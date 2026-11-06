

// ── Custom compatible model endpoint configuration ──────────────────────────
// Endpoints are user configured. Local inference remains the default; remote
// endpoints require the separate explicit remote-inference preference.

export interface CustomModel {
  id: string
  name: string
  endpoint: string
  apiKey: string
  modelId: string
  createdAt: string
}

export interface CustomModelInput {
  name: string
  endpoint: string
  apiKey: string
  modelId: string
}

export function createCustomModelId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Seed custom models (empty — user adds their own) ────────────────────────
export const seedCustomModels: CustomModel[] = []

// ── Validation ──────────────────────────────────────────────────────────────
// Defensive: a malformed body (missing/non-string fields) must return a clear
// 400, never throw a 500.
export function validateCustomModel(input: CustomModelInput): { ok: true } | { ok: false; error: string } {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const endpoint = typeof input?.endpoint === 'string' ? input.endpoint.trim() : ''
  const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : ''
  const modelId = typeof input?.modelId === 'string' ? input.modelId.trim() : ''
  if (!name) return { ok: false, error: 'Name is required.' }
  if (!endpoint) return { ok: false, error: 'Endpoint URL is required.' }
  if (!/^https?:\/\/.+/.test(endpoint))
    return { ok: false, error: 'Endpoint must be a valid HTTP(S) URL.' }
  if (!apiKey) return { ok: false, error: 'API key is required.' }
  if (!modelId) return { ok: false, error: 'Model ID is required.' }
  return { ok: true }
}

// ── Storage helpers (server-side, file-based like chat history) ─────────────
// Custom models are persisted in db/custom-models.json alongside other state.
// The /api/custom-models route handles CRUD; these helpers are for the route.

import { promises as fs } from 'fs'
import path from 'path'
import { DB_DIR } from './db-path'
import { writeJsonAtomic } from './fs-atomic'
import type { CustomModel as PublicCustomModel } from './types'

const CUSTOM_MODELS_FILE = path.join(DB_DIR, 'custom-models.json')

export async function readCustomModels(): Promise<CustomModel[]> {
  try {
    const raw = await fs.readFile(CUSTOM_MODELS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function writeCustomModels(models: CustomModel[]): Promise<void> {
  await writeJsonAtomic(CUSTOM_MODELS_FILE, models)
}

// ── Public serializer ───────────────────────────────────────────────────────
// The API key must never cross the API boundary. Callers that need to actually
// call a provider read the full record from disk via readCustomModels() on the
// server; every HTTP response goes through this function instead.
export function toPublicCustomModel(m: CustomModel): PublicCustomModel {
  return {
    id: m.id,
    name: m.name,
    endpoint: m.endpoint,
    modelId: m.modelId,
    createdAt: m.createdAt,
    hasApiKey: typeof m.apiKey === 'string' && m.apiKey.trim().length > 0,
  }
}
