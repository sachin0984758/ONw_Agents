import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stageStandaloneAssets } from './build.mjs'

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-storage-'))
  const previousDb = process.env.AGENT_HUB_DB_DIR
  const previousRoot = process.env.AGENTHUB_PROJECT_ROOT
  process.env.AGENT_HUB_DB_DIR = fixture
  delete process.env.AGENTHUB_PROJECT_ROOT
  let passed = 0
  const check = (name: string, value: unknown) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`) }
  try {
    const store = await import('../src/lib/agent-hub/chat-store')
    const { createSerializer, writeJsonAtomic } = await import('../src/lib/agent-hub/fs-atomic')
    const { resolveProjectRoot, resolveDbDir } = await import('../src/lib/agent-hub/db-path')
    const { isCrossOrigin } = await import('../src/lib/agent-hub/request-origin')
    const { relativeProjectPath } = await import('../src/lib/agent-hub/session/paths')
    const headers = (origin?: string, host = 'localhost:3000', fetchSite?: string, protocol = 'http:') => ({
      headers: new Headers({ host, ...(origin === undefined ? {} : { origin }), ...(fetchSite ? { 'sec-fetch-site': fetchSite } : {}) }),
      url: `${protocol}//${host}/api/check`,
    })
    check('CLI calls without Origin retain compatibility on loopback', !isCrossOrigin(headers()))
    check('same host and port retain access', !isCrossOrigin(headers('http://localhost:3000')))
    check('127.0.0.1 same-origin requests are accepted', !isCrossOrigin(headers('http://127.0.0.1:3000', '127.0.0.1:3000')))
    check('Next canonical localhost URL accepts the actual loopback Host on the same port', !isCrossOrigin({ headers: new Headers({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }), url: 'http://localhost:3000/api/check' }))
    check('IPv6 loopback same-origin requests are accepted', !isCrossOrigin(headers('http://[::1]:3000', '[::1]:3000')))
    for (const origin of ['https://evil.example', 'http://localhost:3001', 'null', 'not-a-url', 'http://localhost:3000/path', 'http://user@localhost:3000']) check(`invalid or different origin is rejected: ${origin}`, isCrossOrigin(headers(origin)))
    check('attacker-controlled DNS-rebinding host is refused even when Origin matches it', isCrossOrigin(headers('http://rebind.example:3000', 'rebind.example:3000')))
    check('non-loopback Host is refused when Origin is absent', isCrossOrigin(headers(undefined, 'rebind.example:3000')))
    check('scheme-changing Origin is refused', isCrossOrigin(headers('https://localhost:3000')))
    check('cross-site Fetch Metadata is refused without Origin', isCrossOrigin(headers(undefined, 'localhost:3000', 'cross-site')))
    check('same-site Fetch Metadata is refused without Origin', isCrossOrigin(headers(undefined, 'localhost:3000', 'same-site')))
    check('same-origin Fetch Metadata retains Origin-less CLI compatibility', !isCrossOrigin(headers(undefined, 'localhost:3000', 'same-origin')))
    check('missing Host cannot authorize a supplied Origin', isCrossOrigin({ headers: new Headers({ origin: 'http://localhost:3000' }), url: 'http://localhost:3000/api/check' }))
    check('relative Windows-style paths normalize', relativeProjectPath('.\\src\\app\\', 'invalid') === 'src/app')
    for (const value of ['../outside', 'src/../../outside', 'C:\\outside', '\\outside', '//server/share', 'src\0bad']) {
      assert.throws(() => relativeProjectPath(value, 'denied'), /denied/); check(`path escape is refused: ${JSON.stringify(value)}`, true)
    }
    check('default build keeps data outside generated output', resolveProjectRoot(path.join(fixture, '.next', 'standalone')) === fixture)
    check('isolated build keeps data outside generated output', resolveProjectRoot(path.join(fixture, '.next-qa', 'standalone')) === fixture)
    check('ordinary folders named standalone are preserved', resolveProjectRoot(path.join(fixture, 'application', 'standalone')) === path.join(fixture, 'application', 'standalone'))
    process.env.AGENTHUB_PROJECT_ROOT = fixture
    check('launcher project root works for arbitrary custom build names', resolveProjectRoot(path.join(fixture, 'custom-output', 'standalone')) === fixture)
    check('explicit DB override retains precedence', resolveDbDir() === fixture)
    delete process.env.AGENTHUB_PROJECT_ROOT

    const thread = await store.createChatConversation()
    check('new thread is visible through the shared listing', (await store.listChatConversations()).some((item) => item.id === thread.id && item.messageCount === 0))
    check('invalid thread ids cannot traverse storage', await store.readThread('../chat-history') === null)
    const message = (content: string): import('../src/lib/agent-hub/chat-store').StoredChatMessage => ({ id: crypto.randomUUID(), role: 'user', content, time: new Date().toISOString(), kind: 'chat' })
    await store.serializeChat(() => store.writeHistory([message('Teach SQL')], thread.id))
    check('conversation metadata and history share the same file', (await store.readThread(thread.id))?.title === 'Teach SQL' && (await store.readHistory(thread.id)).length === 1)
    await Promise.all(Array.from({ length: 8 }, (_, index) => store.serializeChat(async () => {
      const current = await store.readHistory(thread.id)
      await store.writeHistory([...current, message(`append-${index}`)], thread.id)
    })))
    check('serialized concurrent appends do not lose messages', (await store.readHistory(thread.id)).length === 9)
    await store.renameChatConversation(thread.id, 'Renamed')
    check('rename preserves conversation messages', (await store.readThread(thread.id))?.title === 'Renamed' && (await store.readHistory(thread.id)).length === 9)
    await store.serializeChat(() => store.writeHistory(Array.from({ length: 250 }, (_, index) => message(String(index))), thread.id))
    const bounded = await store.readHistory(thread.id)
    check('stored history retains the newest 200 messages', bounded.length === 200 && bounded[0].content === '50')
    await store.serializeChat(() => store.clearHistory(thread.id))
    check('clear keeps the same thread identity and title', (await store.readHistory(thread.id)).length === 0 && (await store.readThread(thread.id))?.title === 'Renamed')
    check('deletion removes the same thread from all readers', await store.deleteChatConversation(thread.id) && await store.readThread(thread.id) === null && !(await store.listChatConversations()).some((item) => item.id === thread.id))
    await assert.rejects(store.writeHistory([message('late reply')], thread.id), /no longer exists/)
    check('late writes cannot recreate a deleted thread', await store.readThread(thread.id) === null)
    await fs.writeFile(path.join(fixture, 'chat-history.json'), JSON.stringify([message('Legacy')]))
    check('legacy chat remains readable and listed', (await store.readHistory()).length === 1 && (await store.listChatConversations()).some((item) => item.id === 'legacy'))
    await fs.writeFile(path.join(fixture, 'chat-history.json'), '{invalid')
    check('corrupt legacy data is quarantined without crashing', (await store.readHistory()).length === 0 && (await fs.readdir(fixture)).some((name) => name.startsWith('chat-history.json.corrupt-')))

    const concurrentTarget = path.join(fixture, 'concurrent-state.json')
    await Promise.all(Array.from({ length: 8 }, (_, index) => writeJsonAtomic(concurrentTarget, { index, payload: 'complete'.repeat(100) })))
    const concurrentValue = JSON.parse(await fs.readFile(concurrentTarget, 'utf8')) as { index: number; payload: string }
    check('concurrent atomic replacements leave one complete valid JSON file', Number.isInteger(concurrentValue.index) && concurrentValue.index >= 0 && concurrentValue.index < 8 && concurrentValue.payload === 'complete'.repeat(100))

    const target = path.join(fixture, 'blocked-target')
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, 'keep.txt'), 'untouched')
    await assert.rejects(writeJsonAtomic(target, { test: true }))
    check('failed atomic rename preserves destination', await fs.readFile(path.join(target, 'keep.txt'), 'utf8') === 'untouched')
    check('failed atomic rename cleans only its temporary file', !(await fs.readdir(fixture)).some((name) => name.endsWith('.tmp')))
    const serialize = createSerializer()
    await assert.rejects(serialize(async () => { throw new Error('expected') }))
    check('a failed write does not poison future serialized work', await serialize(async () => 'recovered') === 'recovered')
    const buildRoot = path.join(fixture, 'build-fixture')
    await fs.mkdir(path.join(buildRoot, '.next-custom', 'static'), { recursive: true })
    await fs.mkdir(path.join(buildRoot, 'public'), { recursive: true })
    await fs.writeFile(path.join(buildRoot, '.next-custom', 'static', 'app.js'), 'static')
    await fs.writeFile(path.join(buildRoot, 'public', 'asset.txt'), 'public')
    await stageStandaloneAssets(buildRoot, '.next-custom')
    check('portable build stages custom static directory', await fs.readFile(path.join(buildRoot, '.next-custom', 'standalone', '.next-custom', 'static', 'app.js'), 'utf8') === 'static')
    check('portable build stages public assets', await fs.readFile(path.join(buildRoot, '.next-custom', 'standalone', 'public', 'asset.txt'), 'utf8') === 'public')
    await assert.rejects(stageStandaloneAssets(buildRoot, '../outside'), /inside the project/)
    check('build staging refuses paths outside the project', true)
    console.log(`\n${passed} storage/build boundary checks passed.`)
  } finally {
    if (previousDb === undefined) delete process.env.AGENT_HUB_DB_DIR; else process.env.AGENT_HUB_DB_DIR = previousDb
    if (previousRoot === undefined) delete process.env.AGENTHUB_PROJECT_ROOT; else process.env.AGENTHUB_PROJECT_ROOT = previousRoot
    // Only this freshly created, resolved OS-temp fixture is removed.
    assert.equal(path.dirname(fixture), os.tmpdir())
    await fs.rm(fixture, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
