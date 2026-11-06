export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}
export interface ToolSpec {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}
export interface SessionChange { path: string; before: string | null; after: string; truncated?: boolean }
export interface SessionQuestion {
  stage: 'requirements' | 'design' | 'plan'
  prompt: string
  details?: string
  options: string[]
}
export interface SessionItem {
  id: string
  kind: 'assistant' | 'tool' | 'notice' | 'question'
  question?: SessionQuestion
  text: string
  name?: string
  args?: Record<string, unknown>
  status?: 'running' | 'completed' | 'failed' | 'waiting'
  output?: string
}
export interface SessionTurn {
  id: string
  request: string
  startedAt: string
  endedAt?: string
  status: 'running' | 'completed' | 'partial' | 'cancelled' | 'failed'
  agent?: { id: string; name: string }
  items: SessionItem[]
  changes: SessionChange[]
  tokens?: number
}
export interface CodingConversation {
  version: 2
  id: string
  /** The regular Chat thread this coding session belongs to, when launched from Chat. */
  chatId?: string
  /** Prevent custom/remote provider fallback for Chat coding-agent sessions. */
  localOnly?: boolean
  title: string
  workspace: string
  /** Server-registered, explicitly selected project root. Omitted for legacy sessions. */
  workspaceId?: string
  /** Display label only; file access is resolved from workspaceId. */
  workspaceLabel?: string
  /** UI snapshot only; effective authorization lives in the separate permission store. */
  workspaceAccess?: 'none' | 'read' | 'write'
  deletedAt?: string
  mode: 'ro' | 'edit'
  model: string
  effort: 'off' | 'low' | 'medium' | 'high'
  createdAt: string
  updatedAt: string
  turns: SessionTurn[]
  messages: ModelMessage[]
}
export type SessionSummary = Omit<CodingConversation, 'turns' | 'messages'> & { turnCount: number }
export interface Approval { id: string; name: string; args: Record<string, unknown> }
export type SessionEvent =
  | { type: 'turn'; turn: SessionTurn }
  | { type: 'delta'; turnId: string; itemId: string; text: string }
  | { type: 'approval'; approval: Approval | null }
  | { type: 'paused'; paused: boolean }
  | { type: 'done' }
export interface ToolOutcome { ok: boolean; output: string; change?: SessionChange; question?: SessionQuestion }
export interface ModelReply { content: string; calls: ToolCall[]; truncated?: boolean; tokens?: number }
