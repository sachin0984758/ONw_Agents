// A deliberately small, strict reader for the Agent Skills frontmatter.
// It supports the flat key/value shape the specification requires, quoted
// strings, simple arrays and block scalars. It does not evaluate YAML tags,
// anchors or arbitrary objects.

export interface SkillMeta {
  name: string
  description: string
  license?: string
  version?: string
  allowedTools: string[]
  compatibility?: string
  extra: Record<string, string>
}

export interface ParsedSkill {
  ok: boolean
  meta: SkillMeta | null
  body: string
  errors: string[]
  warnings: string[]
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    const inner = trimmed.slice(1, -1)
    if (trimmed.startsWith('"')) {
      return inner
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
    }
    return inner.replace(/''/g, "'")
  }
  return trimmed
}

function splitArray(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => unquote(s))
      .filter(Boolean)
  }
  return trimmed
    .split(/[,\s]+/)
    .map((s) => unquote(s))
    .filter(Boolean)
}

export function parseSkillMarkdown(text: string, expectedName?: string): ParsedSkill {
  const errors: string[] = []
  const warnings: string[] = []
  const normalized = text.replace(/\r\n/g, '\n')
  if (normalized.length > 512 * 1024) {
    return {
      ok: false,
      meta: null,
      body: '',
      errors: ['SKILL.md is larger than 512 KB.'],
      warnings,
    }
  }
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') {
    return {
      ok: false,
      meta: null,
      body: normalized.trim(),
      errors: ['SKILL.md must start with YAML frontmatter delimited by ---.'],
      warnings,
    }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) {
    return {
      ok: false,
      meta: null,
      body: '',
      errors: ['The YAML frontmatter is not closed with ---.'],
      warnings,
    }
  }
  if (end > 400) {
    errors.push('The frontmatter is unreasonably long (more than 400 lines).')
  }

  const fields = new Map<string, string>()
  for (let i = 1; i < end; i++) {
    const raw = lines[i] ?? ''
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(raw)
    if (!match) {
      warnings.push(`Ignored unsupported frontmatter line ${i + 1}: ${raw.slice(0, 80)}`)
      continue
    }
    const key = match[1] ?? ''
    let value = match[2] ?? ''
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const collected: string[] = []
      let j = i + 1
      while (j < end) {
        const next = lines[j] ?? ''
        if (next.trim() && !/^\s+/.test(next)) break
        collected.push(next.replace(/^\s{1,4}/, ''))
        j++
      }
      value = value.startsWith('|') ? collected.join('\n') : collected.join(' ').replace(/\s+/g, ' ')
      i = j - 1
    } else if (/^- /.test(value) || value === '') {
      const items: string[] = []
      let j = i + 1
      while (j < end) {
        const next = lines[j] ?? ''
        const item = /^\s*-\s+(.*)$/.exec(next)
        if (!item) break
        items.push(unquote(item[1] ?? ''))
        j++
      }
      if (items.length > 0) {
        value = items.join(', ')
        i = j - 1
      }
    }
    if (fields.has(key)) warnings.push(`Duplicate frontmatter key "${key}"; the last value wins.`)
    fields.set(key, unquote(value))
  }

  const name = (fields.get('name') ?? '').trim()
  const description = (fields.get('description') ?? '').trim()
  if (!name) errors.push('Frontmatter field "name" is required.')
  else if (!NAME_RE.test(name)) {
    errors.push('Field "name" must be lowercase letters, digits and hyphens (max 64 characters).')
  }
  if (!description) errors.push('Frontmatter field "description" is required.')
  else if (description.length > 1024) errors.push('Field "description" must be at most 1024 characters.')
  if (expectedName && name && name !== expectedName) {
    warnings.push(`Skill name "${name}" differs from its directory name "${expectedName}".`)
  }

  const allowedToolsRaw = fields.get('allowed-tools') ?? fields.get('allowed_tools') ?? fields.get('tools') ?? ''
  const extra: Record<string, string> = {}
  for (const [key, value] of fields) {
    if (['name', 'description', 'license', 'version', 'allowed-tools', 'allowed_tools', 'tools', 'compatibility'].includes(key)) {
      continue
    }
    extra[key] = value
  }

  const meta: SkillMeta = {
    name,
    description,
    license: fields.get('license') || undefined,
    version: fields.get('version') || undefined,
    allowedTools: splitArray(allowedToolsRaw),
    compatibility: fields.get('compatibility') || undefined,
    extra,
  }

  const body = lines.slice(end + 1).join('\n').trim()
  if (!body && !description) errors.push('The skill has neither instructions nor a description.')

  return { ok: errors.length === 0, meta, body, errors, warnings }
}
