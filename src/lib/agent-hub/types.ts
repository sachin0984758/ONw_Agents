// ─── AgentHub: Unified AI Agent Command Center ───────────────────────────────
// Types for the complete dashboard state, combining 9 tools into one.

// ── Agent configuration ─────────────────────────────────────────────────────
export type AgentStatus = 'running' | 'waiting' | 'blocked' | 'completed' | 'paused'
export type AgentType =
  | 'manager'
  | 'architecture'
  | 'backend'
  | 'ui'
  | 'qa'
  | 'database'
  | 'service'
  | 'test'
  | 'ipc'

export interface AgentMetrics {
  agents: number
  worktrees: number
  completion: number // percent
}

export interface AgentNode {
  id: string
  name: string
  type: AgentType
  status: AgentStatus
  description: string
  worktree: string
  metrics: AgentMetrics
  children: AgentNode[]
}

export interface AgentChatMessage {
  id: string
  from: string
  time: string
  text: string
  files?: string[]
  progress?: number
}

// ── Session records ─────────────────────────────────────────────────────────
export type SessionEventType =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'result'
  | 'error'

export interface SessionEvent {
  id: string
  type: SessionEventType
  time: string
  content: string
  tokens?: number
  meta?: string
}

export interface SessionStats {
  userMessages: number
  responses: number
  toolCalls: number
  turns: number
  subAgents: number
  errors: number
  outputTokens: number
  inputTokens: number
}

export interface Session {
  id: string
  name: string
  model: string
  source: string
  endedAt: string
  stats: SessionStats
  events: SessionEvent[]
  agentId: string
}

// ── Token usage ledger (Overview "Token Monitor" / "Token Usage") ─────────────
// The single source of truth for the Overview token widgets. It records REAL
// model calls made by the client call sites (Chat, the Agent Session runtime,
// Playground and Explain); the seeded demo sessions' `stats` are never included.
//
// Each call is stored as its OWN record carrying its OWN completion timestamp,
// so Today/Weekly are computed from when a call actually happened — never from
// a session's last-activity timestamp (a session's `stats` is a single lifetime
// aggregate, so bucketing its whole history under that one time would corrupt
// the daily/weekly totals).
//
// Provider-reported `usage` is preferred; when a provider omits it the value is
// locally estimated (chars / 4) and counted in `estimated`.

/** One real model call, recorded by the client call site that made it. */
export interface UsageRecord {
  /** ISO timestamp of the completion that produced these tokens. */
  at: string
  /** Prompt tokens (provider-reported, or estimated when `estimated` is true). */
  input: number
  /** Completion tokens (provider-reported, or estimated when `estimated` is true). */
  output: number
  /** Model/provider label that served the reply ('' when unknown). */
  model: string
  /** true when the provider omitted `usage` and the values are estimated. */
  estimated: boolean
}

/**
 * Per-day aggregate of usage records older than the retained per-request
 * window. Used purely to bound the size of the persisted ledger: totals stay
 * exact, but sub-day timestamps are folded away for days before the current
 * week (which neither Today nor Weekly ever reads).
 */
export interface UsageDay {
  /** Local calendar date, 'YYYY-MM-DD'. */
  date: string
  input: number
  output: number
  /** Number of successful model calls folded into this day. */
  requests: number
  /** Of `requests`, how many had no provider usage and were estimated. */
  estimated: number
}

export interface TokenUsageLedger {
  /** Per-request records, ascending by `at` (the retained recent window). */
  records: UsageRecord[]
  /** Per-day aggregates for records older than the retained window. */
  days: UsageDay[]
  /** ISO timestamp of the last recorded call ('' when nothing recorded yet). */
  updatedAt: string
}

// ── Local model inventory ────────────────────────────────────────────────────
export interface LocalModel {
  id: string
  name: string
  quant: string
  sizeGb: number
  source: string
  running: boolean
}

// ── Code Graph ──────────────────────────────────────────────────────────────
export type GraphNodeType = 'module' | 'file' | 'class' | 'function' | 'config'

export interface GraphNode {
  id: string
  label: string
  type: GraphNodeType
  cluster: string
  x: number // 0..1 normalized
  y: number // 0..1 normalized
  size: number
}

export interface GraphEdge {
  from: string
  to: string
}

export interface CodeGraph {
  repo: string
  branch: string
  nodeCount: number
  edgeCount: number
  semanticReady: boolean
  renderMs: number
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ── Tasks / Plan ────────────────────────────────────────────────────────────
export type StepStatus = 'completed' | 'in-progress' | 'not-started'

export interface PlanStep {
  id: string
  name: string
  status: StepStatus
  detail: string
}

export interface Plan {
  file: string
  autoRun: boolean
  pendingChanges: number
  commits: number
  steps: PlanStep[]
}

// ── Changes / Code Review ────────────────────────────────────────────────────
export interface FileChange {
  id: string
  name: string
  folder: string
  badge: 'M' | 'A' | 'D'
  staged: boolean
  comments: number
}

export interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'ctx'
  content: string
  warn?: boolean
}

