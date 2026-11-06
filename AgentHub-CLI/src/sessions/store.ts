import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentConfig } from '../config/types.ts'
import type { RunStatus, ChangedFileEvidence, CommandEvidence } from '../core/events.ts'
import type { PlanStep } from '../core/plan.ts'
import type { AuditEntry, AuditApproval, AuditResult } from '../core/audit.ts'
import type { ChatMessage, ToolCall } from '../providers/types.ts'
import { ensureDir, writeAtomic } from '../utils/fsx.ts'
import { redactDeep, redactSecrets } from '../utils/redact.ts'

export interface SessionLedger {
  changedFiles: ChangedFileEvidence[]
  commands: CommandEvidence[]
  tests: CommandEvidence[]
}

export interface StoredSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  workspace: string
  provider: string
  model: string
  permissionMode: string
  messages: ChatMessage[]
  ledger: SessionLedger
  usage: { input: number | null; output: number | null }
  activeSkills: string[]
  /** Restored on resume; never replayed against the workspace. */
  plan: PlanStep[]
  audit: AuditEntry[]
  status: RunStatus
  turns: number
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: string
  workspace: string
  model: string
  turns: number
  messages: number
  status: RunStatus
}

const ID_RE = /^ses_[a-z0-9_]+$/
const MAX_MESSAGES = 240
const MAX_STORED_CONTENT = 8000
const MAX_SESSION_BYTES = 10 * 1024 * 1024
const ROLES = new Set(['system', 'user', 'assistant', 'tool'])
const STATUSES = new Set<RunStatus>(['running', 'completed', 'partial', 'failed', 'cancelled'])
const PLAN_STATUSES = new Set(['pending', 'active', 'completed', 'blocked', 'skipped', 'failed', 'cancelled'])
const AUDIT_DECISIONS = new Set(['allow', 'ask', 'deny'])
const AUDIT_APPROVALS = new Set<AuditApproval>(['not_required', 'pending', 'approved', 'denied', 'cancelled', 'failed'])
const AUDIT_RESULTS = new Set<AuditResult>(['started', 'succeeded', 'failed'])
const MAX_AUDIT_ENTRIES = 500
const MAX_AUDIT_FIELD = 500

function titleFromTask(task: string): string {
  const oneLine = task.replace(/\s+/g, ' ').trim()
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine || 'Untitled session'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && STATUSES.has(value as RunStatus)
}

function redactArguments(raw: string): string {
  // Keep tool-call arguments valid JSON: parse, redact values, re-serialise.
  // If the model emitted invalid JSON, retain the redacted text as-is so the
  // transcript still records the failure without inventing structure.
  try {
    return JSON.stringify(redactDeep(JSON.parse(raw)))
  } catch {
    return redactSecrets(raw)
  }
}

function sanitizeToolCall(raw: unknown): ToolCall | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  const fn = raw.function
  if (!isRecord(fn) || typeof fn.name !== 'string' || !fn.name || typeof fn.arguments !== 'string') return null
  return {
    id: raw.id,
    type: 'function',
    function: { name: fn.name, arguments: redactArguments(fn.arguments) },
  }
}

function sanitizeMessage(raw: unknown): ChatMessage | null {
  if (!isRecord(raw)) return null
  if (typeof raw.role !== 'string' || !ROLES.has(raw.role)) return null
  const content = raw.content
  if (content !== null && typeof content !== 'string') return null
  const message: ChatMessage = {
    role: raw.role as ChatMessage['role'],
    content,
  }
  if (raw.tool_calls !== undefined) {
    if (!Array.isArray(raw.tool_calls)) return null
    const calls: ToolCall[] = []
    for (const call of raw.tool_calls) {
      const sanitized = sanitizeToolCall(call)
      if (!sanitized) return null
      calls.push(sanitized)
    }
    message.tool_calls = calls
  }
  if (raw.tool_call_id !== undefined) {
    if (typeof raw.tool_call_id !== 'string') return null
    message.tool_call_id = raw.tool_call_id
  }
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') return null
    message.name = raw.name
  }
  return message
}

