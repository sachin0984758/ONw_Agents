'use client'

import { create } from 'zustand'
import { normalizeState } from './normalize'
import { setUsageSyncListener } from './usage-sync'
import { ledgerTotals } from './token-usage'
import type {
  AgentNode,
  AgentStatus,
  CustomModel,
  HubState,
  LocalModel,
  PlanStep,
  Session,
  StepStatus,
  TokenUsageLedger,
  ViewId,
  WorkflowNode,
} from './types'
import { seedState } from './seed'

// ── helpers ──────────────────────────────────────────────────────────────────
export function flattenAgents(nodes: AgentNode[], depth = 0, parent?: string): Array<AgentNode & { depth: number; parent?: string }> {
  const out: Array<AgentNode & { depth: number; parent?: string }> = []
  for (const n of nodes) {
    out.push({ ...n, depth, parent })
    out.push(...flattenAgents(n.children, depth + 1, n.id))
  }
  return out
}

export function countStatuses(nodes: AgentNode[]): Record<AgentStatus, number> {
  const flat = flattenAgents(nodes)
  const counts: Record<AgentStatus, number> = {
    running: 0,
    waiting: 0,
    blocked: 0,
    completed: 0,
    paused: 0,
  }
  for (const a of flat) counts[a.status]++
  return counts
}

// ── store ────────────────────────────────────────────────────────────────────
interface HubStore {
  state: HubState
  view: ViewId
  selectedAgentId: string | null
  selectedSessionId: string
  syncStatus: 'idle' | 'syncing' | 'saved' | 'error'
  // actions
  setView: (v: ViewId) => void
  selectAgent: (id: string | null) => void
  selectSession: (id: string) => void
  hydrateIfNewer: (incoming: HubState) => void
  patchState: (partial: Partial<HubState>) => void
  setAgentStatus: (id: string, status: AgentStatus) => void
  toggleModelRunning: (id: string) => void
  deleteModel: (id: string) => void
  addCustomModel: (model: CustomModel) => void
  deleteCustomModel: (id: string) => void
  setStepStatus: (id: string, status: StepStatus) => void
  toggleAutoRun: () => void
  stageFile: (id: string, staged: boolean) => void
  stageAll: (staged: boolean) => void
  toggleSetting: (key: 'codeExecution' | 'networkEgress') => void
  setAllowlistMode: (mode: HubState['settings']['allowlistMode']) => void
  addDomain: (domain: string) => void
  removeDomain: (domain: string) => void
  pushAgentChat: (text: string) => void
  pushEvent: (sessionId: string, content: string, type?: 'user' | 'assistant') => void
  /** Apply a server-recorded token ledger snapshot for display (never persists). */
  applyTokenUsage: (ledger: TokenUsageLedger) => void
  // ── Session ownership (one agent → many sessions; one session → one owner) ──
  createSessionForAgent: (agentId: string, name?: string) => string
  reassignSessionOwner: (sessionId: string, agentId: string) => void
  // ── Workflow actions ──
  wfAddNode: (node: WorkflowNode) => void
  wfRemoveNode: (id: string) => void
  wfUpdateNode: (id: string, patch: Partial<WorkflowNode>) => void
  wfAddEdge: (from: string, to: string) => void
  wfRemoveEdge: (from: string, to: string) => void
  wfRun: () => void
  wfPause: () => void
  wfReset: () => void
  resetState: () => void
}

function mapAgentTree(nodes: AgentNode[], id: string, fn: (a: AgentNode) => AgentNode): AgentNode[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n)
    if (n.children.length) return { ...n, children: mapAgentTree(n.children, id, fn) }
    return n
  })
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x))
}

