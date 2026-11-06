import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
const base = process.env.AGENTHUB_TEST_URL || 'http://localhost:3000'
const origin = { Origin: base, 'Content-Type': 'application/json' }
const ids = new Set()
const evidence = []
let selectedModel
let passed = 0
let ownsScope = false
const check = (name, value) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`) }
const snapshot = async () => (await (await fetch(`${base}/api/computer`)).json())
async function post(body) {
  const response = await fetch(`${base}/api/computer`, { method: 'POST', headers: origin, body: JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok || !value.ok) throw new Error(value.error)
  return value
}
async function start(request, readonly = true) {
  await post({ action: 'enable', scope: { applications: ['notepad'], domains: [], readonly } })
  const value = await post({ action: 'start', input: { request, profile: 'fast', model: selectedModel.id, visionModel: '', saveSummary: false } })
  ids.add(value.task.id)
  return value.task.id
}
async function until(id, predicate, timeout = 180000) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    const value = await snapshot()
    const task = value.tasks.find((entry) => entry.id === id)
    if (task && predicate(task)) return task
    if (task && ['failed', 'cancelled'].includes(task.phase)) throw new Error(task.result)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Local model acceptance timed out.')
}
try {
  const initial = await snapshot()
  check('no other Auto session is interrupted by acceptance', !initial.activeId && !initial.computer.enabled)
  const inventory = await (await fetch(`${base}/api/computer?models=true`)).json()
  selectedModel = inventory.models?.find((model) => model.loaded && model.chat && model.label.startsWith('LM Studio') && (!process.env.AGENTHUB_TEST_MODEL || model.id === process.env.AGENTHUB_TEST_MODEL))
  check('an actual loaded LM Studio model is selected without loading another model', !!selectedModel)
  console.log(`Using ${selectedModel.label}`)
  await post({ action: 'connect' })
  ownsScope = true
  const firstId = await start('Using only the supplied initial observation, count the permitted windows with allowed:true. Do not use tools. Reply in exactly this format: Permitted windows: N (replace N with the actual integer).')
  await until(firstId, (task) => task.phase === 'planning')
  await post({ action: 'pause', id: firstId })
  check('Pause reaches the native controller', (await snapshot()).computer.paused)
  await post({ action: 'resume', id: firstId })
  check('Resume releases the native pause gate', !(await snapshot()).computer.paused)
  const first = await until(firstId, (task) => ['completed', 'partial'].includes(task.phase))
  const observation = JSON.parse(first.events.find((event) => event.action === 'observe').output)
  const expected = observation.windows.filter((window) => window.allowed).length
  check('the loaded LM Studio model answers from the actual desktop observation', first.modelCalls > 0 && first.model === selectedModel.id && first.modelLabel.includes('LM Studio') && first.result.includes(`Permitted windows: ${expected}`))
  check('read-only questions finish without a false missing-input warning', first.phase === 'completed' && !first.result.includes('No input action'))
  const observations = new Set(['desktop.get_windows', 'desktop.get_active_window', 'desktop.inspect_window', 'desktop.read_element', 'desktop.capture_screen', 'desktop.wait_for_element', 'browser.tabs', 'browser.inspect', 'browser.read', 'plan', 'workspace_info', 'list_files', 'read_file', 'search_files', 'count_files'])
  check('read-only model task executes no desktop input', first.events.filter((event) => event.phase === 'acting').every((event) => observations.has(event.action)))
  evidence.push(first)
  const proposalId = await start('Call desktop_open_application with application notepad. Do nothing else and wait for the user to approve this single proposal.', false)
  const proposed = await until(proposalId, (task) => !!task.approval)
  check('a real local-model tool call reaches the approval gate', proposed.approval.name === 'desktop.open_application')
  await post({ action: 'approve', id: proposalId, approvalId: proposed.approval.id, approved: false })
  let declined
  for (let i = 0; i < 60; i++) {
    declined = (await snapshot()).tasks.find((entry) => entry.id === proposalId)
    if (declined.phase === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check('declining prevents native dispatch and records the refusal', declined.phase === 'failed' && /declined/i.test(declined.result) && !declined.events.some((event) => event.phase === 'acting' && event.action === 'desktop.open_application'))
  evidence.push(declined)
  const cancelId = await start('Inspect the actual permitted windows and explain the state in a paragraph. Do not send input.')
  await until(cancelId, (task) => task.phase === 'planning')
  const stopStart = performance.now()
  await post({ action: 'stop', id: cancelId })
  let cancelled
  for (let i = 0; i < 60; i++) {
    cancelled = (await snapshot()).tasks.find((entry) => entry.id === cancelId)
    if (cancelled.phase === 'cancelled' && !(await snapshot()).activeId) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check('Stop aborts an active local-model task and disables input', cancelled.phase === 'cancelled' && !(await snapshot()).computer.enabled)
  evidence.push({ ...cancelled, stopElapsedMs: performance.now()-stopStart })
  await fs.mkdir('output/computer-use', { recursive: true })
  const filename = `output/computer-use/model-acceptance-${selectedModel.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
  await fs.writeFile(filename, JSON.stringify({ passed, model: selectedModel.id, checkedAt: new Date().toISOString(), tasks: evidence.map(({ screenshot, ...task }) => task) }, null, 2))
  console.log(`Evidence: ${filename}`)
  console.log(`\n${passed} real local-model/control-flow checks passed.`)
} finally {
  const current = await snapshot().catch(() => null)
  if (ownsScope && (!current?.activeId || ids.has(current.activeId))) await post({ action: 'stop' }).catch(() => {})
}