function trimForStorage(messages: ChatMessage[]): ChatMessage[] {
  const compact = messages.map((m) => {
    const out: ChatMessage = { ...m }
    if (typeof out.content === 'string' && out.content.length > MAX_STORED_CONTENT) {
      out.content = `${out.content.slice(0, MAX_STORED_CONTENT)}\n… [stored transcript truncated]`
    }
    if (typeof out.content === 'string') out.content = redactSecrets(out.content)
    if (out.tool_calls) {
      out.tool_calls = out.tool_calls.map((call) => ({
        ...call,
        function: { ...call.function, arguments: redactArguments(call.function.arguments) },
      }))
    }
    return out
  })
  if (compact.length <= MAX_MESSAGES) return compact
  const system = compact.find((m) => m.role === 'system')
  const tail = compact.slice(-(MAX_MESSAGES - 2))
  while (tail.length > 0 && tail[0]?.role === 'tool') tail.shift()
  const note: ChatMessage = {
    role: 'user',
    content: `[${compact.length - tail.length} older message(s) were removed from the stored transcript.]`,
  }
  return system ? [system, note, ...tail] : [note, ...tail]
}

function sanitizeChanged(raw: unknown): ChangedFileEvidence | null {
  if (!isRecord(raw)) return null
  if (typeof raw.path !== 'string' || !raw.path) return null
  if (raw.change !== 'created' && raw.change !== 'modified' && raw.change !== 'deleted') return null
  if (raw.backup !== undefined && typeof raw.backup !== 'string') return null
  return {
    path: raw.path,
    change: raw.change,
    ...(typeof raw.backup === 'string' ? { backup: raw.backup } : {}),
    ...(typeof raw.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(raw.expectedHash) ? { expectedHash: raw.expectedHash } : {}),
  }
}

function sanitizeCommand(raw: unknown): CommandEvidence | null {
  if (!isRecord(raw)) return null
  if (typeof raw.command !== 'string') return null
  if (raw.exitCode !== null && typeof raw.exitCode !== 'number') return null
  if (typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs)) return null
  if (typeof raw.timedOut !== 'boolean') return null
  return {
    command: raw.command,
    exitCode: raw.exitCode,
    durationMs: raw.durationMs,
    timedOut: raw.timedOut,
  }
}

function sanitizeCommands(raw: unknown): CommandEvidence[] {
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeCommand).filter((entry): entry is CommandEvidence => entry !== null)
}

function sanitizeLedger(raw: unknown): SessionLedger {
  if (!isRecord(raw)) return { changedFiles: [], commands: [], tests: [] }
  return {
    changedFiles: Array.isArray(raw.changedFiles)
      ? raw.changedFiles.map(sanitizeChanged).filter((entry): entry is ChangedFileEvidence => entry !== null)
      : [],
    commands: sanitizeCommands(raw.commands),
    tests: sanitizeCommands(raw.tests),
  }
}

function sanitizePlan(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw)) return []
  const out: PlanStep[] = []
  for (const step of raw) {
    if (!isRecord(step)) continue
    if (typeof step.title !== 'string' || !step.title.trim()) continue
    if (typeof step.status !== 'string' || !PLAN_STATUSES.has(step.status)) continue
    out.push({
      title: step.title,
      status: step.status as PlanStep['status'],
      ...(typeof step.note === 'string' ? { note: step.note } : {}),
      ...(Array.isArray(step.dependsOn) && step.dependsOn.every((n) => Number.isInteger(n) && n > 0 && n <= raw.length)
        ? { dependsOn: [...new Set(step.dependsOn as number[])] } : {}),
    })
    if (out.length >= 100) break
  }
  return out
}

