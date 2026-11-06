// Real native acceptance checks through AgentHub's existing HTTP -> IPC path.
// Requires explicit invocation. No browser automation, shell UI, saved user files,
// settings changes, or unrelated applications are controlled.
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
const base = process.env.AGENTHUB_TEST_URL || 'http://127.0.0.1:3000'
if (!process.argv.includes('--enable-test-scope')) throw new Error('Pass --enable-test-scope to authorize Calculator and a new empty Notepad document.')
const output = 'output/computer-control'
const checks = []
const timings = []
const evidence = { checkedAt: new Date().toISOString(), checks, timings, modelDriven: false, browserTested: false }
let ownsScope = false
async function post(body, expectedFailure = false) {
  const started = performance.now()
  const response = await fetch(`${base}/api/computer`, {method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(40000)})
  const value = await response.json()
  timings.push({action:body.name || body.action,ms:Math.round(performance.now()-started),nativeMs:value.duration_ms,ok:value.ok})
  if (!expectedFailure && (!response.ok || !value.ok)) throw new Error(`${body.name || body.action}: ${value.error || response.status}`)
  return value
}
const tool = async (name, args = {}, expectedFailure = false) => post({action:'tool',name,args,confirmed:true}, expectedFailure)
const status = async () => (await fetch(`${base}/api/computer`)).json()
function check(name, condition, details) {assert.ok(condition,name); checks.push({name,status:'PASS',...(details ? {details} : {})}); console.log(`PASS ${name}`)}
function unique(items, predicate, label) {const matches=items.filter(predicate); assert.equal(matches.length,1,`${label}: expected one accessible target, got ${matches.length}`);return matches[0]}
const target = (observation, element) => ({snapshot_id:observation.snapshot_id,element_id:element.id})
try {
  await fs.mkdir(output,{recursive:true})
  const before = await status()
  assert(!before.activeId && !before.computer.enabled, 'Refuse to interrupt an existing task or permission grant')
  await post({action:'connect'})
  await post({action:'enable',scope:{applications:['calculator','notepad'],domains:[],readonly:false,pointerProfile:'demonstration',screenshots:true}})
  ownsScope = true
  const first = (await tool('desktop.get_windows')).result
  evidence.monitors = first.monitors
  check('Interactive desktop permits native window discovery',Array.isArray(first.windows))
  assert(process.argv.includes('--reuse-test-calculator') || !first.windows.some(w=>w.allowed && /calculator/i.test(w.process)), 'Calculator is already open; refuse to overwrite an existing calculation')
  const launched = (await tool('desktop.open_application',{application:'calculator'})).result
  const requestedCalculator = process.argv.find(value=>value.startsWith('--calculator-handle='))?.split('=')[1]
  const calculator = unique(launched.windows,w=>/calculator/i.test(w.process)&&(!requestedCalculator||w.handle===Number(requestedCalculator)),'Calculator window')
  let observation = (await tool('desktop.focus_window',{handle:calculator.handle})).result.observation
  check('Calculator is the foreground permitted window',(await tool('desktop.get_active_window')).result.handle===calculator.handle)
  if (process.argv.includes('--reuse-test-calculator')) {
    await tool('desktop.press_key',{snapshot_id:observation.snapshot_id,key:'esc'})
    observation = (await tool('desktop.inspect_window',{handle:calculator.handle})).result
  }
  const seven = unique(observation.elements,e=>e.control_type==='Button' && (e.automation_id==='num7Button'||/^(seven|7)$/i.test(e.name)),'Calculator seven button')
  evidence.calculator = {window:calculator,target:seven}
  const clicked = (await tool('desktop.click',{...target(observation,seven),expected_text:'Display is 7',duration_ms:700})).result
  check('Visible pointer traverses real intermediate screen coordinates',new Set(clicked.pointer.samples.map(point=>point.join(','))).size>2,clicked.pointer)
  const position = (await tool('desktop.get_mouse_position')).result
  check('GetCursorPos confirms pointer reached the intended button',position.x===clicked.pointer.to[0]&&position.y===clicked.pointer.to[1])
  observation = clicked.observation
  const display = observation.elements.find(e=>e.automation_id==='CalculatorResults')
  check('Calculator displays 7 after the native left click',!!display && /\b7\b/.test(display.name),{display:display?.name})
  const capture = (await tool('desktop.capture_screen',{handle:calculator.handle})).result
  await fs.writeFile(`${output}/calculator-visible-click.png`,Buffer.from(capture.image.split(',')[1],'base64'))
  check('Authorized Calculator screenshot captured',capture.verified && capture.original_width>0)
  check('Window maximize is verified by Win32 state',(await tool('desktop.maximize_window',{handle:calculator.handle})).result.verified)
  check('Window restore is verified by Win32 state',(await tool('desktop.restore_window',{handle:calculator.handle})).result.verified)
  const opened = (await tool('desktop.open_application',{application:'notepad'})).result
  const notepad = unique(opened.windows,w=>w.process==='notepad.exe','Notepad window')
  observation = (await tool('desktop.focus_window',{handle:notepad.handle})).result.observation
  await tool('desktop.hotkey',{snapshot_id:observation.snapshot_id,keys:['ctrl','n']})
  observation = (await tool('desktop.inspect_window',{handle:notepad.handle})).result
  let editor = unique(observation.elements,e=>['Edit','Document'].includes(e.control_type)&&e.enabled&&!(e.text||'').trim(),'new empty Notepad editor')
  const editorClick = (await tool('desktop.click',target(observation,editor))).result
  observation = editorClick.observation
  editor = unique(observation.elements,e=>['Edit','Document'].includes(e.control_type)&&e.enabled&&e.focused,'focused Notepad editor')
  check('Visible editor click focuses the actual Notepad control',!!editor,editorClick.pointer)
  const sentence = 'AgentHub native input: Hello World ✓\nSecond line 125 × 48.'
  const typed = (await tool('desktop.type_text',{...target(observation,editor),text:sentence})).result
  evidence.notepad = {expected:sentence,actual:typed.actual_text,verified:typed.verified}
  check('Unicode and multiline typing match actual UIA readback',typed.verified&&typed.actual_text.replace(/\r\n?/g,'\n').includes(sentence))
  observation = typed.observation
  editor = unique(observation.elements,e=>['Edit','Document'].includes(e.control_type)&&e.text?.includes('AgentHub native input'),'fixture editor')
  const stale = target(observation,editor)
  await tool('desktop.focus_window',{handle:calculator.handle})
  const wrongFocus = await tool('desktop.type_text',{...stale,text:'MUST NOT TYPE'},true)
  check('A stale or wrong-focus target refuses typing',!wrongFocus.ok)
  observation = (await tool('desktop.focus_window',{handle:notepad.handle})).result.observation
  check('Switching back targets Notepad only',(await tool('desktop.get_active_window')).result.handle===notepad.handle)
  await tool('desktop.key_down',{snapshot_id:observation.snapshot_id,key:'shift'})
  check('Held input ownership is visible in native status',(await status()).computer.heldKeys?.includes('shift'))
  await post({action:'stop'})
  const stopped = await status()
  check('Stop disables input and releases all owned keys and buttons',!stopped.computer.enabled&&stopped.computer.heldKeys?.length===0&&stopped.computer.heldButtons?.length===0)
  check('Input after Stop is rejected',!(await tool('desktop.press_key',{snapshot_id:observation.snapshot_id,key:'a'},true)).ok)
  await post({action:'enable',scope:{applications:['calculator'],domains:[],readonly:true,screenshots:false}})
  check('Screenshot disable is enforced by native controller',!(await tool('desktop.capture_screen',{handle:calculator.handle},true)).ok)
  check('Read-only grant refuses pointer input',!(await tool('desktop.move_mouse',{snapshot_id:'none',x:0,y:0},true)).ok)
  evidence.status='PARTIAL'
  evidence.remaining=['Double/right click and drag/scroll application effects','Save As and VS Code workflow','Registered-agent/local-model execution','Global emergency shortcut and physical intervention','Alternate display configurations','Live Auto UI screenshots']
} catch (error) {
  evidence.status='FAILED'
  evidence.error=String(error)
  console.error(error)
  process.exitCode=1
} finally {
  if(ownsScope) await post({action:'stop'},true).catch(error=>{evidence.stopError=String(error)})
  await fs.mkdir(output,{recursive:true})
  await fs.writeFile(`${output}/visible-input-acceptance.json`,JSON.stringify(evidence,null,2))
  console.log(`${checks.length} checks passed; status ${evidence.status}. Evidence: ${output}/visible-input-acceptance.json`)
}
