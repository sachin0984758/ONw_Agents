// ─── Chat message typing + legacy-history normalization ──────────────────────
// Pure data + pure functions — safe to import from client AND server.
//
// The Chat persists a flat history of { role, content, time }. Some early
// entries were written by the agent-runner (Sessions) before transport
// isolation landed: internal orchestration prompts, raw ```tool blocks and
// tool results. Those must never render as ordinary conversation.
//
// normalizeHistory() reclassifies such entries WITHOUT mutating the stored
// file (a non-destructive compatibility strategy):
//   · internal orchestration / tool protocol → one compact `tool_activity` group
//   · a trailing `FINAL: <answer>`           → a normal assistant message
//   · everything else                        → a normal chat turn
// It also preserves already-typed entries, so new messages round-trip exactly.

export type ChatRole = 'user' | 'assistant'
export type ChatKind = 'chat' | 'tool_activity' | 'system_event' | 'error'
export type ChatActivityStatus = 'running' | 'completed' | 'failed'

export interface ChatActivityStep {
  /** Short, user-facing label (never a raw system prompt). */
  label: string
  status: ChatActivityStatus
  /** Safe, sanitized detail — never secrets or full internal instructions. */
  detail?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  time: string
  kind: ChatKind
  /** Present only for kind === 'tool_activity'. */
  activity?: ChatActivityStep[]
}

export interface RawHistoryEntry {
  id?: unknown
  role?: unknown
  content?: unknown
  time?: unknown
  kind?: unknown
  activity?: unknown
}

const MAX_DETAIL = 140

const TOOL_NAMES = [
  'call_llm',
  'plan',
  'read_file',
  'write_file',
  'edit_file',
  'delete_file',
  'list_files',
  'search_files',
  'find_files',
  'run_command',
  'syntax_check',
  'task',
  'get_project_structure',
]

