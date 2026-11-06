// ── Playground language + action registry ────────────────────────────────────
// Deterministic, dependency-free data shared by the UI and the server prompt
// builder. `cm` selects the CodeMirror language extension in the editor
// (see components/agent-hub/playground/code-editor-langs.ts); `formatter` is
// false everywhere because the project ships no verified local formatters —
// the UI must not show a Format action that cannot really work.

import type { PlaygroundMode } from './playground-types'

export type PlaygroundLanguageGroup = 'Programming' | 'Web' | 'Data' | 'Shell' | 'Spreadsheet'

export interface PlaygroundLanguageSpec {
  id: string
  label: string
  mode: PlaygroundMode
  group: PlaygroundLanguageGroup
  /** CodeMirror loader key (see playground/code-editor-langs.ts). */
  cm: string
  /** Markdown fence id used in prompts and suggestions. */
  fence: string
  /** Display-only sample file extension (no files are written). */
  ext: string
  /** True only when a verified local formatter is integrated (none are). */
  formatter: boolean
}

export const PLAYGROUND_LANGUAGES: PlaygroundLanguageSpec[] = [
  { id: 'python', label: 'Python', mode: 'code', group: 'Programming', cm: 'python', fence: 'python', ext: '.py', formatter: false },
  { id: 'c', label: 'C', mode: 'code', group: 'Programming', cm: 'c', fence: 'c', ext: '.c', formatter: false },
  { id: 'cpp', label: 'C++', mode: 'code', group: 'Programming', cm: 'cpp', fence: 'cpp', ext: '.cpp', formatter: false },
  { id: 'java', label: 'Java', mode: 'code', group: 'Programming', cm: 'java', fence: 'java', ext: '.java', formatter: false },
  { id: 'csharp', label: 'C#', mode: 'code', group: 'Programming', cm: 'csharp', fence: 'csharp', ext: '.cs', formatter: false },
  { id: 'go', label: 'Go', mode: 'code', group: 'Programming', cm: 'go', fence: 'go', ext: '.go', formatter: false },
  { id: 'rust', label: 'Rust', mode: 'code', group: 'Programming', cm: 'rust', fence: 'rust', ext: '.rs', formatter: false },
  { id: 'php', label: 'PHP', mode: 'code', group: 'Programming', cm: 'php', fence: 'php', ext: '.php', formatter: false },
  { id: 'javascript', label: 'JavaScript', mode: 'code', group: 'Web', cm: 'javascript', fence: 'javascript', ext: '.js', formatter: false },
  { id: 'typescript', label: 'TypeScript', mode: 'code', group: 'Web', cm: 'typescript', fence: 'typescript', ext: '.ts', formatter: false },
  { id: 'html', label: 'HTML', mode: 'markup', group: 'Web', cm: 'html', fence: 'html', ext: '.html', formatter: false },
  { id: 'css', label: 'CSS', mode: 'markup', group: 'Web', cm: 'css', fence: 'css', ext: '.css', formatter: false },
  { id: 'sql', label: 'SQL', mode: 'sql', group: 'Data', cm: 'sql', fence: 'sql', ext: '.sql', formatter: false },
  { id: 'json', label: 'JSON', mode: 'code', group: 'Data', cm: 'json', fence: 'json', ext: '.json', formatter: false },
  { id: 'yaml', label: 'YAML', mode: 'code', group: 'Data', cm: 'yaml', fence: 'yaml', ext: '.yml', formatter: false },
  { id: 'bash', label: 'Bash', mode: 'code', group: 'Shell', cm: 'bash', fence: 'bash', ext: '.sh', formatter: false },
  { id: 'powershell', label: 'PowerShell', mode: 'code', group: 'Shell', cm: 'powershell', fence: 'powershell', ext: '.ps1', formatter: false },
  { id: 'excel-formulas', label: 'Excel formulas', mode: 'excel', group: 'Spreadsheet', cm: 'grid', fence: 'excel', ext: 'practice grid', formatter: false },
]

