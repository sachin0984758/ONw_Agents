import { workspaceResult, type WorkspaceResult } from './workspace-result'
import { promises as fs } from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import { readRuntimePolicy } from '@/lib/agent-hub/runtime-policy'
import { currentWorkspaceRoot as workspaceRoot } from '@/lib/agent-hub/session/workspaces'

// Shared workspace command service. HTTP adapters and server-owned Session /
// Auto tools use the same policy, cwd validation and process lifecycle.
//
//   GET   ?op=scripts                 → package.json scripts (parsed, never run)
//   GET   ?op=list                    → background tasks
//   GET   ?op=logs&taskId=<id>&lines  → task output tail
//   POST  {command, timeoutMs?, background?, mode} → run or start a task
//   POST  {action:'stop', taskId, mode}            → stop a background task
//
// Safety: commands run with the workspace as cwd. A blocklist refuses
// destructive, privileged and remote-pipe commands outright; everything else
// still needs the session's own approval gate (edit mode) before it runs.
// Output is capped; timeouts kill the process; background tasks keep a ring
// buffer and can be stopped. This is NOT a sandbox: it is the machine the
// dashboard runs on. Never point it at untrusted code in read-only mode —
// reads and searches are the only tools there.
// ─────────────────────────────────────────────────────────────────────────────





// Destructive, privileged, or remote-code-pipe commands are refused outright.
// Everything else still passes through the session approval gate.
const BLOCKED: Array<{ re: RegExp; why: string }> = [
  { re: /\brm\s+(-[a-z]*r[a-z]*\s+)(-[a-z]*\s+)*(\/( |$)|~(\/| |$))/i, why: 'recursive delete of / or ~' },
  { re: /\b(mkfs|dd\s+[^;|&]*\bof=\/dev|:\(\)\s*\{)/i, why: 'disk-destructive command' },
  { re: /\b(format\s+[a-z]:|deltree\b)/i, why: 'disk-destructive command' },
  { re: /\b(rd\s+\/s(\s+\/q)?\s+c:|del\s+\/[fsq].*c:\\windows)/i, why: 'destructive Windows delete' },
  { re: /Remove-Item\s+.*(C:\\?\s*(-Recurse| -Force)|HKLM:)/i, why: 'destructive PowerShell removal' },
  { re: /(^|[\s;&|])(sudo|runas|doas|su)\s/i, why: 'privilege escalation' },
  { re: /\b(chmod\s+-R\s+777\s+\/|chown\s+-R\s+\S+\s+\/)/i, why: 'system-wide permission change' },
  { re: /(^|[\s;&|])(shutdown|reboot|halt|poweroff|Restart-Computer|Stop-Computer)\b/i, why: 'machine power control' },
  { re: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|;]*\|\s*(sh|bash|pwsh|powershell|cmd)\b/i, why: 'remote code piped to a shell' },
]

function policyCheck(command: string): string | null {
  for (const b of BLOCKED) {
    if (b.re.test(command)) return `Refused: ${b.why}.`
  }
  return null
}

interface Task {
  id: string
  projectRoot: string
  command: string
  proc: ChildProcess | null
  lines: string[]
  status: 'running' | 'exited' | 'stopped'
  exitCode: number | null
  startedAt: number
}

const RING_SIZE = 300
const OUTPUT_CAP = 64 * 1024
const tasks = new Map<string, Task>()
let counter = 0

function belongsToProject(task: Task): boolean {
  const current = path.resolve(workspaceRoot())
  const owner = path.resolve(task.projectRoot)
  return process.platform === 'win32' ? current.toLowerCase() === owner.toLowerCase() : current === owner
}

function killTask(t: Task): void {
  try {
    const pid = t.proc?.pid
    if (!pid) return
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
    } else {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        t.proc?.kill('SIGKILL')
      }
    }
  } catch {
    // best effort
  }
}

function pushLine(t: Task, chunk: Buffer | string): void {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line === '') continue
    t.lines.push(line.length > 2000 ? line.slice(0, 2000) + '…[truncated]' : line)
    if (t.lines.length > RING_SIZE) t.lines.shift()
  }
}

