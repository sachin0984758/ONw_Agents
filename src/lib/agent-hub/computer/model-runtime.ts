import { type LLMTarget, type ProviderCheck } from '../llm'
import { computerModels, selectComputerModel } from './model-selection'
import { resolveModelTarget } from '../model-routing'
import { readCustomModels } from '../custom-models'

export function computerTarget(providers: ProviderCheck[], requested: string): LLMTarget {
  const model = selectComputerModel(computerModels(providers), requested.trim())
  if (!model) throw new Error(requested.trim()
    ? 'The selected model is no longer available or is not chat compatible. Choose Automatic or another local chat model.'
    : 'No local chat model was found. Start the LM Studio server and download a chat model, then retry.')
  const provider = providers.find((entry) => entry.id === model.providerId)!
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(provider.endpoint).hostname)) throw new Error('Auto uses only loopback model endpoints.')
  return { endpoint: provider.endpoint, apiKey: '', modelId: model.id, label: model.label, loaded: model.loaded, isChatCompatible: true, availableModels: provider.detailedModels }
}

/** Load only an installed model, on Run; never download or unload models. */
export async function prepareComputerModel(target: LLMTarget, signal: AbortSignal, request: typeof fetch = fetch): Promise<LLMTarget> {
  signal.throwIfAborted()
  const url = new URL(target.endpoint)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Auto uses only loopback model endpoints.')
  if (target.loaded !== false) return target
  const providerId = target.availableModels?.find((model) => model.id === target.modelId)?.providerId
  if (providerId !== 'lmstudio') return target // Ollama loads installed models on inference.
  const response = await request(new URL('/api/v1/models/load', url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: target.modelId }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
  })
  // Older LM Studio versions use just-in-time loading through chat/completions.
  if ([404, 405].includes(response.status)) { await response.body?.cancel(); return target }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`LM Studio could not load the selected model (HTTP ${response.status}). Check its memory and server settings.`)
  }
  const value = await response.json()
  if (value.status !== 'loaded') throw new Error('LM Studio did not confirm that the model loaded. No desktop action was executed.')
  return { ...target, loaded: true, modelId: typeof value.instance_id === 'string' ? value.instance_id : target.modelId }
}

export async function detectComputerTarget(requested: string): Promise<LLMTarget> {
  return resolveModelTarget(requested, await readCustomModels(), { localOnly: true })
}