function sanitizeAudit(raw: unknown): AuditEntry[] {
  if (!Array.isArray(raw)) return []
  const out: AuditEntry[] = []
  for (const item of raw.slice(-MAX_AUDIT_ENTRIES)) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || !item.id || typeof item.at !== 'string' || !item.at) continue
    if (typeof item.runId !== 'string' || !item.runId || typeof item.workspace !== 'string') continue
    if (typeof item.tool !== 'string' || !item.tool || typeof item.operation !== 'string' || !item.operation) continue
    const entry: AuditEntry = {
      id: redactText(item.id).slice(0, 120),
      at: item.at.slice(0, 64),
      runId: redactText(item.runId).slice(0, 120),
      workspace: redactText(item.workspace).slice(0, MAX_AUDIT_FIELD),
      tool: redactText(item.tool).slice(0, 80),
      operation: redactText(item.operation).slice(0, 80),
    }
    if (typeof item.decision === 'string' && AUDIT_DECISIONS.has(item.decision)) {
      entry.decision = item.decision as AuditEntry['decision']
    }
    if (typeof item.approval === 'string' && AUDIT_APPROVALS.has(item.approval as AuditApproval)) {
      entry.approval = item.approval as AuditApproval
    }
    if (typeof item.result === 'string' && AUDIT_RESULTS.has(item.result as AuditResult)) {
      entry.result = item.result as AuditResult
    }
    if (typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0) {
      entry.durationMs = Math.floor(item.durationMs)
    }
    if (typeof item.summary === 'string') entry.summary = redactText(item.summary).slice(0, 240)
    if (typeof item.failure === 'string') entry.failure = redactText(item.failure).slice(0, 400)
    out.push(entry)
  }
  return out
}

function sanitizeUsage(raw: unknown): { input: number | null; output: number | null } {
  if (!isRecord(raw)) return { input: 0, output: 0 }
  const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return { input: number(raw.input), output: number(raw.output) }
}

function redactText(value: string): string {
  return redactSecrets(value)
}

function parseMessages(raw: unknown, id: string): ChatMessage[] {
  if (!Array.isArray(raw)) throw new Error(`Session ${id} has no messages array.`)
  const messages: ChatMessage[] = []
  for (let i = 0; i < raw.length; i++) {
    const message = sanitizeMessage(raw[i])
    if (!message) throw new Error(`Session ${id} contains an invalid message at index ${i}.`)
    messages.push(message)
  }
  return messages
}

export class SessionStore {
  readonly dir: string

  constructor(config: AgentConfig) {
    this.dir = config.sessionsDir
  }

