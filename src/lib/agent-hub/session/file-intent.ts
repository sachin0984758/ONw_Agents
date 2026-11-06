// Pure request interpretation and write-scope policy for Agent Sessions.

// ── File scope lock ──────────────────────────────────────────────────────────
// The agent may only modify files that are explicitly the destination of the
// user's request. Enforced in the execution layer — never UI-only.

export type FileIntent = 'list' | 'read' | 'find' | 'create' | 'update' | 'delete' | 'none'

/** The single safe default destination for an unnamed create request. */
export const SAFE_DEFAULT_FILENAME = 'notebook.md'

export interface RequestIntent {
  intent: FileIntent
  /** Explicit, extension-bearing files named in the request. */
  targets: string[]
  /** A directory the request points at, when one can be resolved. */
  directory: string | null
  /** The safe default destination the app will create when none is named. */
  defaultTarget: string | null
  /** True when acting would be unsafe without one concise clarification. */
  needsClarification: boolean
  clarification?: string
}

export interface FileScope {
  /** Workspace-relative paths the agent may write/delete. */
  allowed: string[]
  /** Code implementation requests may choose project paths; each write still needs approval. */
  workspaceWrite?: boolean
  /** Human-readable reason shown when a path is refused. */
  reason: string
  /** The request intent this scope was derived from. */
  intent?: FileIntent
  /** A safe default destination chosen because the request named no file. */
  defaultTarget?: string
  /** True when `defaultTarget` was chosen by the app (not the user). */
  safeDefault?: boolean
  /** True when acting would be unsafe without one concise clarification. */
  needsClarification?: boolean
  /** A feature/project request authorizes relevant files within the workspace. */
  projectWide?: boolean
}

