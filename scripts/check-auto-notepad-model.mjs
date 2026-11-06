// Explicitly authorized live acceptance: new empty Notepad tab only. Leaves
// existing documents untouched; rejects unexpected model input proposals.
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'

const base = process.env.AGENTHUB_TEST_URL || 'http://localhost:3000'
const text = 'AgentHub safe verification ✓\nNew empty tab only.'
let ownsScope = false
let taskId
let passed = 0
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function snapshot() { return (await (await fetch(`${base}/api/computer?models=true`)).json()) }
async function post(body) {
  const response = await fetch(`${base}/api/computer`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok || !value.ok) throw new Error(value.error || `HTTP ${response.status}`)
  return value
}
const tool = async (name, args) => (await post({ action: 'tool', name, args, confirmed: true })).result

try {
  if (!process.argv.includes('--approved-notepad-test')) throw new Error('Explicit approval is required for this live Notepad test.')
  const initial = await snapshot()
  check('no user task or active access is interrupted', !initial.activeId && !initial.computer.enabled)
  const model = initial.models.find((entry) => entry.loaded && entry.chat)
  check('test uses the already loaded local model', Boolean(model))
  await post({ action: 'enable', scope: { applications: ['notepad'], domains: [], readonly: false, approvalMode: 'always-ask', workspaceAccess: 'none', internet: false, screenshots: false } })
  ownsScope = true
  const opened = await tool('desktop.open_application', { application: 'notepad' })
  const win = opened.windows?.[0]
  check('real permitted Notepad window is available', win?.process === 'notepad.exe')
  let observation = (await tool('desktop.focus_window', { handle: win.handle })).observation
  const addTab = observation.elements.find((entry) => entry.control_type === 'Button' && entry.name === 'Add New Tab')
  check('observed new-tab control exists before any text input', Boolean(addTab))
  const previousTabCount = observation.elements.filter((entry) => entry.control_type === 'TabItem').length
  await tool('desktop.click', { snapshot_id: observation.snapshot_id, element_id: addTab.id })
  observation = await tool('desktop.inspect_window', { handle: win.handle })
  const editor = observation.elements.find((entry) => ['Edit', 'Document'].includes(entry.control_type) && entry.enabled && entry.text === '')
  check('a new empty tab was created, preserving the existing documents', Boolean(editor) && observation.elements.filter((entry) => entry.control_type === 'TabItem').length > previousTabCount)
  const capturedAt = Date.now()
  const started = await post({ action: 'start', input: { model: model.id, profile: 'fast', visionModel: '', saveSummary: false, request: `Safe live acceptance test. A NEW EMPTY Notepad tab has just been created and verified. Do not open, close, switch, clear, or replace any document. Perform exactly one input action: desktop_type_text with snapshot_id ${JSON.stringify(observation.snapshot_id)}, element_id ${JSON.stringify(editor.id)}, text ${JSON.stringify(text)}, replace false. These IDs are from the real current inspection of Notepad handle ${win.handle}. The approval handoff will revalidate it. Do not use hotkeys, clicks, commands, workspace tools, or other input actions. After the tool returns, report its actual verified text readback and finish. If the target changed, stop rather than editing another document.` } })
  taskId = started.task.id
  console.log(`LIVE_NOTEPAD_TASK=${taskId}`)
  let task
  let lastProgress = ''
  let delayAnnounced = false
  const deadline = Date.now() + 12 * 60_000
  const approvals = new Set()
  while (Date.now() < deadline) {
    const state = await snapshot()
    task = state.tasks.find((entry) => entry.id === taskId)
    if (!task) throw new Error('Live test task disappeared.')
    const progress = `${task.phase}: ${task.events.at(-1)?.action}; model calls ${task.modelCalls}`
    if (progress !== lastProgress) { console.log(progress); lastProgress = progress }
    if (task.approval && !approvals.has(task.approval.id)) {
      const { id, name, args } = task.approval
      const allowed = name === 'desktop.type_text' && args.snapshot_id === observation.snapshot_id && args.element_id === editor.id && args.text === text && args.replace !== true
      if (!allowed) { await post({ action: 'approve', id: taskId, approvalId: id, decision: 'decline' }); throw new Error(`Unexpected model input ${name} was declined before execution.`) }
      if (Date.now() - capturedAt < 100_000) {
        if (!delayAnnounced) { console.log('Holding exact approved fixture action until its original evidence is at least 100 seconds old.'); delayAnnounced = true }
      } else {
        approvals.add(id)
        console.log(`Approving only exact fixture typing after ${Math.round((Date.now() - capturedAt) / 1000)} seconds; fresh native revalidation is required.`)
        await post({ action: 'approve', id: taskId, approvalId: id, decision: 'once' })
      }
    }
    if (!state.activeId) break
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  check('the real-model task finished', task && ['completed', 'partial'].includes(task.phase))
  const typed = task.events.find((entry) => entry.action === 'desktop.type_text' && entry.phase === 'verifying' && entry.ok && entry.verified)
  check('native typing was actually verified, not just dispatched', Boolean(typed))
  // Event logs can cap the large observation after actual_text. Decode that
  // complete JSON string independently of any truncated trailing UIA tree.
  const actualTextJson = typed.output.match(/"actual_text":("(?:[^"\\]|\\.)*")/)?.[1]
  const actualText = actualTextJson ? JSON.parse(actualTextJson) : undefined
  check('actual Notepad text exactly matches both fixture lines', typeof actualText === 'string' && actualText.replace(/\r\n?/g, '\n').trim() === text)
  check('model executed no other input actions', task.events.filter((entry) => entry.phase === 'acting').every((entry) => entry.action === 'desktop.type_text'))
  const final = await snapshot()
  check('temporary input access is revoked when the task ends', !final.activeId && !final.computer.enabled)
  await fs.mkdir('output/auto-slow-model-fix', { recursive: true })
  await fs.writeFile('output/auto-slow-model-fix/live-notepad.json', JSON.stringify({ passed, model: model.id, task, fixturePreparation: 'A new empty Notepad tab was prepared through the real native bridge before model input; existing documents were not edited.' }, null, 2))
  console.log(`${passed} live Notepad/model checks passed.`)
} finally {
  if (ownsScope) {
    const state = await snapshot().catch(() => null)
    if (!state?.activeId || state.activeId === taskId) await post({ action: 'stop' }).catch(() => {})
  }
}
