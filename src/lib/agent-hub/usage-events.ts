import type { TokenUsageLedger } from './types'

export interface ModelActivity { id: string; model: string; source: string; startedAt: string }
export interface UsageUpdate { ledger?: TokenUsageLedger; active: ModelActivity[]; checkedAt: string }
type Listener = (update: UsageUpdate) => void
const shared = globalThis as typeof globalThis & { agentHubUsageEvents?: { active: Map<string, ModelActivity>; listeners: Set<Listener> } }
const state = shared.agentHubUsageEvents ??= { active: new Map(), listeners: new Set() }
export const modelActivity = () => [...state.active.values()]
export function publishUsage(ledger?: TokenUsageLedger) {
  const update = { ...(ledger ? { ledger } : {}), active: modelActivity(), checkedAt: new Date().toISOString() }
  for (const listener of state.listeners) { try { listener(update) } catch { /* a disconnected dashboard cannot break inference */ } }
}
export function subscribeUsage(listener: Listener) { state.listeners.add(listener); return () => { state.listeners.delete(listener) } }
export function beginModelActivity(model: string, source: string) {
  const id = crypto.randomUUID()
  state.active.set(id, { id, model, source, startedAt: new Date().toISOString() }); publishUsage()
  return () => { if (state.active.delete(id)) publishUsage() }
}
