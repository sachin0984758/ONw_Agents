// ── n8n runtime integration types ────────────────────────────────────────────
// AgentHub can connect to a real n8n instance, import a gallery template as a
// workflow, run it through a supported execution mechanism and show the real
// execution record n8n produced. Nothing here is a mock: every field mirrors
// something n8n actually reports (or something AgentHub genuinely measured).
//
// Verified against the official n8n public API (v1):
//   auth            header  X-N8N-API-KEY
//   workflows       GET/POST /api/v1/workflows, GET/PUT/DELETE /api/v1/workflows/{id}
//   activation      POST /api/v1/workflows/{id}/activate   (n8n v1 name)
//                   POST /api/v1/workflows/{id}/deactivate
//   executions      GET /api/v1/executions?workflowId=…&includeData=…
//                   GET /api/v1/executions/{id}
// On-demand execution of a workflow is only possible through its trigger:
// webhook/form triggers are invoked over HTTP; schedule/event workflows are
// published (activated) and fire on their own; manual-only workflows cannot be
// started by the public API and are reported as such rather than faked.

export type N8nConnectionState =
  | 'not_configured'
  | 'connected'
  | 'unauthorized'
  | 'unreachable'
  | 'error'

/** Safe-to-send config. Never contains the API key. */
export interface N8nPublicConfig {
  baseUrl: string
  webhookBaseUrl: string
  timeoutMs: number
  hasApiKey: boolean
  /** true when both a base URL and an API key are present */
  configured: boolean
  /** which layer supplied the base URL — lets the setup screen explain itself */
  source: 'env' | 'stored' | 'default'
}

export interface N8nStatus {
  state: N8nConnectionState
  config: N8nPublicConfig
  /** n8n version reported by the instance (unauthenticated probe), when known */
  version: string | null
  /** secret-free, human-readable explanation of `state` */
  message: string
  /** workflows visible to the API key, when the auth probe succeeded */
  workflowCount: number | null
  checkedAt: string
}

export type N8nTriggerKind =
  | 'webhook'
  | 'form'
  | 'schedule'
  | 'manual'
  | 'event'
  | 'unknown'

export interface N8nTriggerInfo {
  kind: N8nTriggerKind
  /** n8n node type of the trigger, e.g. n8n-nodes-base.webhook */
  nodeType: string
  nodeName: string | null
  /** webhook / form path parsed from the trigger node, when it exposes one */
  webhookPath: string | null
  /** path segment n8n serves the trigger under: webhook | form | webhook-test */
  webhookSegment: 'webhook' | 'form' | 'webhook-test' | null
  httpMethod: string
  /** credential types any node references — must exist in n8n before running */
  requiredCredentials: string[]
  /** true when AgentHub can start this workflow on demand over HTTP */
  runnableOnDemand: boolean
  /** short, secret-free explanation of what the user must do */
  note: string
}

/** AgentHub ⇄ n8n workflow link. One per imported template. */
export interface N8nWorkflowLink {
  /** AgentHub template id, e.g. n8n-10000 */
  templateId: string
  templateName: string
  /** id of the workflow created inside n8n */
  n8nWorkflowId: string
  importedAt: string
  /** n8n activation (publication) state as last observed */
  activated: boolean
  triggerKind: N8nTriggerKind
}

export type N8nExecutionState =
  | 'queued'
  | 'running'
  | 'success'
  | 'error'
  | 'canceled'
  | 'waiting'
  | 'blocked'
  | 'unknown'

/** Why a run did not reach n8n, when it did not. */
export type N8nBlockReason =
  | 'not_imported'
  | 'needs_activation'
  | 'needs_credentials'
  | 'manual_trigger'
  | 'scheduled_trigger'
  | 'event_trigger'
  | 'not_configured'
  | 'unreachable'

/** One AgentHub-side execution record. Mirrors n8n; it is not the source of truth. */
export interface N8nExecutionRecord {
  /** AgentHub record id */
  id: string
  templateId: string
  templateName: string
  n8nWorkflowId: string
  /** execution id reported by n8n, when one was produced */
  n8nExecutionId: string | null
  status: N8nExecutionState
  /** n8n execution mode: manual | webhook | trigger | retry | … */
  mode: string | null
  startedAt: string
  finishedAt: string | null
  /** AgentHub-measured wall-clock time of the HTTP call, ms */
  requestDurationMs: number | null
  /** duration reported by n8n, ms, when available */
  n8nDurationMs: number | null
  httpStatus: number | null
  /** secret-scrubbed failure summary */
  error: string | null
  /** secret-scrubbed, truncated output/response preview */
  resultPreview: string | null
  /** the concrete reason a run was blocked, when it was */
  blockedReason: N8nBlockReason | null
  /** what triggered this run */
  trigger: 'webhook' | 'form' | 'schedule' | 'event' | 'manual' | 'unknown'
}

/** Persisted AgentHub-side n8n state (db/n8n-state.json). */
export interface N8nStoreState {
  links: Record<string, N8nWorkflowLink>
  executions: N8nExecutionRecord[]
  updatedAt: string
}

/** Server-only stored connection settings (db/n8n-config.json). */
export interface StoredN8nConfig {
  baseUrl?: string
  apiKey?: string
  webhookBaseUrl?: string
  timeoutMs?: number
  updatedAt?: string
}
