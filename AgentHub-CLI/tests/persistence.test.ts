import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { runAgent } from '../src/core/run.ts'
import { SessionStore } from '../src/sessions/store.ts'
import type { AgentEvent } from '../src/core/events.ts'
import {
  ApprovingBroker,
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

test('stored sessions redact transcript, tool arguments and ledger without breaking recovery', async () => {
  const workspace = await tempDir('agenthub-persist-ws-')
  const home = await tempDir('agenthub-persist-home-')
  try {
    const config = testConfig(workspace, home)
    const store = new SessionStore(config)
    const session = store.create({
      task: 'token=abcdefghijklmnop',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'ask',
    })
    session.title = 'token=abcdefghijklmnop'
    session.messages = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({ path: 'notes.txt', content: 'api_key=abcdefghijklmnop' }),
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', name: 'write_file', content: 'wrote file' },
    ]
    session.ledger = {
      changedFiles: [{ path: 'notes.txt', change: 'created' }],
      commands: [
        { command: 'echo token=abcdefghijklmnop', exitCode: 0, durationMs: 1, timedOut: false },
      ],
      tests: [],
    }
    session.audit = [{
      id: 'audit_1',
      at: new Date().toISOString(),
      runId: 'run_1',
      workspace,
      tool: 'write_file',
      operation: 'fs.write',
      decision: 'ask',
      approval: 'approved',
      result: 'succeeded',
      durationMs: 1,
      summary: 'Create notes.txt token=abcdefghijklmnop',
      failure: 'api_key=abcdefghijklmnop',
    }]
    await store.save(session)

    const file = path.join(config.sessionsDir, `${session.id}.json`)
    const raw = await fs.readFile(file, 'utf8')
    assert.equal(raw.includes('abcdefghijklmnop'), false, 'raw session must not contain the secret')
    assert.match(raw, /REDACTED/)

    const loaded = await store.load(session.id)
    assert.equal(loaded.id, session.id)
    assert.equal(loaded.messages.length, 2)
    const call = loaded.messages[0]?.tool_calls?.[0]
    assert.ok(call)
    const args = JSON.parse(call.function.arguments) as Record<string, unknown>
    assert.equal(args.path, 'notes.txt')
    assert.match(String(args.content), /REDACTED/)
    assert.match(loaded.ledger.commands[0]?.command ?? '', /REDACTED/)
    assert.match(loaded.title, /REDACTED/)
    assert.equal(loaded.ledger.changedFiles[0]?.path, 'notes.txt')
    assert.equal(loaded.audit.length, 1)
    assert.match(loaded.audit[0]?.summary ?? '', /REDACTED/)
    assert.match(loaded.audit[0]?.failure ?? '', /REDACTED/)

    // A resumed run can use the loaded transcript; persisted tool arguments
    // remain valid JSON and are never replayed.
    const provider = new MockProvider(() => textResponse('Recovered.'))
    const result = await runAgent({
      task: 'Continue',
      config,
      target: mockTarget(provider),
      session: loaded,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: () => undefined,
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
      resumed: true,
    })
    assert.equal(result.status, 'completed', result.error ?? 'Agent did not complete')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('old sessions default to an empty audit and saved audit history stays bounded', async () => {
  const workspace = await tempDir('agenthub-audit-ws-')
  const home = await tempDir('agenthub-audit-home-')
  try {
    const config = testConfig(workspace, home)
    const store = new SessionStore(config)
    const session = store.create({ task: 'legacy', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'ask' })
    await store.save(session)
    const file = path.join(config.sessionsDir, `${session.id}.json`)
    const original = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
    delete original.audit
    await fs.writeFile(file, JSON.stringify(original), 'utf8')
    assert.deepEqual((await store.load(session.id)).audit, [])

    session.audit = Array.from({ length: 520 }, (_, index) => ({
      id: `audit_${index}`,
      at: new Date().toISOString(),
      runId: 'run_1',
      workspace,
      tool: 'read_file',
      operation: 'fs.read',
      decision: 'allow' as const,
      approval: 'not_required' as const,
      summary: `entry ${index}`,
    }))
    await store.save(session)
    const saved = await store.load(session.id)
    assert.equal(saved.audit.length, 500)
    assert.equal(saved.audit[0]?.summary, 'entry 20')
    assert.equal(saved.audit.at(-1)?.summary, 'entry 519')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('plan and status survive a session save and resume without replaying tools', async () => {
  const workspace = await tempDir('agenthub-plan-ws-')
  const home = await tempDir('agenthub-plan-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'auto', maxSteps: 6 })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'plan work',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'auto',
    })
    const provider = new MockProvider((_request, index) => {
      if (index === 0) return toolResponse('set_plan', { steps: ['Inspect', 'Edit', 'Verify'] })
      if (index === 1) return toolResponse('update_plan', { index: 1, status: 'completed', note: 'looked around' })
      if (index === 2) return toolResponse('update_plan', { index: 2, status: 'completed', note: 'edited' })
      if (index === 3) return toolResponse('update_plan', { index: 3, status: 'completed', note: 'verified' })
      return textResponse('Plan work finished.')
    })
    const result = await runAgent({
      task: 'Do the planned work',
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
    assert.equal(result.status, 'completed', result.error ?? 'Agent did not complete')
    const stored = await store.load(session.id)
    assert.equal(stored.status, 'completed')
    assert.equal(stored.plan.length, 3)
    assert.equal(stored.plan[0]?.title, 'Inspect')
    assert.equal(stored.plan[0]?.status, 'completed')
    assert.equal(stored.plan[1]?.status, 'completed')

    const events: AgentEvent[] = []
    const resumeProvider = new MockProvider(() => textResponse('Resumed without replay.'))
    const resumed = await runAgent({
      task: 'What is left?',
      config,
      target: mockTarget(resumeProvider),
      session: stored,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => events.push(event),
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
      resumed: true,
    })
    assert.equal(resumed.status, 'completed', resumed.error ?? 'Resumed agent did not complete')
    const restoredPlan = events.find((event) => event.type === 'plan')
    assert.ok(restoredPlan && restoredPlan.type === 'plan')
    assert.equal(restoredPlan.steps.length, 3)
    assert.equal(restoredPlan.steps[0]?.status, 'completed')
    assert.equal(resumeProvider.calls.length, 1, 'resume must not replay the old tool calls')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('corrupt and malformed sessions fail clearly and do not break session listing', async () => {
  const workspace = await tempDir('agenthub-corrupt-ws-')
  const home = await tempDir('agenthub-corrupt-home-')
  try {
    const config = testConfig(workspace, home)
    const store = new SessionStore(config)
    const good = store.create({
      task: 'good',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'ask',
    })
    await store.save(good)
    await fs.mkdir(config.sessionsDir, { recursive: true })
    const corruptId = 'ses_corrupt'
    await fs.writeFile(path.join(config.sessionsDir, `${corruptId}.json`), '{ not json', 'utf8')
    const malformedId = 'ses_malformed'
    await fs.writeFile(
      path.join(config.sessionsDir, `${malformedId}.json`),
      JSON.stringify({ id: malformedId, messages: [{ role: 'assistant', content: null, tool_calls: 'nope' }] }),
      'utf8',
    )

    await assert.rejects(() => store.load(corruptId), /corrupt/i)
    await assert.rejects(() => store.load(malformedId), /invalid message/i)
    const list = await store.list()
    assert.deepEqual(list.map((item) => item.id), [good.id])
    assert.equal(await fs.readFile(path.join(config.sessionsDir, `${corruptId}.json`), 'utf8'), '{ not json')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})
