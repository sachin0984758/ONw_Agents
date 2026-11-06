import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { raceAbort, runAgent } from '../src/core/run.ts'
import { BackupStore } from '../src/core/backups.ts'
import { SessionStore } from '../src/sessions/store.ts'
import { ProviderError, type ChatRequest } from '../src/providers/types.ts'
import type { AgentEvent } from '../src/core/events.ts'
import {
  ApprovingBroker,
  DenyingBroker,
  MockProvider,
  emptySkills,
  mockTarget,
  removeDir,
  repoContext,
  tempDir,
  testConfig,
  textResponse,
  toolResponse,
} from './helpers.ts'

test('tool timeout aborts the in-flight tool signal', async () => {
  const parent = new AbortController()
  let toolSignal: AbortSignal | undefined
  await assert.rejects(
    raceAbort(
      (signal) => new Promise<void>((_resolve, reject) => {
        toolSignal = signal
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
      parent.signal,
      10,
    ),
    /Tool exceeded the 0s runtime limit/,
  )
  assert.ok(toolSignal?.aborted, 'timed-out tool must receive an abort signal')
})

test('an oversized protected prompt stops before sending an invalid model request', async () => {
  const workspace = await tempDir('agenthub-context-ws-')
  const home = await tempDir('agenthub-context-home-')
  try {
    for (const modelLimit of [undefined, 200]) {
      const config = testConfig(workspace, home, { contextTokens: modelLimit ? 20_000 : 200 })
      const store = new SessionStore(config)
      const session = store.create({ task: 'hello', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
      const provider = new MockProvider(() => textResponse('should not be called'))
      const target = mockTarget(provider)
      if (modelLimit) target.models = [{ id: target.model, providerId: 'mock', providerLabel: 'Mock', contextLength: modelLimit }]
      const result = await runAgent({ task: 'hello', config, target, session, store,
        skills: emptySkills(), repo: repoContext(workspace), events: () => undefined,
        broker: new ApprovingBroker(), signal: new AbortController().signal })
      assert.equal(result.status, 'partial')
      assert.equal(provider.calls.length, 0)
      assert.ok(result.limitations.some((item) => /context budget/i.test(item)))
    }
  } finally { await removeDir(workspace); await removeDir(home) }
})

test('a token-limited final response cannot be reported as completed', async () => {
  const workspace = await tempDir('agenthub-truncated-ws-')
  const home = await tempDir('agenthub-truncated-home-')
  try {
    const config = testConfig(workspace, home)
    const store = new SessionStore(config)
    const session = store.create({ task: 'answer', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
    const provider = new MockProvider(() => ({ ...textResponse('unfinished'), finishReason: 'length' }))
    const result = await runAgent({ task: 'answer', config, target: mockTarget(provider), session, store,
      skills: emptySkills(), repo: repoContext(workspace), events: () => undefined,
      broker: new ApprovingBroker(), signal: new AbortController().signal })
    assert.equal(result.status, 'partial')
    assert.ok(result.limitations.some((item) => /token limit/i.test(item)))
  } finally { await removeDir(workspace); await removeDir(home) }
})

test('a token-limited tool-call batch cannot mutate files', async () => {
  const workspace = await tempDir('agenthub-truncated-tools-ws-')
  const home = await tempDir('agenthub-truncated-tools-home-')
  try {
    const config = testConfig(workspace, home)
    const store = new SessionStore(config)
    const session = store.create({ task: 'write', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
    const provider = new MockProvider(() => ({ ...toolResponse('write_file', { path: 'must-not-exist.txt', content: 'truncated batch' }), finishReason: 'length' }))
    const events: AgentEvent[] = []
    const result = await runAgent({ task: 'write', config, target: mockTarget(provider), session, store,
      skills: emptySkills(), repo: repoContext(workspace), events: (event) => events.push(event),
      broker: new ApprovingBroker(), signal: new AbortController().signal })
    assert.equal(result.status, 'partial')
    assert.equal(events.some((event) => event.type === 'tool_started'), false)
    await assert.rejects(fs.access(path.join(workspace, 'must-not-exist.txt')), { code: 'ENOENT' })
  } finally { await removeDir(workspace); await removeDir(home) }
})

test('usage events mark a partially reported token count as estimated', async () => {
  const workspace = await tempDir('agenthub-usage-ws-')
  const home = await tempDir('agenthub-usage-home-')
  try {
    const config = testConfig(workspace, home)
    const store = new SessionStore(config)
    const session = store.create({ task: 'hello', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
    const events: AgentEvent[] = []
    const provider = new MockProvider(() => ({ ...textResponse('Hello'), usage: { input: null, output: 4 } }))
    const result = await runAgent({ task: 'hello', config, target: mockTarget(provider), session, store,
      skills: emptySkills(), repo: repoContext(workspace), events: (event) => events.push(event),
      broker: new ApprovingBroker(), signal: new AbortController().signal })
    assert.equal(result.usageEstimated, true)
    const usage = events.find((event) => event.type === 'usage')
    assert.ok(usage && usage.type === 'usage')
    assert.equal(usage.estimated, true)
    assert.equal(usage.output, 4)
    assert.ok(usage.totalInput > 0)
  } finally { await removeDir(workspace); await removeDir(home) }
})

test('the wall-clock budget aborts an active model request and ignores late text', async () => {
  const workspace = await tempDir('agenthub-deadline-ws-')
  const home = await tempDir('agenthub-deadline-home-')
  try {
    const config = testConfig(workspace, home, { maxWallClockMs: 30 })
    const store = new SessionStore(config)
    const session = store.create({ task: 'answer', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
    let requestSignal: AbortSignal | undefined
    let finishProvider!: () => void
    const provider = new MockProvider(async (request) => {
      requestSignal = request.signal
      await new Promise<void>((resolve) => { finishProvider = resolve; setTimeout(resolve, 300) })
      request.onText?.('LATE_OUTPUT')
      return textResponse('Late answer')
    })
    const events: AgentEvent[] = []
    const result = await runAgent({ task: 'answer', config, target: mockTarget(provider), session, store,
      skills: emptySkills(), repo: repoContext(workspace), events: (event) => events.push(event),
      broker: new ApprovingBroker(), signal: new AbortController().signal })
    assert.equal(result.status, 'partial')
    assert.ok(requestSignal?.aborted)
    assert.ok(result.limitations.some((item) => /Wall-clock budget/.test(item)))
    assert.equal(events.some((event) => event.type === 'run_cancelled'), false)
    finishProvider()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(events.some((event) => event.type === 'assistant_delta'), false)
    assert.equal((await store.load(session.id)).status, 'partial')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('the tool budget is enforced inside a single oversized batch and resume remains valid', async () => {
  const workspace = await tempDir('agenthub-batch-ws-')
  const home = await tempDir('agenthub-batch-home-')
  try {
    const config = testConfig(workspace, home, { maxSteps: 1 })
    const store = new SessionStore(config)
    const session = store.create({ task: 'list', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
    const provider = new MockProvider(() => ({ ...textResponse(''), toolCalls: Array.from({ length: 25 }, (_, index) => ({
      id: `batch_${index}`, type: 'function' as const, function: { name: 'list_dir', arguments: '{}' },
    })) }))
    const events: AgentEvent[] = []
    const result = await runAgent({ task: 'List the workspace', config, target: mockTarget(provider), session, store,
      skills: emptySkills(), repo: repoContext(workspace), events: (event) => events.push(event),
      broker: new ApprovingBroker(), signal: new AbortController().signal })
    assert.equal(result.status, 'partial')
    assert.equal(events.filter((event) => event.type === 'tool_started').length, 20)
    assert.ok(result.limitations.some((item) => /Tool-call budget \(20\)/.test(item)))
    const saved = await store.load(session.id)
    assert.equal(saved.messages.filter((message) => message.role === 'tool').length, 25)
    assert.equal(saved.messages.filter((message) => message.role === 'tool' && message.content?.includes('did not run')).length, 5)
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('a late approval after the deadline cannot create a file', async () => {
  const workspace = await tempDir('agenthub-late-approval-ws-')
  const home = await tempDir('agenthub-late-approval-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'ask', maxWallClockMs: 300 })
    const store = new SessionStore(config)
    const session = store.create({ task: 'write', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'ask' })
    const provider = new MockProvider((_request, index) => index === 0
      ? toolResponse('write_file', { path: 'late.txt', content: 'must not be written' }) : textResponse('Done'))
    const result = await runAgent({ task: 'Create late.txt', config, target: mockTarget(provider), session, store,
      skills: emptySkills(), repo: repoContext(workspace), events: () => undefined,
      broker: { request: async () => { await new Promise((resolve) => setTimeout(resolve, 600)); return { approved: true, remember: true } } },
      signal: new AbortController().signal })
    assert.equal(result.status, 'partial')
    await new Promise((resolve) => setTimeout(resolve, 650))
    await assert.rejects(fs.access(path.join(workspace, 'late.txt')), { code: 'ENOENT' })
    const saved = await store.load(session.id)
    assert.ok(saved.audit.some((entry) => entry.approval === 'cancelled'))
    assert.equal(saved.audit.some((entry) => entry.approval === 'approved'), false)
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('agent loop executes a tool, verifies the file and records evidence', async () => {
  const workspace = await tempDir('agenthub-loop-ws-')
  const home = await tempDir('agenthub-loop-home-')
  try {
    await fs.writeFile(path.join(workspace, 'README.md'), '# test\n', 'utf8')
    const config = testConfig(workspace, home, { permissionMode: 'ask', maxSteps: 4 })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'create a file',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'ask',
    })
    const provider = new MockProvider((request, index) => {
      if (index === 0) return toolResponse('write_file', { path: 'hello.txt', content: 'hello\n' })
      assert.ok(
        request.messages.some((message) => message.role === 'tool'),
        'the second request must include the tool result',
      )
      return textResponse('Created hello.txt.')
    })
    const events: AgentEvent[] = []
    const result = await runAgent({
      task: 'Create hello.txt with hello',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => events.push(event),
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })

    assert.equal(result.status, 'completed')
    assert.equal(result.steps, 2)
    assert.equal(await fs.readFile(path.join(workspace, 'hello.txt'), 'utf8'), 'hello\n')
    assert.deepEqual(result.changedFiles.map((f) => f.path), ['hello.txt'])
    assert.equal(result.changedFiles[0]?.change, 'created')
    assert.equal(session.turns, 1)
    assert.ok(events.some((event) => event.type === 'files_changed'))
    assert.ok(events.some((event) => event.type === 'run_completed'))
    assert.ok(result.usage.input !== null && result.usage.input > 0)

    const saved = await store.load(session.id)
    assert.equal(saved.turns, 1)
    assert.ok(saved.messages.some((message) => message.role === 'tool'))
    assert.ok(saved.audit.some((entry) => entry.decision === 'ask' && entry.approval === 'approved'))
    assert.ok(saved.audit.some((entry) => entry.operation === 'tool.execute' && entry.result === 'succeeded'))
    assert.equal(JSON.stringify(saved.audit).includes('hello\\n'), false, 'audit must not store tool output')

    await fs.writeFile(path.join(workspace, 'hello.txt'), 'later user edit\n', 'utf8')
    await assert.rejects(new BackupStore(config).restoreLast(), /changed after AgentHub created it/)
    assert.equal(await fs.readFile(path.join(workspace, 'hello.txt'), 'utf8'), 'later user edit\n')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('a denied action blocks completion and creates no command evidence', async () => {
  const workspace = await tempDir('agenthub-loop-ws-')
  const home = await tempDir('agenthub-loop-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'ask', maxSteps: 3 })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'run a command',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'ask',
    })
    const broker = new DenyingBroker()
    const provider = new MockProvider((request, index) => {
      if (index === 0) return toolResponse('run_command', { command: 'echo should-not-run' })
      assert.ok(request.messages.some((message) => message.role === 'tool'))
      return textResponse('I could not run the command.')
    })
    const result = await runAgent({
      task: 'Run echo should-not-run',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: () => undefined,
      broker,
      signal: new AbortController().signal,
    })

    assert.equal(result.status, 'partial')
    assert.equal(broker.requests.length, 1)
    assert.equal(result.commands.length, 0)
    assert.ok(result.limitations.some((limitation) => /denied/i.test(limitation)))
    const saved = await store.load(session.id)
    assert.ok(saved.audit.some((entry) => entry.decision === 'ask' && entry.approval === 'denied'))
    assert.ok(saved.audit.some((entry) => entry.operation === 'tool.execute' && entry.result === 'failed'))
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('approval failures are audited with the failure message redacted', async () => {
  const workspace = await tempDir('agenthub-approval-failure-ws-')
  const home = await tempDir('agenthub-approval-failure-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'ask', maxSteps: 3 })
    const store = new SessionStore(config)
    const session = store.create({ task: 'run a command', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'ask' })
    const secret = 'api_key=abcdefghijklmnop'
    const provider = new MockProvider((_request, index) =>
      index === 0 ? toolResponse('run_command', { command: 'echo must-not-run' }) : textResponse('The command could not run.'),
    )
    const result = await runAgent({
      task: 'Run the requested command',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: () => undefined,
      broker: { request: async () => { throw new Error(secret) } },
      signal: new AbortController().signal,
    })

    assert.equal(result.status, 'partial')
    const saved = await store.load(session.id)
    const failedApproval = saved.audit.find((entry) => entry.approval === 'failed')
    assert.ok(failedApproval)
    assert.equal(failedApproval.decision, 'ask')
    assert.match(failedApproval.failure ?? '', /REDACTED/)
    assert.equal(JSON.stringify(saved.audit).includes('abcdefghijklmnop'), false)
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('a final model message cannot mark a run complete after a tool failure', async () => {
  const workspace = await tempDir('agenthub-loop-ws-')
  const home = await tempDir('agenthub-loop-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'auto', maxSteps: 3 })
    const store = new SessionStore(config)
    const session = store.create({ task: 'read a file', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
    const provider = new MockProvider((_request, index) =>
      index === 0 ? toolResponse('missing_tool', {}) : textResponse('The task is complete.'),
    )
    const result = await runAgent({
      task: 'Read the requested file',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: () => undefined,
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })
    assert.equal(result.status, 'partial')
    assert.ok(result.limitations.some((item) => /tool call\(s\) failed/i.test(item)))
    const saved = await store.load(session.id)
    assert.ok(saved.audit.some((entry) => entry.tool === 'missing_tool' && entry.result === 'failed'))
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('tool-shaped JSON in assistant text does not count as executed work', async () => {
  const workspace = await tempDir('agenthub-text-tool-ws-')
  const home = await tempDir('agenthub-text-tool-home-')
  try {
    await fs.writeFile(path.join(workspace, 'proof.txt'), 'LOCAL_FILE_PROOF_42', 'utf8')
    const config = testConfig(workspace, home, { permissionMode: 'ask', maxSteps: 3 })
    const store = new SessionStore(config)
    const session = store.create({ task: 'Read proof.txt', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'ask' })
    const provider = new MockProvider(() => textResponse(
      '```json\n{"name":"read_file","arguments":{"path":"proof.txt"}}\n```',
    ))
    const events: AgentEvent[] = []
    const result = await runAgent({
      task: 'Read proof.txt',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => events.push(event),
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })

    assert.equal(result.status, 'partial')
    assert.ok(result.limitations.some((item) => /tool-shaped response.*no tool was executed/i.test(item)))
    assert.equal(events.some((event) => event.type === 'tool_started'), false)
    assert.equal(result.changedFiles.length, 0)
    assert.equal(result.text.includes('LOCAL_FILE_PROOF_42'), false)
    const saved = await store.load(session.id)
    assert.equal(saved.status, 'partial')
    assert.equal(saved.audit.length, 0)
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('a JSON tool example stays a completed answer when the user asked for an example', async () => {
  const workspace = await tempDir('agenthub-tool-example-ws-')
  const home = await tempDir('agenthub-tool-example-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'ask', maxSteps: 3 })
    const store = new SessionStore(config)
    const task = 'Show a JSON example of a read_file call.'
    const session = store.create({ task, workspace, provider: 'mock', model: 'mock-model', permissionMode: 'ask' })
    const provider = new MockProvider(() => textResponse(
      '```json\n{"name":"read_file","arguments":{"path":"README.md"}}\n```',
    ))
    const result = await runAgent({
      task,
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: () => undefined,
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })
    assert.equal(result.status, 'completed')
    assert.equal(result.limitations.some((item) => /tool-shaped response/i.test(item)), false)
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('a final model message cannot mark a run complete while planned steps are unfinished', async () => {
  const workspace = await tempDir('agenthub-plan-incomplete-ws-')
  const home = await tempDir('agenthub-plan-incomplete-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'auto', maxSteps: 3 })
    const store = new SessionStore(config)
    const session = store.create({ task: 'complete planned work', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
    const provider = new MockProvider((_request, index) =>
      index === 0 ? toolResponse('set_plan', { steps: ['Inspect', 'Make change'] }) : textResponse('Everything is finished.'),
    )
    const result = await runAgent({
      task: 'Complete the plan',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: () => undefined,
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })

    assert.equal(result.status, 'partial')
    assert.ok(result.limitations.some((item) => /planned step\(s\) remain unfinished/.test(item)))
    const saved = await store.load(session.id)
    assert.deepEqual(saved.plan.map((step) => step.status), ['pending', 'pending'])
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('a failed final session save is reported as partial instead of completed', async () => {
  const workspace = await tempDir('agenthub-loop-ws-')
  const home = await tempDir('agenthub-loop-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'auto', maxSteps: 3 })
    const store = new SessionStore(config)
    const session = store.create({ task: 'answer', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'auto' })
    store.save = async () => { throw new Error('disk full') }
    const events: AgentEvent[] = []
    const result = await runAgent({
      task: 'Say hello',
      config,
      target: mockTarget(new MockProvider(() => textResponse('Hello.'))),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => events.push(event),
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })
    assert.equal(result.status, 'partial')
    assert.ok(result.limitations.some((item) => /session save failed/i.test(item)))
    assert.ok(events.some((event) => event.type === 'warning' && /disk full/.test(event.message)))
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('cancelling a run stops the provider request and records cancellation', async () => {
  const workspace = await tempDir('agenthub-loop-ws-')
  const home = await tempDir('agenthub-loop-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'auto', maxSteps: 3 })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'cancel me',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'auto',
    })
    const provider = new MockProvider(
      (request: ChatRequest) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(new ProviderError('Cancelled.', { code: 'ABORTED' })),
            { once: true },
          )
        }),
    )
    const controller = new AbortController()
    const run = runAgent({
      task: 'Wait forever',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: () => undefined,
      broker: new ApprovingBroker(),
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 25)
    const result = await run
    assert.equal(result.status, 'cancelled')
    assert.equal(session.turns, 1)
    const saved = await store.load(session.id)
    assert.equal(saved.status, 'cancelled')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('run_command treats an empty cwd as the workspace', async () => {
  const workspace = await tempDir('agenthub-loop-ws-')
  const home = await tempDir('agenthub-loop-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'auto', maxSteps: 3 })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'run a command',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'auto',
    })
    const provider = new MockProvider((_request, index) => {
      if (index === 0) return toolResponse('run_command', { command: 'echo cwd-ok', cwd: '' })
      return textResponse('Command ran.')
    })
    const events: AgentEvent[] = []
    const result = await runAgent({
      task: 'Run echo with an empty cwd',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => events.push(event),
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })
    assert.equal(result.status, 'completed', result.error ?? 'Agent did not complete')
    const toolResult = events.find((event) => event.type === 'tool_result')
    assert.ok(toolResult && toolResult.type === 'tool_result')
    assert.ok(toolResult.content.includes('cwd-ok'))
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('resuming a session keeps prior messages and does not replay old tools', async () => {
  const workspace = await tempDir('agenthub-loop-ws-')
  const home = await tempDir('agenthub-loop-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'auto', maxSteps: 4 })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'first',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'auto',
    })
    const firstProvider = new MockProvider((_request, index) => {
      if (index === 0) return toolResponse('write_file', { path: 'first.txt', content: 'one\n' })
      return textResponse('First turn done.')
    })
    const first = await runAgent({
      task: 'Create first.txt',
      config,
      target: mockTarget(firstProvider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: () => undefined,
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })
    assert.equal(first.status, 'completed')

    const secondProvider = new MockProvider((request) => {
      const transcript = request.messages.map((message) => message.content ?? '').join('\n')
      assert.ok(transcript.includes('Create first.txt'))
      assert.ok(transcript.includes('First turn done.'))
      return textResponse('Second turn done.')
    })
    const second = await runAgent({
      task: 'What did you do?',
      config,
      target: mockTarget(secondProvider),
      session: await store.load(session.id),
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: () => undefined,
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
      resumed: true,
    })
    assert.equal(second.status, 'completed', second.error ?? 'Resumed agent did not complete')
    assert.equal(second.steps, 1)
    assert.equal(secondProvider.calls.length, 1)
    const contents = await fs.readFile(path.join(workspace, 'first.txt'), 'utf8')
    assert.equal(contents, 'one\n')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})
