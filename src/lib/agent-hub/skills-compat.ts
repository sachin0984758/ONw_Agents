// ── Skills compatibility engine (pure, deterministic) ────────────────────────
// Static analysis of an Agent Skills `SKILL.md` + its file inventory against the
// ACTUAL AgentHub runtime. This module only reads text the caller already has:
// it never downloads anything, never executes skill content, and never calls a
// model. It answers three questions honestly —
//
//   1. Is this a valid Agent Skills structure, and what metadata does it use?
//   2. Which runtime capabilities do its instructions/scripts require, and are
//      those capabilities actually registered in AgentHub?
//   3. What would need adapting, and what is simply unverifiable without a test?
//
// The capability catalog (`RUNTIME_CAPABILITIES` + `RUNTIME_TOOL_NAMES`) mirrors
// the real tool registry in `agent-session.ts`; the regression suite asserts the
// two cannot drift apart. A requirement is only reported "available" when a real
// registered tool provides it — never because a skill merely claims it.
//
// Only `./skills-format` (itself dependency-free) is imported, so this stays
// usable from the server route, the CLI harness and, if ever needed, the client.

import {
  MAX_COMPATIBILITY_CHARS,
  MAX_DESCRIPTION_CHARS,
  parseSkillMarkdown,
  scanSkillText,
  type SuspiciousHit,
} from './skills-format'

export const SKILL_COMPAT_SCHEMA_VERSION = 1

// ── Status vocabulary ────────────────────────────────────────────────────────

export type CompatStatus =
  | 'fully-compatible'
  | 'partially-compatible'
  | 'incompatible'
  | 'needs-review'
  | 'not-verified'

export type CapabilitySupport =
  | 'available'
  | 'available-when-permitted'
  | 'check-required'
  | 'unavailable'

export type FunctionalStatus = 'passed' | 'failed' | 'blocked' | 'not-run'

export const COMPAT_STATUS_LABELS: Record<CompatStatus, string> = {
  'fully-compatible': 'Fully compatible',
  'partially-compatible': 'Partially compatible',
  incompatible: 'Incompatible',
  'needs-review': 'Needs review',
  'not-verified': 'Not verified',
}

export const CAPABILITY_SUPPORT_LABELS: Record<CapabilitySupport, string> = {
  available: 'Available',
  'available-when-permitted': 'Available when permitted',
  'check-required': 'Check required',
  unavailable: 'Unavailable',
}

export const FUNCTIONAL_STATUS_LABELS: Record<FunctionalStatus, string> = {
  passed: 'Test passed',
  failed: 'Test failed',
  blocked: 'Test blocked',
  'not-run': 'Test not run',
}

// ── The real runtime, as a catalog ───────────────────────────────────────────
// Tool names here MUST match `src/lib/agent-hub/agent-session.ts`'s `tools`
// registry. `scripts/check-skills.mjs` parses that file and fails on drift.

export const RUNTIME_TOOL_NAMES: string[] = [
  'describe_capabilities',
  'get_project_structure',
  'read_file',
  'list_files',
  'count_files',
  'search_files',
  'find_files',
  'write_file',
  'edit_file',
  'delete_file',
  'plan',
  'activate_skill',
  'syntax_check',
  'run_command',
  'task',
  'call_llm',
]

/** Tools whose execution is approval-controlled in the runtime. */
export const RUNTIME_APPROVAL_TOOLS: string[] = [
  'write_file',
  'edit_file',
  'delete_file',
  'run_command',
  'task',
]

export interface RuntimeCapabilityDef {
  label: string
  support: CapabilitySupport
  tools: string[]
  detail: string
}

