import { seedState } from './seed'
import type { AgentNode, HubState, Session, TokenUsageLedger, UsageDay, UsageRecord } from './types'

// ── State hardening ───────────────────────────────────────────────────────────
// The laptop AI agent can POST arbitrary (partial) JSON to /api/agent. These
// helpers make sure a partial or malformed update can never wipe nested fields
// (e.g. {"plan":{"autoRun":false}} must not erase plan.steps) and never crash
// the dashboard UI.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Recursively merge `patch` into `base`. Nested plain objects are merged key by
 * key; arrays and primitives REPLACE the base value wholesale (so an agent can
 * still overwrite e.g. the whole `agents` tree by posting a full array).
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base
  if (!isPlainObject(base)) return structuredClone(patch) as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch)) {
    // null/undefined in a patch means "not provided" — keep the base value.
    // (Agents that want to clear a field should send an explicit empty value,
    // e.g. "" or [], rather than null.)
    if (v == null) continue
    const cur = (base as Record<string, unknown>)[k]
    out[k] = isPlainObject(v) && isPlainObject(cur) ? deepMerge(cur, v) : v
  }
  return out as T
}

function cloneSeed(): HubState {
  return JSON.parse(JSON.stringify(seedState)) as HubState
}

/** Drop non-object entries from an array of supposed items. */
function keepObjects<T>(arr: unknown): T[] {
  return Array.isArray(arr) ? (arr.filter(isPlainObject) as T[]) : []
}

/** Recursively guarantee that every agent node has a children array. */
function ensureAgentTree(nodes: AgentNode[]): AgentNode[] {
  return nodes.map((n) => ({
    ...n,
    children: Array.isArray(n.children) ? ensureAgentTree(n.children) : [],
  }))
}

function nonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * Guarantee a well-shaped token-usage ledger: drop malformed per-request
 * records and per-day aggregates, clamp every count to a non-negative integer,
 * and keep both arrays sorted. A bad or missing ledger degrades to empty —
 * never a crash and never a fabricated number.
 */
function normalizeUsageLedger(raw: unknown): TokenUsageLedger {
  const src = isPlainObject(raw) ? raw : {}

  const records: UsageRecord[] = []
  if (Array.isArray(src.records)) {
    for (const r of src.records) {
      if (!isPlainObject(r)) continue
      const at = typeof r.at === 'string' ? r.at : ''
      if (!at || !Number.isFinite(Date.parse(at))) continue
      const input = nonNegInt(r.input)
      const output = nonNegInt(r.output)
      if (input === 0 && output === 0) continue
      records.push({
        at,
        input,
        output,
        model: typeof r.model === 'string' ? r.model.slice(0, 80) : '',
        estimated: r.estimated === true,
      })
    }
  }
  records.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

  const days: UsageDay[] = []
  if (Array.isArray(src.days)) {
    for (const d of src.days) {
      if (!isPlainObject(d)) continue
      const date = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : ''
      if (!date) continue
      const requests = nonNegInt(d.requests)
      days.push({
        date,
        input: nonNegInt(d.input),
        output: nonNegInt(d.output),
        requests,
        estimated: Math.min(nonNegInt(d.estimated), requests),
      })
    }
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return { records, days, updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : '' }
}

/**
 * Guarantee a fully-shaped HubState: fill any missing nested fields from the
 * seed defaults, drop malformed items, and fall back to seed objects when a
 * whole section is broken. Unknown extra fields are preserved.
 */
export function normalizeState(input: unknown): HubState {
  const seed = cloneSeed()
  const merged = deepMerge(seed, isPlainObject(input) ? input : {})

  // Item arrays: keep only plain-object entries so a malformed item can never
  // crash a view that maps/filters it.
  merged.agents = ensureAgentTree(keepObjects<AgentNode>(merged.agents))
  merged.agentChat = keepObjects(merged.agentChat)
  merged.sessions = keepObjects<Session>(merged.sessions).map((s) => ({
    ...s,
    agentId: typeof s.agentId === 'string' && s.agentId ? s.agentId : '',
  }))
  merged.models = keepObjects(merged.models)
  // Custom models crossing the state boundary must never carry an API key:
  // derive the public `hasApiKey` flag and drop any secret that was persisted.
  merged.customModels = keepObjects(merged.customModels).map((m) => {
    const raw = m as Record<string, unknown>
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      name: typeof raw.name === 'string' ? raw.name : '',
      endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : '',
      modelId: typeof raw.modelId === 'string' ? raw.modelId : '',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      hasApiKey:
        Boolean(raw.hasApiKey) ||
        (typeof raw.apiKey === 'string' && raw.apiKey.trim().length > 0),
    }
  })

  // Section objects: fall back to the complete seed section when the section
  // itself is missing or not an object-shaped value.
  if (!isPlainObject(merged.plan) || !Array.isArray(merged.plan.steps)) merged.plan = seed.plan
  if (!isPlainObject(merged.changes) || !Array.isArray(merged.changes.files)) merged.changes = seed.changes
  if (!isPlainObject(merged.workflow) || !Array.isArray(merged.workflow.nodes)) merged.workflow = seed.workflow
  if (!isPlainObject(merged.settings)) merged.settings = seed.settings
  if (!isPlainObject(merged.graph)) merged.graph = seed.graph
  merged.tokenUsage = normalizeUsageLedger(merged.tokenUsage)

  return merged
}