export const useHub = create<HubStore>((set, get) => ({
  state: seedState,
  view: 'overview',
  selectedAgentId: 'backend',
  selectedSessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  syncStatus: 'idle',

  setView: (v) => set({ view: v }),
  selectAgent: (id) => set({ selectedAgentId: id }),
  selectSession: (id) => set({ selectedSessionId: id }),

  // Adopt an externally-written state (e.g. the AI agent POSTed an update)
  // only when it is genuinely newer than what the UI currently shows.
  // normalizeState guarantees a fully-shaped HubState so a partial or
  // malformed agent POST can never crash the dashboard views.
  hydrateIfNewer: (incoming) => {
    const cur = get().state
    try {
      const next = normalizeState(incoming)
      if (new Date(next.updatedAt) > new Date(cur.updatedAt)) {
        set({ state: next })
      } else if (Date.parse(next.tokenUsage.updatedAt) > (Date.parse(cur.tokenUsage.updatedAt) || 0)) {
        // Older files may have a newer ledger without a newer dashboard stamp.
        get().applyTokenUsage(next.tokenUsage)
      }
    } catch {
      // ignore malformed timestamps
    }
  },

  patchState: (partial) => {
    const next = { ...get().state, ...partial, updatedAt: new Date().toISOString() }
    set({ state: next, syncStatus: 'saved' })
    void fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
      .then((res) => set({ syncStatus: res.ok ? 'saved' : 'error' }))
      .catch(() => set({ syncStatus: 'error' }))
  },

  setAgentStatus: (id, status) => {
    const agents = mapAgentTree(get().state.agents, id, (a) => ({ ...a, status }))
    get().patchState({ agents })
  },

  toggleModelRunning: (id) => {
    const models: LocalModel[] = get().state.models.map((m) =>
      m.id === id ? { ...m, running: !m.running } : { ...m, running: m.id === id ? true : m.running }
    )
    // only one model can run at a time
    const target = get().state.models.find((m) => m.id === id)
    const nextModels = get().state.models.map((m) =>
      m.id === id ? { ...m, running: !m.running } : { ...m, running: false }
    )
    void target
    get().patchState({ models: nextModels || models })
  },

  deleteModel: (id) => {
    const models = get().state.models.filter((m) => m.id !== id)
    get().patchState({ models })
  },

  addCustomModel: (model) => {
    const customModels = [...get().state.customModels, model]
    get().patchState({ customModels })
  },

  deleteCustomModel: (id) => {
    const customModels = get().state.customModels.filter((m) => m.id !== id)
    get().patchState({ customModels })
  },

  setStepStatus: (id, status) => {
    const steps: PlanStep[] = get().state.plan.steps.map((s) =>
      s.id === id ? { ...s, status } : s
    )
    get().patchState({ plan: { ...get().state.plan, steps } })
  },

  toggleAutoRun: () => {
    get().patchState({ plan: { ...get().state.plan, autoRun: !get().state.plan.autoRun } })
  },

  stageFile: (id, staged) => {
    const files = get().state.changes.files.map((f) => (f.id === id ? { ...f, staged } : f))
    get().patchState({ changes: { ...get().state.changes, files } })
  },

  stageAll: (staged) => {
    const files = get().state.changes.files.map((f) => ({ ...f, staged }))
    get().patchState({ changes: { ...get().state.changes, files } })
  },

  toggleSetting: (key) => {
    const settings = { ...get().state.settings, [key]: !get().state.settings[key] }
    get().patchState({ settings })
  },

  setAllowlistMode: (mode) => {
    const settings = { ...get().state.settings, allowlistMode: mode }
    get().patchState({ settings })
  },

  addDomain: (domain) => {
    const d = domain.trim().toLowerCase()
    if (!d) return
    const current = get().state.settings.additionalDomains
    if (current.includes(d)) return
    get().patchState({ settings: { ...get().state.settings, additionalDomains: [...current, d] } })
  },

  removeDomain: (domain) => {
    const current = get().state.settings.additionalDomains
    get().patchState({
      settings: { ...get().state.settings, additionalDomains: current.filter((d) => d !== domain) },
    })
  },

  pushAgentChat: (text) => {
    const chat = [
      ...get().state.agentChat,
      {
        id: `msg-${Date.now()}`,
        from: 'You',
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        text,
      },
    ]
    get().patchState({ agentChat: chat })
  },

  pushEvent: (sessionId, content, type = 'user') => {
    const sessions = get().state.sessions.map((s) => {
      if (s.id !== sessionId) return s
      return {
        ...s,
        events: [
          ...s.events,
          {
            id: `e-${Date.now()}`,
            type: type as 'user' | 'assistant',
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            content,
          },
        ],
      }
    })
    get().patchState({ sessions })
  },

  // ── Token usage ledger (server-owned) ───────────────────────────────────
  // The server records every model call; each model route returns the updated
  // ledger and the call site hands it here for immediate display. This is
  // display-only — it never POSTs — so the client can never race or overwrite
  // the server's ledger.
  applyTokenUsage: (ledger) => {
    const cur = get().state.tokenUsage
    if ((Date.parse(ledger.updatedAt) || 0) < (Date.parse(cur.updatedAt) || 0)) return
    if (ledger.updatedAt === cur.updatedAt && ledgerTotals(ledger).requests < ledgerTotals(cur).requests) return
    if (
      ledger.updatedAt === cur.updatedAt &&
      ledger.records.length === cur.records.length &&
      ledger.days.length === cur.days.length
    ) {
      return
    }
    set({ state: { ...get().state, tokenUsage: ledger } })
  },

  // ── Session ownership ───────────────────────────────────────────────────
  // One agent → many sessions; one session → exactly one owner (agentId).
  // Never silently reassign: selectSession/selectAgent only change the UI
  // selection, never the stored owner.
  createSessionForAgent: (agentId, name) => {
    const all = flattenAgents(get().state.agents)
    const owner = all.find((a) => a.id === agentId)
    if (!owner) throw new Error(`No agent with id "${agentId}".`)
    const id = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const label = (name ?? '').trim() || `${owner.name} session ${get().state.sessions.filter((s) => s.agentId === agentId).length + 1}`
    const session: Session = {
      id,
      name: label,
      model: '',
      source: 'AgentHub',
      endedAt: '',
      agentId,
      stats: {
        userMessages: 0,
        responses: 0,
        toolCalls: 0,
        turns: 0,
        subAgents: 0,
        errors: 0,
        outputTokens: 0,
        inputTokens: 0,
      },
      events: [],
    }
    get().patchState({ sessions: [...get().state.sessions, session] })
    set({ selectedSessionId: id })
    return id
  },

  reassignSessionOwner: (sessionId, agentId) => {
    const all = flattenAgents(get().state.agents)
    if (!all.some((a) => a.id === agentId)) throw new Error(`No agent with id "${agentId}".`)
    const sessions = get().state.sessions.map((s) =>
      s.id === sessionId ? { ...s, agentId } : s
    )
    get().patchState({ sessions })
  },

  wfAddNode: (node) => {
    const wf = { ...get().state.workflow, nodes: [...get().state.workflow.nodes, node] }
    get().patchState({ workflow: wf })
  },

  wfRemoveNode: (id) => {
    const wf = {
      ...get().state.workflow,
      nodes: get().state.workflow.nodes.filter((n) => n.id !== id),
      edges: get().state.workflow.edges.filter((e) => e.from !== id && e.to !== id),
    }
    get().patchState({ workflow: wf })
  },

  wfUpdateNode: (id, patch) => {
    const wf = {
      ...get().state.workflow,
      nodes: get().state.workflow.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }
    get().patchState({ workflow: wf })
  },

  wfAddEdge: (from, to) => {
    if (from === to) return
    const edges = [...get().state.workflow.edges]
    if (edges.some((e) => e.from === from && e.to === to)) return
    const wf = { ...get().state.workflow, edges: [...edges, { from, to }] }
    get().patchState({ workflow: wf })
  },

  wfRemoveEdge: (from, to) => {
    const wf = {
      ...get().state.workflow,
      edges: get().state.workflow.edges.filter((e) => !(e.from === from && e.to === to)),
    }
    get().patchState({ workflow: wf })
  },

  wfRun: () => {
    const agent = { ...get().state.workflow.agent, active: true }
    const wf = { ...get().state.workflow, agent }
    get().patchState({ workflow: wf })
    get().pushAgentChat(`Workflow "${get().state.workflow.name}" started — ${get().state.workflow.nodes.length} nodes, ${get().state.workflow.edges.length} connections.`)
  },

  wfPause: () => {
    const agent = { ...get().state.workflow.agent, active: false }
    const wf = { ...get().state.workflow, agent }
    get().patchState({ workflow: wf })
  },

  wfReset: () => {
    const wf = {
      ...get().state.workflow,
      nodes: get().state.workflow.nodes.map((n) => ({ ...n })),
      edges: get().state.workflow.edges.map((e) => ({ ...e })),
      agent: { ...get().state.workflow.agent, active: false },
    }
    get().patchState({ workflow: wf })
  },

  resetState: () => {
    set({ state: clone(seedState), syncStatus: 'idle' })
    void fetch('/api/agent', { method: 'DELETE' }).catch(() => {})
  },
}))

// Wire server-recorded usage back into the UI: model routes return the updated
// ledger and the call sites push it here for display. Kept outside the store so
// the Agent Session runtime can sync usage without importing this module.
setUsageSyncListener((ledger) => useHub.getState().applyTokenUsage(ledger))