export const SQL_DIALECTS = [
  { id: 'postgresql', label: 'PostgreSQL' },
  { id: 'mysql', label: 'MySQL' },
  { id: 'sqlite', label: 'SQLite' },
  { id: 'mssql', label: 'SQL Server' },
] as const
export type SqlDialectId = (typeof SQL_DIALECTS)[number]['id']

export interface PlaygroundActionSpec {
  id: string
  label: string
  /** Short description used for titles/tooltips. */
  hint: string
  modes: PlaygroundMode[]
  /** True when the response may include a code/formula suggestion to apply. */
  suggests?: boolean
  /** True when the response is an AI estimate (output / result prediction). */
  estimated?: boolean
}

export const PLAYGROUND_ACTIONS: PlaygroundActionSpec[] = [
  { id: 'explain', label: 'Explain', hint: 'Explain what this code does', modes: ['code', 'markup', 'sql'] },
  { id: 'review', label: 'Review', hint: 'Review structure, readability and possible mistakes', modes: ['code', 'markup', 'sql'] },
  { id: 'find-bugs', label: 'Find bugs', hint: 'Identify likely logical and structural defects', modes: ['code', 'markup', 'sql'] },
  { id: 'hint', label: 'Hint', hint: 'Get a nudge without revealing the full solution', modes: ['code', 'markup', 'sql', 'excel'] },
  { id: 'improve', label: 'Improve', hint: 'Suggest an improved version', modes: ['code', 'markup'], suggests: true },
  { id: 'predict-output', label: 'Predict output', hint: 'Estimate what a real run would print — not executed', modes: ['code'], estimated: true },
  { id: 'roadmap', label: 'Roadmap', hint: 'Build a step-by-step learning roadmap for this practice', modes: ['code', 'markup', 'sql', 'excel'] },
  { id: 'predict-result', label: 'Predict result', hint: 'Estimate the result set — queries are not executed', modes: ['sql'], estimated: true },
  { id: 'explain-formula', label: 'Explain formula', hint: 'Explain the selected cell formula', modes: ['excel'] },
  { id: 'find-errors', label: 'Find errors', hint: 'Look for likely formula errors', modes: ['excel'] },
  { id: 'suggest-correction', label: 'Suggest correction', hint: 'Propose a corrected formula', modes: ['excel'], suggests: true },
  { id: 'explain-dataset', label: 'Explain dataset', hint: 'Explain the sheet contents', modes: ['excel'] },
  { id: 'generate-questions', label: 'Practice questions', hint: 'Generate practice questions about this sheet', modes: ['excel'] },
]

const LANGUAGE_BY_ID = new Map(PLAYGROUND_LANGUAGES.map((l) => [l.id, l]))
const ACTION_BY_ID = new Map(PLAYGROUND_ACTIONS.map((a) => [a.id, a]))

export function playgroundLanguage(id: string): PlaygroundLanguageSpec {
  return LANGUAGE_BY_ID.get(id) ?? PLAYGROUND_LANGUAGES[0]
}

export function languagesByGroup(): Array<{ group: PlaygroundLanguageGroup; languages: PlaygroundLanguageSpec[] }> {
  const groups: PlaygroundLanguageGroup[] = ['Programming', 'Web', 'Data', 'Shell', 'Spreadsheet']
  return groups
    .map((group) => ({ group, languages: PLAYGROUND_LANGUAGES.filter((l) => l.group === group) }))
    .filter((g) => g.languages.length > 0)
}

export function actionsForMode(mode: PlaygroundMode): PlaygroundActionSpec[] {
  return PLAYGROUND_ACTIONS.filter((a) => a.modes.includes(mode))
}

export function playgroundAction(id: string): PlaygroundActionSpec | undefined {
  return ACTION_BY_ID.get(id)
}

export function isSqlDialect(id: string): id is SqlDialectId {
  return SQL_DIALECTS.some((d) => d.id === id)
}
