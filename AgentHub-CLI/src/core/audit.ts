import type { AgentEvent } from './events.ts'
import type { PolicyDecision } from '../policy/engine.ts'
import { redactSecrets } from '../utils/redact.ts'

export type AuditApproval = 'not_required' | 'pending' | 'approved' | 'denied' | 'cancelled' | 'failed'
export type AuditResult = 'started' | 'succeeded' | 'failed'

export interface AuditEntry {
  id: string
  at: string
  runId: string
  workspace: string
  tool: string
  operation: string
  decision?: PolicyDecision
  approval?: AuditApproval
  result?: AuditResult
  durationMs?: number
  summary?: string
  failure?: string
}

export interface PolicyAuditInput {
  tool: string
  operation: string
  decision: PolicyDecision
  approval: AuditApproval
  summary: string
}

export const MAX_AUDIT_ENTRIES = 500
const MAX_SUMMARY_CHARS = 240
const MAX_FAILURE_CHARS = 400

function clean(value: string, limit: number): string {
  return redactSecrets(value).slice(0, limit)
}

/**
 * A compact session audit. It intentionally excludes tool arguments, file
 * contents, provider messages, and successful tool output.
 */
export class AuditTrail {
  private readonly entriesValue: AuditEntry[]
  private readonly runtimeByCall = new Map<string, AuditEntry>()
  private sequence = 0
  private readonly runId: string
  private readonly workspace: string

  constructor(runId: string, workspace: string, previous: AuditEntry[] = []) {
    this.runId = runId
    this.workspace = workspace
    this.entriesValue = previous.slice(-MAX_AUDIT_ENTRIES)
  }

  recordPolicy(input: PolicyAuditInput): string {
    const entry = this.append({
      at: new Date().toISOString(),
      runId: this.runId,
      workspace: this.workspace,
      tool: clean(input.tool, 80),
      operation: clean(input.operation, 80),
      decision: input.decision,
      approval: input.approval,
      summary: clean(input.summary, MAX_SUMMARY_CHARS),
    })
    return entry.id
  }

  resolveApproval(id: string, approval: Exclude<AuditApproval, 'not_required' | 'pending'>, failure?: string): void {
    const entry = this.entriesValue.find((candidate) => candidate.id === id)
    if (!entry) return
    entry.approval = approval
    if (failure) entry.failure = clean(failure, MAX_FAILURE_CHARS)
  }

  recordRuntime(event: AgentEvent): void {
    if (event.type === 'tool_started') {
      const entry = this.append({
        at: new Date().toISOString(),
        runId: this.runId,
        workspace: this.workspace,
        tool: clean(event.name, 80),
        operation: 'tool.execute',
        result: 'started',
      })
      this.runtimeByCall.set(event.id, entry)
      return
    }

    if (event.type !== 'tool_result' && event.type !== 'tool_error') return
    let entry = this.runtimeByCall.get(event.id)
    if (!entry) {
      entry = this.append({
        at: new Date().toISOString(),
        runId: this.runId,
        workspace: this.workspace,
        tool: clean(event.name, 80),
        operation: 'tool.execute',
      })
      this.runtimeByCall.set(event.id, entry)
    }

    entry.result = event.type === 'tool_result' && event.ok ? 'succeeded' : 'failed'
    entry.durationMs = Number.isFinite(event.durationMs) ? Math.max(0, Math.floor(event.durationMs)) : 0
    if (event.type === 'tool_error') entry.failure = clean(event.error, MAX_FAILURE_CHARS)
    else if (!event.ok) entry.failure = 'Tool reported an unsuccessful result.'
  }

  snapshot(): AuditEntry[] {
    return this.entriesValue.map((entry) => ({ ...entry }))
  }

  private append(fields: Omit<AuditEntry, 'id'>): AuditEntry {
    const entry: AuditEntry = { id: `${this.runId}_audit_${++this.sequence}`, ...fields }
    this.entriesValue.push(entry)
    if (this.entriesValue.length > MAX_AUDIT_ENTRIES) {
      this.entriesValue.splice(0, this.entriesValue.length - MAX_AUDIT_ENTRIES)
    }
    return entry
  }
}