export function parseTargetFiles(request: string): string[] {
  const out = new Set<string>()
  // Match file-path shapes: src/foo.ts, ./foo/bar.js, foo.json, README.md …
  const re = /(?:^|[\s"'`(])((?:\.?\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.[a-zA-Z]{1,10})(?=[\s"'`)]|$|[,;])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(request)) !== null) {
    const p = m[1].replace(/^\.\//, '').replace(/^\//, '')
    if (p.length > 1 && p.length < 200 && !p.includes('..')) out.add(p)
  }
  return [...out]
}

// A directory reference: either a trailing-slash path (src/, ./app/lib/) or a
// "in|into|under|inside <dir>" phrase whose token has no file extension.
export function parseTargetDirs(request: string): string | null {
  const quoted = request.match(/\b(?:in|into|under|inside)\s+(?:the\s+)?(?:(?:folder|directory|dir)\s+(?:named\s+)?)?[`"']([^`"'\r\n]+)[`"']/i)
  if (quoted) return quoted[1].replace(/^\.\//, '').replace(/\/$/, '')
  const slash = request.match(/(?:^|[\s"'`(])(\.?\/?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)\/(?=[\s"'`)]|$)/)
  if (slash) return slash[1].replace(/^\.\//, '').replace(/^\//, '')
  const inDir = request.match(
    /\b(?:in|into|under|inside)\s+(?:the\s+)?((?:folder|directory|dir)\s+(?:named\s+)?)?([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)(?:\s+(?:folder|directory|dir))?\b/i,
  )
  if (inDir) {
    const d = inDir[2].replace(/^\.\//, '').replace(/^\//, '')
    const generic = !inDir[1] && /^(here|there|that|this|the|a|an|it|my|your|our|same|current|workspace|project|root|folder|directory|dir|repo|repository)$/i.test(d)
    if (d && !generic && !/\.[a-zA-Z]{1,10}$/.test(d)) return d
  }
  return null
}

const CREATE_VERBS = /\b(create|make|add|new|write|generate|scaffold|produce|draft|build|set\s?up)\b/i
const UPDATE_VERBS = /\b(update|edit|change|modify|fix|append|insert|patch|refactor|rename|correct|adjust)\b/i
const DELETE_VERBS = /\b(delete|remove|erase|drop)\b/i
const READ_VERBS = /\b(read|show|display|open|cat|print|view|dump)\b/i
const LIST_VERBS = /\b(list|ls|tree|directory|folder|contents)\b/i
const FIND_VERBS = /\b(find|search|locate|grep|where)\b/i
const PROJECT_ARTIFACT = /\b(game|app|application|website|web\s*site|site|dashboard|tool|calculator|editor|portfolio|landing\s*page|component|feature|page|plugin|api|endpoint|service|script|program|bug|issue|error|code|functionality|route|screen|button|layout|sidebar|chat|input|navigation|style|css|color|spacing|header|footer|modal|menu|alignment|form|table|widget|dropdown|icon|hover|navbar)\b/i

/**
 * Session prompts often name the desired artifact without an imperative verb
 * (for example, "chess game"). In the coding-agent surface that means build it.
 * Questions, destructive requests and generic file/document requests remain
 * read-only or clarifying.
 */
function isProjectImplementationRequest(request: string): boolean {
  const text = request.trim()
  if (!text || !PROJECT_ARTIFACT.test(text) || DELETE_VERBS.test(text)) return false
  const hasBuildVerb = /\b(build|make|create|add|write|generate|scaffold|develop|implement|fix|edit|update|change|repair|refactor)\b/i.test(text)
  if (hasBuildVerb) return true
  if (/[?]\s*$/.test(text)) return false
  const words = text.match(/[a-z0-9]+/gi) ?? []
  return words.length >= 2 && words.length <= 5 && !/\b(read|show|open|list|find|search|explain|describe|analyze|inspect|understand|overview|summary|what|how|why|roadmap|plan|teach|tutorial|lesson|course|guide|steps|structure|architecture|documentation|docs|status|meaning|definition)\b/i.test(text)
}

export function isCommandOnlyRequest(request: string): boolean {
  return /^\s*(?:please\s+)?(?:run|execute)\b/i.test(request) && !/\b(?:and|then)\s+(?:create|make|add|edit|fix|update|delete|remove)\b/i.test(request)
}

export function isInformationRequest(request: string): boolean {
  return /^\s*(?:what|why|how\s+(?:do|does|did|to|can\s+I)|explain|describe|teach|tell\s+me\s+how)\b/i.test(request) && !/\b(?:and|then)\s+(?:please\s+)?(?:fix|implement|create|make|edit|update|remove|delete)\b/i.test(request)
}

export function isProjectChangeRequest(request: string): boolean {
  if (isCommandOnlyRequest(request) || isInformationRequest(request)) return false
  const area = /\b(app|application|website|site|game|feature|component|dashboard|page|api|project|workspace|sidebar|chat|editor|layout|login|navigation|agent|bug)\b/i.test(request)
  const fragment = request.trim().length < 100 && !/[?]/.test(request) && !/\b(what|why|how|explain|describe|teach|learn|count|many)\b/i.test(request) && /\b(game|website|application|dashboard)\b/i.test(request)
  return !DELETE_VERBS.test(request) && ((area && (CREATE_VERBS.test(request) || UPDATE_VERBS.test(request))) || fragment || isProjectImplementationRequest(request))
}

export function isFileCountRequest(request: string): boolean {
  return /\b(?:how\s+many|count|number\s+of|total)\b[\s\S]*\bfiles?\b|\bfiles?\b[\s\S]*\b(?:count|total|number)\b/i.test(request) && !/\b(?:lines?|words?|characters?|tokens?|add|implement|build|create|fix|edit|remove|delete)\b/i.test(request)
}

export function detectFileIntent(request: string): RequestIntent {
  const targets = parseTargetFiles(request)
  const directory = parseTargetDirs(request)
  if (isCommandOnlyRequest(request) || isInformationRequest(request)) return { intent: 'none', targets, directory, defaultTarget: null, needsClarification: false }
  let intent: FileIntent = 'none'
  if (DELETE_VERBS.test(request)) intent = 'delete'
  else if (UPDATE_VERBS.test(request)) intent = 'update'
  else if (CREATE_VERBS.test(request)) intent = 'create'
  else if (READ_VERBS.test(request)) intent = 'read'
  else if (LIST_VERBS.test(request)) intent = 'list'
  else if (FIND_VERBS.test(request)) intent = 'find'
  else if (isProjectChangeRequest(request)) intent = 'create'

  let defaultTarget: string | null = null
  if (intent === 'create') {
    defaultTarget = directory ? `${directory}/${SAFE_DEFAULT_FILENAME}` : SAFE_DEFAULT_FILENAME
  }
  const needsClarification = targets.length === 0 && (intent === 'delete' || (intent === 'update' && !isProjectChangeRequest(request)))
  const clarification = needsClarification
    ? `Which file should I ${intent === 'delete' ? 'delete' : 'update'}? No file was named, so nothing has been changed.`
    : undefined
  return { intent, targets, directory, defaultTarget, needsClarification, clarification }
}

export function getFileScope(request: string): FileScope {
  const explicit = parseTargetFiles(request)
  const info = detectFileIntent(request)
  if (!['create', 'update', 'delete'].includes(info.intent) && !isProjectChangeRequest(request)) {
    return { allowed: [], reason: 'This request asks for inspection or an answer; no file changes were requested.', intent: info.intent }
  }
  if (explicit.length) {
    return {
      allowed: explicit,
      reason: `This task targets: ${explicit.join(', ')}. Other files are out of scope.`,
      intent: info.intent,
    }
  }
  if (isProjectChangeRequest(request)) {
    return { allowed: [info.directory ?? '.'], reason: 'Implement the requested feature in relevant workspace files. Inspect existing files before changing them.', intent: info.intent, projectWide: true }
  }
  // An unnamed CREATE gets one deterministic, safe destination instead of a
  // silent failure. Update/delete never invent a target (they ask instead).
  if (info.intent === 'create') {
    const dest = info.defaultTarget ?? SAFE_DEFAULT_FILENAME
    return {
      allowed: [dest],
      reason: info.directory
        ? `No file was named; this task creates ${dest} in ${info.directory} (safe default). Other files are out of scope.`
        : `No file was named; this task creates ${dest} (safe default). Other files are out of scope.`,
      intent: 'create',
      defaultTarget: dest,
      safeDefault: true,
    }
  }
  return {
    allowed: [],
    reason:
      info.needsClarification
        ? `No destination file was named to ${info.intent} this request — state the file (or folder) to proceed.`
        : 'No destination file was named in this request — nothing may be modified.',
    intent: info.intent,
    needsClarification: info.needsClarification,
  }
}

export function isPathInScope(scope: FileScope, relPath: string): boolean {
  if (scope.workspaceWrite) return true
  return isPathInExplicitScope(scope, relPath)
}

export function isPathInExplicitScope(scope: FileScope, relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '')
  if (!norm || /(^|\/)\.\.(\/|$)/.test(norm) || /^[A-Za-z]:/.test(norm) || relPath.startsWith('/') || relPath.startsWith('\\')) return false
  return scope.allowed.some((a) => {
    const aNorm = a.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '')
    return (scope.projectWide && aNorm === '.') || norm === aNorm || norm.startsWith(`${aNorm}/`)
  })
}


