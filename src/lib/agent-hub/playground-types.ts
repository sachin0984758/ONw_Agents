// ── Playground practice types ────────────────────────────────────────────────
// Shared by the client UI and the server API route. Dependency-free so it is
// safe to import from anywhere. Code and formulas are NEVER executed by this
// feature — these types only carry practice content between the editor, the
// grid, the session store and the analysis prompt builder.

export type PlaygroundMode = 'code' | 'sql' | 'markup' | 'excel'

export type PracticeLevel = 'beginner' | 'intermediate' | 'advanced'

export const PRACTICE_LEVELS: PracticeLevel[] = ['beginner', 'intermediate', 'advanced']

/**
 * A spreadsheet sheet holds RAW cell text. Formulas stay as the literal text
 * the user typed (e.g. "=SUM(B2:B6)") — the playground has no calculation
 * engine and never fabricates computed values.
 */
export interface ExcelSheet {
  name: string
  columns: number
  rows: number
  /** Address ("A1") → raw text. Sparse; missing addresses are empty. */
  cells: Record<string, string>
}

export interface FeedbackEntry {
  id: string
  actionId: string
  actionLabel: string
  at: string
  status: 'ok' | 'error'
  /** Markdown for ok entries, plain error text otherwise. */
  text: string
  /** Which model actually answered (human-readable target label), when known. */
  model?: string
  /** True for predictions (output / result estimates) — never a verified run. */
  estimated?: boolean
  /** Extracted suggestion the user may explicitly apply (never auto-applied). */
  suggestion?: string
  suggestionKind?: 'code' | 'formula'
  applied?: boolean
}

export interface PracticeSession {
  id: string
  name: string
  mode: PlaygroundMode
  languageId: string
  level: PracticeLevel
  problemStatement: string
  code: string
  sheet: ExcelSheet | null
  /** Selected local model id ('' = automatic). */
  modelPreference: string
  /** Deterministic starter this practice began from (used by Reset). */
  starterId: string
  starterCode: string
  starterSheet: ExcelSheet | null
  feedback: FeedbackEntry[]
  /** Optional saved local-roadmap lesson and mastery state. Older sessions omit it. */
  roadmapProgress?: RoadmapProgress
  createdAt: string
  updatedAt: string
}

export interface RoadmapProgress {
  selectedSlug: string
  conversationSlug: string
  currentTopicId: string
  currentTopicLabel: string
  /** Explicitly completed topics grouped by the local roadmap graph slug. */
  completedTopics: Record<string, string[]>
  conversation: Array<{ role: 'assistant' | 'user'; content: string }>
}

export interface PlaygroundModelOption {
  id: string
  label: string
  provider: string
  loaded: boolean
  chatCompatible: boolean
  kind: 'local' | 'custom'
}

// ── Bounds shared by client and server ───────────────────────────────────────
export const PLAYGROUND_MAX_SESSIONS = 100
export const PLAYGROUND_MAX_CODE_CHARS = 200_000
export const PLAYGROUND_MAX_FEEDBACK = 20
export const PLAYGROUND_MAX_FEEDBACK_CHARS = 20_000
export const PLAYGROUND_MAX_ANALYZE_CHARS = 24_000
export const PLAYGROUND_MAX_SHEET_CELLS = 600
export const PLAYGROUND_MAX_NAME_CHARS = 80

/**
 * Non-execution labels — the single source of truth for the UI copy. The
 * playground analyses code/formulas with a local model and never runs them.
 */
export const ANALYSIS_LABELS: Record<PlaygroundMode, string> = {
  code: 'AI analysis only — code is not executed.',
  sql: 'Queries are analyzed but not executed. Results shown by AI are estimates.',
  markup: 'AI analysis only — markup and styles are not rendered or executed.',
  excel:
    'Formula analysis only — recalculation is not performed unless a verified calculation engine is explicitly integrated.',
}
