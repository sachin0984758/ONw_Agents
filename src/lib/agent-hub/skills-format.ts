// ── Agent Skills format: SKILL.md parsing + validation ──────────────────────
// Pure, dependency-free implementation of the Agent Skills specification
// (https://agentskills.io/specification): YAML frontmatter (a deliberate,
// well-tested subset — scalars, quoted strings, one nesting level, block
// scalars, flow lists) plus the validation rules for `name` / `description` /
// optional fields. Imported by BOTH the Skills API route (server) and the
// Sessions runtime (client), so it must never import anything.
//
// Nothing in this module executes skill content: it only reads and judges text.

export const SKILL_FILE_NAME = 'SKILL.md'
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MAX_NAME_CHARS = 64
export const MAX_DESCRIPTION_CHARS = 1024
export const MAX_COMPATIBILITY_CHARS = 500
export const MAX_LICENSE_CHARS = 200

/** Frontmatter limits — a SKILL.md is metadata + instructions, not a payload. */
export const MAX_FRONTMATTER_CHARS = 16 * 1024
export const MAX_SKILL_MD_CHARS = 512 * 1024

export interface SkillFrontmatter {
  name: string
  description: string
  license: string
  compatibility: string
  metadata: Record<string, string>
  /** Space-separated advisory tool list — metadata only, never a permission. */
  allowedTools: string
  /** Unknown frontmatter keys, preserved for display. */
  extras: Record<string, string>
}

export interface SkillParseResult {
  ok: boolean
  meta: SkillFrontmatter
  /** Markdown instructions after the frontmatter. */
  body: string
  errors: string[]
  warnings: string[]
  hasFrontmatter: boolean
}

export interface SuspiciousHit {
  label: string
  line: number
  excerpt: string
}

// ── YAML subset parser ───────────────────────────────────────────────────────

interface ParsedYaml {
  data: Record<string, unknown>
  errors: string[]
}

function parseScalar(raw: string): unknown {
  const v = raw.trim()
  if (v === '') return ''
  if (v === 'true') return true
  if (v === 'false') return false
  if (v === 'null' || v === '~') return null
  if (v === '{}') return {}
  if (/^\[.*\]$/.test(v)) {
    const inner = v.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((s) => unquote(s.trim()))
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return unquote(v)
  }
  // Plain scalar: strip trailing comment (only when preceded by whitespace).
  const plain = v.replace(/\s+#.*$/, '').trim()
  return plain
}

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(["\\/nrt])/g, (_, c: string) => {
      switch (c) {
        case 'n':
          return '\n'
        case 'r':
          return '\r'
        case 't':
          return '\t'
        default:
          return c
      }
    })
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'")
  }
  return v
}

/**
 * Parse the YAML frontmatter of a SKILL.md. Deliberately small and strict:
 * an input it cannot understand is an error (skills are rejected with a
 * useful message), never silently accepted.
 */
