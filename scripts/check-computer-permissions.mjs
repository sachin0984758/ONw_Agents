import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'

const base = process.env.AGENTHUB_TEST_URL || 'http://127.0.0.1:3000'
let ownsScope = false
let passed = 0
const evidence = {}
const check = (name, value) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`) }
const status = async () => (await (await fetch(`${base}/api/computer`)).json())
async function post(body) {
  const response = await fetch(`${base}/api/computer`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok || !value.ok) throw new Error(value.error || `HTTP ${response.status}`)
  return value
}

try {
  const initial = await status()
  check('acceptance leaves any existing user session alone', !initial.activeId && !initial.computer.enabled)
  await post({ action: 'connect' })
  ownsScope = true
  await post({ action: 'enable', scope: { applications: ['notepad'], domains: [], readonly: true } })
  const start = await post({ action: 'start', input: { request: 'open notepad and type hi', model: '', visionModel: '', profile: 'fast', saveSummary: false } })
  let current
  for (let i = 0; i < 100; i++) {
    current = await status()
    if (!current.activeId && !current.computer.enabled) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const blocked = current.tasks.find((task) => task.id === start.task.id)
  check('the exact reported request needs input permission instead of completing', blocked?.permissionRequired && blocked.phase === 'partial')
  check('the explanation identifies Read only and the existing launch capability', blocked.result.includes('clear Read only') && blocked.result.includes('application-launch tool'))
  check('no model inference is wasted on the blocked request', blocked.modelCalls === 0)
  check('no observation or input action is dispatched for the blocked request', blocked.events.every((event) => event.action === 'permission'))
  check('blocked requests leave native input disabled', !current.computer.enabled && !current.activeId)
  evidence.readonly = { phase: blocked.phase, permissionRequired: blocked.permissionRequired, modelCalls: blocked.modelCalls, result: blocked.result }

  if (process.argv.includes('--launch-notepad')) {
    // Explicit safe acceptance action: launch/locate Notepad, but never type,
    // save, close tabs or modify a user document.
    await post({ action: 'enable', scope: { applications: ['notepad'], domains: [], readonly: false } })
    const started = performance.now()
    const opened = await post({ action: 'tool', name: 'desktop.open_application', args: { application: 'notepad' }, confirmed: true })
    const windows = opened.result?.windows ?? []
    check('the real launch tool finds an actual permitted Notepad window', opened.result?.verified && windows.some((window) => window.process === 'notepad.exe' && window.allowed))
    const found = await post({ action: 'tool', name: 'desktop.get_windows', args: {} })
    check('an independent desktop query confirms that Notepad is open', found.result.windows.some((window) => window.process === 'notepad.exe' && window.allowed))
    evidence.launch = { verified: true, alreadyOpen: !!opened.result.already_open, windows: windows.length, elapsedMs: performance.now() - started }
  }
  await post({ action: 'stop' })
  check('acceptance finishes with computer input off', !(await status()).computer.enabled)
  await fs.mkdir('output/computer-use', { recursive: true })
  await fs.writeFile('output/computer-use/permissions-acceptance.json', JSON.stringify({ passed, checkedAt: new Date().toISOString(), ...evidence }, null, 2))
  console.log(`\n${passed} actual permission/launch checks passed.`)
} finally {
  if (ownsScope) await post({ action: 'stop' }).catch(() => {})
}
