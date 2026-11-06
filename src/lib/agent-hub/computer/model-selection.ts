import type { ProviderCheck } from '../llm'

export interface ComputerModel {
  id: string
  label: string
  providerId: string
  loaded: boolean
  vision: boolean
  chat: boolean
}

export function computerModels(providers: ProviderCheck[]): ComputerModel[] {
  return providers.filter((provider) => provider.available).flatMap((provider) =>
    provider.detailedModels.map((model) => ({
      id: model.id, label: `${provider.name} · ${model.id}`, providerId: provider.id,
      loaded: model.loaded, vision: model.type === 'vlm', chat: model.isChatCompatible,
    })),
  )
}

/** No named-model allowlist. Prefer a model the user already loaded. */
export function selectComputerModel(models: ComputerModel[], requested = ''): ComputerModel | undefined {
  const compatible = models.filter((model) => model.chat)
  if (requested) return compatible.find((model) => model.id === requested)
  return compatible.find((model) => model.loaded)
    ?? compatible.find((model) => !model.vision)
    ?? compatible[0]
}

export function selectComputerVision(models: ComputerModel[], requested: string, primary: string): ComputerModel | undefined {
  const compatible = models.filter((model) => model.vision && model.loaded && model.chat)
  if (requested === 'auto') return compatible.find((model) => model.id === primary) ?? compatible[0]
  return requested ? compatible.find((model) => model.id === requested) : undefined
}
