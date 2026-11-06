import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from './db-path'
import { createSerializer, writeJsonAtomic } from './fs-atomic'
import { DEFAULT_MODEL_PREFERENCE, normalizeModelPreference, type ModelPreference } from './model-preference'

const file = path.join(DB_DIR, 'model-preference.json')
const shared = globalThis as typeof globalThis & { agentHubModelPreferenceQueue?: ReturnType<typeof createSerializer> }
const serialize = shared.agentHubModelPreferenceQueue ??= createSerializer()
export async function readModelPreference(): Promise<ModelPreference> {
  try { return normalizeModelPreference(JSON.parse(await fs.readFile(file, 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_MODEL_PREFERENCE }; throw new Error('The shared model preference could not be read.') }
}
export async function saveModelPreference(patch: Partial<Pick<ModelPreference, 'model' | 'allowRemote'>>) {
  return serialize(async () => {
    const preference = normalizeModelPreference({ ...await readModelPreference(), ...patch, updatedAt: new Date().toISOString() })
    await writeJsonAtomic(file, preference)
    return preference
  })
}