export function parseFrontmatter(raw: string): ParsedYaml & { body: string; present: boolean } {
  const text = (raw ?? '').replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (!lines.length || lines[0].trim() !== '---') {
    return { data: {}, body: text, errors: [], present: false }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === '---' || t === '...') {
      end = i
      break
    }
  }
  if (end === -1) {
    return { data: {}, body: '', errors: ['Frontmatter is not closed with a "---" line.'], present: true }
  }
  const body = lines.slice(end + 1).join('\n')
  const fmLines = lines.slice(1, end)
  const errors: string[] = []
  const data: Record<string, unknown> = {}

  let currentMap: string | null = null
  let blockKey: string | null = null
  let blockIndent = 0
  let blockKind: 'literal' | 'folded' | null = null
  let blockLines: string[] = []

  const flushBlock = (): void => {
    if (blockKind && blockKey) {
      const text = blockKind === 'literal' ? blockLines.join('\n') : blockLines.map((l) => l.trim()).join(' ').trim()
      data[blockKey] = text
    }
    blockKind = null
    blockKey = null
    blockLines = []
  }

  for (let i = 0; i < fmLines.length; i++) {
    const lineNo = i + 2 // 1-based, frontmatter starts after the opening ---
    const line = fmLines[i]

    if (blockKind && blockKey) {
      if (line.trim() === '') {
        blockLines.push('')
        continue
      }
      const indent = line.match(/^ */)?.[0].length ?? 0
      if (indent > blockIndent) {
        blockLines.push(line.slice(blockIndent + 1))
        continue
      }
      flushBlock()
      // fall through — this line belongs to the parent document
    }

    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (/^\t/.test(line)) {
      errors.push(`Line ${lineNo}: tabs are not allowed for YAML indentation.`)
      continue
    }
    const indent = line.match(/^ */)?.[0].length ?? 0
    const trimmed = line.trim()
    const colon = trimmed.indexOf(':')
    if (colon <= 0) {
      errors.push(`Line ${lineNo}: expected "key: value" — got "${trimmed.slice(0, 60)}".`)
      continue
    }
    const key = trimmed.slice(0, colon).trim()
    const rest = trimmed.slice(colon + 1).trim()
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
      errors.push(`Line ${lineNo}: invalid key "${key.slice(0, 40)}".`)
      continue
    }

    if (indent > 0) {
      // Nested entry — only valid inside an open map (metadata, etc).
      if (!currentMap) {
        errors.push(`Line ${lineNo}: unexpected indented entry "${key}" (no parent map).`)
        continue
      }
      const parent = data[currentMap]
      const map = parent && typeof parent === 'object' && !Array.isArray(parent) ? (parent as Record<string, unknown>) : {}
      map[key] = parseScalar(rest)
      data[currentMap] = map
      continue
    }

    currentMap = null
    if (rest === '|' || rest === '|-' || rest === '|+' || rest === '>' || rest === '>-' || rest === '>+') {
      blockKind = rest.startsWith('|') ? 'literal' : 'folded'
      blockKey = key
      blockIndent = indent
      blockLines = []
      continue
    }
    if (rest === '') {
      // Possibly an empty scalar or the start of a nested map — resolved by
      // whichever shape the following lines take. Default to nested map.
      data[key] = {}
      currentMap = key
      continue
    }
    data[key] = parseScalar(rest)
  }
  flushBlock()

  // Keys that stayed empty maps with no children are plain empty strings.
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) data[k] = ''
  }

  if (text.length > MAX_FRONTMATTER_CHARS + MAX_SKILL_MD_CHARS) {
    errors.push('SKILL.md is unreasonably large — refusing to parse.')
  }
  return { data, body, errors, present: true }
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

// ── SKILL.md parsing + validation ────────────────────────────────────────────

export function emptyMeta(): SkillFrontmatter {
  return { name: '', description: '', license: '', compatibility: '', metadata: {}, allowedTools: '', extras: {} }
}

/** Validate frontmatter against the Agent Skills spec. Pure; returns messages. */
export function validateSkillMeta(meta: SkillFrontmatter, dirName?: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  if (!meta.name) errors.push('Missing required field "name".')
  else {
    if (meta.name.length > MAX_NAME_CHARS) errors.push(`"name" is longer than ${MAX_NAME_CHARS} characters.`)
    if (!SKILL_NAME_PATTERN.test(meta.name)) {
      errors.push(
        `"name" must be lowercase letters, numbers and single hyphens (no leading/trailing/double hyphens) — got "${meta.name}".`,
      )
    }
  }
  if (!meta.description) errors.push('Missing required field "description".')
  else if (meta.description.length > MAX_DESCRIPTION_CHARS) {
    errors.push(`"description" is longer than ${MAX_DESCRIPTION_CHARS} characters (${meta.description.length}).`)
  }
  if (meta.compatibility && meta.compatibility.length > MAX_COMPATIBILITY_CHARS) {
    errors.push(`"compatibility" is longer than ${MAX_COMPATIBILITY_CHARS} characters.`)
  }
  if (meta.license && meta.license.length > MAX_LICENSE_CHARS) {
    warnings.push('"license" is unusually long — keep it short (name or bundled file).')
  }
  if (dirName && meta.name && dirName !== meta.name) {
    errors.push(`Skill directory "${dirName}" does not match the declared name "${meta.name}" (the spec requires them to match).`)
  }
  return { errors, warnings }
}

/**
 * Parse a SKILL.md file: frontmatter + validation + body.
 * `dirName` (when known) enforces the spec's directory/name match.
 */
