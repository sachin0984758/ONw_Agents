// ─── Shared LLM provider helpers ─────────────────────────────────────────
// OpenAI-compatible chat completions against local providers (LM Studio,
// Ollama) or user-configured custom endpoints. Pure fetch — no SDK. Used by
// the explanation engine route. Server-only (never imported by client code).

import { LOCAL_PROVIDERS } from './chat-settings'
import { beginModelActivity } from './usage-events'

// Provider error bodies are untrusted (they can echo prompts, auth headers or
// injected instructions), so they never leave this module — callers, logs,
// stored state and the UI only ever see the HTTP status.
export function providerHttpError(status: number): Error {
  return new Error(`The model provider returned an error (HTTP ${status}).`)
}

// ── Token usage ──────────────────────────────────────────────────────────────
// OpenAI-compatible providers report `usage` on a completion (and, when
// `stream_options.include_usage` is set, on the final stream frame). We surface
// it verbatim; when a provider omits it the caller estimates from text and
// labels the result as estimated — the app never presents a guess as exact.

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** Extract OpenAI-compatible `usage` from a completion/stream payload, or null. */
export function readUsage(json: unknown): LLMUsage | null {
  const u = (json as { usage?: unknown } | null | undefined)?.usage
  if (!u || typeof u !== 'object') return null
  const r = u as Record<string, unknown>
  const rawIn = typeof r.prompt_tokens === 'number' ? r.prompt_tokens : typeof r.input_tokens === 'number' ? r.input_tokens : NaN
  const rawOut = typeof r.completion_tokens === 'number' ? r.completion_tokens : typeof r.output_tokens === 'number' ? r.output_tokens : NaN
  if (!Number.isFinite(rawIn) && !Number.isFinite(rawOut)) return null
  const inputTokens = Number.isFinite(rawIn) ? Math.max(0, Math.floor(rawIn)) : 0
  const outputTokens = Number.isFinite(rawOut) ? Math.max(0, Math.floor(rawOut)) : 0
  const totalTokens =
    typeof r.total_tokens === 'number' && Number.isFinite(r.total_tokens)
      ? Math.max(0, Math.floor(r.total_tokens))
      : inputTokens + outputTokens
  return { inputTokens, outputTokens, totalTokens }
}

/**
 * Local fallback estimate (~4 chars/token) used ONLY when a provider omits
 * `usage`. Callers must label the result as estimated. Deterministic and
 * dependency-free so it can be shared by every route.
 */
export function estimateUsage(inputText: string, outputText: string): LLMUsage {
  const inputTokens = Math.ceil((inputText ?? '').length / 4)
  const outputTokens = Math.ceil((outputText ?? '').length / 4)
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
}

export interface LocalModelMetadata {
  id: string
  name: string
  providerId: string
  providerName: string
  type: string
  arch?: string
  loaded: boolean
  isChatCompatible: boolean
  incompatibilityReason?: string
}

export interface LLMTarget {
  endpoint: string
  apiKey: string
  modelId: string
  label: string
  loaded?: boolean
  isChatCompatible?: boolean
  warning?: string
  availableModels?: LocalModelMetadata[]
}

export interface CustomModelLike {
  id: string
  name: string
  endpoint: string
  apiKey: string
  modelId: string
}

export interface ProviderCheck {
  id: string
  name: string
  endpoint: string
  port: number
  available: boolean
  models: string[]
  detailedModels: LocalModelMetadata[]
  /**
   * True when this provider reported genuine loaded/running state (LM Studio
   * `/api/v0/models` `state`, or Ollama `/api/ps`). When false, the app cannot
   * tell which models are loaded and must not claim that any are running.
   */
  loadedStateKnown: boolean
}

