import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { activityForEvent, activityIsBusy, type Activity } from '../src/cli/activity.ts'
import { runAgent } from '../src/core/run.ts'
import { SessionStore } from '../src/sessions/store.ts'
import {
  ApprovingBroker, MockProvider, emptySkills, mockTarget, removeDir,
  repoContext, tempDir, testConfig, textResponse, toolResponse,
} from './helpers.ts'

test('real agent events drive thinking, approval, action, streaming, and completion activity', async () => {
  const workspace = await tempDir('agenthub-activity-ws-')
  const home = await tempDir('agenthub-activity-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'ask' })
    const store = new SessionStore(config)
    const session = store.create({ task: 'create a file', workspace, provider: 'mock', model: 'mock-model', permissionMode: 'ask' })
    let activity: Activity | null = null
    const phases: string[] = []
    const broker = new ApprovingBroker()
    const provider = new MockProvider((request, index) => {
      assert.equal(activity?.phase, 'thinking')
      if (index === 0) return toolResponse('write_file', { path: 'activity.txt', content: 'ACTIVITY_OK\n' })
      request.onText?.('Created activity.txt.')
      assert.equal(activity?.phase, 'responding')
      return textResponse('Created activity.txt.')
    })
    const result = await runAgent({
      task: 'Create activity.txt', config, target: mockTarget(provider), session, store,
      skills: emptySkills(), repo: repoContext(workspace), broker,
      signal: new AbortController().signal,
      events: (event) => {
        activity = activityForEvent(activity, event)
        if (activity && phases.at(-1) !== activity.phase) phases.push(activity.phase)
      },
    })
    assert.equal(result.status, 'completed')
    assert.equal(await fs.readFile(path.join(workspace, 'activity.txt'), 'utf8'), 'ACTIVITY_OK\n')
    assert.equal(broker.requests.length, 1)
    assert.deepEqual(phases, ['working', 'thinking', 'working', 'acting', 'approval', 'acting', 'working', 'thinking', 'responding', 'completed'])
    assert.equal(activityIsBusy(activity), false)
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('cancellation cannot be overwritten by late stream or tool events', () => {
  const cancelling: Activity = { phase: 'cancelling' }
  assert.equal(activityForEvent(cancelling, { type: 'assistant_delta', text: 'late' }), cancelling)
  assert.equal(activityForEvent(cancelling, { type: 'tool_started', id: '1', name: 'read_file' }), cancelling)
  assert.equal(activityForEvent(cancelling, { type: 'approval_resolved', id: '1', approved: false, remember: false }), cancelling)
  assert.equal(activityIsBusy(cancelling), true)
  const cancelled = activityForEvent(cancelling, { type: 'run_cancelled', runId: 'run', reason: 'interrupt' })
  assert.deepEqual(cancelled, { phase: 'cancelled' })
  assert.equal(activityIsBusy(cancelled), false)
})

test('planning, delegation, denied approvals, failures, and partial runs have distinct states', () => {
  let activity = activityForEvent(null, { type: 'plan', steps: [] })
  assert.equal(activity?.phase, 'planning')
  activity = activityForEvent(activity, { type: 'subagent_started', id: '1', label: 'Review', task: 'review', maxSteps: 2 })
  assert.deepEqual(activity, { phase: 'delegating', detail: 'Review' })
  activity = activityForEvent(activity, { type: 'approval_resolved', id: '2', approved: false, remember: false })
  assert.deepEqual(activity, { phase: 'working', detail: 'Permission declined' })
  assert.equal(activityForEvent(activity, { type: 'error', message: 'retry', fatal: false }), activity)
  activity = activityForEvent(activity, { type: 'error', message: 'offline', fatal: true })
  assert.deepEqual(activity, { phase: 'failed' })
  assert.equal(activityIsBusy(activity), false)
  activity = activityForEvent(activity, { type: 'status', status: 'partial' })
  assert.deepEqual(activity, { phase: 'partial' })
  assert.equal(activityIsBusy(activity), false)
  assert.equal(activityIsBusy(null), false)
})
