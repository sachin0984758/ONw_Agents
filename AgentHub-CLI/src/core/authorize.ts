import type { ApprovalBroker } from '../policy/engine.ts'
import { describeAction, PolicyEngine, type PolicyAction } from '../policy/engine.ts'
import type { AgentEvent, EventSink } from '../core/events.ts'
import type { Authorize, AuthorizeResult } from '../tools/types.ts'
import { isAbortError } from '../providers/types.ts'
import type { AuditTrail } from './audit.ts'
import { awaitWithSignal } from './cancellation.ts'

let sequence = 0

export function createAuthorizer(
  policy: PolicyEngine,
  broker: ApprovalBroker,
  events: EventSink,
  signal: AbortSignal,
  audit?: AuditTrail,
): Authorize {
  return async (action: PolicyAction, tool: string, detailOverride?: string): Promise<AuthorizeResult> => {
    if (signal.aborted) return { ok: false, reason: 'Cancelled before authorization.' }
    const result = policy.evaluate(action)
    const described = describeAction(action)
    if (result.decision === 'allow') {
      audit?.recordPolicy({ tool, operation: action.kind, decision: result.decision, approval: 'not_required', summary: described.summary })
      return { ok: true, reason: result.reason }
    }
    if (result.decision === 'deny') {
      audit?.recordPolicy({ tool, operation: action.kind, decision: result.decision, approval: 'not_required', summary: described.summary })
      return { ok: false, reason: `${result.reason} [${result.rule}]`, hard: true }
    }
    const request = {
      id: `ap_${Date.now().toString(36)}_${++sequence}`,
      tool,
      summary: described.summary,
      detail: detailOverride ?? described.detail,
      risk: result.risk,
      action,
    }
    const auditId = audit?.recordPolicy({
      tool,
      operation: action.kind,
      decision: result.decision,
      approval: 'pending',
      summary: described.summary,
    })
    events({
      type: 'approval_requested',
      id: request.id,
      tool: request.tool,
      summary: request.summary,
      detail: request.detail,
      risk: request.risk,
    })
    try {
      const outcome = await awaitWithSignal(() => broker.request(request, signal), signal)
      signal.throwIfAborted()
      events({
        type: 'approval_resolved',
        id: request.id,
        approved: outcome.approved,
        remember: outcome.remember,
      })
      if (!outcome.approved) {
        if (auditId) audit?.resolveApproval(auditId, 'denied')
        return { ok: false, reason: 'The user denied this action.' }
      }
      if (auditId) audit?.resolveApproval(auditId, 'approved')
      if (outcome.remember) policy.rememberApproval(policy.approvalKey(action))
      return { ok: true, reason: 'Approved by the user.' }
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        if (auditId) audit?.resolveApproval(auditId, 'cancelled')
        events({ type: 'approval_resolved', id: request.id, approved: false, remember: false })
        return { ok: false, reason: 'Cancelled while waiting for approval.' }
      }
      const message = err instanceof Error ? err.message : String(err)
      if (auditId) audit?.resolveApproval(auditId, 'failed', message)
      events({ type: 'approval_resolved', id: request.id, approved: false, remember: false })
      return { ok: false, reason: `Approval failed: ${message}` }
    }
  }
}

export type { AgentEvent }
