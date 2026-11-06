import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const base = process.env.AGENTHUB_TEST_URL || 'http://127.0.0.1:3000'
const expected = 'AUTO_WORKSPACE_OK'
const filename = 'auto-smoke.txt'
const snapshot = async (models = false) => (await (await fetch(`${base}/api/computer${models ? '?models=true' : ''}`)).json())
let taskId
let ownsScope = false
let passed = 0
let task
const approvals = new Set()
const check = (label, value) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`) }
async function post(route, body) {
  const response = await fetch(`${base}${route}`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok || !value.ok) throw new Error(value.error || `HTTP ${response.status}`)
  return value
}
const control = (body) => post('/api/computer', body)
try {
  const initial = await snapshot(true)
  check('no existing user Auto session is interrupted', !initial.activeId && !initial.computer.enabled)
  const model = initial.models?.find((entry) => entry.loaded && entry.chat && entry.label.startsWith('LM Studio'))
  check('the workflow uses the already-loaded LM Studio model', !!model)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-auto-workflow-'))
  const registered = await post('/api/agent-session/workspaces', { action: 'select', path: root })
  check('the disposable workspace is registered against its real directory', registered.workspace.root.toLowerCase() === root.toLowerCase())
  await control({ action: 'connect' })
  ownsScope = true
  // The selected temporary folder needs an explicit grant; readonly:false
  // alone permits desktop input but does not authorize workspace writes.
  await control({ action: 'enable', scope: { applications: ['notepad'], domains: [], readonly: false, workspaceId: registered.workspace.id, workspaceAccess: 'write' } })
  console.log('Coverage: real approved file write and readback. Auto does not currently expose run_command.')
  const started = await control({ action: 'start', input: { model: model.id, profile: 'fast', visionModel: '', saveSummary: true, request: `Use the file tools only for this safe test. Call write_file with the relative path "${filename}" (NOT an absolute path) and exactly this single line as content:\n${expected}\nThen call read_file on ${filename}, verify its actual content and report that content. Do not open applications, type into windows, browse websites, run commands or modify other files.` } })
  taskId = started.task.id
  const deadline = performance.now() + 8 * 60_000
  let previous = ''
  while (performance.now() < deadline) {
    const state = await snapshot()
    task = state.tasks.find((entry) => entry.id === taskId)
    const progress = `${task.phase}: ${task.events.at(-1)?.action} (${task.modelCalls} model calls)`
    if (progress !== previous) { console.log(progress); previous = progress }
    if (task.approval && !approvals.has(task.approval.id)) {
      const { name, args, id } = task.approval
      const relative = String(args.path ?? '').replaceAll('\\', '/').replace(/^\.\//, '')
      const allowed = name === 'write_file' && relative === filename && String(args.content).trim() === expected
      approvals.add(id)
      await control({ action: 'approve', id: taskId, approvalId: id, approved: !!allowed })
      if (!allowed) throw new Error(`Unexpected model proposal declined: ${name}. No unreviewed action ran.`)
      console.log(`Approved only the exact safe fixture action: ${name}`)
    }
    if (!state.activeId) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  check('the actual local-model task completed', task.phase === 'completed')
  check('the model created the exact file in the selected workspace', (await fs.readFile(path.join(root, filename), 'utf8')).trim() === expected)
  const readback = task.events.find((event) => event.action === 'read_file' && event.phase === 'verifying' && event.ok && event.verified)
  check('the file was really read back and its content was verified', readback?.output.includes(expected))
  check('the workflow sent no desktop input', !task.events.some((event) => event.phase === 'acting' && /^(desktop|browser)\./.test(event.action)))
  check('only the requested fixture file was created', (await fs.readdir(root)).join(',') === filename)
  const end = await snapshot()
  check('native input is off after the workflow', !end.activeId && !end.computer.enabled)
  await fs.writeFile('output/computer-use/workflow-acceptance.json', JSON.stringify({ passed, checkedAt: new Date().toISOString(), root, model: model.id, task }, null, 2))
  console.log(`\n${passed} real local-model workspace workflow checks passed.`)
} finally {
  if (ownsScope) {
    const current = await snapshot().catch(() => null)
    if (!current?.activeId || current.activeId === taskId) await control({ action: 'stop' }).catch(() => {})
  }
}
