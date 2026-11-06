import assert from 'node:assert/strict'
import { COMPUTER_READS, COMPUTER_SCHEMAS, COMPUTER_TOOLS, COMPUTER_TOOL_METADATA, computerToolsForMode, nativeToolName, validateComputerAction } from '../src/lib/agent-hub/computer/protocol'
import { inputPermissionRequired } from '../src/lib/agent-hub/computer/access'
import { POST } from '../src/app/api/computer/route'
import { NextRequest } from 'next/server'
let passed = 0
const check = (name: string, value: unknown) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`) }
async function main() {
  for (const name of ['get_windows', 'get_active_window', 'inspect_window', 'focus_window', 'capture_screen', 'click', 'double_click', 'right_click', 'move_mouse', 'drag', 'scroll', 'type_text', 'press_key', 'hotkey', 'wait_for_element', 'open_application', 'read_element', 'stop']) check(`desktop.${name} has a validated tool contract`, !!COMPUTER_SCHEMAS[`desktop.${name}`])
  check('model tool names round-trip to the strict native registry', COMPUTER_TOOLS.every((tool) => COMPUTER_SCHEMAS[nativeToolName(tool.name)]))
  for (const name of ['get_mouse_position', 'hover', 'mouse_down', 'mouse_up', 'key_down', 'key_up', 'minimize_window', 'maximize_window', 'restore_window', 'close_window']) check(`desktop.${name} has a validated tool contract`, !!COMPUTER_SCHEMAS[`desktop.${name}`])
  assert.throws(() => validateComputerAction('desktop.click', { snapshot_id: 's', element_id: 'e', duration_ms: 2001 }))
  check('unbounded pointer durations are rejected', true)
  assert.throws(() => validateComputerAction('desktop.mouse_down', { snapshot_id: 's', x: 20, y: 30, button: 'unknown' }))
  check('unknown held mouse buttons are rejected', true)
  check('negative coordinates remain valid for a secondary display', validateComputerAction('desktop.move_mouse', { snapshot_id: 's', x: -1200, y: 200 }).x === -1200)
  check('Calculator is an explicit permitted launch option', validateComputerAction('desktop.open_application', { application: 'calculator' }).application === 'calculator')
  check('all tools specify output shape, timeout, permission and verification', Object.values(COMPUTER_TOOL_METADATA).every((metadata) => metadata.output && metadata.timeoutMs > 0 && metadata.permission && metadata.verification))
  for (const [name, args] of [['desktop.open_application', { application: 'powershell' }], ['desktop.inspect_window', { handle: -1 }], ['desktop.click', { snapshot_id: 'old' }], ['desktop.type_text', { snapshot_id: 's', element_id: 'e', text: 'x'.repeat(8001) }], ['browser.fill', { page_id: 'p', role: 'textbox', name: 'field', text: 'x', script: 'evil' }], ['run_anything', {}]] as const) {
    assert.throws(() => validateComputerAction(name, args)); check(`${name} rejects unsafe or malformed arguments`, true)
  }
  check('all computer input actions require approval', ['desktop.click', 'desktop.type_text', 'desktop.open_application', 'browser.fill', 'browser.navigate'].every((name) => !COMPUTER_READS.has(name)))
  check('observation tools are explicitly classified', COMPUTER_READS.has('desktop.inspect_window') && COMPUTER_READS.has('browser.inspect'))
  check('control mode exposes the real Notepad launch tool', computerToolsForMode(false).some((tool) => tool.name === 'desktop_open_application'))
  check('observe-only mode withholds all input tools', computerToolsForMode(true).every((tool) => COMPUTER_READS.has(nativeToolName(tool.name))))
  for (const request of ['open notepad and type hi', 'Please launch Notepad', 'Can you open Notepad?', 'could you please type a test sentence', 'save this file', 'Run the tests', 'Click the test button']) {
    const message = inputPermissionRequired(request, true)
    check(`observe-only explains input permissions for: ${request}`, message?.includes('Observe only') && message.includes('application-launch tool') && message.includes('clear Read only'))
    check(`control mode does not block the proposal: ${request}`, !inputPermissionRequired(request, false))
  }
  for (const request of ['Is Notepad open?', 'Count the open windows', 'Tell me which apps are open', 'Read the text from Notepad', 'Explain how to open Notepad', 'Do not open Notepad', 'What is the current folder?']) check(`observation/help request remains available: ${request}`, !inputPermissionRequired(request, true))
  const req = (origin?: string, host = 'localhost') => new NextRequest(`http://${host}/api/computer`, { method: 'POST', headers: { Host: host, ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' }, body: '{"action":"connect"}' })
  check('missing origin cannot enable the bridge', (await POST(req())).status === 403)
  check('cross-origin requests cannot enable the bridge', (await POST(req('https://untrusted.example'))).status === 403)
  check('LAN/public-host access is refused', (await POST(req('http://192.168.1.50', '192.168.1.50'))).status === 403)
  const previous = process.env.AGENTHUB_LOCAL_ONLY
  delete process.env.AGENTHUB_LOCAL_ONLY
  check('an old broadly-bound startup cannot enable computer control', (await POST(req('http://localhost'))).status === 403)
  if (previous !== undefined) process.env.AGENTHUB_LOCAL_ONLY = previous
  console.log(`\n${passed} computer protocol/security checks passed.`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