export function parseSkillMarkdown(raw: string, dirName?: string): SkillParseResult {
  const warnings: string[] = []
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, meta: emptyMeta(), body: '', errors: ['SKILL.md is empty.'], warnings, hasFrontmatter: false }
  }
  if (raw.length > MAX_SKILL_MD_CHARS) {
    return {
      ok: false,
      meta: emptyMeta(),
      body: '',
      errors: [`SKILL.md exceeds the ${Math.round(MAX_SKILL_MD_CHARS / 1024)}KB limit.`],
      warnings,
      hasFrontmatter: false,
    }
  }
  const parsed = parseFrontmatter(raw)
  if (!parsed.present) {
    return { ok: false, meta: emptyMeta(), body: parsed.body, errors: ['SKILL.md must start with YAML frontmatter ("---" on the first line).'], warnings, hasFrontmatter: false }
  }
  const errors = [...parsed.errors]

  const fm = parsed.data
  const meta = emptyMeta()
  meta.name = asString(fm.name)
  meta.description = asString(fm.description)
  meta.license = asString(fm.license)
  meta.compatibility = asString(fm.compatibility)
  meta.allowedTools = asString(fm['allowed-tools'])

  if (fm.metadata !== undefined && fm.metadata !== null && fm.metadata !== '') {
    if (typeof fm.metadata === 'object' && !Array.isArray(fm.metadata)) {
      for (const [k, v] of Object.entries(fm.metadata as Record<string, unknown>)) {
        const s = asString(v)
        if (s !== '' || v === '') meta.metadata[k] = s
        else if (v !== null && v !== undefined) warnings.push(`metadata.${k} is not a string value — ignored.`)
      }
    } else {
      errors.push('"metadata" must be a map of string keys to string values.')
    }
  }

  const known = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'])
  for (const [k, v] of Object.entries(fm)) {
    if (known.has(k)) continue
    const s = asString(v)
    if (s) meta.extras[k] = s
    warnings.push(`Unknown frontmatter field "${k}" — kept as extra metadata.`)
  }

  const v = validateSkillMeta(meta, dirName)
  errors.push(...v.errors)
  warnings.push(...v.warnings)

  if (!parsed.body.trim()) warnings.push('SKILL.md has no instruction body — the skill can describe itself but has nothing to follow.')

  return { ok: errors.length === 0, meta, body: parsed.body, errors, warnings, hasFrontmatter: true }
}

// ── Suspicious-content heuristics ────────────────────────────────────────────
// Untrusted instructional text gets a genuinely useful warning list, never an
// "it is safe" claim. Patterns are conservative to keep signal high.

const SUSPICIOUS_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'prompt-injection phrasing', re: /\b(ignore|disregard|forget)\b[^\n]{0,40}\b(previous|prior|above|system|earlier)\b[^\n]{0,20}\b(instructions?|rules?|prompts?)?/i },
  { label: 'asks to reveal secrets', re: /\b(reveal|expose|print|dump|leak|send|upload|exfiltrate|share)\b[^\n]{0,60}\b(api[-_ ]?keys?|secrets?|tokens?|passwords?|credentials?|\.env|environment variables?)\b/i },
  { label: 'reads .env or key material', re: /\b(cat|read|less|more|type|open)\b[^\n]{0,30}\b(\.env\b|id_rsa|\.pem\b|\.key\b|credentials)/i },
  { label: 'remote script piped to a shell', re: /\b(curl|wget|iwr|invoke-webrequest)\b[^\n]{0,120}\|\s*(sh|bash|zsh|pwsh|powershell|node|python)\b/i },
  { label: 'destructive filesystem command', re: /\b(rm\s+-rf|rm\s+-fr|del\s+\/[sq]|format\s+[a-z]:|remove-item[^\n]{0,40}-recurse)\b/i },
  { label: 'privilege escalation', re: /\b(sudo|runas|doas|su\s+-)\b/i },
  { label: 'disables safety checks', re: /\b(disable|bypass|skip|turn off)\b[^\n]{0,30}\b(approval|permission|safety|verification|check)s?\b/i },
  { label: 'instructs to edit the agent itself', re: /\b(modify|edit|change|patch)\b[^\n]{0,30}\b(agent[- ]session|system prompt|runtime|permissions?)\b/i },
  { label: 'large embedded blob (possible smuggling)', re: /[A-Za-z0-9+/]{400,}={0,2}/ },
]

/** Scan text (an instruction body or script) for risky patterns. */
export function scanSkillText(text: string, maxHits = 12): SuspiciousHit[] {
  if (!text) return []
  const hits: SuspiciousHit[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    for (const p of SUSPICIOUS_PATTERNS) {
      if (p.re.test(lines[i])) {
        hits.push({
          label: p.label,
          line: i + 1,
          excerpt: lines[i].trim().slice(0, 140),
        })
        break // one hit per line keeps the list readable
      }
    }
    if (hits.length >= maxHits) break
  }
  return hits
}
