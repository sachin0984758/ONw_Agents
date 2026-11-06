// Explicit acceptance test: opens a NEW empty Notepad document and an isolated
// browser on a local fixture. Never saves, closes, or edits user documents.
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
const base = process.env.AGENTHUB_TEST_URL || 'http://localhost:3000'
const allowInputs = process.argv.includes('--enable-test-scope')
const domOnly = process.argv.includes('--dom-only')
let passed = 0
const skipped = []
let ownsScope = false
const timings = []
const check = (name, value) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`) }
async function post(body, expectFailure = false) {
  const started = performance.now()
  const response = await fetch(`${base}/api/computer`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  timings.push({ action: body.name || body.action, elapsedMs: Math.round((performance.now()-started)*100)/100, nativeMs: value.duration_ms, ok: value.ok })
  if (!expectFailure && (!response.ok || !value.ok)) throw new Error(value.error || `${response.status}`)
  return value
}
const tool = (name, args = {}, expectFailure = false) => post({ action: 'tool', name, args, confirmed: true }, expectFailure)
const status = async () => (await (await fetch(`${base}/api/computer`)).json())
try {
  const initial = await status()
  check('Auto endpoint is reachable', initial.ok)
  if (initial.activeId || initial.computer.enabled) throw new Error('A user Auto session is active or enabled. Stop it explicitly before running acceptance; this script will not interrupt it.')
  const denied = await fetch(`${base}/api/computer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"connect"}' })
  check('requests without same-origin authorization are refused', denied.status === 403)
  const cross = await fetch(`${base}/api/computer`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{"action":"connect"}' })
  check('cross-origin computer control is refused', cross.status === 403)
  if (!allowInputs) throw new Error('Pass --enable-test-scope to explicitly authorize only the safe Notepad/local-browser acceptance fixtures.')
  await post({ action: 'connect' })
  ownsScope = true
  await post({ action: 'stop' })
  check('computer input is disabled after Stop', !(await status()).computer.enabled)
  check('tools refuse input while control is off', !(await tool('desktop.get_windows', {}, true)).ok)
  await post({ action: 'enable', scope: { applications: ['notepad', 'browser'], domains: ['localhost', '127.0.0.1'], readonly: false } })
  check('explicit test scope enables only selected apps', (await status()).computer.applications.sort().join(',') === ['notepad', 'browser'].sort().join(','))
  check('unknown executable/command tools are refused', !(await tool('desktop.run_shell', { command: 'echo no' }, true)).ok)
  check('unknown arguments are refused before native execution', !(await tool('desktop.get_windows', { command: 'echo no' }, true)).ok)
  check('non-allowlisted apps cannot launch', !(await tool('desktop.open_application', { application: 'explorer' }, true)).ok)
  const first = (await tool('desktop.get_windows')).result
  check('real desktop and monitor discovery returns actual data', Array.isArray(first.windows) && first.monitors.length > 0)
  let win = first.windows.find((window) => window.process === 'notepad.exe')
  if (!domOnly) {
  const before = new Set(first.windows.map((window) => window.handle))
  const opened = await tool('desktop.open_application', { application: 'notepad' })
  win = opened.result.windows.find((window) => !before.has(window.handle)) ?? opened.result.windows[0]
  for (let i = 0; i < 30 && !win; i++) {
    const current = (await tool('desktop.get_windows')).result.windows
    win = current.find((window) => window.process === 'notepad.exe' && !before.has(window.handle))
    if (!win) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check('Notepad is actually present after the launch request', !!win)
  const focus = await tool('desktop.focus_window', { handle: win.handle })
  check('Notepad foreground focus is observed', focus.result.verified)
  let observation = focus.result.observation
  // Modern Notepad may restore an existing user document on launch. Create an
  // empty tab through its observed control before selecting any editor.
  const addTab = observation.elements.find((element) => element.control_type === 'Button' && element.name === 'Add New Tab')
  if (addTab) {
    await tool('desktop.click', { snapshot_id: observation.snapshot_id, element_id: addTab.id })
    for (let i = 0; i < 20; i++) {
      observation = (await tool('desktop.inspect_window', { handle: win.handle })).result
      if (observation.elements.some((element) => ['Document', 'Edit'].includes(element.control_type) && element.enabled && (element.text || '').trim() === '')) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  let editor = observation.elements.find((element) => ['Document', 'Edit'].includes(element.control_type) && element.enabled && (element.text || '').trim() === '')
  check('an actual empty editor was found; existing content will not be touched', !!editor)
  const initialText = 'AgentHub safe verification — Unicode ✓\nSecond test line.'
  const typed = await tool('desktop.type_text', { snapshot_id: observation.snapshot_id, element_id: editor.id, text: initialText })
  if (!typed.result.verified) console.log('Typing verification evidence:', JSON.stringify(typed.result.actual_text))
  check('Unicode and multiline text are verified in the real Notepad editor', typed.result.verified && typed.result.actual_text.includes('Unicode ✓'))
  observation = typed.result.observation
  editor = observation.elements.find((element) => ['Document', 'Edit'].includes(element.control_type) && element.text?.includes('AgentHub safe verification'))
  check('the typed content appears in the fresh UIA observation', !!editor)
  const oldTarget = { snapshot_id: observation.snapshot_id, element_id: editor.id }
  const selected = await tool('desktop.hotkey', { ...oldTarget, keys: ['ctrl', 'a'] })
  check('real keyboard selection dispatch is observable without a fabricated success claim', selected.ok && selected.result.observation && selected.result.verified === false)
  check('stale element references are rejected', !(await tool('desktop.read_element', oldTarget, true)).ok)
  observation = selected.result.observation
  editor = observation.elements.find((element) => ['Document', 'Edit'].includes(element.control_type) && element.text?.includes('AgentHub safe verification'))
  const replaced = await tool('desktop.type_text', { snapshot_id: observation.snapshot_id, element_id: editor.id, text: 'AgentHub replacement verified ✓', replace: true })
  check('replacement is confirmed from real editor content', replaced.result.verified && replaced.result.actual_text.includes('replacement verified'))
  observation = replaced.result.observation
  editor = observation.elements.find((element) => ['Document', 'Edit'].includes(element.control_type) && element.text?.includes('replacement verified'))
  const longText = 'AgentHub long Unicode text verified ✓\n'.repeat(30)
  const large = await tool('desktop.type_text', { snapshot_id: observation.snapshot_id, element_id: editor.id, text: longText, replace: true })
  check('large Unicode values are verified through the actual native text control', large.result.verified && large.result.actual_text.replace(/\r\n?/g, '\n').includes(longText.slice(0, -1)))
  observation = large.result.observation
  editor = observation.elements.find((element) => ['Document', 'Edit'].includes(element.control_type) && element.text?.includes('long Unicode'))
  const restored = await tool('desktop.type_text', { snapshot_id: observation.snapshot_id, element_id: editor.id, text: 'AgentHub replacement verified ✓', replace: true })
  check('the exact fixture text can be restored without keyboard flooding', restored.result.verified && restored.result.actual_text.trim() === 'AgentHub replacement verified ✓')
  const absent = await tool('desktop.wait_for_element', { handle: win.handle, control_type: 'Button', name: 'AgentHub element that does not exist', timeout_ms: 150 }, true)
  check('nonexistent UI elements report a real failure', !absent.ok)
  observation = (await tool('desktop.inspect_window', { handle: win.handle })).result
  check('inspection recovers after the missing-element failure', observation.elements.length > 0)
  const captured = await tool('desktop.capture_screen', { handle: win.handle })
  check('actual permitted-window PNG capture has valid scaling metadata', captured.result.image.startsWith('data:image/png;base64,') && captured.result.original_width >= captured.result.width)
  await fs.mkdir('output/computer-use', { recursive: true })
  await fs.writeFile('output/computer-use/notepad-verified.png', Buffer.from(captured.result.image.split(',')[1], 'base64'))
  editor = observation.elements.find((element) => ['Document', 'Edit'].includes(element.control_type) && element.text?.includes('replacement verified'))
  const textRect = editor?.text_rects?.find((rect) => rect[2] > 50 && rect[3] > 0)
  check('UIA exposes actual text geometry for a safe pointer target', !!textRect)
  const [textX, textY, textWidth, textHeight] = textRect
  const dragY = Math.round(textY + textHeight / 2)
  const moved = await tool('desktop.drag', { snapshot_id: observation.snapshot_id, element_id: editor.id, from_x: Math.round(textX+2), from_y: dragY, to_x: Math.round(textX+Math.min(textWidth-2,180)), to_y: dragY })
  check('pointer drag returns a fresh actual editor observation', moved.ok && moved.result.observation?.window.handle === win.handle)
  observation = moved.result.observation
  editor = observation.elements.find((element) => ['Document', 'Edit'].includes(element.control_type) && element.text?.includes('replacement verified'))
  const dragRead = await tool('desktop.read_element', { snapshot_id: observation.snapshot_id, element_id: editor.id })
  check('the real pointer drag selects actual fixture text', dragRead.result.selected_text?.length > 0 && 'AgentHub replacement verified ✓'.includes(dragRead.result.selected_text.trim()))
  }
  const browser = await tool('browser.open', { url: `${base}/auto-test.html` })
  const page_id = browser.result.page_id
  check('isolated browser opens the real local fixture', browser.result.url === `${base}/auto-test.html` && browser.result.accessibility.includes('safe browser fixture'))
  const filled = await tool('browser.fill', { page_id, role: 'textbox', name: 'Test sentence', text: 'Local DOM verification ✓' })
  check('browser form fill is verified by its actual value', filled.result.verified)
  const read = await tool('browser.read', { page_id, role: 'textbox', name: 'Test sentence' })
  check('browser input values can be read back accurately', read.result.text === 'Local DOM verification ✓')
  const clicked = await tool('browser.click', { page_id, role: 'button', name: 'Test button', expected_text: 'Verified button click' })
  check('button click is verified by the changed page state', clicked.result.verified)
  const chosen = await tool('browser.select', { page_id, role: 'combobox', name: 'Profile', value: 'Careful' })
  check('browser dropdown selection is verified', chosen.result.verified)
  const scroll = await tool('browser.scroll', { page_id, pixels: 1000 })
  check('browser scrolling returns a real observation rather than claimed completion', scroll.ok && scroll.result.observation)
  const next = await tool('browser.navigate', { page_id, url: `${base}/auto-test.html?next=1` })
  check('browser navigation is verified against the actual URL', next.result.verified && next.result.observation.url.endsWith('?next=1'))
  check('browser locators fail for missing elements', !(await tool('browser.click', { page_id, role: 'button', name: 'Does not exist' }, true)).ok)
  check('unapproved browser hosts are blocked before navigation', !(await tool('browser.open', { url: 'https://unapproved.example' }, true)).ok)
  check('visual grounding is unavailable without an explicitly loaded vision model', !(await tool('visual_ground', { handle: win?.handle ?? 1, instruction: 'Find File' }, true)).ok)
  if (!domOnly) await tool('desktop.focus_window', { handle: win.handle })
  if (win) {
  const waiting = tool('desktop.wait_for_element', { handle: win.handle, control_type: 'Button', name: 'Never appears', timeout_ms: 10000 }, true)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const stopStart = performance.now()
  await post({ action: 'stop' })
  const stopped = await waiting
  check('Stop interrupts a pending native wait', !stopped.ok && performance.now()-stopStart < 2000)
  } else {
    skipped.push('Native wait interruption: no permitted Notepad window was present in DOM-only mode.')
    console.log(`SKIP ${skipped.at(-1)}`)
    await post({ action: 'stop' })
  }
  await post({ action: 'enable', scope: { applications: ['notepad'], domains: [], readonly: true } })
  check('read-only sessions reject actual input', !(await tool('desktop.open_application', { application: 'notepad' }, true)).ok)
  await post({ action: 'stop' })
  check('computer control ends disabled', !(await status()).computer.enabled)
  await fs.mkdir('output/computer-use', { recursive: true })
  await fs.writeFile('output/computer-use/acceptance.json', JSON.stringify({ passed, skipped, checkedAt: new Date().toISOString(), timings, monitors: first.monitors, limitations: ['Different DPI settings were not changed.', 'Multiple monitors tested only if present in monitors.', 'No loaded LLM or vision inference is implied by native/DOM acceptance tests.'], nativeKeyboardTested: !domOnly, notepadTestText: domOnly ? null : 'AgentHub replacement verified ✓' }, null, 2))
  console.log(`\n${passed} real native/DOM acceptance checks passed. Timings: output/computer-use/acceptance.json`)
} finally {
  if (ownsScope) await post({ action: 'stop' }, true).catch(() => {})
}