  private fileFor(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`Invalid session id: ${id}`)
    return path.join(this.dir, `${id}.json`)
  }

  newId(): string {
    return `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  create(opts: {
    task: string
    workspace: string
    provider: string
    model: string
    permissionMode: string
  }): StoredSession {
    const now = new Date().toISOString()
    return {
      id: this.newId(),
      title: titleFromTask(opts.task),
      createdAt: now,
      updatedAt: now,
      workspace: opts.workspace,
      provider: opts.provider,
      model: opts.model,
      permissionMode: opts.permissionMode,
      messages: [],
      ledger: { changedFiles: [], commands: [], tests: [] },
      usage: { input: 0, output: 0 },
      activeSkills: [],
      plan: [],
      audit: [],
      status: 'running',
      turns: 0,
    }
  }

  async save(session: StoredSession): Promise<void> {
    await ensureDir(this.dir)
    session.updatedAt = new Date().toISOString()
    // Build the persisted value from validated, redacted fields. Never write
    // provider credentials: they are runtime-only and are not part of a
    // StoredSession at all.
    const stored: StoredSession = {
      id: session.id,
      title: redactText(session.title).slice(0, 200),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      workspace: redactText(session.workspace),
      provider: redactText(session.provider),
      model: redactText(session.model),
      permissionMode: redactText(session.permissionMode),
      messages: trimForStorage(session.messages),
      ledger: redactDeep(sanitizeLedger(session.ledger)),
      usage: sanitizeUsage(session.usage),
      activeSkills: session.activeSkills.filter((name) => typeof name === 'string').map(redactText),
      plan: redactDeep(sanitizePlan(session.plan)),
      audit: sanitizeAudit(session.audit),
      status: isStatus(session.status) ? session.status : 'partial',
      turns: Number.isFinite(session.turns) ? Math.max(0, Math.floor(session.turns)) : 0,
    }
    await writeAtomic(this.fileFor(session.id), JSON.stringify(stored, null, 2), 0o600)
  }

  async load(id: string): Promise<StoredSession> {
    const file = this.fileFor(id)
    const stat = await fs.stat(file)
    if (stat.size > MAX_SESSION_BYTES) {
      throw new Error(`Session ${id} is larger than the 10 MB safety limit: ${file}`)
    }
    const raw = await fs.readFile(file, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(`Session ${id} is corrupt (${(err as Error).message}). The file was left untouched: ${file}`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Session ${id} is not a valid session file: ${file}`)
    }
    const obj = parsed as Record<string, unknown>
    if (typeof obj.id !== 'string' || !ID_RE.test(obj.id)) throw new Error(`Session ${id} has an invalid id.`)
    if (obj.id !== id) throw new Error(`Session ${id} contains a different id (${obj.id}); refusing to load it.`)
    const messages = parseMessages(obj.messages, id)
    return {
      id: obj.id,
      title: typeof obj.title === 'string' ? redactText(obj.title) : 'Untitled session',
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
      updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
      workspace: typeof obj.workspace === 'string' ? redactText(obj.workspace) : '',
      provider: typeof obj.provider === 'string' ? redactText(obj.provider) : '',
      model: typeof obj.model === 'string' ? redactText(obj.model) : '',
      permissionMode: typeof obj.permissionMode === 'string' ? redactText(obj.permissionMode) : 'ask',
      messages,
      ledger: redactDeep(sanitizeLedger(obj.ledger)),
      usage: sanitizeUsage(obj.usage),
      activeSkills: Array.isArray(obj.activeSkills)
        ? obj.activeSkills.filter((s): s is string => typeof s === 'string').map(redactText)
        : [],
      plan: redactDeep(sanitizePlan(obj.plan)),
      audit: sanitizeAudit(obj.audit),
      status: isStatus(obj.status) ? obj.status : 'completed',
      turns: typeof obj.turns === 'number' && Number.isFinite(obj.turns) ? Math.max(0, Math.floor(obj.turns)) : 0,
    }
  }

  async list(limit = 30): Promise<SessionSummary[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch {
      return []
    }
    const files = names.filter((n) => n.endsWith('.json') && ID_RE.test(n.slice(0, -5)))
    const summaries: SessionSummary[] = []
    for (const file of files) {
      try {
        const id = file.slice(0, -5)
        const raw = await fs.readFile(path.join(this.dir, file), 'utf8')
        const obj = JSON.parse(raw) as unknown
        if (!isRecord(obj) || obj.id !== id) continue
        const messages = parseMessages(obj.messages, id)
        summaries.push({
          id,
          title: typeof obj.title === 'string' ? redactText(obj.title) : 'Untitled session',
          updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : '',
          workspace: typeof obj.workspace === 'string' ? redactText(obj.workspace) : '',
          model: typeof obj.model === 'string' ? redactText(obj.model) : '',
          turns: typeof obj.turns === 'number' && Number.isFinite(obj.turns) ? Math.max(0, Math.floor(obj.turns)) : 0,
          messages: messages.length,
          status: isStatus(obj.status) ? obj.status : 'completed',
        })
      } catch {
        // A corrupt session must not make the list unusable. `load` reports the
        // specific error if the user asks for that id.
      }
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return summaries.slice(0, limit)
  }

  async latest(): Promise<StoredSession | null> {
    const summaries = await this.list(1)
    const first = summaries[0]
    if (!first) return null
    return this.load(first.id)
  }

  async remove(id: string): Promise<void> {
    await fs.rm(this.fileFor(id), { force: true })
  }
}
