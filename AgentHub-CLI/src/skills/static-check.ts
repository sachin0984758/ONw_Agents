import type { SkillEntry } from './discover.ts'

export type StaticVerdict = 'compatible' | 'needs-review' | 'incompatible' | 'not-verified'

export interface ToolSupport {
  declared: string
  available: boolean
  mappedTo: string | null
  note?: string
}

export interface StaticCheck {
  name: string
  valid: boolean
  verdict: StaticVerdict
  format: string
  declaredTools: ToolSupport[]
  missingCapabilities: string[]
  capabilitiesObserved: string[]
  warnings: string[]
  security: string[]
  scripts: string[]
  limitation: string
}

// Claude Code / Agent Skills tool names mapped onto this runtime's real tools.
const TOOL_MAP: Record<string, string | null> = {
  read: 'read_file',
  write: 'write_file',
  edit: 'edit_file',
  multiedit: 'edit_file',
  glob: 'search_files',
  grep: 'search_files',
  ls: 'list_dir',
  bash: 'run_command',
  shell: 'run_command',
  execute: 'run_command',
  skill: 'read_skill',
  todowrite: 'set_plan',
  read_file: 'read_file',
  write_file: 'write_file',
  edit_file: 'edit_file',
  search_files: 'search_files',
  list_dir: 'list_dir',
  run_command: 'run_command',
  git_status: 'git_status',
  git_diff: 'git_diff',
  read_skill: 'read_skill',
  set_plan: 'set_plan',
  update_plan: 'update_plan',
  webfetch: null,
  websearch: null,
  browser: null,
  task: null,
  agent: null,
  notebookedit: null,
  image: null,
  computer: null,
}

const CAPABILITY_PATTERNS: Array<{ re: RegExp; capability: string; unavailable: boolean }> = [
  { re: /\b(webfetch|web_fetch|fetch_url|http_get)\b/i, capability: 'web fetch tool', unavailable: true },
  { re: /\b(websearch|web_search|search the web)\b/i, capability: 'web search', unavailable: true },
  { re: /\b(mcp__|model context protocol|mcp server)\b/i, capability: 'MCP server', unavailable: true },
  { re: /\b(sub-?agent|delegate to|task tool)\b/i, capability: 'subagents', unavailable: true },
  { re: /\b(browser|playwright|puppeteer|selenium|screenshot)\b/i, capability: 'browser automation', unavailable: true },
  { re: /\b(image generation|generate an image|dall-e|stable diffusion)\b/i, capability: 'image generation', unavailable: true },
  { re: /\b(vision|look at the image|analy[sz]e the screenshot)\b/i, capability: 'vision input', unavailable: true },
  { re: /\b(notebook|\.ipynb)\b/i, capability: 'notebook editing', unavailable: true },
  { re: /\b(curl|wget|invoke-webrequest)\b/i, capability: 'network download (requires approval)', unavailable: false },
]

function declaredList(entry: SkillEntry): string[] {
  const tools = entry.meta?.allowedTools ?? []
  return [...new Set(tools.map((t) => t.trim()).filter(Boolean))]
}

export function staticCheck(entry: SkillEntry): StaticCheck {
  const warnings: string[] = []
  const missing: string[] = []
  const observed: string[] = []
  const declared = declaredList(entry)
  const support: ToolSupport[] = declared.map((tool) => {
    const key = tool.toLowerCase()
    const mapped = TOOL_MAP[key]
    const available = mapped !== undefined && mapped !== null
    if (!available) {
      missing.push(tool)
      warnings.push(`Declared tool "${tool}" is not available in this runtime.`)
    }
    return { declared: tool, available, mappedTo: mapped ?? null }
  })

  for (const pattern of CAPABILITY_PATTERNS) {
    if (pattern.re.test(entry.body)) {
      observed.push(pattern.capability)
      if (pattern.unavailable) missing.push(pattern.capability)
    }
  }
  const seen = new Set<string>()
  const uniqueMissing = missing.filter((m) => (seen.has(m) ? false : (seen.add(m), true)))
  const uniqueObserved = [...new Set(observed)]

  if (!entry.valid) {
    return {
      name: entry.name,
      valid: false,
      verdict: 'incompatible',
      format: 'invalid',
      declaredTools: support,
      missingCapabilities: uniqueMissing,
      capabilitiesObserved: uniqueObserved,
      warnings: [...entry.errors, ...warnings],
      security: entry.security,
      scripts: entry.scripts,
      limitation: 'The skill format is invalid; it cannot be activated.',
    }
  }

  const incompatible = uniqueMissing.length > 0
  let verdict: StaticVerdict
  if (incompatible) verdict = 'incompatible'
  else if (entry.security.length > 0 || entry.scripts.length > 0) verdict = 'needs-review'
  else if (support.length > 0 && support.every((s) => s.available)) verdict = 'compatible'
  else verdict = 'not-verified'

  return {
    name: entry.name,
    valid: true,
    verdict,
    format: 'valid',
    declaredTools: support,
    missingCapabilities: uniqueMissing,
    capabilitiesObserved: uniqueObserved,
    warnings,
    security: entry.security,
    scripts: entry.scripts,
    limitation:
      'Static check only. It does not prove the skill works: a functional test through the real model and tool path is required for that.',
  }
}

export function staticCheckAll(entries: SkillEntry[]): StaticCheck[] {
  return entries.map((entry) => staticCheck(entry))
}
