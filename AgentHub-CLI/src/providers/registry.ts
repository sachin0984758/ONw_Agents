import type { AgentConfig, ProviderConfig } from '../config/types.ts'
import { OpenAICompatProvider } from './openai.ts'
import { CapabilityRegistry } from './capabilities.ts'
import { ProviderError, type ModelInfo, type Provider, type ToolSchema } from './types.ts'

export interface DiscoveryResult {
  provider: ProviderConfig
  ok: boolean
  models: ModelInfo[]
  error?: string
  skipped?: string
  durationMs: number
}

export class NoModelError extends Error {
  readonly detail: string
  constructor(message: string, detail: string) {
    super(message)
    this.name = 'NoModelError'
    this.detail = detail
  }
}

export function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return ['http:', 'https:'].includes(parsed.protocol) && ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)
  } catch {
    return false
  }
}

function shouldSkip(provider: ProviderConfig, config: AgentConfig): string | null {
  // `local` is an advisory config label, not a security boundary. Only a
  // loopback URL may bypass explicit remote-endpoint consent.
  const local = isLocalUrl(provider.baseUrl)
  if (!local && !config.allowCloud) {
    return 'Skipped: remote endpoints are disabled (use --allow-cloud to enable).'
  }
  if (provider.apiKey) return null
  if (provider.apiKeyEnv && !process.env[provider.apiKeyEnv]) {
    if (local) return null
    return `Skipped: ${provider.apiKeyEnv} is not set.`
  }
  if (!local && !provider.apiKey && !provider.apiKeyEnv) {
    return 'Skipped: non-local endpoint has no apiKeyEnv configured.'
  }
  return null
}

export async function discoverProviders(config: AgentConfig, signal?: AbortSignal): Promise<DiscoveryResult[]> {
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const results = await Promise.all(
    config.providers.map(async (provider): Promise<DiscoveryResult> => {
      const started = Date.now()
      const skipped = shouldSkip(provider, config)
      if (skipped) {
        return { provider, ok: false, models: [], skipped, durationMs: 0 }
      }
      try {
        const client = new OpenAICompatProvider(provider)
        const models = await client.listModels(combined)
        for (const model of models) model.capabilities = await new CapabilityRegistry(config.home).get(provider, model.id)
        return { provider, ok: true, models, durationMs: Date.now() - started }
      } catch (err) {
        if (signal?.aborted) {
          return { provider, ok: false, models: [], error: 'Cancelled.', durationMs: Date.now() - started }
        }
        const message = err instanceof Error ? err.message : String(err)
        const detail = err instanceof ProviderError ? err.detail : ''
        return {
          provider,
          ok: false,
          models: [],
          error: detail ? `${message} — ${detail}` : message,
          durationMs: Date.now() - started,
        }
      }
    }),
  )
  return results
}

export interface ResolvedTarget {
  provider: Provider
  providerConfig: ProviderConfig
  model: string
  models: ModelInfo[]
  warning?: string
}

const PRIORITY = ['lmstudio', 'ollama', 'custom']

function priority(id: string): number {
  const index = PRIORITY.indexOf(id)
  return index === -1 ? PRIORITY.length : index
}

export function resolveTarget(config: AgentConfig, discovery: DiscoveryResult[]): ResolvedTarget {
  const byId = new Map(discovery.map((d) => [d.provider.id, d]))
  const reachable = discovery.filter((d) => d.ok)
  const errors = discovery
    .filter((d) => !d.ok && !d.skipped)
    .map((d) => `${d.provider.id}: ${d.error}`)
  const skipped = discovery.filter((d) => d.skipped).map((d) => `${d.provider.id}: ${d.skipped}`)

  const build = (result: DiscoveryResult, model: string, warning?: string): ResolvedTarget => ({
    provider: new OpenAICompatProvider(result.provider),
    providerConfig: result.provider,
    model,
    models: result.models,
    warning,
  })

  const explicit = config.model.trim()
  if (explicit) {
    const slash = explicit.indexOf('/')
    if (slash > 0) {
      const prefix = explicit.slice(0, slash)
      const rest = explicit.slice(slash + 1)
      const candidate = byId.get(prefix)
      if (candidate && candidate.ok) {
        return build(candidate, rest)
      }
    }
    const matches = reachable.filter((d) => d.models.some((m) => m.id === explicit))
    if (matches.length > 0) {
      const preferred =
        matches.find((d) => d.provider.id === config.provider) ??
        [...matches].sort((a, b) => priority(a.provider.id) - priority(b.provider.id))[0]
      if (preferred) return build(preferred, explicit)
    }
    if (config.provider !== 'auto') {
      const candidate = byId.get(config.provider)
      if (candidate?.ok) {
        return build(
          candidate,
          explicit,
          `Model "${explicit}" was not listed by ${candidate.provider.id}; using it anyway.`,
        )
      }
    }
    if (matches.length === 0 && reachable.length > 0) {
      const chosen = [...reachable].sort((a, b) => priority(a.provider.id) - priority(b.provider.id))[0]
      if (chosen) {
        return build(
          chosen,
          explicit,
          `Model "${explicit}" was not listed by any reachable provider; sending it to ${chosen.provider.id} anyway.`,
        )
      }
    }
    throw new NoModelError(
      `No reachable provider can serve model "${explicit}".`,
      [...errors, ...skipped].join('\n'),
    )
  }

  if (config.provider !== 'auto') {
    const candidate = byId.get(config.provider)
    if (!candidate) {
      throw new NoModelError(`Provider "${config.provider}" is not configured.`, describeDiscovery(discovery))
    }
    if (!candidate.ok) {
      throw new NoModelError(
        `Provider "${config.provider}" is not reachable.`,
        candidate.error ?? candidate.skipped ?? 'Unknown error.',
      )
    }
    const model =
      candidate.models.find((m) => m.loaded)?.id ?? candidate.models[0]?.id
    if (!model) {
      throw new NoModelError(`Provider "${config.provider}" is reachable but lists no models.`, describeDiscovery(discovery))
    }
    return build(candidate, model, candidate.models.some((m) => m.loaded) ? undefined : undefined)
  }

  const ordered = [...reachable].sort((a, b) => priority(a.provider.id) - priority(b.provider.id))
  for (const candidate of ordered) {
    const model = candidate.models.find((m) => m.loaded)?.id ?? candidate.models[0]?.id
    if (model) return build(candidate, model)
  }

  throw new NoModelError(
    'No local or configured model provider is reachable.',
    [
      ...errors,
      ...skipped,
      'Start LM Studio (http://127.0.0.1:1234/v1) or Ollama (http://127.0.0.1:11434/v1), or configure a provider in ~/.agenthub/config.json.',
    ].join('\n'),
  )
}

