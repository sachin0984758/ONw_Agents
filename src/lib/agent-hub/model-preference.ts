export interface ModelPreference { model: string; allowRemote: boolean; updatedAt: string }
export const DEFAULT_MODEL_PREFERENCE: ModelPreference = { model: '', allowRemote: false, updatedAt: '' }
export function normalizeModelPreference(value: unknown): ModelPreference {
  const candidate = value && typeof value === 'object' ? value as Partial<ModelPreference> : {}
  return { model: typeof candidate.model === 'string' ? candidate.model.trim().slice(0, 300) : '', allowRemote: candidate.allowRemote === true, updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '' }
}