export const RUNTIME_CAPABILITIES: Record<string, RuntimeCapabilityDef> = {
  'read-files': {
    label: 'Read project files',
    support: 'available',
    tools: ['read_file', 'list_files', 'count_files', 'get_project_structure', 'find_files'],
    detail: 'Existing validated read tools — always available.',
  },
  'search-code': {
    label: 'Search project code',
    support: 'available',
    tools: ['search_files', 'find_files'],
    detail: 'Pattern and filename search over the workspace.',
  },
  'write-files': {
    label: 'Create or edit source files',
    support: 'available-when-permitted',
    tools: ['write_file', 'edit_file'],
    detail: 'Approval-controlled and refused in read-only mode.',
  },
  'delete-files': {
    label: 'Delete files',
    support: 'available-when-permitted',
    tools: ['delete_file'],
    detail: 'Approval-controlled; only files named in the task request.',
  },
  'run-commands': {
    label: 'Execute shell commands',
    support: 'available-when-permitted',
    tools: ['run_command'],
    detail: 'Approval-controlled and gated by the code-execution switch.',
  },
  'background-tasks': {
    label: 'Run background tasks',
    support: 'available-when-permitted',
    tools: ['task'],
    detail: 'Approval-controlled; for long-running processes (servers, watchers).',
  },
  'call-model': {
    label: 'Call the configured model',
    support: 'available',
    tools: ['call_llm'],
    detail: 'Uses the same provider/model the session uses.',
  },
  'load-skill': {
    label: 'Load another installed skill',
    support: 'available',
    tools: ['activate_skill'],
    detail: 'Only enabled, valid, reviewed skills can be activated.',
  },
  'syntax-check': {
    label: 'Check code syntax',
    support: 'available',
    tools: ['syntax_check'],
    detail: 'Syntax hints for JS/JSON/HTML snippets.',
  },
  python: {
    label: 'Run bundled Python',
    support: 'check-required',
    tools: ['run_command'],
    detail: 'Requires a Python interpreter on PATH and code execution permitted.',
  },
  node: {
    label: 'Run bundled Node.js',
    support: 'check-required',
    tools: ['run_command'],
    detail: 'Requires Node.js on PATH and code execution permitted.',
  },
  network: {
    label: 'Make network requests',
    support: 'check-required',
    tools: ['run_command'],
    detail: 'No dedicated fetch tool — only reachable through a permitted shell command.',
  },
  'github-api': {
    label: 'Use the GitHub API',
    support: 'check-required',
    tools: ['run_command'],
    detail: 'No GitHub tool is registered; requires curl/gh via a permitted command.',
  },
  browser: {
    label: 'Control a browser',
    support: 'unavailable',
    tools: [],
    detail: 'No browser/automation tool is registered in AgentHub.',
  },
  'image-generation': {
    label: 'Generate images',
    support: 'unavailable',
    tools: [],
    detail: 'No image-generation tool is registered in AgentHub.',
  },
  documents: {
    label: 'Create office documents',
    support: 'unavailable',
    tools: [],
    detail: 'No document-generation tool (docx/xlsx/pdf) is registered.',
  },
  vision: {
    label: 'Understand images (vision)',
    support: 'check-required',
    tools: [],
    detail: 'Depends on the selected model supporting image input.',
  },
  mcp: {
    label: 'Use MCP servers or sub-agents',
    support: 'unavailable',
    tools: [],
    detail: 'No MCP client or sub-agent tool is registered in AgentHub.',
  },
  'external-services': {
    label: 'Reach an external service',
    support: 'check-required',
    tools: ['run_command'],
    detail: 'No integration is configured; requires the service to run and be reachable.',
  },
  'edit-agent': {
    label: 'Modify the agent or its permissions',
    support: 'unavailable',
    tools: [],
    detail: 'Refused by policy — a skill can never change the runtime or its permissions.',
  },
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface CompatFileInput {
  /** POSIX path relative to the skill directory. */
  path: string
  size: number
  /** Bounded text content when the caller could read it (scripts, manifests…). */
  text?: string
}

export interface CompatEnvInput {
  platform: string
  /** Read-only vs edit mode of the runtime. */
  mode: 'ro' | 'edit'
  /** Settings → Capabilities: command/file mutation permitted. */
  codeExecution: boolean
  /** Recorded preference (advisory — there is no OS sandbox). */
  networkEgress: boolean
  /** Optional probe results: binary name → present on PATH. */
  binaries?: Record<string, boolean>
  /** The loaded chat model, when one is known. */
  model?: {
    id: string
    label: string
    provider: string
    contextLength?: number
    vision?: boolean
    loaded?: boolean
  }
  /** The registered tool names; defaults to the real registry snapshot. */
  runtimeTools?: string[]
}

export interface CompatSourceInput {
  kind: 'github' | 'local'
  repoUrl?: string
  owner?: string
  repo?: string
  refUsed?: string
  commit?: string
  dirInRepo?: string
  license?: string
}

export interface CompatAnalysisInput {
  id: string
  name: string
  dirName: string
  skillMd: string
  files: CompatFileInput[]
  env: CompatEnvInput
  source: CompatSourceInput
  origin: 'repo' | 'installed'
  revisionKey: string
  functional?: FunctionalTestResult
  checkedAt?: string
}

// ── Findings / outputs ───────────────────────────────────────────────────────

export interface CompatFinding {
  level: 'error' | 'warning' | 'info'
  message: string
}

export interface CompatCapability {
  id: string
  label: string
  support: CapabilitySupport
  tools: string[]
  detail: string
  evidence: string[]
}

export interface CompatScript {
  path: string
  kind: 'python' | 'node' | 'shell' | 'powershell' | 'ruby' | 'perl' | 'other'
  bytes: number
  /** True when the caller supplied the (bounded) file content for scanning. */
  inspected: boolean
  suspicious: SuspiciousHit[]
}

export interface CompatDependency {
  kind: 'interpreter' | 'package' | 'env' | 'command' | 'service' | 'os' | 'credential'
  name: string
  ecosystem?: 'python' | 'node' | 'other'
  sources?: string[]
  required: boolean
  /** undefined = not probed / cannot be verified statically. */
  available?: boolean
  note: string
}

export interface DependencySummary {
  interpreters: string[]
  packages: Array<{ ecosystem: 'python' | 'node' | 'other'; name: string; sources: string[] }>
  envVars: string[]
  commands: string[]
  services: string[]
  osSpecific: string[]
  credentials: string[]
  network: boolean
  manifests: string[]
}

export interface ModelSuitability {
  skillMdChars: number
  estimatedPromptTokens: number
  referenceBytes: number
  scriptCount: number
  stepCount: number
  complexity: 'low' | 'medium' | 'high'
  requiresVision: boolean
  providerSpecific: string[]
  issues: string[]
  model?: CompatEnvInput['model']
  status: CompatStatus
  note: string
}

export interface FunctionalTestStep {
  step: string
  ok: boolean
  detail: string
}

export interface FunctionalTestResult {
  status: FunctionalStatus
  model?: { id: string; label: string; provider: string }
  provider?: string
  startedAt?: string
  durationMs?: number
  outputExcerpt?: string
  outputChars?: number
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  steps: FunctionalTestStep[]
  limitations: string[]
  error?: string
}

export interface CompatReport {
  schemaVersion: number
  origin: 'repo' | 'installed'
  id: string
  name: string
  dirName: string
  source: CompatSourceInput
  revisionKey: string
  envFingerprint: string
  checkedAt: string
  overall: CompatStatus
  statuses: {
    format: CompatStatus
    metadata: CompatStatus
    tools: CompatStatus
    dependencies: CompatStatus
    security: CompatStatus
    model: CompatStatus
    functional: CompatStatus
  }
  format: { ok: boolean; hasFrontmatter: boolean; errors: string[]; warnings: string[] }
  metadata: {
    name: string
    description: string
    license: string
    compatibility: string
    declaredFields: string[]
    supportedFields: string[]
    unsupportedFields: string[]
    missingReferences: string[]
  }
  capabilities: CompatCapability[]
  dependencies: CompatDependency[]
  dependencySummary: DependencySummary
  scripts: CompatScript[]
  security: { instructionHits: SuspiciousHit[]; scriptHits: SuspiciousHit[]; hardBlockers: string[] }
  modelSuitability: ModelSuitability
  functional: FunctionalTestResult
  findings: CompatFinding[]
  recommendations: string[]
  testedModel?: string
}

// ── Small deterministic helpers ──────────────────────────────────────────────

/** FNV-1a 32-bit — dependency-free, stable across processes. */
export function hashString(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** A stable fingerprint of the local runtime that can invalidate cached reports. */
export function fingerprintEnv(env: CompatEnvInput): string {
  const bins = env.binaries
    ? Object.keys(env.binaries).sort().map((k) => `${k}=${env.binaries![k] ? 1 : 0}`).join(',')
    : 'unprobed'
  const model = env.model ? `${env.model.provider}/${env.model.id}${env.model.contextLength ? `@${env.model.contextLength}` : ''}${env.model.vision ? ':vision' : ''}` : 'none'
  const part = [
    'v1',
    env.platform,
    env.mode,
    env.codeExecution ? 'exec' : 'noexec',
    env.networkEgress ? 'net' : 'nonet',
    model,
    (env.runtimeTools ? [...env.runtimeTools].sort().join(',') : RUNTIME_TOOL_NAMES.join(',')),
    bins,
  ].join('|')
  return hashString(part)
}

const SCRIPT_EXTS = new Set(['.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.rb', '.pl', '.bat', '.cmd'])

function extOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot).toLowerCase() : ''
}