function capOutput(text: string): { text: string; truncated: boolean } {
  if (text.length <= OUTPUT_CAP) return { text, truncated: false }
  const head = text.slice(0, OUTPUT_CAP / 2)
  const tail = text.slice(-OUTPUT_CAP / 2)
  return { text: `${head}\n…[truncated ${text.length - OUTPUT_CAP} chars]…\n${tail}`, truncated: true }
}

export async function readWorkspaceCommands(q: URLSearchParams) {
  const op = q.get('op') ?? 'list'

  if (op === 'scripts') {
    const root = workspaceRoot()
    try {
      const raw = await fs.readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ root, 'package.json'), 'utf-8')
      if (raw.length > 1024 * 1024) return workspaceResult({ ok: true, scripts: {} })
      // Parse only — package data is never executed or interpolated.
      const pkg = JSON.parse(raw) as { scripts?: unknown }
      const scripts: Record<string, string> = {}
      if (pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)) {
        for (const [k, v] of Object.entries(pkg.scripts as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) scripts[k] = v.slice(0, 500)
        }
      }
      return workspaceResult({ ok: true, scripts })
    } catch {
      return workspaceResult({ ok: true, scripts: {} })
    }
  }

  if (op === 'list') {
    const rows = [...tasks.values()].filter(belongsToProject).map((t) => ({
      id: t.id,
      command: t.command,
      status: t.status,
      exitCode: t.exitCode,
      ageSec: Math.round((Date.now() - t.startedAt) / 1000),
    }))
    return workspaceResult({ ok: true, tasks: rows })
  }

  if (op === 'logs') {
    const t = tasks.get(q.get('taskId') ?? '')
    if (!t || !belongsToProject(t)) {
      const known = [...tasks.values()].filter(belongsToProject).map((task) => task.id).join(', ') || 'none'
      return workspaceResult({ ok: false, error: `No task "${q.get('taskId')}". Known tasks: ${known}.` }, { status: 404 })
    }
    const n = Math.min(RING_SIZE, Math.max(1, Number(q.get('lines') ?? 50) || 50))
    return workspaceResult({
      ok: true,
      id: t.id,
      command: t.command,
      status: t.status,
      exitCode: t.exitCode,
      logs: t.lines.slice(-n).join('\n') || '(no output yet)',
    })
  }

  return workspaceResult({ ok: false, error: 'Unknown op. Use scripts, list or logs.' }, { status: 400 })
}