export interface AIComment {
  id: string
  file: string
  lines: string
  snippet: string
  suggestion: string
  severity: 'info' | 'idea' | 'warning'
}

export interface ChangesState {
  project: string
  branch: string
  files: FileChange[]
  activeFile: string
  diff: DiffLine[]
  comments: AIComment[]
}

// ── Workflows ────────────────────────────────────────────────────────────────
export type WorkflowNodeKind = 'trigger' | 'manual' | 'action' | 'webhook'

export interface WorkflowNode {
  id: string
  title: string
  subtitle: string
  service: string
  kind: WorkflowNodeKind
  x: number // percent within canvas
  y: number
}

export interface WorkflowEdge {
  from: string
  to: string
}

export interface WorkflowFile {
  name: string
  note: string
  status: 'uploaded' | 'uploading'
}

export interface WorkflowAgent {
  name: string
  active: boolean
  instructions: string
  successRate: number
  responseTimeSec: number
  processed: number
  accuracy: number
  files: WorkflowFile[]
}

export interface Workflow {
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  agent: WorkflowAgent
}

// ── Runtime settings ────────────────────────────────────────────────────────
export type AllowlistMode = 'package-managers' | 'all' | 'custom'

export interface HubSettings {
  codeExecution: boolean
  networkEgress: boolean
  allowlistMode: AllowlistMode
  additionalDomains: string[]
}

// ── Custom API Models (user-defined OpenAI-compatible endpoints) ─────────────
// PUBLIC shape — this is what the browser and the Agent API see. The API key
// itself is stored only server-side (db/custom-models.json) and is never sent
// to a client; `hasApiKey` reports whether a key is configured.
export interface CustomModel {
  id: string
  name: string
  endpoint: string
  modelId: string
  createdAt: string
  hasApiKey: boolean
}

// ── Root state ───────────────────────────────────────────────────────────────
export interface HubState {
  version: number
  updatedAt: string
  projectName: string
  agents: AgentNode[]
  agentChat: AgentChatMessage[]
  sessions: Session[]
  tokenUsage: TokenUsageLedger
  models: LocalModel[]
  customModels: CustomModel[]
  graph: CodeGraph
  plan: Plan
  changes: ChangesState
  workflow: Workflow
  settings: HubSettings
}

export type ViewId =
  | 'overview'
  | 'chat'
  | 'agents'
  | 'sessions'
  | 'auto'
  | 'models'
  | 'tasks'
  | 'changes'
  | 'playground'
  | 'ui-components'
  | 'capabilities'
  | 'settings'
  | 'agent-api'

// ── n8n template gallery ────────────────────────────────────────────────────
// Real workflows from n8n's official template gallery. The untouched n8n JSON
// for each lives at public/n8n-templates/<id>.json (see `jsonUrl`), so any
// template can be imported into a real n8n instance unchanged.

export type N8nNodeKind = 'trigger' | 'webhook' | 'action' | 'logic'

export interface N8nTemplateNode {
  id: string
  title: string
  /** n8n node type with the n8n-nodes-base. prefix stripped */
  service: string
  kind: N8nNodeKind
  /** normalized 0..100 canvas position */
  x: number
  y: number
}

export interface N8nTemplate {
  id: string
  name: string
  category: string
  /** sorted unique node services used by this workflow */
  services: string[]
  /** node services that act as triggers */
  triggers: string[]
  nodeCount: number
  edgeCount: number
  /** sticky notes dropped from the graph */
  noteCount: number
  complexity: 'Low' | 'Medium' | 'High'
  trigger: string
  timezone: string
  active: boolean
  description: string
  author: string
  jsonUrl: string
  sourceUrl: string
  nodes: N8nTemplateNode[]
  edges: Array<{ from: string; to: string }>
}

// ── Local machine telemetry (LM Studio-style console) ───────────────────────
// Read live from the host by /api/system-metrics. Every field is optional so
// the UI can degrade honestly on a machine without an NVIDIA GPU.

export interface GpuTelemetry {
  name: string
  vramUsedMb: number
  vramTotalMb: number
  utilizationPct: number
  temperatureC: number
  powerDrawW: number
  driverVersion?: string
  cudaVersion?: string
}

export interface CpuTelemetry {
  model: string
  cores: number
  threads: number
  clockGhz: number
  utilizationPct: number
}

export interface MemoryTelemetry {
  usedGb: number
  totalGb: number
  utilizationPct: number
}

export interface SystemTelemetry {
  ok: boolean
  platform: string
  hostname: string
  uptimeSec: number
  gpu: GpuTelemetry | null
  cpu: CpuTelemetry
  memory: MemoryTelemetry
  /** why a section is missing, when it is */
  notes?: string[]
  sampledAt: string
}
