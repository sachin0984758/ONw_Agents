import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { MemoryStore, retrieveMemory, memoryScore } from '../src/context/memory.ts'
import { migrateConfig } from '../src/config/migrate.ts'
import { CapabilityRegistry } from '../src/providers/capabilities.ts'
import { ActionJournal } from '../src/core/journal.ts'
import { BackupStore } from '../src/core/backups.ts'
import { mapBounded } from '../src/core/scheduler.ts'
import { runAgent } from '../src/core/run.ts'
import { SessionStore } from '../src/sessions/store.ts'
import type { AgentEvent } from '../src/core/events.ts'
import { parseArgs } from '../src/cli/args.ts'
import { PolicyEngine } from '../src/policy/engine.ts'
import { ApprovingBroker, DenyingBroker, MockProvider, emptySkills, mockTarget, removeDir, repoContext, tempDir, testConfig, textResponse, toolResponse } from './helpers.ts'

async function fixture() {
  const root = await tempDir('agenthub-advanced-')
  const workspace = path.join(root, 'workspace')
  const home = path.join(root, 'home')
  await fs.mkdir(workspace); await fs.mkdir(home)
  const config = testConfig(workspace, home)
  return { root, workspace, home, config }
}

test('explicit memory extraction, categorized updates, expiry and lexical retrieval preserve exact user facts', async () => {
  const f = await fixture()
  try {
    const store = new MemoryStore(f.config)
    assert.deepEqual(await store.extract('The assistant thinks the project uses Rust.'), [])
    const [fact] = await store.extract('remember decision: Use SQLite for the project database')
    assert.equal(fact?.text, 'Use SQLite for the project database')
    assert.equal(fact?.source, 'explicit-user-request')
    assert.equal(fact?.category, 'decision')
    await store.extract('remember decision: use sqlite for the project database')
    assert.equal((await store.list()).length, 1)
    await store.put('Use PostgreSQL for the project database', 'decision', { id: fact!.id })
    const expired = await store.put('Temporary database migration', 'history', { expiresAt: '2000-01-01' })
    assert.equal((await store.list()).length, 1)
    assert.equal((await store.list(true)).length, 2)
    f.config.memory = true; f.config.memoryBudgetBytes = 256
    const selected = await retrieveMemory(f.config, 'project database')
    assert.ok(selected.some((row) => row.text.includes('PostgreSQL')))
    assert.ok(selected.every((row) => !row.text.includes('Temporary')))
    assert.ok(selected.reduce((sum, row) => sum + Buffer.byteLength(row.text), 0) <= 256)
    assert.ok(memoryScore('Use PostgreSQL database', 'database') > memoryScore('Use React UI', 'database'))
    await store.remove(expired.id)
    await assert.rejects(store.put('token=abcdefghijklmnopqrstuvwx'), /secret/)
    assert.equal(JSON.stringify(await store.list(true)).includes('abcdefghijklmnopqrstuvwx'), false)
    assert.equal((await new MemoryStore({ ...f.config, workspace: f.home }).list()).length, 0)
  } finally { await removeDir(f.root) }
})

test('concurrent memory additions are serialized without losing facts', async () => {
  const f = await fixture()
  try {
    await Promise.all(Array.from({ length: 8 }, (_, i) => new MemoryStore(f.config).put(`Distinct project fact ${i}`)))
    assert.equal((await new MemoryStore(f.config).list()).length, 8)
  } finally { await removeDir(f.root) }
})

test('version migration preserves unknown values and original bytes, previews and rejects future schemas', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.home, 'config.json')
    const before = '{ "provider": "lmstudio", "customFuture": {"x":7} }\r\n'
    await fs.writeFile(file, before)
    assert.equal((await migrateConfig(file, true)).changed, true)
    assert.equal(await fs.readFile(file, 'utf8'), before)
    const migrated = await migrateConfig(file)
    assert.equal(await fs.readFile(migrated.backup!, 'utf8'), before)
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { provider: 'lmstudio', customFuture: { x: 7 }, schemaVersion: 1 })
    assert.equal((await migrateConfig(file)).changed, false)
    await fs.writeFile(file, '{"schemaVersion":99}')
    await assert.rejects(migrateConfig(file), /Unsupported/)
    assert.equal(await fs.readFile(file, 'utf8'), '{"schemaVersion":99}')
    assert.equal(parseArgs(['config', 'migrate', '--user']).subcommand, 'migrate')
    assert.equal(parseArgs(['--json', 'backups', 'prune', '--dry-run']).subcommand, 'prune')
    assert.equal(parseArgs(['--review', '--yes', 'inspect']).review, true)
  } finally { await removeDir(f.root) }
})