async function checkLocalProvider(provider: { id: string; name: string; endpoint: string; port: number }): Promise<ProviderCheck> {
  const detailedModels: LocalModelMetadata[] = []
  let available = false
  // Whether the provider itself told us which models are loaded/running.
  let loadedStateKnown = false

  // 1. Try LM Studio native endpoint /api/v0/models for rich state (loaded vs not-loaded, llm vs embeddings)
  if (provider.id === 'lmstudio' || provider.port === 1234) {
    try {
      const v0Url = `${provider.endpoint.replace(/\/v1\/?$/, '')}/api/v0/models`
      const res = await fetch(v0Url, { signal: AbortSignal.timeout(2500) })
      if (res.ok) {
        const json = await res.json()
        if (Array.isArray(json?.data)) {
          available = true
          // LM Studio reports real per-model `state` (loaded / not-loaded).
          loadedStateKnown = true
          for (const item of json.data) {
            if (!item || typeof item !== 'object') continue
            const id = typeof item.id === 'string' ? item.id : ''
            if (!id) continue
            const type = typeof item.type === 'string' ? item.type.toLowerCase() : 'llm'
            const isEmbeddings = type === 'embeddings' || type.includes('embed') || id.includes('embedding')
            const isLoaded = item.state === 'loaded'
            detailedModels.push({
              id,
              name: id,
              providerId: provider.id,
              providerName: provider.name,
              type,
              arch: typeof item.arch === 'string' ? item.arch : undefined,
              loaded: isLoaded,
              isChatCompatible: !isEmbeddings,
              incompatibilityReason: isEmbeddings ? 'Embedding model (does not support chat completions)' : undefined,
            })
          }
        }
      }
    } catch {
      // /api/v0/models not available; fall back to standard /v1/models below
    }
  }

  // 2. Try Ollama. `/api/ps` lists models currently LOADED into memory (the only
  //    genuine "running" state); `/api/tags` lists everything installed. An
  //    installed-but-idle model is NOT running, so only /api/ps names count.
  if (!available && (provider.id === 'ollama' || provider.port === 11434)) {
    try {
      const base = provider.endpoint.replace(/\/v1\/?$/, '')
      const runningNames = new Set<string>()
      try {
        const psRes = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(2500) })
        if (psRes.ok) {
          loadedStateKnown = true
          const ps = await psRes.json()
          if (Array.isArray(ps?.models)) {
            for (const m of ps.models) {
              const name = typeof m?.name === 'string' ? m.name : typeof m?.model === 'string' ? m.model : ''
              if (name) runningNames.add(name)
            }
          }
        }
      } catch {
        // Older Ollama without /api/ps — running state stays unknown.
      }
      const tagsUrl = `${base}/api/tags`
      const res = await fetch(tagsUrl, { signal: AbortSignal.timeout(2500) })
      if (res.ok) {
        const json = await res.json()
        if (Array.isArray(json?.models)) {
          available = true
          for (const item of json.models) {
            const id = typeof item.name === 'string' ? item.name : ''
            if (!id) continue
            detailedModels.push({
              id,
              name: id,
              providerId: provider.id,
              providerName: provider.name,
              type: 'llm',
              loaded: runningNames.has(id),
              isChatCompatible: true,
            })
          }
        }
      }
    } catch {
      // fall through
    }
  }

  // 3. Fallback: standard OpenAI-compatible /v1/models
  if (!available || detailedModels.length === 0) {
    try {
      const res = await fetch(`${provider.endpoint}/models`, { signal: AbortSignal.timeout(2500) })
      if (res.ok) {
        const json = await res.json()
        const rawList = Array.isArray(json?.data) ? json.data : []
        if (rawList.length > 0 || res.status === 200) {
          available = true
          for (const m of rawList) {
            const id = typeof m?.id === 'string' ? m.id : ''
            if (!id || detailedModels.some((x) => x.id === id)) continue
            const isEmbeddings = id.toLowerCase().includes('embedding') || id.toLowerCase().includes('embed')
            detailedModels.push({
              id,
              name: id,
              providerId: provider.id,
              providerName: provider.name,
              type: isEmbeddings ? 'embeddings' : 'llm',
              loaded: false,
              isChatCompatible: !isEmbeddings,
              incompatibilityReason: isEmbeddings ? 'Embedding model (does not support chat completions)' : undefined,
            })
          }
        }
      }
    } catch {
      // not reachable
    }
  }

  return {
    ...provider,
    available,
    models: detailedModels.map((m) => m.id),
    detailedModels,
    loadedStateKnown,
  }
}

/** Check all local providers and return their models and status */
export async function detectLocalProviders(): Promise<ProviderCheck[]> {
  return Promise.all(LOCAL_PROVIDERS.map(checkLocalProvider))
}