function scriptKind(p: string): CompatScript['kind'] {
  switch (extOf(p)) {
    case '.py':
      return 'python'
    case '.js':
    case '.mjs':
    case '.cjs':
    case '.ts':
    case '.tsx':
      return 'node'
    case '.sh':
    case '.bash':
    case '.zsh':
      return 'shell'
    case '.ps1':
    case '.psm1':
      return 'powershell'
    case '.rb':
      return 'ruby'
    case '.pl':
      return 'perl'
    default:
      return 'other'
  }
}

function isScriptPath(p: string): boolean {
  return p.split('/')[0] === 'scripts' || SCRIPT_EXTS.has(extOf(p))
}

const PY_STDLIB = new Set([
  'os', 'sys', 're', 'json', 'math', 'time', 'datetime', 'pathlib', 'subprocess', 'collections', 'itertools',
  'functools', 'typing', 'io', 'csv', 'argparse', 'logging', 'random', 'string', 'textwrap', 'shutil', 'tempfile',
  'glob', 'hashlib', 'base64', 'urllib', 'http', 'socket', 'threading', 'asyncio', 'dataclasses', 'enum', 'abc',
  'unittest', 'xml', 'html', 'email', 'zipfile', 'tarfile', 'gzip', 'statistics', 'stat', 'copy', 'pickle',
  'sqlite3', 'contextlib', 'warnings', 'secrets', 'uuid', 'platform', 'signal', 'struct', 'codecs', 'pprint',
  'difflib', 'fnmatch', 'traceback', 'inspect', 'importlib', 'concurrent', 'multiprocessing', 'decimal',
  'fractions', 'operator', 'heapq', 'bisect', 'array', 'queue', 'weakref', 'types', 'numbers', 'cmath',
  'calendar', 'locale', 'getpass', 'shlex', 'configparser', 'tomllib', 'venv', 'webbrowser', 'ctypes',
  'typing_extensions',
])

const SUPPORTED_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']

// ── Capability detection ─────────────────────────────────────────────────────

interface CapabilityRule {
  id: string
  res: RegExp[]
}

