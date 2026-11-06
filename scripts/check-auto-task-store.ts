import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AutoEvent, AutoTask } from '../src/lib/agent-hub/computer/protocol'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-auto-history-'))
  const previousDb = process.env.AGENT_HUB_DB_DIR
  process.env.AGENT_HUB_DB_DIR = path.join(root, 'db')
  const check = (name: string, value: unknown) => { assert.ok(value, name); console.log(`PASS ${name}`) }
  try {
    const store = await import('../src/lib/agent-hub/computer/task-store')
    const historyFile = path.join(process.env.AGENT_HUB_DB_DIR, 'computer-tasks.json')
    const empty = await store.loadAutoTaskHistory()
    check('missing task history starts empty and remains writable', empty.tasks.length === 0 && empty.writable)
    const event: AutoEvent = { id: crypto.randomUUID(), action: 'write_file', phase: 'verifying', startedAt: new Date().toISOString(), output: 'saved', ok: true, verified: true }
    const active: AutoTask = {
      id: crypto.randomUUID(), title: 'Interrupted task', request: 'x'.repeat(9000), phase: 'acting', profile: 'balanced', model: 'local-model', visionModel: '',
      scope: { approvalMode: 'full', applications: ['notepad'], domains: [], readonly: false, workspaceId: crypto.randomUUID(), workspaceAccess: 'write', internet: false },
      events: Array.from({ length: 105 }, (_, index) => ({ ...event, id: `${event.id}-${index}`, output: 'y'.repeat(17000) })),
      plan: Array.from({ length: 105 }, (_, index) => `step ${index}`), result: '', createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:01:00.000Z', modelCalls: 3, modelMs: 1250,
      approval: { id: 'pending-approval', name: 'desktop.type_text', args: { text: 'secret draft' } }, screenshot: 'data:image/png;base64,private',
    }
    const finished: AutoTask = { ...active, id: crypto.randomUUID(), title: 'Finished task', request: 'Done', phase: 'completed', events: [event], plan: [], result: 'Verified result', approval: undefined, screenshot: undefined }
    await store.saveAutoTaskHistory([active, finished])
    const savedText = await fs.readFile(historyFile, 'utf8')
    const saved = JSON.parse(savedText) as { version: number; tasks: Array<Record<string, unknown>> }
    check('history uses versioned durable JSON', saved.version === 1 && saved.tasks.length === 2)
    check('persisted task data omits screenshots and pending approval payloads', saved.tasks.every((task) => !('screenshot' in task) && !('approval' in task)))
    check('persisted requests, plans, and event logs are bounded', (saved.tasks[0].request as string).length === 8000 && (saved.tasks[0].events as unknown[]).length === 100 && (saved.tasks[0].plan as unknown[]).length === 100 && ((saved.tasks[0].events as Array<{ output: string }>)[0].output.length === 16000))
    const restored = await store.loadAutoTaskHistory()
    const interrupted = restored.tasks.find((task) => task.id === active.id)
    const completed = restored.tasks.find((task) => task.id === finished.id)
    check('interrupted execution recovers as partial and never resumes', restored.recovered && interrupted?.phase === 'partial' && interrupted.events.at(-1)?.action === 'restart_recovery' && interrupted.result.includes('no actions were resumed'))
    check('restart recovery keeps previous verified results and marks them historical', interrupted?.events.some((entry) => entry.action === 'write_file' && entry.verified) && interrupted.scope.workspaceAccess === 'write')
    check('completed task remains completed after restart', completed?.phase === 'completed' && completed.result === 'Verified result')
    check('load never restores pending approval or screenshot data', interrupted && !interrupted.approval && !interrupted.screenshot)
    check('historical approval mode is preserved without restoring any active grant', completed?.scope.approvalMode === 'full' && !completed.approval)
    check('restart recovery preserves bounded task and event history', interrupted?.request.length === 8000 && interrupted.events.length === 100)

    const capped = Array.from({ length: 35 }, (_, index) => ({ ...finished, id: `task-${index}`, createdAt: new Date(Date.now() - index * 1000).toISOString() }))
    await store.saveAutoTaskHistory(capped)
    check('task history keeps only the newest 30 records', (await store.loadAutoTaskHistory()).tasks.length === 30)

    const corrupt = '{broken json; preserve this file'
    await fs.writeFile(historyFile, corrupt, 'utf8')
    const unreadable = await store.loadAutoTaskHistory()
    check('corrupt history reports a warning and disables writes', !unreadable.writable && Boolean(unreadable.warning) && unreadable.tasks.length === 0)
    check('corrupt history remains untouched for recovery', await fs.readFile(historyFile, 'utf8') === corrupt)
  } finally {
    if (previousDb === undefined) delete process.env.AGENT_HUB_DB_DIR
    else process.env.AGENT_HUB_DB_DIR = previousDb
    assert.equal(path.dirname(root), os.tmpdir())
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