export interface RuntimeModel {
  id: string
  providerId: string
  providerName: string
  arch?: string
  type: string
}

export interface RuntimeModelsReport {
  /** Models confirmed loaded/running by their provider right now. */
  loaded: RuntimeModel[]
  /** Providers that answered a status probe. */
  onlineProviders: string[]
  /**
   * 'ok'          — at least one provider was reachable and reported state
   * 'offline'     — providers configured, but none reachable
   * 'unavailable' — a provider is reachable but cannot report loaded state
   */
  status: 'ok' | 'offline' | 'unavailable'
  checkedAt: string
}

/**
 * Report ONLY models that a provider confirms are loaded/running. Downloaded,
 * installed or configured models are deliberately excluded, and no seeded or
 * fabricated model is ever reported. If no reachable provider can report loaded
 * state, `status` is 'unavailable' rather than inventing a running model.
 */
export async function detectRuntimeModels(): Promise<RuntimeModelsReport> {
  const checks = await detectLocalProviders()
  const online = checks.filter((c) => c.available)
  const loaded: RuntimeModel[] = []
  for (const check of checks) {
    if (!check.available || !check.loadedStateKnown) continue
    for (const m of check.detailedModels) {
      if (m.loaded && m.isChatCompatible) {
        loaded.push({
          id: m.id,
          providerId: m.providerId,
          providerName: m.providerName,
          arch: m.arch,
          type: m.type,
        })
      }
    }
  }
  const status: RuntimeModelsReport['status'] =
    loaded.length > 0 || online.some((c) => c.loadedStateKnown)
      ? 'ok'
      : online.length > 0
        ? 'unavailable'
        : 'offline'
  return {
    loaded,
    onlineProviders: online.map((c) => c.name),
    status,
    checkedAt: new Date().toISOString(),
  }
}

// Rank local models for text chat. Used only when nothing is loaded, so we
// never override a model the user has deliberately loaded in LM Studio.
// Deprioritises vision/embedding/reasoning models and prefers instruct/chat.
function chatScore(m: LocalModelMetadata): number {
  const id = m.id.toLowerCase()
  let s = 0
  if (/instruct|chat|assistant/.test(id)) s += 5
  if (m.type === 'llm') s += 2
  if (m.type === 'vlm' || /(^|[^a-z])(vl|vision|image)([^a-z]|$)/.test(id)) s -= 2
  if (/reason|thinking|spark/.test(id)) s -= 4
  if (/uncensored|abliterated/.test(id)) s -= 1
  return s
}

function pickBestChatModel(models: LocalModelMetadata[]): LocalModelMetadata | undefined {
  const chat = models.filter((m) => m.isChatCompatible)
  let best: LocalModelMetadata | undefined
  let bestScore = -Infinity
  for (const m of chat) {
    const score = chatScore(m)
    if (score > bestScore) {
      best = m
      bestScore = score
    }
  }
  return best
}

