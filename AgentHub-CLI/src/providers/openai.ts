import type { ProviderConfig } from '../config/types.ts'
import { redactSecrets } from '../utils/redact.ts'
import {
  ProviderError,
  isAbortError,
  type ChatRequest,
  type ChatResponse,
  type ModelInfo,
  type Provider,
  type TokenUsage,
  type ToolCall,
} from './types.ts'

function trimBase(base: string): string {
  return base.replace(/\/+$/, '')
}

function originOf(base: string): string {
  try {
    return new URL(base).origin
  } catch {
    return base
  }
}

function normalizeUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const input = obj.prompt_tokens ?? obj.input_tokens
  const output = obj.completion_tokens ?? obj.output_tokens
  if (typeof input !== 'number' && typeof output !== 'number') return null
  return {
    input: typeof input === 'number' ? input : null,
    output: typeof output === 'number' ? output : null,
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ProviderError('Cancelled.', { code: 'ABORTED' }))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new ProviderError('Cancelled.', { code: 'ABORTED' }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function errorForStatus(status: number, body: string, providerLabel: string, apiKeyEnv?: string): ProviderError {
  const detail = redactSecrets(body).slice(0, 600)
  if (status === 401 || status === 403) {
    return new ProviderError(
      `${providerLabel}: authentication failed (HTTP ${status}).${apiKeyEnv ? ` Set ${apiKeyEnv}.` : ''}`,
      { status, code: 'AUTH', retryable: false, detail },
    )
  }
  if (status === 404) {
    return new ProviderError(
      `${providerLabel}: endpoint or model not found (HTTP 404). Check the base URL and model id.`,
      { status, code: 'NOT_FOUND', retryable: false, detail },
    )
  }
  if (status === 429) {
    return new ProviderError(`${providerLabel}: rate limited (HTTP 429).`, {
      status,
      code: 'RATE_LIMIT',
      retryable: true,
      detail,
    })
  }
  if (status >= 500) {
    return new ProviderError(`${providerLabel}: server error (HTTP ${status}).`, {
      status,
      code: 'SERVER',
      retryable: true,
      detail,
    })
  }
  const hint = /tool|function/i.test(detail)
    ? ' The server may not support tool calling for this model.'
    : ''
  return new ProviderError(`${providerLabel}: request failed (HTTP ${status}).${hint}`, {
    status,
    code: 'HTTP',
    retryable: false,
    detail,
  })
}

export interface SSEAccumulator {
  content: string
  toolCalls: ToolCall[]
  usage: TokenUsage | null
  finishReason: string | null
  emitted: boolean
  done: boolean
}

interface ToolDraft {
  id: string
  name: string
  args: string
}

export class SSEBuilder {
  private readonly drafts = new Map<number, ToolDraft>()
  private readonly result: SSEAccumulator = {
    content: '',
    toolCalls: [],
    usage: null,
    finishReason: null,
    emitted: false,
    done: false,
  }

  feed(raw: string, onText?: (delta: string) => void): void {
    const dataLines = raw
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
    if (dataLines.length === 0) return
    const payload = dataLines.join('\n').trim()
    if (!payload) return
    if (payload === '[DONE]') {
      this.result.done = true
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      throw new ProviderError('The provider sent a malformed streaming event.', {
        code: 'BAD_STREAM',
        retryable: false,
        detail: redactSecrets(payload).slice(0, 400),
      })
    }
    if (!parsed || typeof parsed !== 'object') return
    const chunk = parsed as Record<string, unknown>
    if (chunk.error) {
      const err = chunk.error as Record<string, unknown>
      throw new ProviderError(`Provider stream error: ${String(err.message ?? 'unknown error')}`, {
        code: 'STREAM_ERROR',
        retryable: false,
        detail: redactSecrets(JSON.stringify(err)).slice(0, 400),
      })
    }
    const usage = normalizeUsage(chunk.usage)
    if (usage) this.result.usage = usage

    const choices = chunk.choices
    if (!Array.isArray(choices) || choices.length === 0) return
    const choice = choices[0] as Record<string, unknown>
    const delta = (choice.delta ?? choice.message ?? {}) as Record<string, unknown>
    const text = delta.content
    if (typeof text === 'string' && text.length > 0) {
      this.result.content += text
      this.result.emitted = true
      onText?.(text)
    }
    const calls = delta.tool_calls
    if (Array.isArray(calls)) {
      for (const rawCall of calls) {
        if (!rawCall || typeof rawCall !== 'object') continue
        const call = rawCall as Record<string, unknown>
        const index = typeof call.index === 'number' ? call.index : this.drafts.size
        const fn = (call.function ?? {}) as Record<string, unknown>
        const existing = this.drafts.get(index) ?? { id: '', name: '', args: '' }
        if (typeof call.id === 'string' && call.id) existing.id = call.id
        if (typeof fn.name === 'string' && fn.name) existing.name += fn.name
        if (typeof fn.arguments === 'string') existing.args += fn.arguments
        this.drafts.set(index, existing)
        this.result.emitted = true
      }
    }
    if (typeof choice.finish_reason === 'string') this.result.finishReason = choice.finish_reason
  }

  hasEmitted(): boolean {
    return this.result.emitted
  }

  finish(): SSEAccumulator {
    const ordered = [...this.drafts.entries()].sort((a, b) => a[0] - b[0])
    const toolCalls: ToolCall[] = []
    for (const [index, draft] of ordered) {
      if (!draft.name) {
        throw new ProviderError('The provider returned a tool call without a name.', {
          code: 'BAD_TOOL_CALL',
          retryable: false,
        })
      }
      toolCalls.push({
        id: draft.id || `call_${index}_${Date.now().toString(36)}`,
        type: 'function',
        function: { name: draft.name, arguments: draft.args || '{}' },
      })
    }
    this.result.toolCalls = toolCalls
    return this.result
  }
}

export class OpenAICompatProvider implements Provider {
  readonly config: ProviderConfig
  readonly label: string

  constructor(config: ProviderConfig) {
    this.config = config
    this.label = config.label ?? config.id
  }

  private apiKey(): string | undefined {
    if (this.config.apiKey) return this.config.apiKey
    if (this.config.apiKeyEnv) {
      const v = process.env[this.config.apiKeyEnv]
      if (v) return v
    }
    return undefined
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers ?? {}),
    }
    const key = this.apiKey()
    if (key && !headers.Authorization) headers.Authorization = `Bearer ${key}`
    return headers
  }

  private combinedSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
    return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  }

  async listModels(signal: AbortSignal): Promise<ModelInfo[]> {
    const url = `${trimBase(this.config.baseUrl)}/models`
    const timeoutMs = this.config.timeoutMs ?? 5_000
    const operationSignal = this.combinedSignal(signal, timeoutMs)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: this.headers(),
        signal: operationSignal,
      })
    } catch (err) {
      if (signal.aborted) throw new ProviderError('Cancelled.', { code: 'ABORTED' })
      if (isAbortError(err)) {
        throw new ProviderError(`${this.label}: model discovery timed out at ${url}.`, {
          code: 'TIMEOUT',
          retryable: true,
          detail: (err as Error).message,
        })
      }
      throw new ProviderError(`${this.label}: cannot reach ${url}. Is the server running?`, {
        code: 'UNREACHABLE',
        retryable: false,
        detail: (err as Error).message,
      })
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw errorForStatus(res.status, body, this.label, this.config.apiKeyEnv)
    }
    let json: unknown
    try {
      json = await res.json()
    } catch (err) {
      if (signal.aborted) throw new ProviderError('Cancelled.', { code: 'ABORTED' })
      if (operationSignal.aborted || isAbortError(err)) {
        throw new ProviderError(`${this.label}: model discovery timed out at ${url}.`, {
          code: 'TIMEOUT',
          retryable: true,
          detail: (err as Error).message,
        })
      }
      throw new ProviderError(`${this.label}: ${url} did not return valid JSON.`, {
        code: 'BAD_RESPONSE',
        retryable: false,
        detail: redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 400),
      })
    }
    const data = json && typeof json === 'object' ? (json as Record<string, unknown>).data : null
    if (!Array.isArray(data)) {
      throw new ProviderError(`${this.label}: ${url} did not return an OpenAI-compatible model list.`, {
        code: 'BAD_RESPONSE',
        retryable: false,
      })
    }
    const models: ModelInfo[] = []
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      if (typeof obj.id !== 'string') continue
      models.push({ id: obj.id, providerId: this.config.id, providerLabel: this.label })
    }
    await this.enrich(models, signal)
    models.sort((a, b) => a.id.localeCompare(b.id))
    return models
  }

  private async enrich(models: ModelInfo[], signal: AbortSignal): Promise<void> {
    if (models.length === 0) return
    const origin = originOf(this.config.baseUrl)
    if (this.config.id === 'lmstudio' || this.config.baseUrl.includes(':1234')) {
      const data = await this.tryJson(`${origin}/api/v0/models`, signal)
      const rows = data && typeof data === 'object' ? (data as Record<string, unknown>).data : null
      if (Array.isArray(rows)) {
        const byId = new Map<string, Record<string, unknown>>()
        for (const row of rows) {
          if (row && typeof row === 'object' && typeof (row as Record<string, unknown>).id === 'string') {
            byId.set((row as Record<string, unknown>).id as string, row as Record<string, unknown>)
          }
        }
        for (const model of models) {
          const row = byId.get(model.id)
          if (!row) continue
          if (typeof row.state === 'string') model.loaded = row.state === 'loaded'
          const loadedContext = row.loaded_context_length
          const ctx = model.loaded && typeof loadedContext === 'number' && loadedContext > 0
            ? loadedContext : row.max_context_length
          if (typeof ctx === 'number' && Number.isFinite(ctx) && ctx > 0) model.contextLength = ctx
        }
      }
    }
    if (this.config.id === 'ollama' || this.config.baseUrl.includes(':11434')) {
      const ps = await this.tryJson(`${origin}/api/ps`, signal)
      const rows = ps && typeof ps === 'object' ? (ps as Record<string, unknown>).models : null
      if (Array.isArray(rows)) {
        const loaded = new Set<string>()
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue
          const obj = row as Record<string, unknown>
          if (typeof obj.name === 'string') loaded.add(obj.name)
          if (typeof obj.model === 'string') loaded.add(obj.model)
        }
        for (const model of models) {
          if (loaded.has(model.id) || loaded.has(`${model.id}:latest`)) model.loaded = true
        }
      }
    }
  }

  private async tryJson(url: string, signal: AbortSignal): Promise<unknown | null> {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.headers(),
        signal: this.combinedSignal(signal, 1500),
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      if (signal.aborted) throw new ProviderError('Cancelled.', { code: 'ABORTED' })
      return null
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const maxAttempts = 3
    let lastError: ProviderError | null = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.chatOnce(request)
      } catch (err) {
        if (request.signal.aborted) {
          throw new ProviderError('Cancelled.', { code: 'ABORTED' })
        }
        const pe =
          err instanceof ProviderError
            ? err
            : new ProviderError(`${this.label}: ${(err as Error).message}`, {
                code: 'NETWORK',
                retryable: true,
                detail: (err as Error).stack?.slice(0, 400),
              })
        lastError = pe
        if (pe.code === 'ABORTED' || !pe.retryable || pe.code === 'PARTIAL') break
        if (attempt < maxAttempts - 1) {
          await sleep(350 * 2 ** attempt + Math.floor(Math.random() * 150), request.signal)
        }
      }
    }
    throw lastError ?? new ProviderError(`${this.label}: request failed.`)
  }

  private async chatOnce(request: ChatRequest): Promise<ChatResponse> {
    const url = `${trimBase(this.config.baseUrl)}/chat/completions`
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: true,
      temperature: request.temperature ?? 0.2,
    }
    if (request.maxTokens) body.max_tokens = request.maxTokens
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools
      body.tool_choice = 'auto'
    }

    // Larger local models can stream useful long-form output for several
    // minutes. Keep the request alive long enough for those generations;
    // callers can still set a shorter per-provider timeout explicitly.
    const timeoutMs = this.config.timeoutMs ?? (this.config.id === 'lmstudio' ? 600_000 : 180_000)
    const operationSignal = this.combinedSignal(request.signal, timeoutMs)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: operationSignal,
      })
    } catch (err) {
      if (request.signal.aborted) throw new ProviderError('Cancelled.', { code: 'ABORTED' })
      if (isAbortError(err)) {
        throw new ProviderError(`${this.label}: request timed out.`, {
          code: 'TIMEOUT',
          retryable: true,
          detail: (err as Error).message,
        })
      }
      throw new ProviderError(`${this.label}: cannot reach ${url}.`, {
        code: 'UNREACHABLE',
        retryable: true,
        detail: (err as Error).message,
      })
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw errorForStatus(res.status, text, this.label, this.config.apiKeyEnv)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream')) {
      const builder = new SSEBuilder()
      const reader = res.body?.getReader()
      if (!reader) {
        throw new ProviderError(`${this.label}: the response had no body.`, { code: 'BAD_RESPONSE' })
      }
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          buffer = buffer.replace(/\r\n/g, '\n')
          let index = buffer.indexOf('\n\n')
          while (index !== -1) {
            const raw = buffer.slice(0, index)
            buffer = buffer.slice(index + 2)
            builder.feed(raw, request.onText)
            index = buffer.indexOf('\n\n')
          }
        }
        buffer += decoder.decode()
        if (buffer.trim()) builder.feed(buffer, request.onText)
      } catch (err) {
        if (request.signal.aborted) throw new ProviderError('Cancelled.', { code: 'ABORTED' })
        const detail = redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 400)
        if (builder.hasEmitted()) {
          reader.cancel().catch(() => undefined)
          throw new ProviderError(
            operationSignal.aborted
              ? `${this.label}: stream timed out after partial output.`
              : `${this.label}: stream was interrupted after partial output.`,
            { code: 'PARTIAL', retryable: false, detail },
          )
        }
        if (operationSignal.aborted || isAbortError(err)) {
          reader.cancel().catch(() => undefined)
          throw new ProviderError(`${this.label}: stream timed out before output.`, {
            code: 'TIMEOUT',
            retryable: true,
            detail,
          })
        }
        if (err instanceof ProviderError) {
          throw err
        }
        throw new ProviderError(`${this.label}: stream was interrupted before output.`, {
          code: 'NETWORK',
          retryable: true,
          detail,
        })
      }
      const acc = builder.finish()
      return {
        content: acc.content,
        toolCalls: acc.toolCalls,
        usage: acc.usage,
        model: request.model,
        finishReason: acc.finishReason,
        streamed: true,
      }
    }

    // Some local servers ignore stream:true and return a single JSON object.
    let json: unknown
    try {
      json = await res.json()
    } catch (err) {
      if (request.signal.aborted) throw new ProviderError('Cancelled.', { code: 'ABORTED' })
      if (operationSignal.aborted || isAbortError(err)) {
        throw new ProviderError(`${this.label}: request timed out while reading the response.`, {
          code: 'TIMEOUT',
          retryable: true,
          detail: (err as Error).message,
        })
      }
      throw new ProviderError(`${this.label}: the response was not valid JSON.`, {
        code: 'BAD_RESPONSE',
        retryable: false,
        detail: redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 400),
      })
    }
    if (!json || typeof json !== 'object') {
      throw new ProviderError(`${this.label}: the response was not valid JSON.`, { code: 'BAD_RESPONSE' })
    }
    const obj = json as Record<string, unknown>
    const choices = obj.choices
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new ProviderError(`${this.label}: the response contained no choices.`, { code: 'BAD_RESPONSE' })
    }
    const choice = choices[0] as Record<string, unknown>
    const message = (choice.message ?? {}) as Record<string, unknown>
    const content = typeof message.content === 'string' ? message.content : ''
    if (content && request.onText) request.onText(content)
    const rawCalls = message.tool_calls
    const toolCalls: ToolCall[] = []
    if (Array.isArray(rawCalls)) {
      for (let i = 0; i < rawCalls.length; i++) {
        const call = rawCalls[i] as Record<string, unknown>
        const fn = (call.function ?? {}) as Record<string, unknown>
        if (typeof fn.name !== 'string' || !fn.name) continue
        toolCalls.push({
          id: typeof call.id === 'string' && call.id ? call.id : `call_${i}_${Date.now().toString(36)}`,
          type: 'function',
          function: {
            name: fn.name,
            arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
          },
        })
      }
    }
    return {
      content,
      toolCalls,
      usage: normalizeUsage(obj.usage),
      model: typeof obj.model === 'string' ? obj.model : request.model,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    }
  }
}