test('capability observations are scoped to endpoint and model; explicit configuration wins', async () => {
  const f = await fixture()
  try {
    const registry = new CapabilityRegistry(f.home)
    const provider = new MockProvider(() => textResponse('')).config
    assert.deepEqual(await registry.get(provider, 'vision-model'), {})
    await registry.observe(provider, 'vision-model', 'tools', true)
    assert.equal((await registry.get(provider, 'vision-model')).tools?.source, 'observed')
    assert.deepEqual(await registry.get({ ...provider, baseUrl: 'http://127.0.0.1:77/v1' }, 'vision-model'), {})
    assert.deepEqual(await registry.get(provider, 'other-model'), {})
    assert.equal((await registry.get({ ...provider, capabilities: { tools: false, json: true } }, 'vision-model')).tools?.supported, false)
    const stored = JSON.parse(await fs.readFile(registry.file, 'utf8'))
    stored[0].capabilities.tools.at = '2000-01-01'
    await fs.writeFile(registry.file, JSON.stringify(stored))
    assert.deepEqual(await registry.get(provider, 'vision-model'), {})
  } finally { await removeDir(f.root) }
})

test('write-ahead recovery observes file bytes and never replays unknown side effects', async () => {
  const f = await fixture()
  try {
    const journal = new ActionJournal(f.config, 'session')
    await journal.start('run', 'write', 'write_file', { path: 'proof.txt', content: 'secret original content' })
    await fs.writeFile(path.join(f.workspace, 'proof.txt'), 'secret original content')
    await journal.start('run', 'shell', 'run_command', { command: 'secret-command' })
    const result = await journal.recover()
    assert.equal(result.observedApplied, 1)
    assert.equal(result.unresolved.length, 1)
    assert.equal((await journal.recover()).observedApplied, 0)
    const bytes = await fs.readFile(journal.file, 'utf8')
    assert.equal(bytes.includes('secret original content'), false)
    assert.equal(bytes.includes('secret-command'), false)
    await fs.appendFile(journal.file, '{"interrupted"')
    await assert.rejects(journal.recover(), /interrupted final record/)
  } finally { await removeDir(f.root) }
})

test('bounded scheduler respects concurrency and waits for other workers before rejecting', async () => {
  let active = 0, peak = 0, finished = 0
  const values = await mapBounded([1, 2, 3, 4], 2, async (item) => {
    active++; peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--; return item * 2
  })
  assert.deepEqual(values, [2, 4, 6, 8]); assert.equal(peak, 2)
  await assert.rejects(mapBounded([1, 2], 2, async (item) => {
    if (item === 1) throw new Error('worker failed')
    await new Promise((resolve) => setTimeout(resolve, 20)); finished++
  }), /worker failed/)
  assert.equal(finished, 1)
})

test('backup retention previews, prunes only known fingerprints and preserves the latest undo', async () => {
  const f = await fixture()
  try {
    const store = new BackupStore(f.config)
    const file = path.join(f.workspace, 'proof.txt')
    await fs.writeFile(file, 'zero')
    for (const content of ['one', 'two', 'three']) { await store.backup(file, content); await fs.writeFile(file, content) }
    f.config.backupMaxEntries = 1
    const orphan = path.join(store.root, 'orphan-original.txt')
    await fs.writeFile(orphan, 'preserve me')
    const before = await store.list()
    const preview = await store.prune()
    assert.equal(preview.removed, 2); assert.equal((await store.list()).length, 3)
    const result = await store.prune(false)
    assert.equal(result.removed, 2)
    assert.ok(result.manifest)
    assert.ok(result.orphans.includes(orphan))
    assert.equal(await fs.readFile(orphan, 'utf8'), 'preserve me')
    await assert.rejects(fs.access(before[2]!.backup!), { code: 'ENOENT' })
    await store.restoreLast()
    assert.equal(await fs.readFile(file, 'utf8'), 'two')
  } finally { await removeDir(f.root) }
})