/** Resolve which provider to use from a requested model id + custom models. */
export async function resolveTarget(model: string, customModels: CustomModelLike[]): Promise<LLMTarget> {
  const reqModel = (model || '').trim()

  // 1. Explicit custom model
  const custom = reqModel ? customModels.find((cm) => cm.id === reqModel) : undefined
  if (custom) {
    return {
      endpoint: custom.endpoint,
      apiKey: custom.apiKey,
      modelId: custom.modelId,
      label: `${custom.name} (${custom.modelId})`,
      loaded: true,
      isChatCompatible: true,
    }
  }

  // Probe local providers
  const providerChecks = await detectLocalProviders()
  const allDetailed = providerChecks.flatMap((p) => p.detailedModels)

  // 2. Explicit local model ID requested
  if (reqModel && reqModel !== 'lmstudio' && reqModel !== 'ollama') {
    const matched = allDetailed.find((m) => m.id === reqModel)
    if (matched) {
      const provider = providerChecks.find((p) => p.id === matched.providerId)!
      return {
        endpoint: provider.endpoint,
        apiKey: '',
        modelId: matched.id,
        label: `${matched.providerName} · ${matched.id}`,
        loaded: matched.loaded,
        isChatCompatible: matched.isChatCompatible,
        warning: matched.incompatibilityReason
          ? `Model "${matched.id}" is incompatible with text chat: ${matched.incompatibilityReason}.`
          : !matched.loaded && provider.id === 'lmstudio'
            ? `Model "${matched.id}" is not currently loaded in LM Studio memory — it will be loaded on demand.`
            : undefined,
        availableModels: allDetailed,
      }
    }
    // The caller explicitly asked for a model we cannot find. Fail loudly
    // instead of silently switching the user to a different model.
    throw new Error(
      `Model "${reqModel}" was not found on any reachable local provider. Pick a model from the list or add a custom model.`,
    )
  }

  // 3. Explicit local provider requested (lmstudio or ollama)
  const local = reqModel ? providerChecks.find((p) => p.id === reqModel) : undefined
  if (local && local.available) {
    // Prefer an already-loaded chat-compatible model; otherwise pick the most
    // suitable text-chat model on this provider (LM Studio loads it on demand).
    const loadedChat = local.detailedModels.find((m) => m.loaded && m.isChatCompatible)
    const picked = loadedChat || pickBestChatModel(local.detailedModels)
    const modelId = picked ? picked.id : ''
    return {
      endpoint: local.endpoint,
      apiKey: '',
      modelId,
      label: modelId ? `${local.name} · ${modelId}` : local.name,
      loaded: picked?.loaded ?? true,
      isChatCompatible: picked?.isChatCompatible ?? true,
      warning: picked && !picked.loaded ? `Model "${modelId}" is not loaded in ${local.name}.` : undefined,
      availableModels: allDetailed,
    }
  }

  // 4. Auto-detect: find any local provider that has a LOADED chat-compatible model first!
  const availableProviders = providerChecks.filter((p) => p.available)
  if (availableProviders.length > 0) {
    // Check if any provider has an actively loaded chat model (e.g. spark-x2.5-4b in LM Studio)
    for (const p of availableProviders) {
      const loadedChat = p.detailedModels.find((m) => m.loaded && m.isChatCompatible)
      if (loadedChat) {
        return {
          endpoint: p.endpoint,
          apiKey: '',
          modelId: loadedChat.id,
          label: `${p.name} · ${loadedChat.id}`,
          loaded: true,
          isChatCompatible: true,
          availableModels: allDetailed,
        }
      }
    }
    // Next, pick the best chat-compatible model on an available provider
    // (prefer instruct/chat models over vision/reasoning ones).
    for (const p of availableProviders) {
      const best = pickBestChatModel(p.detailedModels)
      if (best) {
        return {
          endpoint: p.endpoint,
          apiKey: '',
          modelId: best.id,
          label: `${p.name} · ${best.id}`,
          loaded: best.loaded,
          isChatCompatible: true,
          warning:
            !best.loaded && p.id === 'lmstudio'
              ? `Model "${best.id}" is not loaded yet — LM Studio will load it on demand.`
              : undefined,
          availableModels: allDetailed,
        }
      }
    }
    // Fall back to first provider endpoint
    const p = availableProviders[0]
    const fallbackId = p.models[0] ?? ''
    return {
      endpoint: p.endpoint,
      apiKey: '',
      modelId: fallbackId,
      label: fallbackId ? `${p.name} · ${fallbackId}` : p.name,
      loaded: true,
      isChatCompatible: true,
      availableModels: allDetailed,
    }
  }

  // 5. Fallback to custom models
  if (customModels.length > 0) {
    const cm = customModels[0]
    return {
      endpoint: cm.endpoint,
      apiKey: cm.apiKey,
      modelId: cm.modelId,
      label: `${cm.name} (${cm.modelId})`,
      loaded: true,
      isChatCompatible: true,
      availableModels: allDetailed,
    }
  }

  throw new Error('No LLM provider available. Start LM Studio, Ollama, or add a custom API model.')
}

