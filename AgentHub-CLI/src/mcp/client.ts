import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { McpServerConfig } from '../config/types.ts'
import { filterSensitiveEnvironment } from '../utils/env.ts'
import { redactSecrets } from '../utils/redact.ts'

const MAX_STDERR = 12_000

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string | null
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export interface McpToolResult {
  content: unknown
  isError: boolean
  raw: unknown
}

export class McpError extends Error {
  readonly server: string
  constructor(server: string, message: string) {
    super(`MCP server "${server}": ${message}`)
    this.name = 'McpError'
    this.server = server
  }
}

/**
 * Minimal, standards-based MCP stdio client (JSON-RPC 2.0, newline framed).
 * One client owns one child process. Servers are only started from explicit
 * user configuration; a model cannot add a server or choose a command.
 */
export class McpStdioClient {
  readonly server: McpServerConfig
  private readonly child: ChildProcessWithoutNullStreams
  private buffer = ''
  private stderr = ''
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private closed = false
  private readonly closeListeners = new Set<() => void>()
  private readonly abortListener: () => void
  private readonly signal: AbortSignal

  private constructor(server: McpServerConfig, signal: AbortSignal) {
    this.server = server
    this.signal = signal
    // Do not pass the CLI's ambient credentials to every configured server.
    // Explicit per-server variables remain available for intentional secrets.
    const env = { ...filterSensitiveEnvironment(process.env), ...(server.env ?? {}) }
    this.child = spawn(server.command, server.args, {
      cwd: server.cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-MAX_STDERR)
    })
    this.child.on('error', (err) => this.failAll(new McpError(server.id, `failed to start: ${err.message}`)))
    this.child.on('exit', (code, signal) => {
      const detail = this.stderr.trim() ? `\n${redactSecrets(this.stderr.trim()).slice(-1500)}` : ''
      this.failAll(new McpError(server.id, `exited (${signal ?? code ?? 'unknown'})${detail}`))
    })
    this.abortListener = () => this.shutdown(new McpError(server.id, 'cancelled.'))
    if (signal.aborted) this.abortListener()
    else signal.addEventListener('abort', this.abortListener, { once: true })
  }

  static async connect(server: McpServerConfig, signal: AbortSignal): Promise<McpStdioClient> {
    const client = new McpStdioClient(server, signal)
    const timeout = server.timeoutMs ?? 20_000
    try {
      await client.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'AgentHub-CLI', version: '0.1.0' },
      }, timeout)
      client.notify('notifications/initialized', {})
      return client
    } catch (err) {
      client.close()
      throw err instanceof McpError ? err : new McpError(server.id, err instanceof Error ? err.message : String(err))
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) break
      const line = this.buffer.slice(0, newline).replace(/\r$/, '').trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      let message: JsonRpcResponse
      try {
        message = JSON.parse(line) as JsonRpcResponse
      } catch {
        // Servers sometimes print a banner to stdout. Ignore non-JSON rather
        // than killing an otherwise usable connection.
        continue
      }
      if (typeof message.id !== 'number') continue
      const pending = this.pending.get(message.id)
      if (!pending) continue
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(
          new McpError(
            this.server.id,
            `${message.error.message ?? 'request failed'} (code ${message.error.code ?? 'unknown'})`,
          ),
        )
      } else {
        pending.resolve(message.result)
      }
    }
  }

  private failAll(error: Error): void {
    if (this.closed && this.pending.size === 0) return
    this.closed = true
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    for (const listener of this.closeListeners) listener()
    this.closeListeners.clear()
  }

  private send(message: Record<string, unknown>): void {
    if (this.closed || this.child.stdin.destroyed) throw new McpError(this.server.id, 'connection is closed.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.signal.aborted) return Promise.reject(new McpError(this.server.id, 'cancelled.'))
    if (this.closed) return Promise.reject(new McpError(this.server.id, 'connection is closed.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new McpError(this.server.id, `request "${method}" timed out after ${timeoutMs} ms.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err)
      }
    })
  }

  private notify(method: string, params: Record<string, unknown>): void {
    try {
      this.send({ jsonrpc: '2.0', method, params })
    } catch {
      // A notification failure will surface on the next request.
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.request('tools/list', {}, this.server.timeoutMs ?? 20_000)
    const obj = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
    const tools = Array.isArray(obj.tools) ? obj.tools : []
    const out: McpToolInfo[] = []
    for (const raw of tools) {
      if (!raw || typeof raw !== 'object') continue
      const tool = raw as Record<string, unknown>
      if (typeof tool.name !== 'string' || !tool.name) continue
      const schema = tool.inputSchema && typeof tool.inputSchema === 'object' ? (tool.inputSchema as Record<string, unknown>) : { type: 'object' }
      out.push({
        name: tool.name,
        ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
        inputSchema: schema,
        ...(tool.annotations && typeof tool.annotations === 'object'
          ? { annotations: tool.annotations as Record<string, unknown> }
          : {}),
      })
    }
    return out
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.request('tools/call', { name, arguments: args }, this.server.timeoutMs ?? 60_000)
    const obj = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
    return { content: obj.content ?? null, isError: obj.isError === true, raw: result }
  }

  close(): void {
    this.shutdown(new McpError(this.server.id, 'connection is closed.'))
  }

  private shutdown(error: McpError): void {
    if (this.closed) return
    this.closed = true
    this.signal.removeEventListener('abort', this.abortListener)
    this.failAll(error)
    try {
      this.child.stdin.end()
    } catch {
      // best effort
    }
    try {
      this.child.kill()
    } catch {
      // best effort
    }
  }
}

/** Format the content blocks returned by tools/call for the model. */
export function formatMcpResult(result: McpToolResult): string {
  if (Array.isArray(result.content)) {
    const parts: string[] = []
    for (const block of result.content) {
      if (!block || typeof block !== 'object') continue
      const item = block as Record<string, unknown>
      if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
      else if (item.type === 'resource' && item.resource && typeof item.resource === 'object') {
        const resource = item.resource as Record<string, unknown>
        if (typeof resource.text === 'string') parts.push(resource.text)
        else parts.push(JSON.stringify(resource))
      } else if (item.type === 'image') {
        parts.push(`[image${typeof item.mimeType === 'string' ? ` ${item.mimeType}` : ''} omitted from terminal output]`)
      } else {
        parts.push(JSON.stringify(item))
      }
    }
    return parts.join('\n').trim() || '(the MCP tool returned no text content)'
  }
  return JSON.stringify(result.raw, null, 2).slice(0, 120_000)
}