/** Stable id for a new message (server or client). */
export function newMessageId(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined
    if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  } catch {
    /* fall through */
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function sanitizeDetail(s: string): string {
  const line = (s || '').replace(/\s+/g, ' ').trim()
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL)}…` : line
}

/** Names of tools proposed in ```tool fenced blocks ('' when malformed/empty). */
function toolBlockNames(content: string): string[] {
  const names: string[] = []
  const re = /```tool\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const raw = (m[1] ?? '').trim()
    if (!raw) {
      names.push('')
      continue
    }
    try {
      const j = JSON.parse(raw) as { name?: unknown }
      names.push(typeof j?.name === 'string' ? j.name : '')
    } catch {
      names.push('')
    }
  }
  return names
}

function isInternalPrompt(c: string): boolean {
  return (
    /You are the Project Manager of an agent team/i.test(c) ||
    /Proposed call:\s/i.test(c) ||
    /Reply with exactly ONE fenced block/i.test(c) ||
    /Harness-held checklist/i.test(c)
  )
}

function isSynthesisRequest(c: string): boolean {
  return (
    /Verified step results from the team:/i.test(c) ||
    /write a concise final report of what the team actually accomplished/i.test(c)
  )
}

function isToolResult(c: string): boolean {
  return /(?:^|\n)\s*Result of [a-z_]+:/i.test(c)
}

function isToolError(c: string): boolean {
  const tool = TOOL_NAMES.join('|')
  return (
    /invalid arguments for [a-z_]+/i.test(c) ||
    /unknown tool "/i.test(c) ||
    /is outside your allow-list/i.test(c) ||
    new RegExp(`(?:^|\\n)\\s*(?:${tool}) failed:`, 'i').test(c)
  )
}

function extractFinal(c: string): string | null {
  const m = /(?:^|\n)\s*FINAL:\s*([\s\S]*)$/.exec(c)
  const t = m ? m[1].trim() : ''
  return t || null
}

const KNOWN_KINDS: ChatKind[] = ['chat', 'tool_activity', 'system_event', 'error']

/**
 * Convert a stored history array into typed, render-ready messages.
 * Deterministic and side-effect free; safe to run on every read.
 */
export function normalizeHistory(raw: unknown): ChatMessage[] {
  const out: ChatMessage[] = []
  if (!Array.isArray(raw)) return out

  let inRunner = false
  let seq = 0
  let pending: ChatActivityStep[] = []
  let pendingTime = ''

  const pushStep = (step: ChatActivityStep, time: string) => {
    if (pending.length === 0) pendingTime = time
    pending.push(step)
  }
  const flush = () => {
    if (!pending.length) return
    out.push({
      id: `activity-${seq++}`,
      role: 'assistant',
      content: '',
      time: pendingTime,
      kind: 'tool_activity',
      activity: pending,
    })
    pending = []
    pendingTime = ''
  }
  const emitChat = (role: ChatRole, content: string, time: string, id?: string) => {
    flush()
    out.push({ id: id || `msg-${seq++}`, role, content, time, kind: 'chat' })
  }

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as RawHistoryEntry
    const role: ChatRole = e.role === 'assistant' ? 'assistant' : 'user'
    const content = typeof e.content === 'string' ? e.content : ''
    const time = typeof e.time === 'string' ? e.time : ''
    const id = typeof e.id === 'string' ? e.id : undefined

    // Already-typed entries are preserved verbatim.
    const kind = KNOWN_KINDS.includes(e.kind as ChatKind) ? (e.kind as ChatKind) : null
    if (kind === 'tool_activity') {
      const steps = Array.isArray(e.activity)
        ? (e.activity as ChatActivityStep[]).filter((s) => s && typeof s.label === 'string')
        : []
      if (steps.length) steps.forEach((s) => pushStep(s, time))
      continue
    }
    if (kind === 'system_event' || kind === 'error') {
      flush()
      out.push({ id: id || `msg-${seq++}`, role, content, time, kind })
      continue
    }
    if (kind === 'chat') {
      emitChat(role, content, time, id)
      continue
    }

    // ── Classify a legacy (untyped) entry ──
    if (role === 'assistant') {
      const fin = extractFinal(content)
      if (fin) {
        inRunner = false
        emitChat('assistant', fin, time, id)
        continue
      }
      const names = toolBlockNames(content)
      if (names.length) {
        for (const n of names) {
          pushStep(
            n
              ? { label: `Tool call: ${n}`, status: 'completed' }
              : { label: 'Tool call (malformed)', status: 'failed', detail: 'empty or unparseable tool block' },
            time,
          )
        }
        continue
      }
      if (inRunner) {
        pushStep({ label: 'Agent reply', status: 'completed' }, time)
        continue
      }
      emitChat('assistant', content, time, id)
      continue
    }

    // user
    // Tool evidence is checked FIRST: real runner messages combine the internal
    // prompt with "Result of <tool>:" / "Error: ..."; classifying them as tool
    // evidence keeps the useful signal and drops the internal instruction text.
    if (isToolError(content)) {
      pushStep(
        { label: 'Tool error reported', status: 'failed', detail: sanitizeDetail(content.replace(/^[\s\S]*?(?:Error:|[a-z_]+ failed:)/i, '')) },
        time,
      )
      continue
    }
    if (isToolResult(content)) {
      pushStep({ label: 'Tool result returned', status: 'completed' }, time)
      continue
    }
    if (isInternalPrompt(content)) {
      inRunner = true
      pushStep({ label: 'Agent orchestration prompt', status: 'completed' }, time)
      continue
    }
    if (isSynthesisRequest(content)) {
      inRunner = true
      pushStep({ label: 'Final synthesis request', status: 'completed' }, time)
      continue
    }
    if (inRunner) {
      pushStep({ label: 'Delegated prompt', status: 'completed', detail: sanitizeDetail(content) }, time)
      continue
    }
    emitChat('user', content, time, id)
  }

  flush()
  return out
}

/** True for messages the Chat should present (excludes internal events). */
export function isVisibleMessage(m: ChatMessage): boolean {
  return m.kind === 'chat' || m.kind === 'tool_activity' || m.kind === 'error'
}
