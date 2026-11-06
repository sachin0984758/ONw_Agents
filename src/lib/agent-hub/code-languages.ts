// Language registry for Chat code blocks.
//
// Maps the language identifiers that appear in Markdown fences to a Prism /
// refractor language id (registered by `code-block.tsx`) plus a human-readable
// label for the code-block header. Kept dependency-free so it is safe to import
// from anywhere (client or server).

export interface CodeLanguageSpec {
  /** Prism/refractor language id that is registered with the highlighter. */
  id: string
  /** Human-readable label shown in the code-block header. */
  label: string
  /** Fence identifiers / aliases that resolve to this language. */
  aliases: string[]
}

export const CODE_LANGUAGES: CodeLanguageSpec[] = [
  { id: 'markup', label: 'HTML', aliases: ['html', 'htm', 'xml', 'svg', 'markup'] },
  { id: 'css', label: 'CSS', aliases: ['css', 'scss', 'sass', 'less'] },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'javascript', 'mjs', 'cjs', 'node'] },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'typescript'] },
  { id: 'jsx', label: 'JSX', aliases: ['jsx'] },
  { id: 'tsx', label: 'TSX', aliases: ['tsx'] },
  { id: 'python', label: 'Python', aliases: ['py', 'python', 'python3'] },
  { id: 'sql', label: 'SQL', aliases: ['sql', 'postgres', 'postgresql', 'mysql', 'sqlite'] },
  { id: 'bash', label: 'Bash', aliases: ['sh', 'bash', 'shell', 'zsh', 'console', 'shell-session'] },
  { id: 'c', label: 'C', aliases: ['c'] },
  { id: 'cpp', label: 'C++', aliases: ['cpp', 'c++', 'cc', 'cxx', 'hpp'] },
  { id: 'java', label: 'Java', aliases: ['java'] },
  { id: 'json', label: 'JSON', aliases: ['json', 'jsonc'] },
  { id: 'yaml', label: 'YAML', aliases: ['yaml', 'yml'] },
  { id: 'markdown', label: 'Markdown', aliases: ['md', 'markdown'] },
  { id: 'powershell', label: 'PowerShell', aliases: ['powershell', 'ps1', 'ps'] },
]

const ALIAS_TO_SPEC = new Map<string, CodeLanguageSpec>()
for (const spec of CODE_LANGUAGES) {
  for (const alias of spec.aliases) ALIAS_TO_SPEC.set(alias, spec)
}

/**
 * Normalise a Markdown fence language to a registered Prism id.
 * Returns `null` for empty or unsupported languages (rendered as plain text —
 * the highlighter never throws on an unknown id).
 */
export function resolveCodeLanguage(language: string): string | null {
  const key = (language ?? '').trim().toLowerCase()
  if (!key) return null
  return ALIAS_TO_SPEC.get(key)?.id ?? null
}

/** Human-readable header label. Falls back to the raw identifier. */
export function codeLanguageLabel(language: string): string {
  const key = (language ?? '').trim().toLowerCase()
  if (!key) return 'Code'
  return ALIAS_TO_SPEC.get(key)?.label ?? key
}
