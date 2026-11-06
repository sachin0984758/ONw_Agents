// ── Playground practice-session store ────────────────────────────────────────
// Sessions live in their own file (<db>/playground.json) so the feature can
// never collide with chat history, agent sessions or any other dashboard
// state. Writes are atomic and serialized (writeJsonAtomic +
// createSerializer); the file is validated field-by-field on read, and an
// unreadable file is quarantined next to the original instead of crashing
// the view.

import { promises as fs } from 'fs'
import path from 'path'
import { resolveDbDir } from './db-path'
import { createSerializer, writeJsonAtomic } from './fs-atomic'
import {
  PLAYGROUND_MAX_CODE_CHARS,
  PLAYGROUND_MAX_FEEDBACK,
  PLAYGROUND_MAX_FEEDBACK_CHARS,
  PLAYGROUND_MAX_NAME_CHARS,
  PLAYGROUND_MAX_SESSIONS,
  PLAYGROUND_MAX_SHEET_CELLS,
  PRACTICE_LEVELS,
} from './playground-types'
import type { ExcelSheet, FeedbackEntry, PracticeLevel, PracticeSession } from './playground-types'
import { PLAYGROUND_LANGUAGES, playgroundLanguage } from './playground-languages'

export const PLAYGROUND_FILE_NAME = 'playground.json'

/** Absolute path of the store file (resolved lazily so AGENT_HUB_DB_DIR
 *  overrides — used by the isolated test suites — are always honoured). */
export function playgroundStorePath(): string {
  return path.join(resolveDbDir(), PLAYGROUND_FILE_NAME)
}

interface PlaygroundStoreFile {
  version: 1
  updatedAt: string
  sessions: PracticeSession[]
}

function emptyStore(): PlaygroundStoreFile {
  return { version: 1, updatedAt: new Date().toISOString(), sessions: [] }
}

const serialize = createSerializer()

const LANGUAGE_IDS = new Set(PLAYGROUND_LANGUAGES.map((l) => l.id))
const ADDRESS_RE = /^[A-Z]{1,2}[1-9][0-9]{0,2}$/
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/
const ROADMAP_SLUG_RE = /^[a-z0-9-]{1,100}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T/

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function sanitizeSheet(input: unknown): ExcelSheet | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const columns = Math.max(1, Math.min(26, Number.isFinite(Number(raw.columns)) ? Math.floor(Number(raw.columns)) : 12))
  const rows = Math.max(1, Math.min(200, Number.isFinite(Number(raw.rows)) ? Math.floor(Number(raw.rows)) : 30))
  const cellsIn = raw.cells && typeof raw.cells === 'object' ? (raw.cells as Record<string, unknown>) : {}
  const cells: Record<string, string> = {}
  let count = 0
  for (const [addr, value] of Object.entries(cellsIn)) {
    if (count >= PLAYGROUND_MAX_SHEET_CELLS) break
    if (!ADDRESS_RE.test(addr)) continue
    if (typeof value !== 'string' || value === '') continue
    cells[addr] = value.slice(0, 2000)
    count++
  }
  return {
    name: cleanString(raw.name, 60).trim() || 'Sheet',
    columns,
    rows,
    cells,
  }
}

function sanitizeFeedback(input: unknown): FeedbackEntry[] {
  if (!Array.isArray(input)) return []
  const out: FeedbackEntry[] = []
  for (const item of input.slice(0, PLAYGROUND_MAX_FEEDBACK)) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = cleanString(raw.id, 64)
    if (!id) continue
    const status = raw.status === 'error' ? 'error' : 'ok'
    const suggestionKind = raw.suggestionKind === 'formula' ? 'formula' : raw.suggestionKind === 'code' ? 'code' : undefined
    out.push({
      id,
      actionId: cleanString(raw.actionId, 40),
      actionLabel: cleanString(raw.actionLabel, 60),
      at: cleanString(raw.at, 40),
      status,
      text: cleanString(raw.text, PLAYGROUND_MAX_FEEDBACK_CHARS),
      model: cleanString(raw.model, 200) || undefined,
      estimated: raw.estimated === true,
      suggestion: cleanString(raw.suggestion, PLAYGROUND_MAX_FEEDBACK_CHARS) || undefined,
      suggestionKind,
      applied: raw.applied === true,
    })
  }
  return out
}

function sanitizeRoadmapProgress(input: unknown): PracticeSession['roadmapProgress'] {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  const cleanSlug = (value: unknown) => {
    const slug = cleanString(value, 100)
    return ROADMAP_SLUG_RE.test(slug) ? slug : ''
  }
  const completedTopics: Record<string, string[]> = {}
  if (raw.completedTopics && typeof raw.completedTopics === 'object' && !Array.isArray(raw.completedTopics)) {
    for (const [slugIn, idsIn] of Object.entries(raw.completedTopics as Record<string, unknown>).slice(0, 25)) {
      const slug = cleanSlug(slugIn)
      if (!slug || !Array.isArray(idsIn)) continue
      const ids = [...new Set(idsIn.flatMap((id) => {
        const clean = cleanString(id, 120)
        return /^[A-Za-z0-9_-]{1,120}$/.test(clean) ? [clean] : []
      }))].slice(0, 500)
      if (ids.length) completedTopics[slug] = ids
    }
  }
  const conversation = Array.isArray(raw.conversation)
    ? raw.conversation.slice(-40).flatMap((turn) => {
        if (!turn || typeof turn !== 'object') return []
        const item = turn as Record<string, unknown>
        if (item.role !== 'assistant' && item.role !== 'user') return []
        const content = cleanString(item.content, 4000)
        return content ? [{ role: item.role, content } as const] : []
      })
    : []
  const selectedSlug = cleanSlug(raw.selectedSlug)
  const conversationSlug = cleanSlug(raw.conversationSlug)
  const currentTopicId = cleanString(raw.currentTopicId, 120)
  const currentTopicLabel = cleanString(raw.currentTopicLabel, 200)
  if (!selectedSlug && !conversationSlug && !currentTopicId && !conversation.length && !Object.keys(completedTopics).length) return undefined
  return { selectedSlug, conversationSlug, currentTopicId, currentTopicLabel, completedTopics, conversation }
}

