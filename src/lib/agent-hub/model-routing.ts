import { detectLocalProviders, resolveLocalTarget, resolveTarget, type CustomModelLike, type LLMTarget } from './llm'
import { readModelPreference } from './model-preference-server'

export function isLoopbackModelEndpoint(endpoint: string) {
  try { const url = new URL(endpoint); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) } catch { return false }
}

/** Shared routing; selecting a model never grants any task or network permission. */
export async function resolveModelTarget(requested: string, customModels: CustomModelLike[] = [], policy: { localOnly?: boolean; vision?: boolean } = {}): Promise<LLMTarget> {
  const preference = await readModelPreference()
  const model = requested === 'auto' ? '' : requested.trim() || preference.model
  const custom = customModels.find((entry) => entry.id === model)
  if (custom && !isLoopbackModelEndpoint(custom.endpoint) && (policy.localOnly || !preference.allowRemote)) throw new Error(policy.localOnly ? 'Auto computer use accepts only local models. Choose Auto or a local model in the shared selector.' : 'Remote model inference is disabled. Explicitly allow configured remote inference in model settings before using this provider.')
  let target: LLMTarget
  if (policy.vision && !model) {
    const providers = await detectLocalProviders()
    const models = providers.filter((entry) => entry.available).flatMap((entry) => entry.detailedModels).filter((entry) => entry.type === 'vlm' && entry.isChatCompatible)
    const candidate = models.find((entry) => entry.loaded) ?? models[0]
    if (!candidate) throw new Error('No available local vision model can handle these images. Load a vision model or remove the images.')
    target = await resolveLocalTarget(candidate.id)
  } else target = custom ? await resolveTarget(model, customModels) : await resolveLocalTarget(model)
  const local = isLoopbackModelEndpoint(target.endpoint)
  if (!local && (policy.localOnly || !preference.allowRemote)) throw new Error('This request does not have permission to use a remote model provider.')
  return target
}
