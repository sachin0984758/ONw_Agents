import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { resolveProjectRoot } from '../db-path'

interface Bridge { child: ChildProcess; port: number; token: string; nativePid?: number; starting?: Promise<void>; error?: string }
const shared = globalThis as typeof globalThis & { agentHubComputerBridge?: Bridge }
export interface BridgeReply { ok: boolean; result?: Record<string, unknown>; error?: string; duration_ms?: number }

export async function startComputerBridge(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Auto computer control requires Windows.')
  if (shared.agentHubComputerBridge?.starting) return shared.agentHubComputerBridge.starting
  if (shared.agentHubComputerBridge?.child.exitCode === null && shared.agentHubComputerBridge.port) return
  const root = resolveProjectRoot()
  const python = process.env.AGENTHUB_COMPUTER_PYTHON || path.join(root, 'agenthub-computer', '.venv', 'Scripts', 'python.exe')
  await fs.access(python).catch(() => { throw new Error('Run npm run computer:setup once to install the local Windows companion dependencies.') })
  const token = randomBytes(32).toString('hex')
  // Python and its environment are installed locally, outside Next's bundle.
  const child = spawn(/* turbopackIgnore: true */ python, ['-u', path.join(root, 'agenthub-computer', 'controller.py')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AGENTHUB_COMPUTER_TOKEN: token, AGENTHUB_COMPUTER_PARENT: String(process.pid) } })
  const bridge: Bridge = { child, port: 0, token }
  shared.agentHubComputerBridge = bridge
  bridge.starting = new Promise<void>((resolve, reject) => {
    let buffer = ''; let errors = ''; let settled = false
    const finish = (error?: string) => {
      if (settled) return
      settled = true; clearTimeout(timer); bridge.starting = undefined
      if (error) { bridge.error = error; child.kill(); reject(new Error(error)) } else resolve()
    }
    const timer = setTimeout(() => finish('The Windows companion did not start within 25 seconds.'), 25_000)
    child.stderr?.on('data', (chunk) => { errors = (errors + String(chunk)).slice(-3000) })
    child.stdout?.on('data', (chunk) => {
      buffer += String(chunk)
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''
      for (const line of lines) {
        try { const value = JSON.parse(line); if (value.ready && Number.isInteger(value.port)) { bridge.port = value.port; bridge.nativePid = Number(value.pid); finish() } } catch { /* startup diagnostics never become model instructions */ }
      }
    })
    child.on('error', () => finish('Could not launch the Windows companion. Run npm run computer:setup.'))
    child.on('exit', () => { if (!settled) finish(`Windows companion exited during startup: ${errors.slice(-1200) || 'check Python dependencies and emergency-hotkey availability'}`) })
  })
  return bridge.starting
}

export async function computerRequest(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<BridgeReply> {
  const bridge = shared.agentHubComputerBridge
  if (!bridge?.port || bridge.child.exitCode !== null) throw new Error('The Windows companion is disconnected. Connect it in Auto.')
  const url = `http://127.0.0.1:${bridge.port}`
  const headers = { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' }
  let response: Response
  let reply: BridgeReply
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ name, args }), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(32_000)]) })
    reply = await response.json() as BridgeReply
  } catch (error) {
    // Aborting HTTP alone does not interrupt a native worker. The independent
    // stop handler must also disable input, including for manual tool calls.
    if (!['control.stop', 'control.status', 'control.shutdown', 'desktop.stop'].includes(name)) await fetch(url, { method: 'POST', headers, body: JSON.stringify({ name: 'control.stop', args: {} }), signal: AbortSignal.timeout(2000) }).catch(() => {})
    throw error
  }
  if (!response.ok || !reply.ok) throw new Error(reply.error || `Computer action failed (${response.status}).`)
  return reply
}

export async function computerStatus(): Promise<Record<string, unknown>> {
  try { return { ...(await computerRequest('control.status')).result, connected: true } }
  catch { return { enabled: false, connected: false, platform: process.platform, error: shared.agentHubComputerBridge?.error } }
}

export async function stopComputerBridge(): Promise<void> {
  await computerRequest('control.stop').catch(() => {})
  await computerRequest('control.shutdown').catch(() => {})
  const bridge = shared.agentHubComputerBridge
  if (bridge?.nativePid && Number.isInteger(bridge.nativePid)) { try { process.kill(bridge.nativePid) } catch { /* already stopped */ } }
  bridge?.child.kill()
  delete shared.agentHubComputerBridge
}