/** Resolve only LM Studio/Ollama models; never fall through to a custom API. */
export async function resolveLocalTarget(model: string): Promise<LLMTarget> {
  const requested = model.trim()
  const providers = await detectLocalProviders()
  const details = providers.flatMap((provider) => provider.detailedModels)

  let provider: (typeof providers)[number] | undefined
  let picked: (typeof details)[number] | undefined
  if (requested === 'lmstudio' || requested === 'ollama') {
    provider = providers.find((entry) => entry.id === requested)
    if (!provider?.available) throw new Error(`${provider?.name ?? requested} is unavailable. Start a local model provider or select another local model.`)
    picked = provider.detailedModels.find((item) => item.loaded && item.isChatCompatible)
      ?? pickBestChatModel(provider.detailedModels)
  } else if (requested) {
    picked = details.find((item) => item.id === requested)
    if (!picked) throw new Error(`Local model “${requested}” was not found. Select an LM Studio or Ollama model.`)
    provider = providers.find((entry) => entry.id === picked!.providerId)
    if (!provider?.available) throw new Error(`The local provider for “${requested}” is unavailable. Start it and retry.`)
  } else {
    const available = providers.filter((entry) => entry.available)
    for (const candidate of available) {
      const loaded = candidate.detailedModels.find((item) => item.loaded && item.isChatCompatible)
      if (loaded) { provider = candidate; picked = loaded; break }
    }
    if (!provider) {
      for (const candidate of available) {
        const best = pickBestChatModel(candidate.detailedModels)
        if (best) { provider = candidate; picked = best; break }
      }
    }
  }

  if (!provider?.available) throw new Error('No local model provider is reachable. Start LM Studio or Ollama, then retry.')
  if (!picked) throw new Error(`No chat-compatible local model was found in ${provider.name}. Load a model or choose another provider.`)
  if (!picked.isChatCompatible) throw new Error(`Local model “${picked.id}” is not compatible with text chat. Choose a chat model.`)
  return {
    endpoint: provider.endpoint,
    apiKey: '',
    modelId: picked.id,
    label: `${provider.name} · ${picked.id}`,
    loaded: picked.loaded,
    isChatCompatible: true,
    warning: !picked.loaded ? `Model “${picked.id}” is not loaded in ${provider.name}; it may load on demand.` : undefined,
    availableModels: details,
  }
}

/** Human/agent-readable description of the model actually answering. */
export function describeTarget(target: LLMTarget): string {
  const parts = [target.label]
  if (target.modelId && !target.label.includes(target.modelId)) parts.push(`model id: ${target.modelId}`)
  try {
    parts.push(`provider: ${new URL(target.endpoint).host}`)
  } catch {
    /* endpoint may not be a URL */
  }
  return parts.join(' · ')
}

function headers(target: LLMTarget): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (target.apiKey) h['Authorization'] = `Bearer ${target.apiKey}`
  return h
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatTurn {
  role: string
  /** Plain text, or OpenAI-style multimodal content parts. */
  content: string | ChatContentPart[]
}

/** Flatten chat turns to plain text (for token estimation / prompt assembly). */
export function chatTurnsText(turns: ChatTurn[]): string {
  return turns
    .map((t) =>
      typeof t.content === 'string'
        ? t.content
        : t.content.map((p) => (p.type === 'text' ? p.text : '[image]')).join(' '),
    )
    .join('\n')
}

interface LLMRequestOptions {
  json?: boolean
  maxTokens?: number
  extraBody?: Record<string, unknown>
  signal?: AbortSignal
  onMetrics?: (metrics: LLMRequestMetrics) => void
}

