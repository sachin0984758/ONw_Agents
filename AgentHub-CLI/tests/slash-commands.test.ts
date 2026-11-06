import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { setImmediate, setTimeout } from 'node:timers/promises'
import { stripVTControlCharacters, promisify } from 'node:util'
import test from 'node:test'
import { runTui } from '../src/cli/tui.ts'
import { SLASH_COMMANDS } from '../src/cli/slash-commands.ts'
import { BackupStore } from '../src/core/backups.ts'
import { SessionStore } from '../src/sessions/store.ts'
import type { ProviderConfig } from '../src/config/types.ts'
import { emptySkills, MockProvider, mockTarget, removeDir, tempDir, testConfig, textResponse, toolResponse } from './helpers.ts'

const exec = promisify(execFile)
const plain = (text: string) => stripVTControlCharacters(text.replace(/\u001b[78]/g, ''))

async function fixture(provider = new MockProvider(() => textResponse('ANSWER_OK'))) {
  const root = await tempDir('agenthub-slash-')
  const workspace = path.join(root, 'workspace')
  const home = path.join(root, 'home')
  await fs.mkdir(workspace, { recursive: true })
  await fs.mkdir(home, { recursive: true })
  const chatRequests: Array<{ url: string; model: string }> = []
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith('/chat/completions')) {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model: string }
        chatRequests.push({ url: req.url ?? '', model: body.model })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: 'HTTP_TARGET_OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4 } }))
      })
      return
    }
    const ids = req.url?.startsWith('/alternate') ? ['alternate-model'] : ['mock-model', 'second-model']
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const providers: ProviderConfig[] = [
    { id: 'mock', kind: 'openai-compatible', baseUrl: `${baseUrl}/v1`, local: true },
    { id: 'alternate', kind: 'openai-compatible', baseUrl: `${baseUrl}/alternate/v1`, local: true },
    { id: 'offline', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', local: true, timeoutMs: 100 },
  ]
  const config = testConfig(workspace, home, { providers, permissionMode: 'ask' })
  const store = new SessionStore(config)
  const session = store.create({ task: 'Original session', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'ask' })
  session.status = 'completed'
  session.turns = 1
  session.messages = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `message ${index}` }))
  session.plan = [{ title: 'Keep this plan title', status: 'active' }]
  session.usage = { input: 64, output: 32 }
  await store.save(session)
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined })
  const output = Object.assign(new PassThrough(), { columns: 120, rows: 30 })
  let printed = ''
  let ended = false
  const invoked = new Set<string>()
  output.on('data', (chunk: Buffer) => { printed += chunk.toString() })
  const running = runTui({ config, store, session, skills: emptySkills(), target: mockTarget(provider), terminal: { input, output } })
  void running.finally(() => { ended = true })
  const ready = async (after = 0) => {
    await setImmediate()
    const deadline = Date.now() + 6000
    while (!(printed.length > after && printed.endsWith('\u001b[?25h')) && !ended && Date.now() < deadline) await setTimeout(10)
    assert.equal(ended, false, `TUI exited unexpectedly: ${plain(printed).slice(-900)}`)
    assert.ok(printed.length > after && printed.endsWith('\u001b[?25h'), 'terminal did not return to input')
  }
  await ready()
  return {
    root, workspace, home, config, store, session, provider, invoked, chatRequests,
    async send(command: string) {
      if (command.startsWith('/')) invoked.add(command.split(/\s/)[0] ?? '')
      const before = printed.length
      input.write(`${command}\r`)
      await ready(before)
      return plain(printed.slice(before))
    },
    async finish(command = '/quit') {
      invoked.add(command)
      input.write(`${command}\r`)
      return await running
    },
    async dispose() {
      if (!ended) { input.write('\u0004'); await running }
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await removeDir(root)
    },
  }
}