async function runFixture(f: Awaited<ReturnType<typeof fixture>>, provider: MockProvider, broker = new ApprovingBroker(), repo = repoContext(f.workspace)) {
  const store = new SessionStore(f.config)
  const session = store.create({ task: 'test task', workspace: f.workspace, provider: 'mock', model: 'mock-model', permissionMode: f.config.permissionMode })
  const events: AgentEvent[] = []
  const result = await runAgent({ task: 'test task', config: f.config, target: mockTarget(provider), session, store, skills: emptySkills(), repo, broker, signal: new AbortController().signal, events: (event) => events.push(event) })
  return { result, session, events, store }
}

test('automatic post-edit verification runs discovered checks and rejects a failing test despite model success', async () => {
  const f = await fixture()
  try {
    f.config.verification = true; f.config.permissionMode = 'ask'
    await fs.writeFile(path.join(f.workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(1)"' } }))
    const repo = repoContext(f.workspace); repo.packageManager = 'npm'; repo.scripts = { test: 'node -e "process.exit(1)"' }
    const provider = new MockProvider((_, i) => i === 0 ? toolResponse('write_file', { path: 'index.js', content: 'export const x = 1\n' }) : textResponse('Everything passed!'))
    const run = await runFixture(f, provider, new ApprovingBroker(), repo)
    assert.equal(run.result.status, 'partial')
    assert.ok(run.result.commands.some((c) => c.command === 'npm run test' && c.exitCode !== 0))
    assert.ok(run.result.limitations.some((s) => /test:/.test(s)))
    assert.ok(run.events.some((e) => e.type === 'tool_proposed' && e.name === 'run_command'))
  } finally { await removeDir(f.root) }
})

test('automatic verification catches changed output and never bypasses denied check commands', async () => {
  const f = await fixture()
  try {
    f.config.verification = true; f.config.permissionMode = 'ask'
    const repo = repoContext(f.workspace); repo.packageManager = 'npm'; repo.scripts = { test: 'ignored' }
    let approvals = 0
    const broker = new ApprovingBroker()
    broker.request = async (req) => { approvals++; return { approved: req.tool === 'write_file', remember: false } }
    const provider = new MockProvider(async (_, i) => {
      if (i === 0) return toolResponse('write_file', { path: 'index.js', content: 'agent bytes' })
      await fs.writeFile(path.join(f.workspace, 'index.js'), 'later user edit')
      return textResponse('Done')
    })
    const run = await runFixture(f, provider, broker, repo)
    assert.equal(run.result.status, 'partial')
    assert.ok(approvals >= 2)
    assert.equal(run.result.commands.length, 0)
    assert.equal(await fs.readFile(path.join(f.workspace, 'index.js'), 'utf8'), 'later user edit')
    assert.ok(run.result.limitations.some((s) => /no longer matches/.test(s)))
  } finally { await removeDir(f.root) }
})

test('specialist pools run independent child sessions read-only and cannot create files', async () => {
  const f = await fixture()
  try {
    f.config.agentConcurrency = 2; f.config.maxAgents = 2; f.config.maxSteps = 5
    const provider = new MockProvider((request) => {
      const role = request.messages[0]?.content ?? ''
      const hasTool = request.messages.some((m) => m.role === 'tool')
      if (role.includes('Assigned responsibility:')) return hasTool ? textResponse('attempted') : toolResponse('write_file', { path: 'escape.txt', content: 'must not write' })
      return hasTool ? textResponse('parent done') : toolResponse('run_agents', { tasks: [{ role: 'reviewer', task: 'Review' }, { role: 'researcher', task: 'Research' }] })
    })
    const run = await runFixture(f, provider)
    await assert.rejects(fs.access(path.join(f.workspace, 'escape.txt')), { code: 'ENOENT' })
    assert.equal((await run.store.list()).length, 3)
    assert.equal(run.result.status, 'partial')
    assert.equal(run.events.filter((e) => e.type === 'subagent_started').length, 2)
  } finally { await removeDir(f.root) }
})

test('read-only runtime schedules independent reads together and preserves tool result ordering', async () => {
  const f = await fixture()
  try {
    f.config.permissionMode = 'read-only'; f.config.toolConcurrency = 2
    await fs.writeFile(path.join(f.workspace, 'a.txt'), 'A'); await fs.writeFile(path.join(f.workspace, 'b.txt'), 'B')
    const provider = new MockProvider((_, i) => {
      if (i) return textResponse('read both')
      const a = toolResponse('read_file', { path: 'a.txt' }); const b = toolResponse('read_file', { path: 'b.txt' })
      b.toolCalls[0]!.id = 'second'; a.toolCalls.push(...b.toolCalls); return a
    })
    const run = await runFixture(f, provider)
    assert.equal(run.result.status, 'completed')
    const firstResult = run.events.findIndex((e) => e.type === 'tool_result')
    assert.equal(run.events.slice(0, firstResult).filter((e) => e.type === 'tool_started').length, 2)
    assert.deepEqual(run.session.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id), ['call_test_1', 'second'])
  } finally { await removeDir(f.root) }
})

test('failed proposed-action checkpoint prevents mutation and unknown recovery never triggers execution', async () => {
  const f = await fixture()
  try {
    const store = new SessionStore(f.config)
    store.save = async () => { throw new Error('disk unavailable') }
    const session = store.create({ task: 'write', workspace: f.workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
    const provider = new MockProvider(() => toolResponse('write_file', { path: 'no.txt', content: 'no' }))
    const result = await runAgent({ task: 'write', config: f.config, target: mockTarget(provider), session, store, skills: emptySkills(), repo: repoContext(f.workspace), broker: new DenyingBroker(), signal: new AbortController().signal, events: () => undefined })
    assert.equal(result.status, 'failed')
    await assert.rejects(fs.access(path.join(f.workspace, 'no.txt')), { code: 'ENOENT' })
    const journal = new ActionJournal(f.config, session.id)
    await journal.start('prior', 'unknown', 'run_command', { command: 'DO_NOT_EXECUTE' })
    store.save = async () => undefined
    const second = new MockProvider(() => textResponse('all done'))
    const recovered = await runAgent({ task: 'status', config: f.config, target: mockTarget(second), session, store, skills: emptySkills(), repo: repoContext(f.workspace), broker: new DenyingBroker(), signal: new AbortController().signal, events: () => undefined, resumed: true })
    assert.equal(recovered.status, 'partial')
    assert.equal(recovered.commands.length, 0)
    assert.ok(recovered.limitations.some((s) => /unknown outcomes/.test(s)))
  } finally { await removeDir(f.root) }
})

test('automatic memory extraction requests approval and read-only hard denial cannot be overridden', async () => {
  const f = await fixture()
  try {
    f.config.memory = true; f.config.memoryAutoExtract = true; f.config.permissionMode = 'read-only'
    f.config.allowRules = ['memory.write:*']; f.config.autoApprove = true
    assert.equal(new PolicyEngine(f.config).evaluate({ kind: 'memory.write', scope: 'project' }).decision, 'deny')
    const store = new SessionStore(f.config)
    const task = 'remember fact: Exact durable project fact'
    const run = async (broker: ApprovingBroker | DenyingBroker) => runAgent({ task, config: f.config,
      target: mockTarget(new MockProvider(() => textResponse('acknowledged'))),
      session: store.create({ task, workspace: f.workspace, provider: 'mock', model: 'mock-model', permissionMode: f.config.permissionMode }),
      store, skills: emptySkills(), repo: repoContext(f.workspace), broker,
      signal: new AbortController().signal, events: () => undefined })
    const readOnlyBroker = new ApprovingBroker()
    assert.equal((await run(readOnlyBroker)).status, 'partial')
    assert.equal(readOnlyBroker.requests.length, 0)
    assert.equal((await new MemoryStore(f.config).list()).length, 0)
    f.config.permissionMode = 'ask'; f.config.allowRules = []; f.config.autoApprove = false
    const denied = new DenyingBroker()
    assert.equal((await run(denied)).status, 'partial')
    assert.equal(denied.requests.length, 1)
    assert.equal((await new MemoryStore(f.config).list()).length, 0)
    const approved = new ApprovingBroker()
    assert.equal((await run(approved)).status, 'completed')
    assert.equal(approved.requests.length, 1)
    assert.equal((await new MemoryStore(f.config).list())[0]?.text, 'Exact durable project fact')
  } finally { await removeDir(f.root) }
})
