import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ShellKind } from '../config/types.ts'
import { displayPath, resolveInside } from '../utils/fsx.ts'
import { redactSecrets } from '../utils/redact.ts'
import { filterSensitiveEnvironment } from '../utils/env.ts'
import { optionalNumber, requireString, optionalString } from './validate.ts'
import type { AgentTool, ToolResult } from './types.ts'

const HARD_OUTPUT_CAP = 5 * 1024 * 1024

function shellSpec(kind: ShellKind, command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    if (kind === 'powershell') {
      return {
        file: process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      }
    }
    if (kind === 'bash') return { file: 'bash.exe', args: ['-lc', command] }
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  if (kind === 'powershell') return { file: 'pwsh', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] }
  return { file: '/bin/sh', args: ['-lc', command] }
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      // best effort
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // best effort
    }
  }
}

interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  truncated: boolean
  durationMs: number
}

function execShell(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  maxBytes: number,
  signal: AbortSignal,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let bytes = 0
    const outputLimit = Math.min(HARD_OUTPUT_CAP, Math.max(0, maxBytes))
    let truncated = false
    let timedOut = false
    let aborted = false
    let settled = false

    const child = spawn(file, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: {
        ...filterSensitiveEnvironment(process.env),
        GIT_PAGER: 'cat',
        PAGER: 'cat',
        GIT_TERMINAL_PROMPT: '0',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const append = (which: 'out' | 'err', chunk: Buffer) => {
      if (bytes >= outputLimit) {
        truncated = true
        return
      }
      const remaining = outputLimit - bytes
      const captured = chunk.subarray(0, remaining)
      bytes += captured.length
      if (which === 'out') stdoutChunks.push(captured)
      else stderrChunks.push(captured)
      if (captured.length < chunk.length || bytes >= outputLimit) truncated = true
    }

    child.stdout?.on('data', (chunk: Buffer) => append('out', chunk))
    child.stderr?.on('data', (chunk: Buffer) => append('err', chunk))

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, timeoutMs)

    const onAbort = () => {
      aborted = true
      killTree(child.pid)
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      stdout = Buffer.concat(stdoutChunks).toString('utf8')
      stderr = Buffer.concat(stderrChunks).toString('utf8')
      if (timedOut) code = 124
      else if (aborted) code = 130
      resolve({
        code,
        stdout,
        stderr,
        timedOut,
        aborted,
        truncated: truncated || bytes >= HARD_OUTPUT_CAP,
        durationMs: Date.now() - started,
      })
    }

    child.on('error', (err) => {
      append('err', Buffer.from(`\nFailed to start command: ${err.message}`))
      finish(127)
    })
    child.on('close', (code) => finish(code))
  })
}

function formatOutput(result: ExecResult, command: string): string {
  const status = result.aborted
    ? 'cancelled'
    : result.timedOut
      ? 'timed out'
      : result.code === 0
        ? 'success'
        : `failed (exit ${result.code ?? 'unknown'})`
  const parts = [
    `$ ${command}`,
    `status: ${status} · ${(result.durationMs / 1000).toFixed(2)}s`,
  ]
  if (result.stdout.trim()) parts.push('--- stdout ---', result.stdout.trimEnd())
  if (result.stderr.trim()) parts.push('--- stderr ---', result.stderr.trimEnd())
  if (!result.stdout.trim() && !result.stderr.trim()) parts.push('(no output)')
  if (result.truncated) parts.push('(output was truncated)')
  return redactSecrets(parts.join('\n'))
}

export const runCommandTool: AgentTool = {
  name: 'run_command',
  description:
    'Run a shell command in the workspace. Commands run with your OS user permissions (not a sandbox) and are subject to the permission policy. Use it to run tests, type checks, linters and builds.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command line to execute.' },
      cwd: { type: 'string', description: 'Working directory relative to the workspace (default ".").' },
      timeout_ms: { type: 'integer', description: 'Timeout in milliseconds (bounded by config).' },
      reason: { type: 'string', description: 'Short reason for running the command.' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const command = requireString(input, 'command', { max: 4000 })
    const cwdInput = optionalString(input, 'cwd', { max: 1000 })?.trim() || '.'
    const reason = optionalString(input, 'reason', { max: 300 })
    const requestedTimeout = optionalNumber(input, 'timeout_ms', { min: 1000, max: 600_000, integer: true })
    const timeoutMs = Math.min(requestedTimeout ?? ctx.config.commandTimeoutMs, ctx.config.commandTimeoutMs)
    const cwd = await resolveInside(ctx.workspace, cwdInput)
    const stat = await fs.stat(cwd).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      return { ok: false, content: '', error: `Working directory does not exist: ${cwdInput}` }
    }
    const auth = await ctx.authorize(
      { kind: 'shell.run', command, cwd },
      'run_command',
      [`${displayPath(ctx.workspace, cwd)}$ ${command}`, reason ? `Reason: ${reason}` : ''].filter(Boolean).join('\n'),
    )
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }

    const spec = shellSpec(ctx.config.shell, command)
    const result = await execShell(spec.file, spec.args, cwd, timeoutMs, ctx.config.maxOutputBytes, ctx.signal)
    ctx.ledger.addCommand({
      command,
      exitCode: result.code,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    })
    const formatted = formatOutput(result, command)
    if (result.aborted) {
      return { ok: false, content: formatted, error: 'Command cancelled.', truncated: result.truncated }
    }
    if (result.timedOut) {
      return {
        ok: false,
        content: formatted,
        error: `Command timed out after ${timeoutMs} ms and was terminated.`,
        truncated: result.truncated,
      }
    }
    if (result.code !== 0) {
      return {
        ok: false,
        content: formatted,
        error: `Command exited with code ${result.code ?? 'unknown'}.`,
        truncated: result.truncated,
      }
    }
    return { ok: true, content: formatted, truncated: result.truncated }
  },
}

export const shellTools: AgentTool[] = [runCommandTool]

export { execShell, formatOutput, shellSpec }
export type { ExecResult }