test('all 18 advertised slash commands execute real handlers and their expected effects', async () => {
  const f = await fixture()
  try {
    const skill = path.join(f.workspace, '.agenthub', 'skills', 'check-skill')
    await fs.mkdir(skill, { recursive: true })
    await fs.writeFile(path.join(skill, 'SKILL.md'), '---\nname: check-skill\ndescription: Command verification skill.\n---\nExplain the workspace.\n')
    const file = path.join(f.workspace, 'sample.txt')
    await fs.writeFile(file, 'before\n')
    await exec('git', ['init', '--quiet'], { cwd: f.workspace, windowsHide: true })
    await exec('git', ['add', 'sample.txt'], { cwd: f.workspace, windowsHide: true })
    await new BackupStore(f.config).backup(file, 'after\n')
    await fs.writeFile(file, 'after\n')
    const help = await f.send('/help')
    for (const { name } of SLASH_COMMANDS) assert.ok(help.includes(name))
    assert.match(await f.send('/status'), /Original session|session: ses_/)
    assert.match(await f.send('/skills'), /check-skill/)
    assert.match(await f.send('/memory'), /Memory \(project\)/)
    assert.match(await f.send('/skill check-skill'), /Loaded check-skill/)
    assert.ok((await f.store.load(f.session.id)).activeSkills.includes('check-skill'))
    assert.match(await f.send('/plan'), /\[active\] Keep this plan title/)
    assert.match(await f.send('/diff'), /\+after/)
    assert.match(await f.send('/undo'), /Restored/)
    assert.equal(await fs.readFile(file, 'utf8'), 'before\n')
    assert.match(await f.send('/permissions read-only'), /Permission mode: read-only/)
    assert.equal(f.config.permissionMode, 'read-only')
    assert.match(await f.send('/usage'), /session: 64 in \/ 32 out/)
    assert.match(await f.send('/compact'), /Compacted 21 .* 11 messages/)
    assert.equal((await f.store.load(f.session.id)).messages.length, 11)
    assert.match(await f.send('/model second-model'), /mock \/ second-model/)
    assert.equal(f.config.model, 'second-model')
    assert.match(await f.send('/provider alternate'), /alternate \/ alternate-model/)
    assert.equal(f.config.provider, 'alternate')
    assert.match(await f.send('Confirm switched provider'), /HTTP_TARGET_OK/)
    assert.deepEqual(f.chatRequests, [{ url: '/alternate/v1/chat/completions', model: 'alternate-model' }])
    const clear = await f.send('/clear')
    const fresh = clear.match(/New session (ses_[a-z0-9_]+)/)?.[1]
    assert.ok(fresh)
    assert.notEqual(fresh, f.session.id)
    assert.equal((await f.store.load(fresh)).messages.length, 0)
    assert.match(await f.send('/sessions'), new RegExp(f.session.id))
    assert.match(await f.send(`/resume ${f.session.id}`), new RegExp(`Resumed ${f.session.id}`))
    assert.match(await f.send('/verbose'), /verbose: on/)
    assert.match(await f.send('/verbose'), /verbose: off/)
    assert.equal(await f.finish(), 0)
    assert.deepEqual([...f.invoked].sort(), SLASH_COMMANDS.map((command) => command.name).sort())
  } finally { await f.dispose() }
})

test('memory slash command lists, searches, and deletes project and user entries', async () => {
  const f = await fixture()
  try {
    const projectDir = path.join(f.workspace, '.agenthub')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.writeFile(path.join(projectDir, 'memory.md'), '- Prefer Rust examples\n- Project uses TypeScript\n', 'utf8')
    await fs.writeFile(path.join(f.home, 'memory.md'), '- Use concise answers\n', 'utf8')

    assert.match(await f.send('/memory'), /1\. Prefer Rust examples[\s\S]*2\. Project uses TypeScript/)
    const search = plain(await f.send('/memory search rust'))
    const searchResult = search.slice(search.lastIndexOf('Memory search (project): rust'))
    assert.match(searchResult, /Prefer Rust examples/)
    assert.doesNotMatch(searchResult, /Project uses TypeScript/)
    assert.match(await f.send('/memory list --user'), /Use concise answers/)
    assert.match(await f.send('/memory delete 1'), /Removed: Prefer Rust examples/)
    assert.equal(await fs.readFile(path.join(projectDir, 'memory.md'), 'utf8'), '- Project uses TypeScript\n')
    assert.match(await f.send('/memory delete 1 --user'), /Removed: Use concise answers/)
    assert.equal(await fs.readFile(path.join(f.home, 'memory.md'), 'utf8'), '\n')
    assert.equal(await f.finish(), 0)
  } finally { await f.dispose() }
})

test('invalid model/provider/permission commands retain the active settings and leave the TUI usable', async () => {
  const f = await fixture()
  try {
    assert.match(await f.send('/model'), /mock-model/)
    assert.match(await f.send('/provider'), /mock/)
    await f.send('/provider missing-provider')
    assert.equal(f.config.provider, 'mock')
    assert.equal(f.config.model, 'mock-model')
    await f.send('/provider offline')
    assert.equal(f.config.provider, 'mock')
    await f.send('/model missing-model')
    assert.equal(f.config.model, 'mock-model')
    await f.send('/permissions toString')
    assert.equal(f.config.permissionMode, 'ask')
    assert.match(await f.send('/status'), /model: mock \/ mock-model/)
    assert.match(await f.send('/skill missing'), /No skill named/)
    assert.match(await f.send('/skill'), /Usage: \/skill/)
    assert.match(await f.send('/resume bad-id'), /Invalid session id/)
    assert.match(await f.send('/unknown'), /Unknown command/)
    assert.equal(await f.finish('/exit'), 0)
  } finally { await f.dispose() }
})

