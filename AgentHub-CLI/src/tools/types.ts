import type { AgentConfig } from '../config/types.ts'
import type { BackupStore } from '../core/backups.ts'
import type { AgentEvent, EventSink, RunResult } from '../core/events.ts'
import type { RunLedger } from '../core/ledger.ts'
import type { PlanState } from '../core/plan.ts'
import type { PolicyAction } from '../policy/engine.ts'
import type { SkillIndex } from '../skills/discover.ts'

export interface AuthorizeResult {
  ok: boolean
  reason: string
  hard?: boolean
}

export type Authorize = (action: PolicyAction, tool: string, detail?: string) => Promise<AuthorizeResult>

export interface SubagentOptions {
  role?: 'planner' | 'researcher' | 'coder' | 'reviewer' | 'tester' | 'debugger'
  task: string
  label?: string
  maxSteps?: number
  /** Cancellation signal from the parent tool call, including its timeout. */
  signal?: AbortSignal
}

export type SpawnSubagent = (opts: SubagentOptions) => Promise<RunResult>

export interface ToolContext {
  runId: string
  workspace: string
  config: AgentConfig
  authorize: Authorize
  events: EventSink
  signal: AbortSignal
  backups: BackupStore
  skills: SkillIndex
  plan: PlanState
  ledger: RunLedger
  activeSkills: Set<string>
  /** Set by the runtime; absent in contexts that cannot run a child agent. */
  spawnSubagent?: SpawnSubagent
}

export interface ToolResult {
  ok: boolean
  content: string
  error?: string
  truncated?: boolean
}

export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
  /** Optional human-readable preview shown before an approval prompt. */
  preview?(input: Record<string, unknown>, ctx: ToolContext): Promise<string | null>
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

export type { AgentEvent, EventSink }