export function describeDiscovery(discovery: DiscoveryResult[]): string {
  const lines: string[] = []
  for (const d of discovery) {
    if (d.skipped) {
      lines.push(`${d.provider.id.padEnd(10)} skipped  ${d.skipped}`)
      continue
    }
    if (!d.ok) {
      lines.push(`${d.provider.id.padEnd(10)} error    ${d.error ?? 'unknown error'}`)
      continue
    }
    lines.push(`${d.provider.id.padEnd(10)} ok       ${d.models.length} model(s) in ${d.durationMs} ms`)
    for (const model of d.models) {
      const flags = [model.loaded ? 'loaded' : null, model.contextLength ? `${model.contextLength} ctx` : null]
        .filter(Boolean)
        .join(', ')
      lines.push(`  - ${model.id}${flags ? `  (${flags})` : ''}`)
    }
  }
  return lines.join('\n')
}

export interface ToolProbeResult {
  status: 'supported' | 'unsupported' | 'inconclusive' | 'error'
  model: string
  provider: string
  detail: string
}

/**
 * Explicit, opt-in probe. It records the exact model tested and never infers
 * tool support from a model name. It costs one small model request.
 */
export async function probeToolCalling(
  target: ResolvedTarget,
  signal: AbortSignal,
): Promise<ToolProbeResult> {
  const tool: ToolSchema = {
    type: 'function',
    function: {
      name: 'get_clock',
      description: 'Return the current time. You must call this tool.',
      parameters: {
        type: 'object',
        properties: { timezone: { type: 'string', description: 'IANA timezone, e.g. UTC' } },
        required: [],
        additionalProperties: false,
      },
    },
  }
  try {
    const res = await target.provider.chat({
      model: target.model,
      signal,
      temperature: 0,
      maxTokens: 128,
      tools: [tool],
      messages: [
        { role: 'system', content: 'You are a tool-use probe. Call the get_clock tool; do not reply in prose.' },
        { role: 'user', content: 'What time is it? Use the tool.' },
      ],
    })
    if (res.toolCalls.length > 0) {
      const call = res.toolCalls[0]
      let args: unknown
      try { args = JSON.parse(call?.function.arguments ?? '') } catch { args = null }
      const validArgs = args !== null && typeof args === 'object' && !Array.isArray(args) &&
        Object.entries(args).every(([key, value]) => key === 'timezone' && typeof value === 'string')
      if (res.toolCalls.length !== 1 || call?.function.name !== 'get_clock' || !validArgs) {
        return {
          status: 'inconclusive', model: target.model, provider: target.providerConfig.id,
          detail: 'The model did not return the single requested get_clock tool with valid arguments. No tool was executed.',
        }
      }
      return {
        status: 'supported',
        model: target.model,
        provider: target.providerConfig.id,
        detail: `Returned tool call "${res.toolCalls[0]?.function.name ?? 'unknown'}".`,
      }
    }
    return {
      status: 'inconclusive',
      model: target.model,
      provider: target.providerConfig.id,
      detail: `The model replied with text instead of a tool call: ${res.content.slice(0, 160) || '(empty)'}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof ProviderError && err.status === 400 && /tool|function/i.test(err.detail)) {
      return {
        status: 'unsupported',
        model: target.model,
        provider: target.providerConfig.id,
        detail: `${message} ${err.detail}`.slice(0, 500),
      }
    }
    return {
      status: 'error',
      model: target.model,
      provider: target.providerConfig.id,
      detail: message,
    }
  }
}