test('plan titles survive live step updates, and clear/resume do not expose previous request usage', async () => {
  const provider = new MockProvider((_request, index) => index === 0
    ? toolResponse('set_plan', { steps: ['Retain actual step title'] })
    : index === 1 ? toolResponse('update_plan', { index: 1, status: 'completed' }) : textResponse('PLAN_OK'))
  const f = await fixture(provider)
  try {
    await f.send('Create and complete a plan')
    assert.match(await f.send('/plan'), /\[completed\] Retain actual step title/)
    await f.send('/clear')
    assert.doesNotMatch(await f.send('/usage'), /last request:|last run:/)
    assert.match(await f.send('/plan'), /No plan yet/)
    assert.match(await f.send('/resume last'), new RegExp(`Resumed ${f.session.id}`))
    assert.match(await f.send('/plan'), /Retain actual step title/)
    assert.equal(provider.calls.length, 3, 'resuming must not replay tools')
    assert.equal(await f.finish(), 0)
  } finally { await f.dispose() }
})

test('undo errors do not exit the TUI and cannot restore outside the workspace', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.workspace, 'file.txt')
    await fs.writeFile(file, 'before')
    const backups = new BackupStore(f.config)
    const backup = await backups.backup(file, 'after')
    assert.ok(backup.backup)
    await fs.writeFile(file, 'after')
    await fs.rm(backup.backup)
    assert.match(await f.send('/undo'), /ENOENT|backup/i)
    assert.equal(await fs.readFile(file, 'utf8'), 'after')
    assert.match(await f.send('/status'), /permission: ask/)
    const outside = path.join(f.root, 'outside.txt')
    await fs.writeFile(outside, 'keep')
    await fs.writeFile(path.join(backups.root, 'index.json'), JSON.stringify([{ at: new Date().toISOString(), original: outside, existed: false, backup: null }]))
    assert.match(await f.send('/undo'), /outside|escape/i)
    assert.equal(await fs.readFile(outside, 'utf8'), 'keep')
    await fs.writeFile(path.join(backups.root, 'index.json'), JSON.stringify([{
      at: new Date().toISOString(),
      original: file,
      existed: true,
      backup: outside,
      expectedHash: createHash('sha256').update('after').digest('hex'),
      originalHash: '0'.repeat(64),
    }]))
    assert.match(await f.send('/undo'), /outside|escape/i)
    assert.equal(await fs.readFile(file, 'utf8'), 'after')
    assert.equal(await f.finish(), 0)
  } finally { await f.dispose() }
})

test('usage accumulates across turns while last-run and last-request totals stay separate', async () => {
  const f = await fixture()
  try {
    await f.send('first turn')
    await f.send('second turn')
    const usage = await f.send('/usage')
    assert.match(usage, /session: 84 in \/ 40 out/)
    assert.match(usage, /last run: 10 in \/ 4 out/)
    assert.match(usage, /last request: 10 in \/ 4 out/)
    assert.deepEqual((await f.store.load(f.session.id)).usage, { input: 84, output: 40 })
    assert.equal(await f.finish(), 0)
  } finally { await f.dispose() }
})

test('empty states, permission modes, duplicate skills, undo creation, and compact no-op remain usable', async () => {
  const f = await fixture()
  try {
    assert.match(await f.send('/skills'), /No skills installed/)
    assert.match(await f.send('/diff'), /No Git repository/)
    assert.match(await f.send('/undo'), /Nothing to undo/)
    assert.match(await f.send('/permissions'), /mode: ask/)
    for (const mode of ['read-only', 'auto', 'bypass', 'ask'] as const) {
      await f.send(`/permissions ${mode}`)
      assert.equal(f.config.permissionMode, mode)
      assert.equal((await f.store.load(f.session.id)).permissionMode, mode)
    }
    const skill = path.join(f.workspace, '.agenthub', 'skills', 'duplicate-skill')
    await fs.mkdir(skill, { recursive: true })
    await fs.writeFile(path.join(skill, 'SKILL.md'), '---\nname: duplicate-skill\ndescription: Check repeated activation.\n---\nInstructions.\n')
    await f.send('/skill duplicate-skill')
    const before = (await f.store.load(f.session.id)).messages.length
    assert.match(await f.send('/skill duplicate-skill'), /already loaded/)
    assert.equal((await f.store.load(f.session.id)).messages.length, before)
    const file = path.join(f.workspace, 'new.txt')
    await new BackupStore(f.config).backup(file, 'new content')
    await fs.writeFile(file, 'new content')
    assert.match(await f.send('/undo'), /Removed/)
    await assert.rejects(fs.access(file))
    await f.send('/clear')
    assert.match(await f.send('/compact'), /Compacted 0 .* 0 messages/)
    assert.equal(await f.finish(), 0)
  } finally { await f.dispose() }
})

test('storage failures keep commands usable and quit reports failed persistence honestly', async () => {
  const f = await fixture()
  try {
    await fs.rename(f.config.sessionsDir, `${f.config.sessionsDir}-preserved`)
    await fs.writeFile(f.config.sessionsDir, 'not a directory')
    assert.match(await f.send('/compact'), /EEXIST|ENOTDIR/i)
    assert.match(await f.send('/status'), /session: ses_/)
    assert.equal(await f.finish(), 1)
  } finally { await f.dispose() }
})