export async function executeWorkspaceCommand(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return workspaceResult({ ok: false, error: 'Request body must be a JSON object.' }, { status: 400 })
  const body = input as { action?: unknown; command?: unknown; taskId?: unknown; timeoutMs?: unknown; background?: unknown; mode?: unknown; workspace?: unknown }
  if (body.mode !== 'edit') {
    return workspaceResult({ ok: false, error: 'Commands require edit mode.' }, { status: 403 })
  }
  const projectRoot = workspaceRoot()
  let root = projectRoot
  if (typeof body.workspace === 'string' && body.workspace && body.workspace !== '.') {
    const relative = body.workspace.replace(/\\/g, '/')
    if (relative.startsWith('/') || /^[A-Za-z]:/.test(relative) || relative.split('/').some((part) => part === '..' || part.includes('\0'))) return workspaceResult({ ok: false, error: 'Command workspace must be a relative project folder.' }, { status: 400 })
    try {
      const realProject = await fs.realpath(/* turbopackIgnore: true */ projectRoot)
      const candidate = await fs.realpath(/* turbopackIgnore: true */ path.resolve(projectRoot, relative))
      const inside = path.relative(realProject, candidate)
      if (inside.startsWith('..') || path.isAbsolute(inside)) return workspaceResult({ ok: false, error: 'Command workspace escapes the project through a symbolic link.' }, { status: 403 })
      if (!(await fs.stat(/* turbopackIgnore: true */ candidate)).isDirectory()) return workspaceResult({ ok: false, error: 'Command workspace is not a directory.' }, { status: 400 })
      root = candidate
    } catch { return workspaceResult({ ok: false, error: 'Command workspace folder is not available.' }, { status: 400 }) }
  }

  if (body.action === 'stop') {
    const t = tasks.get(typeof body.taskId === 'string' ? body.taskId : '')
    if (!t || !belongsToProject(t)) return workspaceResult({ ok: false, error: `No task "${body.taskId}".` }, { status: 404 })
    if (t.status !== 'running') return workspaceResult({ ok: true, id: t.id, status: t.status })
    t.status = 'stopped'
    killTask(t)
    return workspaceResult({ ok: true, id: t.id, status: 'stopped' })
  }

  // Honour Settings → Capabilities → "Code execution and file creation".
  // Stopping a task above is always allowed; launching a new command is not
  // when the user has switched code execution off (persisted in hub state).
  const policy = await readRuntimePolicy()
  if (!policy.codeExecution) {
    return workspaceResult(
      {
        ok: false,
        error:
          'Code execution is disabled (Settings → Capabilities → "Code execution and file creation"). Enable it to run commands.',
      },
      { status: 403 },
    )
  }

  const command = typeof body.command === 'string' ? body.command.trim() : ''
  if (!command) return workspaceResult({ ok: false, error: 'command is required.' }, { status: 400 })
  if (command.length > 4000) return workspaceResult({ ok: false, error: 'command is too long (max 4000 chars).' }, { status: 413 })
  const refused = policyCheck(command)
  if (refused) return workspaceResult({ ok: false, error: refused }, { status: 403 })

  if (body.background === true) {
    const id = `t${++counter}`
    let proc: ChildProcess
    try {
      proc = spawn(command, { cwd: root, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      return workspaceResult(
        { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Failed to start.' },
        { status: 500 },
      )
    }
    const t: Task = { id, projectRoot, command, proc, lines: [], status: 'running', exitCode: null, startedAt: Date.now() }
    proc.stdout?.on('data', (c: Buffer) => pushLine(t, c))
    proc.stderr?.on('data', (c: Buffer) => pushLine(t, c))
    proc.on('error', (err) => {
      pushLine(t, `[failed to start: ${err.message}]`)
      t.status = 'exited'
      t.exitCode = -1
    })
    proc.on('close', (code) => {
      if (t.status === 'running') {
        t.status = 'exited'
        t.exitCode = code
      }
    })
    tasks.set(id, t)
    await new Promise((r) => setTimeout(r, 1500))
    const early = t.lines.slice(-15).join('\n')
    const status =
      t.status === 'running'
        ? `Task ${id} is running in the background.`
        : `Task ${id} exited almost immediately (exit code ${t.exitCode}).`
    return workspaceResult({ ok: true, id, status, command, earlyOutput: early })
  }

  const timeoutMs = Math.min(300000, Math.max(1000, Number(body.timeoutMs) || 120000))
  const started = Date.now()
  return new Promise<WorkspaceResult>((resolve) => {
    let proc: ChildProcess
    try {
      proc = spawn(command, { cwd: root, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve(
        workspaceResult(
          { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Failed to start.' },
          { status: 500 },
        ),
      )
      return
    }
    let out = ''
    let errOut = ''
    let done = false
    const finish = (exitCode: number | null, timedOut: boolean) => {
      if (done) return
      done = true
      const capped = capOutput(out)
      const cappedErr = capOutput(errOut)
      resolve(
        workspaceResult({
          ok: true,
          command,
          exitCode,
          stdout: capped.text,
          stderr: cappedErr.text,
          truncated: capped.truncated || cappedErr.truncated,
          timedOut,
          durationMs: Date.now() - started,
        }),
      )
    }
    const timer = setTimeout(() => {
      try {
        const pid = proc.pid
        if (pid) {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true })
          } else {
            try {
              process.kill(-pid, 'SIGKILL')
            } catch {
              proc.kill('SIGKILL')
            }
          }
        }
      } catch {
        // best effort
      }
      finish(null, true)
    }, timeoutMs)
    proc.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8')
      if (out.length > OUTPUT_CAP * 2) out = out.slice(-OUTPUT_CAP * 2)
    })
    proc.stderr?.on('data', (c: Buffer) => {
      errOut += c.toString('utf8')
      if (errOut.length > OUTPUT_CAP * 2) errOut = errOut.slice(-OUTPUT_CAP * 2)
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve(workspaceResult({ ok: false, error: `Failed to start: ${err.message.slice(0, 300)}` }, { status: 500 }))
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      finish(code, false)
    })
  })
}