/**
 * Validate + clamp a session payload. `mode` is always derived from the
 * language registry so the stored record can never contradict itself.
 */
export function sanitizeSession(input: unknown, opts: { touch: boolean }): PracticeSession | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = cleanString(raw.id, 64)
  if (!ID_RE.test(id)) return null
  const requestedLanguage = cleanString(raw.languageId, 40)
  const languageId = LANGUAGE_IDS.has(requestedLanguage) ? requestedLanguage : 'python'
  const levelIn = cleanString(raw.level, 20)
  const level: PracticeLevel = (PRACTICE_LEVELS as string[]).includes(levelIn) ? (levelIn as PracticeLevel) : 'beginner'
  const now = new Date().toISOString()
  const createdAt = cleanString(raw.createdAt, 40)
  const updatedAt = cleanString(raw.updatedAt, 40)
  return {
    id,
    name: cleanString(raw.name, PLAYGROUND_MAX_NAME_CHARS).trim() || 'Untitled practice',
    mode: playgroundLanguage(languageId).mode,
    languageId,
    level,
    problemStatement: cleanString(raw.problemStatement, 4000),
    code: cleanString(raw.code, PLAYGROUND_MAX_CODE_CHARS),
    sheet: sanitizeSheet(raw.sheet),
    modelPreference: cleanString(raw.modelPreference, 120),
    starterId: cleanString(raw.starterId, 80),
    starterCode: cleanString(raw.starterCode, PLAYGROUND_MAX_CODE_CHARS),
    starterSheet: sanitizeSheet(raw.starterSheet),
    feedback: sanitizeFeedback(raw.feedback),
    roadmapProgress: sanitizeRoadmapProgress(raw.roadmapProgress),
    createdAt: ISO_RE.test(createdAt) ? createdAt : now,
    updatedAt: opts.touch ? now : ISO_RE.test(updatedAt) ? updatedAt : now,
  }
}

async function readStore(): Promise<{ store: PlaygroundStoreFile; warning?: string }> {
  const file = playgroundStorePath()
  try {
    const raw = await fs.readFile(file, 'utf-8')
    const parsed = JSON.parse(raw) as { updatedAt?: unknown; sessions?: unknown }
    const sessions = Array.isArray(parsed?.sessions)
      ? parsed.sessions
          .map((s) => sanitizeSession(s, { touch: false }))
          .filter((s): s is PracticeSession => s !== null)
      : []
    return {
      store: {
        version: 1,
        updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        sessions,
      },
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { store: emptyStore() }
    // Unreadable/corrupt: quarantine the file and start clean rather than
    // breaking the Playground. The corrupt copy is kept for inspection.
    try {
      await fs.rename(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* best effort */
    }
    return {
      store: emptyStore(),
      warning: 'The playground store was unreadable and has been reset (the corrupt copy was kept).',
    }
  }
}

async function writeStore(store: PlaygroundStoreFile): Promise<void> {
  store.updatedAt = new Date().toISOString()
  await writeJsonAtomic(playgroundStorePath(), store)
}

export async function listSessions(): Promise<{ sessions: PracticeSession[]; warning?: string }> {
  const { store, warning } = await readStore()
  const sessions = [...store.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { sessions, warning }
}

export async function saveSession(
  input: unknown,
): Promise<{ ok: true; session: PracticeSession; warning?: string } | { ok: false; error: string }> {
  const incoming = sanitizeSession(input, { touch: true })
  if (!incoming) return { ok: false, error: 'The practice session payload is invalid.' }
  return serialize(async () => {
    const { store, warning } = await readStore()
    const existing = store.sessions.find((s) => s.id === incoming.id)
    const session: PracticeSession = { ...incoming, createdAt: existing?.createdAt ?? incoming.createdAt }
    const sessions = [session, ...store.sessions.filter((s) => s.id !== session.id)]
    if (sessions.length > PLAYGROUND_MAX_SESSIONS) {
      sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      sessions.length = PLAYGROUND_MAX_SESSIONS
    }
    await writeStore({ version: 1, updatedAt: store.updatedAt, sessions })
    return warning ? { ok: true as const, session, warning } : { ok: true as const, session }
  })
}

export async function deleteSession(id: string): Promise<{ ok: true; deleted: boolean }> {
  return serialize(async () => {
    const { store } = await readStore()
    const exists = store.sessions.some((s) => s.id === id)
    if (exists) {
      await writeStore({ ...store, sessions: store.sessions.filter((s) => s.id !== id) })
    }
    return { ok: true as const, deleted: exists }
  })
}

export async function renameSession(
  id: string,
  name: string,
): Promise<{ ok: true; session: PracticeSession } | { ok: false; error: string }> {
  const cleanName = cleanString(name, PLAYGROUND_MAX_NAME_CHARS).trim()
  if (!cleanName) return { ok: false, error: 'A session name is required.' }
  return serialize(async () => {
    const { store } = await readStore()
    const existing = store.sessions.find((s) => s.id === id)
    if (!existing) return { ok: false as const, error: 'Practice session not found.' }
    const session: PracticeSession = { ...existing, name: cleanName, updatedAt: new Date().toISOString() }
    await writeStore({ ...store, sessions: store.sessions.map((s) => (s.id === id ? session : s)) })
    return { ok: true as const, session }
  })
}
