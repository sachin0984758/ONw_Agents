import type { ProviderConfig } from '../config/types.ts'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface TokenUsage {
  input: number | null
  output: number | null
}

export interface ModelInfo {
  id: string
  providerId: string
  providerLabel: string
  loaded?: boolean
  contextLength?: number
  capabilities?: Partial<Record<'streaming' | 'tools' | 'json' | 'vision' | 'reasoning', { supported: boolean; source: 'configured' | 'observed'; at?: string }>>
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools?: ToolSchema[]
  signal: AbortSignal
  temperature?: number
  maxTokens?: number
  onText?: (delta: string) => void
}

export interface ChatResponse {
  streamed?: boolean
  content: string
  toolCalls: ToolCall[]
  usage: TokenUsage | null
  model: string
  finishReason: string | null
}

export interface Provider {
  readonly config: ProviderConfig
  readonly label: string
  listModels(signal: AbortSignal): Promise<ModelInfo[]>
  chat(request: ChatRequest): Promise<ChatResponse>
}

export class ProviderError extends Error {
  readonly status: number | null
  readonly code: string
  readonly retryable: boolean
  readonly detail: string
  constructor(message: string, opts: { status?: number | null; code?: string; retryable?: boolean; detail?: string } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.status = opts.status ?? null
    this.code = opts.code ?? 'PROVIDER_ERROR'
    this.retryable = opts.retryable ?? false
    this.detail = opts.detail ?? ''
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false
  const e = err as { name?: string; code?: string }
  return e.name === 'AbortError' || e.name === 'TimeoutError' || e.code === 'ABORT_ERR'
}
