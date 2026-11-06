// ── n8n persistence ──────────────────────────────────────────────────────────
// Two JSON files under DB_DIR (same durable, atomic-write pattern the rest of
// AgentHub uses):
//
//   db/n8n-config.json   server-only connection settings (may hold an API key).
//                        NEVER returned to the browser — the API exposes only
//                        a sanitized view (see n8n.ts → toPublicConfig).
//   db/n8n-state.json    workflow links + AgentHub-side execution history.
//                        Safe to return; contains no secrets.
//
// This is deliberately separate from db/agent-hub-state.json so an n8n reset or
// corrupt file can never damage sessions, plans or other dashboard state.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from './db-path'
import { writeJsonAtomic } from './fs-atomic'
import type { N8nStoreState, StoredN8nConfig } from './n8n-types'

const STATE_FILE = path.join(DB_DIR, 'n8n-state.json')
const CONFIG_FILE = path.join(DB_DIR, 'n8n-config.json')

/** How many execution records we keep. Older ones are dropped on write. */
export const MAX_EXECUTION_HISTORY = 200

const emptyState = (): N8nStoreState => ({
  links: {},
  executions: [],
  updatedAt: new Date(0).toISOString(),
})

// Atomic writes come from fs-atomic.ts (unique temp names keep concurrent
// writes safe — see the module comment there).

// ── Execution history + links ────────────────────────────────────────────────

export async function readN8nState(): Promise<N8nStoreState> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<N8nStoreState>
    return {
      links: parsed.links && typeof parsed.links === 'object' ? parsed.links : {},
      executions: Array.isArray(parsed.executions) ? parsed.executions : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    }
  } catch {
    return emptyState()
  }
}

export async function writeN8nState(state: N8nStoreState): Promise<void> {
  const trimmed: N8nStoreState = {
    links: state.links,
    // newest first, capped
    executions: state.executions
      .slice()
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, MAX_EXECUTION_HISTORY),
    updatedAt: new Date().toISOString(),
  }
  await writeJsonAtomic(STATE_FILE, trimmed)
}

export async function getWorkflowLink(templateId: string) {
  const state = await readN8nState()
  return state.links[templateId] ?? null
}

export async function upsertWorkflowLink(link: N8nStoreState['links'][string]): Promise<void> {
  const state = await readN8nState()
  state.links[link.templateId] = link
  await writeN8nState(state)
}

export async function removeWorkflowLink(templateId: string): Promise<void> {
  const state = await readN8nState()
  delete state.links[templateId]
  await writeN8nState(state)
}

export async function addExecutionRecord(record: N8nStoreState['executions'][number]): Promise<void> {
  const state = await readN8nState()
  state.executions = [record, ...state.executions]
  await writeN8nState(state)
}

export async function updateExecutionRecord(
  id: string,
  patch: Partial<N8nStoreState['executions'][number]>
): Promise<N8nStoreState['executions'][number] | null> {
  const state = await readN8nState()
  const idx = state.executions.findIndex((r) => r.id === id)
  if (idx === -1) return null
  const next = { ...state.executions[idx], ...patch }
  state.executions[idx] = next
  await writeN8nState(state)
  return next
}

export async function getExecutionRecord(id: string) {
  const state = await readN8nState()
  return state.executions.find((r) => r.id === id) ?? null
}

export async function listExecutionRecords(templateId?: string) {
  const state = await readN8nState()
  const rows = templateId ? state.executions.filter((r) => r.templateId === templateId) : state.executions
  return rows.slice().sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
}

// ── Server-only connection config ────────────────────────────────────────────

export async function readStoredN8nConfig(): Promise<StoredN8nConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as StoredN8nConfig
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export async function writeStoredN8nConfig(config: StoredN8nConfig): Promise<void> {
  await writeJsonAtomic(CONFIG_FILE, { ...config, updatedAt: new Date().toISOString() })
}

export async function clearStoredN8nConfig(): Promise<void> {
  try {
    await fs.rm(CONFIG_FILE, { force: true })
  } catch {
    /* ignore */
  }
}
