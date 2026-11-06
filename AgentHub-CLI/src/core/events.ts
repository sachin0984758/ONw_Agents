// Stable runtime event contract. Every interface (TUI, one-shot, JSON, future
// IDE clients) consumes these events; none of them depend on terminal state.

export type RunStatus = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'

export interface TokenUsage {
  /** null means "provider did not report it" — never invent a number. */
  input: number | null
  output: number | null
}

export interface PlanStepEvent {
  index: number
  title: string
  status: 'pending' | 'active' | 'completed' | 'blocked' | 'skipped' | 'failed' | 'cancelled'
  /** Dependency step numbers, 1-based. */
  dependsOn?: number[]
  note?: string
}

export interface CommandEvidence {
  command: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
}

export interface ChangedFileEvidence {
  path: string
  change: 'created' | 'modified' | 'deleted'
  backup?: string
  expectedHash?: string
}

export interface RunStartedEvent {
  type: 'run_started'
  runId: string
  sessionId: string
  task: string
  workspace: string
  provider: string
  model: string
  permission: string
  startedAt: string
}

export interface StatusEvent {
  type: 'status'
  status: RunStatus
  detail?: string
}

export interface AssistantDeltaEvent {
  type: 'assistant_delta'
  text: string
}

export interface AssistantMessageEvent {
  type: 'assistant_message'
  text: string
}

export interface ToolProposedEvent {
  type: 'tool_proposed'
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ApprovalRequestedEvent {
  type: 'approval_requested'
  id: string
  tool: string
  summary: string
  detail: string
  risk: 'low' | 'medium' | 'high'
}

export interface ApprovalResolvedEvent {
  type: 'approval_resolved'
  id: string
  approved: boolean
  remember: boolean
}

export interface ToolStartedEvent {
  type: 'tool_started'
  id: string
  name: string
}

export interface ToolProgressEvent {
  type: 'tool_progress'
  id: string
  name: string
  message: string
}

export interface ToolResultEvent {
  type: 'tool_result'
  id: string
  name: string
  ok: boolean
  content: string
  durationMs: number
  truncated: boolean
}

export interface ToolErrorEvent {
  type: 'tool_error'
  id: string
  name: string
  error: string
  durationMs: number
}

export interface PlanEvent {
  type: 'plan'
  steps: PlanStepEvent[]
}

export interface PlanStepChangedEvent {
  type: 'plan_step'
  index: number
  status: PlanStepEvent['status']
  note?: string
}

export interface FilesChangedEvent {
  type: 'files_changed'
  path: string
  change: ChangedFileEvidence['change']
  backup?: string
}

export interface SubagentStartedEvent {
  type: 'subagent_started'
  id: string
  label: string
  task: string
  maxSteps: number
}

export interface SubagentProgressEvent {
  type: 'subagent_progress'
  id: string
  message: string
}

export interface SubagentCompletedEvent {
  type: 'subagent_completed'
  id: string
  label: string
  status: Exclude<RunStatus, 'running'>
  text: string
  changedFiles: ChangedFileEvidence[]
  commands: CommandEvidence[]
  durationMs: number
}

export interface UsageEvent {
  type: 'usage'
  input: number | null
  output: number | null
  estimated: boolean
  totalInput: number
  totalOutput: number
}

export interface WarningEvent {
  type: 'warning'
  message: string
}

export interface ErrorEvent {
  type: 'error'
  message: string
  fatal: boolean
}

export interface RunCompletedEvent {
  type: 'run_completed'
  runId: string
  sessionId: string
  status: Exclude<RunStatus, 'running'>
  text: string
  changedFiles: ChangedFileEvidence[]
  commands: CommandEvidence[]
  usage: TokenUsage
  durationMs: number
  steps: number
  limitations: string[]
}

export interface RunCancelledEvent {
  type: 'run_cancelled'
  runId: string
  reason: string
}

export type AgentEvent =
  | RunStartedEvent
  | StatusEvent
  | AssistantDeltaEvent
  | AssistantMessageEvent
  | ToolProposedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | ToolStartedEvent
  | ToolProgressEvent
  | ToolResultEvent
  | ToolErrorEvent
  | PlanEvent
  | PlanStepChangedEvent
  | FilesChangedEvent
  | SubagentStartedEvent
  | SubagentProgressEvent
  | SubagentCompletedEvent
  | UsageEvent
  | WarningEvent
  | ErrorEvent
  | RunCompletedEvent
  | RunCancelledEvent

export type EventSink = (event: AgentEvent) => void

export interface RunResult {
  runId: string
  sessionId: string
  status: Exclude<RunStatus, 'running'>
  text: string
  changedFiles: ChangedFileEvidence[]
  commands: CommandEvidence[]
  usage: TokenUsage
  /** True when at least part of the usage total was estimated, not reported. */
  usageEstimated?: boolean
  durationMs: number
  steps: number
  limitations: string[]
  error?: string
}