const CAPABILITY_RULES: CapabilityRule[] = [
  {
    id: 'read-files',
    res: [
      /\b(read|open|inspect|review|parse)\b[^\n]{0,30}\b(file|files|source|codebase|repository|project)\b/i,
      /\b(list|enumerate)\b[^\n]{0,20}\b(files|directory|folder|tree)\b/i,
      /\b(contents of|read_file|list_files|get_project_structure)\b/i,
    ],
  },
  {
    id: 'search-code',
    res: [
      /\b(search|grep|find|locate|scan)\b[^\n]{0,30}\b(pattern|files?|code|usages?|references?|symbols?|strings?)\b/i,
      /\b(ripgrep|rg |search_files|find_files)\b/i,
    ],
  },
  {
    id: 'write-files',
    res: [
      /\b(write|create|generate|add|edit|modify|update|patch|apply|refactor|implement|save)\b[^\n]{0,25}\b(file|files|source|code|snippet|component|configuration)\b/i,
      /\b(write_file|edit_file)\b/i,
    ],
  },
  { id: 'delete-files', res: [/\b(delete|remove)\b[^\n]{0,20}\bfiles?\b/i, /\bdelete_file\b/i] },
  {
    id: 'run-commands',
    res: [
      /\b(run|execute|invoke|launch)\b[^\n]{0,25}\b(command|commands|shell|cli|terminal|bash|npm|pnpm|yarn|pip|pytest|make|deno|bun)\b/i,
      /```\s*(bash|sh|shell|console|zsh|powershell)/i,
      /\b(run_command|shell out)\b/i,
    ],
  },
  { id: 'background-tasks', res: [/\b(dev server|background|long-running|watch mode|start the server|run the server)\b/i, /\btask tool\b/i] },
  { id: 'call-model', res: [/\b(call|invoke|ask|query)\b[^\n]{0,20}\b(the )?(llm|language model|model|ai)\b/i, /\bcall_llm\b/i] },
  { id: 'python', res: [/\bpython3?\b/i, /```\s*python/i] },
  { id: 'node', res: [/\bnode(\.js)?\b/i, /```\s*(js|javascript|ts|typescript|tsx|jsx)\b/i] },
  { id: 'network', res: [/\b(curl|wget|http request|https?:\/\/api\.|download (the|a|this)|fetch\(|requests\.|axios|webhook)\b/i] },
  { id: 'github-api', res: [/\b(github api|api\.github\.com|octokit|gh api|github cli)\b/i] },
  { id: 'browser', res: [/\b(browser|playwright|puppeteer|selenium|devtools|web page|click on|screenshot the page)\b/i] },
  { id: 'image-generation', res: [/\b(generate|create|produce|render|draw)\b[^\n]{0,25}\b(image|images|picture|illustration|logo|icon)\b/i] },
  { id: 'documents', res: [/\b(create|generate|produce|export|build)\b[^\n]{0,25}\b(document|docx|spreadsheet|xlsx|pdf|presentation|pptx|slide deck)\b/i] },
  { id: 'vision', res: [/\b(analy[sz]e|read|understand|describe|inspect|look at)\b[^\n]{0,25}\b(image|images|screenshot|photo|diagram|figure|picture)\b/i, /\bvision model\b/i] },
  { id: 'mcp', res: [/\b(mcp|model context protocol|sub-?agent|claude code|skill tool)\b/i] },
  { id: 'external-services', res: [/\b(docker|postgres|postgresql|redis|mongodb|mysql|supabase|kubernetes|helm|n8n|ollama|lm studio)\b/i] },
  { id: 'edit-agent', res: [/\b(modify|edit|change|patch|override)\b[^\n]{0,30}\b(agent|runtime|system prompt|permissions?|approval)\b/i] },
]

export function detectCapabilities(body: string, scripts: CompatScript[]): CompatCapability[] {
  const lines = body.split(/\r?\n/)
  const out: CompatCapability[] = []
  const byId = new Map<string, CompatCapability>()
  const push = (id: string, evidence: string): void => {
    const def = RUNTIME_CAPABILITIES[id]
    if (!def) return
    const existing = byId.get(id)
    if (existing) {
      if (evidence && existing.evidence.length < 3 && !existing.evidence.includes(evidence)) existing.evidence.push(evidence)
      return
    }
    const cap: CompatCapability = { id, label: def.label, support: def.support, tools: [...def.tools], detail: def.detail, evidence: evidence ? [evidence] : [] }
    byId.set(id, cap)
    out.push(cap)
  }
  for (const rule of CAPABILITY_RULES) {
    for (const line of lines) {
      if (rule.res.some((re) => re.test(line))) {
        push(rule.id, line.trim().slice(0, 160))
        break
      }
    }
  }
  for (const s of scripts) {
    if (s.kind === 'python') push('python', `bundled script ${s.path}`)
    else if (s.kind === 'node') push('node', `bundled script ${s.path}`)
    else if (s.kind === 'shell' || s.kind === 'powershell') push('run-commands', `bundled script ${s.path}`)
  }
  return out
}

// ── Script catalog ───────────────────────────────────────────────────────────

export function catalogScripts(files: CompatFileInput[]): CompatScript[] {
  const out: CompatScript[] = []
  for (const f of files) {
    if (!isScriptPath(f.path)) continue
    out.push({
      path: f.path,
      kind: scriptKind(f.path),
      bytes: f.size,
      inspected: typeof f.text === 'string',
      suspicious: typeof f.text === 'string' ? scanSkillText(f.text, 6) : [],
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 60)
}

// ── Dependency detection ─────────────────────────────────────────────────────

const COMMANDS = [
  'curl', 'wget', 'jq', 'ffmpeg', 'git', 'docker', 'make', 'npm', 'npx', 'pnpm', 'yarn', 'pip', 'pip3',
  'python', 'python3', 'node', 'deno', 'bun', 'go', 'cargo', 'gcc', 'g++', 'java', 'mvn', 'gradle', 'ruby',
  'gem', 'php', 'composer', 'rsync', 'ssh', 'scp', 'tar', 'unzip', 'pandoc', 'tesseract', 'pdftotext',
  'aws', 'gcloud', 'kubectl', 'terraform',
]

const SERVICES = ['docker', 'postgres', 'postgresql', 'mysql', 'mariadb', 'redis', 'mongodb', 'elasticsearch', 'rabbitmq', 'kafka', 'supabase', 'n8n', 'ollama', 'lm studio', 'kubernetes', 'minio']

const OS_HINTS: Array<[RegExp, string]> = [
  [/\bapt-get\b|\bapt install\b|\bapt\s+update\b/i, 'Linux / Debian (apt)'],
  [/\bbrew\b/i, 'macOS (Homebrew)'],
  [/\bchoco\b/i, 'Windows (Chocolatey)'],
  [/\bwinget\b/i, 'Windows (winget)'],
  [/\bsystemctl\b/i, 'Linux (systemd)'],
  [/\bosascript\b|\blaunchctl\b/i, 'macOS'],
  [/\bpowershell\b|\bpwsh\b/i, 'Windows (PowerShell)'],
  [/\breg add\b/i, 'Windows registry'],
]

function wordRe(word: string): RegExp {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9_-])${esc}([^a-z0-9_-]|$)`, 'i')
}

export function detectDependencies(files: CompatFileInput[], body: string): DependencySummary {
  const interpreters = new Set<string>()
  const packageMap = new Map<string, { ecosystem: 'python' | 'node' | 'other'; name: string; sources: Set<string> }>()
  const envVars = new Set<string>()
  const commands = new Set<string>()
  const services = new Set<string>()
  const osSpecific = new Set<string>()
  const credentials = new Set<string>()
  const manifests: string[] = []
  let network = false

  const addPkg = (ecosystem: 'python' | 'node' | 'other', name: string, source: string): void => {
    if (!name || name.startsWith('.') || name.startsWith('node:')) return
    const key = `${ecosystem}:${name}`
    const cur = packageMap.get(key) ?? { ecosystem, name, sources: new Set<string>() }
    cur.sources.add(source)
    packageMap.set(key, cur)
  }

  for (const f of files) {
    const base = f.path.slice(f.path.lastIndexOf('/') + 1)
    if (['requirements.txt', 'pyproject.toml', 'package.json', 'Pipfile', 'environment.yml', 'setup.py', 'Gemfile', 'go.mod'].includes(base)) manifests.push(f.path)
  }

  const scanText = (text: string, source: string): void => {
    const kind = scriptKind(source)
    if (kind === 'python') {
      interpreters.add('python')
      for (const m of text.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
        if (!PY_STDLIB.has(m[1])) addPkg('python', m[1], source)
      }
    }
    if (kind === 'node') {
      interpreters.add('node')
      for (const m of text.matchAll(/(?:require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"])/g)) {
        const raw = m[1] ?? m[2] ?? ''
        if (!raw || raw.startsWith('.') || raw.startsWith('node:')) continue
        const name = raw.startsWith('@') ? raw.split('/').slice(0, 2).join('/') : raw.split('/')[0]
        addPkg('node', name, source)
      }
    }
    if (kind === 'shell') interpreters.add('bash')
    if (kind === 'powershell') interpreters.add('powershell')
    if (kind === 'ruby') interpreters.add('ruby')
    if (kind === 'perl') interpreters.add('perl')

    // Manifest parsing
    if (source.endsWith('requirements.txt')) {
      interpreters.add('python')
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim()
        if (!t || t.startsWith('#') || t.startsWith('-')) continue
        const name = t.split(/[<>=!~;[ ]/)[0].trim()
        if (name) addPkg('python', name, source)
      }
    }
    if (source.endsWith('package.json')) {
      interpreters.add('node')
      try {
        const j = JSON.parse(text) as Record<string, unknown>
        for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
          const d = j[key]
          if (d && typeof d === 'object') for (const n of Object.keys(d as Record<string, unknown>)) addPkg('node', n, source)
        }
      } catch {
        /* malformed package.json — reported via the format/dependency notes elsewhere */
      }
    }

    for (const m of text.matchAll(/(?:process\.env\.|process\.env\[['"]|os\.environ(?:\.get\(\s*)?\[?['"]?|getenv\(\s*['"]|\$\{?)([A-Z][A-Z0-9_]{2,})/g)) envVars.add(m[1])
    for (const c of COMMANDS) if (wordRe(c).test(text)) commands.add(c)
    for (const s of SERVICES) if (wordRe(s).test(text)) services.add(s)
    for (const [re, label] of OS_HINTS) if (re.test(text)) osSpecific.add(label)
    if (/(api[-_]?key|access[-_]?token|secret|password|credential|bearer\s|authorization:)/i.test(text)) credentials.add(source)
    if (/\b(curl|wget)\b|fetch\(|requests\.|axios|https?:\/\/api\./i.test(text)) network = true
  }

  for (const f of files) {
    if (typeof f.text === 'string') scanText(f.text, f.path)
  }
  if (typeof body === 'string') scanText(body, 'SKILL.md')
  if (/\b(curl|wget|download|webhook|https?:\/\/api\.)\b/i.test(body)) network = true

  return {
    interpreters: [...interpreters].sort(),
    packages: [...packageMap.values()].map((p) => ({ ecosystem: p.ecosystem, name: p.name, sources: [...p.sources] })).sort((a, b) => a.name.localeCompare(b.name)),
    envVars: [...envVars].sort(),
    commands: [...commands].sort(),
    services: [...services].sort(),
    osSpecific: [...osSpecific].sort(),
    credentials: [...credentials].sort(),
    network,
    manifests,
  }
}

/** Turn the raw dependency summary into annotated, per-item entries + findings. */
export function annotateDependencies(summary: DependencySummary, env: CompatEnvInput): { entries: CompatDependency[]; findings: CompatFinding[] } {
  const entries: CompatDependency[] = []
  const findings: CompatFinding[] = []
  const binaries = env.binaries

  const probe = (name: string): boolean | undefined => {
    if (!binaries) return undefined
    return binaries[name]
  }

  for (const interp of summary.interpreters) {
    const looked = probe(interp)
    if (!env.codeExecution) {
      entries.push({ kind: 'interpreter', name: interp, required: true, available: false, note: 'Command execution is disabled in Settings → Capabilities.' })
      findings.push({ level: 'warning', message: `Bundled ${interp} code cannot run while code execution is disabled.` })
    } else if (looked === undefined) {
      entries.push({ kind: 'interpreter', name: interp, required: true, available: undefined, note: 'Interpreter availability not probed — expected on PATH.' })
    } else if (looked) {
      entries.push({ kind: 'interpreter', name: interp, required: true, available: true, note: 'Found on PATH.' })
    } else {
      entries.push({ kind: 'interpreter', name: interp, required: true, available: false, note: 'Not found on PATH.' })
      findings.push({ level: 'error', message: `A bundled script needs "${interp}", which was not found on PATH.` })
    }
  }

  for (const pkg of summary.packages) {
    entries.push({
      kind: 'package',
      name: pkg.name,
      ecosystem: pkg.ecosystem,
      sources: pkg.sources,
      required: true,
      available: undefined,
      note: 'Declared dependency — AgentHub does not install packages; the environment must already provide it.',
    })
  }

  for (const v of summary.envVars) entries.push({ kind: 'env', name: v, required: true, available: undefined, note: 'Environment variable must be set before use.' })
  for (const c of summary.commands) {
    const looked = probe(c)
    entries.push({ kind: 'command', name: c, required: false, available: looked, note: looked === undefined ? 'External command referenced; availability not probed.' : looked ? 'Found on PATH.' : 'Not found on PATH.' })
  }
  for (const s of summary.services) entries.push({ kind: 'service', name: s, required: true, available: undefined, note: 'External service must be running and reachable.' })
  for (const o of summary.osSpecific) entries.push({ kind: 'os', name: o, required: false, available: undefined, note: 'Operating-system-specific steps — will not run everywhere.' })
  for (const c of summary.credentials) entries.push({ kind: 'credential', name: c, required: true, available: undefined, note: 'Scripts reference credentials/tokens — never paste real secrets into an untrusted skill.' })

  if (summary.network) findings.push({ level: 'info', message: 'This skill performs network requests; outbound access is a recorded preference, not sandbox-enforced.' })
  if (summary.credentials.length) findings.push({ level: 'warning', message: 'Scripts read credentials or environment variables — review before granting execution.' })

  return { entries, findings }
}

// ── Reference checking ───────────────────────────────────────────────────────

export function extractReferences(body: string): string[] {
  const out = new Set<string>()
  const push = (raw: string): void => {
    let p = raw.trim()
    if (!p) return
    p = p.split('#')[0].split('?')[0].trim()
    if (!p || /^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.startsWith('/') || p.startsWith('#') || p.startsWith('mailto:')) return
    p = p.replace(/^\.\//, '').replace(/^\.\.\//, '')
    if (/^(references|scripts|assets)\//.test(p) || /\.(md|txt|json|ya?ml|toml|csv|py|sh|js|mjs|cjs|ts|tsx|ps1|rb|html|css|xml|pdf)$/i.test(p)) out.add(p)
  }
  for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) push(m[1])
  for (const m of body.matchAll(/`([^`\n]+)`/g)) push(m[1])
  return [...out].slice(0, 40)
}

// ── Model suitability ────────────────────────────────────────────────────────

function assessModel(input: { body: string; files: CompatFileInput[]; capabilities: CompatCapability[]; scripts: CompatScript[]; env: CompatEnvInput }): ModelSuitability {
  const { body, files, capabilities, scripts, env } = input
  const referenceBytes = files.filter((f) => f.path.split('/')[0] === 'references').reduce((n, f) => n + f.size, 0)
  const stepCount = (body.match(/^\s*(?:\d+[.)]|[-*+])\s+\S/gm) ?? []).length
  const est = Math.ceil((body.length + Math.min(referenceBytes, 200_000) * 0.25) / 4) + 220
  const requiresVision = capabilities.some((c) => c.id === 'vision')
  const providerSpecific: string[] = []
  const hay = `${body}\n${files.filter((f) => f.text).map((f) => f.text).join('\n')}`
  for (const [re, label] of [
    [/\bclaude code\b/i, 'Claude Code'],
    [/\bclaude\b|\banthropic\b/i, 'Claude/Anthropic'],
    [/\bopenai\b|\bgpt-4\b|\bgpt-3\.5\b/i, 'OpenAI/GPT'],
    [/\bcursor\b/i, 'Cursor'],
    [/\bwindsurf\b/i, 'Windsurf'],
  ] as Array<[RegExp, string]>) {
    if (re.test(hay) && !providerSpecific.includes(label)) providerSpecific.push(label)
  }

  const model = env.model
  const complexity: ModelSuitability['complexity'] = stepCount > 40 || est > 6000 ? 'high' : stepCount > 15 || est > 2500 ? 'medium' : 'low'
  const issues: string[] = []
  if (requiresVision && model && !model.vision) issues.push('The skill needs image understanding, but the selected model does not advertise vision.')
  if (model?.contextLength && est > model.contextLength * 0.8) issues.push(`Estimated prompt (~${est} tokens) is close to the model's context window (${model.contextLength}).`)
  if (!model) issues.push('No loaded chat model was detected — local-model suitability is unverified.')
  if (providerSpecific.length) issues.push(`Instructions reference provider-specific agents (${providerSpecific.join(', ')}); they must be mapped to AgentHub tools.`)
  if (complexity === 'high') issues.push(`Long, multi-step workflow (${stepCount} steps) — small models may not follow it reliably.`)
  if (referenceBytes > 250_000) issues.push('Large reference material must be fetched selectively rather than loaded wholesale.')

  let status: CompatStatus
  if (requiresVision && model && !model.vision) status = 'incompatible'
  else if (!model) status = 'not-verified'
  else if (issues.length) status = 'partially-compatible'
  else status = 'fully-compatible'

  const note = !model
    ? 'No loaded model detected; suitability was assessed only from instruction size and structure.'
    : `${model.label} (${model.provider})${model.contextLength ? `, ~${model.contextLength} token context` : ''} · estimated prompt ~${est} tokens · ${complexity} complexity.`

  return { skillMdChars: body.length, estimatedPromptTokens: est, referenceBytes, scriptCount: scripts.length, stepCount, complexity, requiresVision, providerSpecific, issues, model, status, note }
}

// ── Overall status ───────────────────────────────────────────────────────────

function computeOverall(s: CompatReport['statuses'], functional: FunctionalStatus): CompatStatus {
  if (s.format === 'incompatible' || s.tools === 'incompatible' || s.security === 'incompatible' || functional === 'failed') return 'incompatible'
  if (s.security === 'needs-review' || s.metadata === 'needs-review') return 'needs-review'
  if (s.model === 'not-verified' || functional === 'blocked' || s.dependencies === 'not-verified') return 'not-verified'
  if (functional === 'not-run') return 'partially-compatible'
  if (
    s.tools === 'partially-compatible' ||
    s.dependencies === 'partially-compatible' ||
    s.model === 'partially-compatible' ||
    s.metadata === 'partially-compatible' ||
    s.format === 'partially-compatible'
  ) {
    return 'partially-compatible'
  }
  return 'fully-compatible'
}

// ── Main entry ───────────────────────────────────────────────────────────────

export function buildCompatReport(input: CompatAnalysisInput): CompatReport {
  const { id, name, dirName, skillMd, files, env, source, origin, revisionKey } = input
  const parsed = parseSkillMarkdown(skillMd, dirName || undefined)
  const body = parsed.body || ''
  const findings: CompatFinding[] = []
  const recommendations: string[] = []

  const scripts = catalogScripts(files)
  const capabilities = detectCapabilities(body, scripts)

  // Compare declared capabilities against the *actually registered* tools.
  const runtimeTools = env.runtimeTools && env.runtimeTools.length ? env.runtimeTools : RUNTIME_TOOL_NAMES
  for (const cap of capabilities) {
    const missing = cap.tools.filter((t) => !runtimeTools.includes(t))
    if (missing.length) {
      cap.support = 'unavailable'
      cap.detail = `${cap.detail} (not registered: ${missing.join(', ')})`
      findings.push({ level: 'error', message: `Capability "${cap.label}" needs ${missing.join(', ')}, which is not a registered AgentHub tool.` })
    }
  }
  const toolsStatus: CompatStatus = capabilities.some((c) => c.support === 'unavailable')
    ? 'incompatible'
    : capabilities.some((c) => c.support === 'check-required')
      ? 'partially-compatible'
      : 'fully-compatible'

  // Format
  const formatStatus: CompatStatus = !parsed.ok ? 'incompatible' : parsed.warnings.length ? 'partially-compatible' : 'fully-compatible'
  if (!parsed.ok) findings.push({ level: 'error', message: `SKILL.md is not valid: ${parsed.errors.join(' ')}` })

  // Metadata
  const unsupportedFields = Object.keys(parsed.meta.extras)
  const referenced = extractReferences(body)
  const fileSet = new Set(files.map((f) => f.path))
  const missingReferences = referenced.filter((r) => !fileSet.has(r))
  const supportedPresent = SUPPORTED_FIELDS.filter((f) => {
    if (f === 'name') return !!parsed.meta.name
    if (f === 'description') return !!parsed.meta.description
    if (f === 'license') return !!parsed.meta.license
    if (f === 'compatibility') return !!parsed.meta.compatibility
    if (f === 'metadata') return Object.keys(parsed.meta.metadata).length > 0
    return !!parsed.meta.allowedTools
  })
  const declaredFields = [...new Set([...supportedPresent, ...unsupportedFields])]
  let metadataStatus: CompatStatus = 'fully-compatible'
  if (unsupportedFields.length) {
    metadataStatus = 'needs-review'
    findings.push({ level: 'warning', message: `Unsupported frontmatter field(s) present: ${unsupportedFields.join(', ')} — AgentHub keeps them as display-only extras; remove or adapt them.` })
    recommendations.push(`Review the unsupported frontmatter field(s): ${unsupportedFields.join(', ')}.`)
  }
  if (missingReferences.length) {
    if (metadataStatus === 'fully-compatible') metadataStatus = 'partially-compatible'
    findings.push({ level: 'warning', message: `Instruction references point to missing file(s): ${missingReferences.slice(0, 8).join(', ')}.` })
    recommendations.push('Add the referenced files or update the paths in SKILL.md.')
  }
  if (parsed.meta.allowedTools) {
    findings.push({ level: 'info', message: `allowed-tools is advisory in AgentHub — "${parsed.meta.allowedTools}" does not grant any permission.` })
  }
  if (parsed.meta.description && parsed.meta.description.length > MAX_DESCRIPTION_CHARS) findings.push({ level: 'error', message: 'Description exceeds the spec limit.' })
  if (parsed.meta.compatibility && parsed.meta.compatibility.length > MAX_COMPATIBILITY_CHARS) findings.push({ level: 'error', message: 'Compatibility field exceeds the spec limit.' })

  // Dependencies
  const depSummary = detectDependencies(files, body)
  const { entries: dependencies, findings: depFindings } = annotateDependencies(depSummary, env)
  findings.push(...depFindings)
  const depStatus: CompatStatus = dependencies.some((d) => d.required && d.available === false)
    ? 'incompatible'
    : dependencies.some((d) => d.available === undefined)
      ? 'partially-compatible'
      : 'fully-compatible'
  for (const pkg of depSummary.packages) recommendations.push(`Ensure the ${pkg.ecosystem} package "${pkg.name}" is installed (AgentHub will not install it for you).`)
  for (const v of depSummary.envVars) recommendations.push(`Set the environment variable ${v} before running this skill.`)

  // Security
  const instructionHits = scanSkillText(body, 12)
  const scriptHits = scripts.flatMap((s) => s.suspicious.map((h) => ({ ...h, label: `${s.path}: ${h.label}` })))
  const HARD = /disables safety checks|instructs to edit the agent itself|asks to reveal secrets|reads \.env or key material|privilege escalation/i
  const hardBlockers = instructionHits.filter((h) => HARD.test(h.label)).map((h) => h.label)
  const securityStatus: CompatStatus = hardBlockers.length ? 'incompatible' : instructionHits.length || scriptHits.length ? 'needs-review' : 'fully-compatible'
  for (const label of hardBlockers) findings.push({ level: 'error', message: `Security blocker: the instructions contain "${label}".` })
  if (!hardBlockers.length && (instructionHits.length || scriptHits.length)) {
    findings.push({ level: 'warning', message: `Flagged ${instructionHits.length + scriptHits.length} potentially risky pattern(s) — static scanning is a warning list, not a safety guarantee.` })
  }
  if (scripts.some((s) => !s.inspected)) findings.push({ level: 'info', message: 'Some bundled scripts were not read for content; only names and sizes were inspected.' })

  // Model suitability
  const modelSuitability = assessModel({ body, files, capabilities, scripts, env })
  if (modelSuitability.providerSpecific.length) recommendations.push('Rewrite provider-specific instructions in terms of AgentHub tools (read_file, edit_file, run_command, …).')
  if (modelSuitability.requiresVision) recommendations.push('Provide a vision-capable model, or restrict the skill to text workflows.')

  // Functional test (carried in, or not-run)
  const functional: FunctionalTestResult = input.functional ?? { status: 'not-run', steps: [], limitations: ['No controlled functional test was run.'] }
  const functionalStatus: CompatStatus =
    functional.status === 'passed' ? 'fully-compatible' : functional.status === 'failed' ? 'incompatible' : functional.status === 'blocked' ? 'not-verified' : 'partially-compatible'

  const statuses: CompatReport['statuses'] = {
    format: formatStatus,
    metadata: metadataStatus,
    tools: toolsStatus,
    dependencies: depStatus,
    security: securityStatus,
    model: modelSuitability.status,
    functional: functionalStatus,
  }
  const overall = computeOverall(statuses, functional.status)

  if (overall !== 'fully-compatible' && functional.status !== 'passed') {
    recommendations.push('Run “Test skill” with the configured local model to confirm the supported workflow end to end.')
  }
  if (toolsStatus === 'incompatible') recommendations.push('Remove the steps that need unavailable capabilities, or replace them with AgentHub tools.')
  if (securityStatus === 'needs-review') recommendations.push('Review the flagged content before installing or enabling this skill.')

  return {
    schemaVersion: SKILL_COMPAT_SCHEMA_VERSION,
    origin,
    id,
    name: parsed.meta.name || name,
    dirName,
    source,
    revisionKey,
    envFingerprint: fingerprintEnv(env),
    checkedAt: input.checkedAt ?? new Date().toISOString(),
    overall,
    statuses,
    format: { ok: parsed.ok, hasFrontmatter: parsed.hasFrontmatter, errors: parsed.errors, warnings: parsed.warnings },
    metadata: {
      name: parsed.meta.name,
      description: parsed.meta.description,
      license: parsed.meta.license || source.license || '',
      compatibility: parsed.meta.compatibility,
      declaredFields: [...new Set(declaredFields)],
      supportedFields: supportedPresent,
      unsupportedFields,
      missingReferences,
    },
    capabilities,
    dependencies,
    dependencySummary: depSummary,
    scripts,
    security: { instructionHits, scriptHits, hardBlockers },
    modelSuitability,
    functional,
    findings: dedupeFindings(findings),
    recommendations: [...new Set(recommendations)].slice(0, 20),
    testedModel: functional.status === 'passed' && functional.model ? functional.model.label : undefined,
  }
}

function dedupeFindings(findings: CompatFinding[]): CompatFinding[] {
  const seen = new Set<string>()
  const out: CompatFinding[] = []
  for (const f of findings) {
    const key = `${f.level}:${f.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out.slice(0, 60)
}