/** Non-streaming completion. Returns the full text. */
async function callNonStreamingLLM(
  target: LLMTarget,
  context: ChatTurn[],
  opts: LLMRequestOptions & { onUsage?: (usage: LLMUsage) => void } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: target.modelId,
    messages: context,
    stream: false,
  }
  if (opts.json) body.response_format = { type: 'json_object' }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  if (opts.extraBody) Object.assign(body, opts.extraBody)

  const res = await fetch(`${target.endpoint.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: headers(target),
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!res.ok) {
    // Drain without reading: the provider error body is untrusted content.
    await res.text().catch(() => '')
    // Some providers reject response_format — retry without it.
    if (opts.json && (res.status === 400 || res.status === 422)) {
      return callNonStreamingLLM(target, context, { ...opts, json: false })
    }
    throw providerHttpError(res.status)
  }
  const json = await res.json()
  if (json?.error) throw new Error('The model provider reported an error.')
  if (json?.choices?.[0]?.finish_reason === 'length') {
    throw new Error('The model reached its output-token limit. The response is partial; request a shorter answer or increase the output budget.')
  }
  const usage = readUsage(json)
  if (usage && opts.onUsage) opts.onUsage(usage)
  return (json?.choices?.[0]?.message?.content ?? '').trim()
}

export type StreamChunk =
  | { type: 'thinking'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: LLMUsage }

/**
 * Streaming completion. Yields text deltas and thinking updates as they arrive
 * (OpenAI SSE), plus a final `usage` chunk when the provider reports one (we
 * request `stream_options.include_usage`). Falls back to a single non-streamed
 * chunk when the provider does not support streaming (we detect a non-SSE JSON
 * body and emit it whole).
 */
async function* streamProvider(
  target: LLMTarget,
  context: ChatTurn[],
  opts: LLMRequestOptions = {},
): AsyncGenerator<StreamChunk, void, unknown> {
  const body: Record<string, unknown> = {
    model: target.modelId,
    messages: context,
    stream: true,
    // Ask the provider to include a `usage` block on the final frame. Providers
    // that ignore it simply omit usage, and callers fall back to estimation.
    stream_options: { include_usage: true },
  }
  if (opts.json) body.response_format = { type: 'json_object' }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  if (opts.extraBody) Object.assign(body, opts.extraBody)

  let res: Response
  try {
    res = await fetch(`${target.endpoint.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: headers(target),
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Network error')
  }

  if (!res.ok) {
    // Drain without reading: the provider error body is untrusted content.
    await res.text().catch(() => '')
    // Provider refused streaming or json mode — fall back to non-streaming.
    if (res.status === 400 || res.status === 422) {
      const full = await callLLMFallbackWithUsage(target, context, opts)
      if (full.text) yield { type: 'delta', text: full.text }
      if (full.usage) yield { type: 'usage', usage: full.usage }
      return
    }
    throw providerHttpError(res.status)
  }

  if (!res.body) {
    const full = await callLLMFallbackWithUsage(target, context, opts)
    if (full.text) yield { type: 'delta', text: full.text }
    if (full.usage) yield { type: 'usage', usage: full.usage }
    return
  }

  const contentType = res.headers.get('content-type') ?? ''
  // Non-SSE JSON (provider ignored stream:true) → emit whole body once.
  if (!contentType.includes('event-stream') && !contentType.includes('text/event-stream')) {
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      if (json?.error) throw new Error('The model provider reported an error.')
      if (json?.choices?.[0]?.finish_reason === 'length') {
        throw new Error('The model reached its output-token limit. The response is partial; request a shorter answer or increase the output budget.')
      }
      const content = (json?.choices?.[0]?.message?.content ?? '').trim()
      if (content) yield { type: 'delta', text: content }
      const usage = readUsage(json)
      if (usage) yield { type: 'usage', usage }
      return
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      throw new Error('The model provider returned an invalid non-streaming response.')
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') {
          if (!finished) throw new Error('The model stream ended before completion. The response is partial; retry the request.')
          return
        }
        try {
          const json = JSON.parse(data)
          if (json.error) throw new Error('The model provider reported a streaming error.')
          if (json?.choices?.[0]?.finish_reason === 'length') throw new Error('The model reached its output-token limit. The response is partial; request a shorter answer or increase the output budget.')
          finished ||= Boolean(json?.choices?.[0]?.finish_reason)
          const delta = json?.choices?.[0]?.delta
          const content = delta?.content
          const reasoning = delta?.reasoning_content ?? delta?.thinking
          if (typeof reasoning === 'string' && reasoning) {
            yield { type: 'thinking', text: reasoning }
          }
          if (typeof content === 'string' && content) {
            yield { type: 'delta', text: content }
          }
          // With include_usage the provider sends a final frame carrying usage
          // (and usually an empty choices array) — surface it before [DONE].
          const usage = readUsage(json)
          if (usage) yield { type: 'usage', usage }
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
          throw new Error('The model provider returned a malformed stream frame.')
        }
      }
      if (done) {
        if (!finished) throw new Error('The model stream ended before completion. The response is partial; retry the request.')
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Non-streaming fallback that also captures provider usage out-of-band. */
async function callLLMFallbackWithUsage(
  target: LLMTarget,
  context: ChatTurn[],
  opts: LLMRequestOptions,
): Promise<{ text: string; usage: LLMUsage | null }> {
  let usage: LLMUsage | null = null
  const text = await callNonStreamingLLM(target, context, { ...opts, json: false, onUsage: (u) => { usage = u } })
  return { text, usage }
}


export interface LLMRequestMetrics {
  requestId: string
  model: string
  provider: string
  durationMs: number
  timeToFirstTokenMs: number | null
  generationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  tokensPerSecond: number | null
  status: 'completed' | 'cancelled' | 'failed' | 'timed_out'
  failureStage: 'connecting' | 'generating' | null
}

/** Collect streaming upstream even for callers needing a final string. This
 * avoids waiting for a slow local model to finish before HTTP headers arrive. */
export async function callLLM(target: LLMTarget, context: ChatTurn[], opts: LLMRequestOptions & { onUsage?: (usage: LLMUsage) => void } = {}): Promise<string> {
  let text = ''
  for await (const chunk of streamLLM(target, context, opts)) {
    if (chunk.type === 'delta') text += chunk.text
    if (chunk.type === 'usage') opts.onUsage?.(chunk.usage)
  }
  return text.trim()
}

/** A bounded wall-clock deadline covers connecting, prefill and generation.
 * Metrics contain no prompt, endpoint credentials, or generated content. */
export async function* streamLLM(target: LLMTarget, context: ChatTurn[], opts: LLMRequestOptions = {}): AsyncGenerator<StreamChunk, void, unknown> {
  const endActivity = beginModelActivity(target.label, 'Chat / teaching / Playground')
  const started = Date.now()
  const configured = Number(process.env.AGENTHUB_LLM_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(configured) && configured >= 1000 ? Math.min(configured, 1800000) : 600000
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline
  let first: number | null = null
  let usage: LLMUsage | null = null
  let status: LLMRequestMetrics['status'] = 'cancelled'
  let outputChars = 0
  try {
    for await (const chunk of streamProvider(target, context, { ...opts, signal })) {
      if ((chunk.type === 'delta' || chunk.type === 'thinking') && first === null) first = Date.now()
      if (chunk.type === 'usage') usage = chunk.usage
      if (chunk.type === 'delta') outputChars += chunk.text.length
      if (chunk.type === 'thinking') outputChars += chunk.text?.length ?? 0
      yield chunk
    }
    signal.throwIfAborted()
    status = 'completed'
  } catch (error) {
    status = deadline.aborted ? 'timed_out' : opts.signal?.aborted ? 'cancelled' : 'failed'
    if (deadline.aborted) throw new Error(`Model request timed out during ${first === null ? 'connection or prompt processing' : 'generation'}. Try a smaller output budget or check the provider queue.`)
    throw error
  } finally {
    // One record per actual generation, including repair attempts. Route
    // handlers return this authoritative ledger instead of recording again.
    try {
      if (usage || outputChars > 0) {
        const { recordServerUsage } = await import('./state-file')
        await recordServerUsage({ input: usage?.inputTokens ?? Math.ceil(chatTurnsText(context).length / 4), output: usage?.outputTokens ?? Math.ceil(outputChars / 4), estimated: !usage, model: target.label })
      }
    } catch { console.error('Could not persist model token usage.') }
    const ended = Date.now()
    const generationMs = first === null ? null : ended - first
    let provider = 'local'
    try { provider = new URL(target.endpoint).hostname } catch { /* The endpoint may be a custom non-URL identifier. */ }
    const metrics: LLMRequestMetrics = {
      requestId: crypto.randomUUID(), model: target.modelId, provider,
      durationMs: ended - started, timeToFirstTokenMs: first === null ? null : first - started,
      generationMs, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null,
      tokensPerSecond: usage && generationMs && generationMs > 0 ? usage.outputTokens / (generationMs / 1000) : null,
      status, failureStage: status === 'completed' ? null : first === null ? 'connecting' : 'generating',
    }
    endActivity()
    opts.onMetrics?.(metrics)
    console.info('[llm-request]', JSON.stringify(metrics))
  }
}
