import { promises as fs } from 'node:fs'
import {
  collectFiles,
  diffPreview,
  displayPath,
  formatBytes,
  globToRegExp,
  isProbablyBinary,
  matchLineEndings,
  readFileBounded,
  resolveInside,
  writeAtomic,
} from '../utils/fsx.ts'
import { redactSecrets } from '../utils/redact.ts'
import { fingerprint } from '../core/journal.ts'
import { optionalBoolean, optionalNumber, optionalString, requireString } from './validate.ts'
import { ToolInputError, type AgentTool, type ToolContext, type ToolResult } from './types.ts'

const MAX_READ_BYTES = 512 * 1024
const MAX_READ_LINES = 2000
const MAX_OUTPUT_BYTES = 160 * 1024
const MAX_WRITE_BYTES = 1024 * 1024

function cap(text: string, maxBytes = MAX_OUTPUT_BYTES): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false }
  const head = Math.floor(maxBytes * 0.6)
  const tail = Math.floor(maxBytes * 0.35)
  const buf = Buffer.from(text, 'utf8')
  const headText = buf.subarray(0, head).toString('utf8')
  const tailText = buf.subarray(Math.max(head, buf.length - tail)).toString('utf8')
  return {
    text: `${headText}\n\n… output truncated (${formatBytes(buf.length)} total) …\n\n${tailText}`,
    truncated: true,
  }
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.split(/\r?\n/).length
}

export const listDirTool: AgentTool = {
  name: 'list_dir',
  description:
    'List files and directories inside the workspace. Use it to understand project structure before reading files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path relative to the workspace (default ".").' },
      depth: { type: 'integer', description: 'Recursion depth, 1-3 (default 2).', minimum: 1, maximum: 3 },
    },
    required: [],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const rel = optionalString(input, 'path', { max: 1000 }) ?? '.'
    const depth = optionalNumber(input, 'depth', { min: 1, max: 3, integer: true }) ?? 2
    const abs = await resolveInside(ctx.workspace, rel)
    const auth = await ctx.authorize({ kind: 'fs.list', path: abs, display: displayPath(ctx.workspace, abs) }, 'list_dir')
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    let stat
    try {
      stat = await fs.stat(abs)
    } catch {
      return { ok: false, content: '', error: `Directory does not exist: ${rel}` }
    }
    if (!stat.isDirectory()) {
      return { ok: false, content: '', error: `${rel} is a file. Use read_file.` }
    }
    const entries = await collectFiles(abs, { maxDepth: depth, maxFiles: 400 })
    if (entries.length === 0) return { ok: true, content: `Directory: ${displayPath(ctx.workspace, abs)}\n(empty)` }
    const lines = entries.map((entry) => {
      const suffix = entry.isDirectory ? '/' : ` (${formatBytes(entry.size)})`
      return `${entry.rel}${suffix}`
    })
    lines.sort((a, b) => a.localeCompare(b))
    const header = `Directory: ${displayPath(ctx.workspace, abs)} (depth ${depth}, ${entries.length} entries)`
    const body = cap(`${header}\n${lines.join('\n')}`)
    return {
      ok: true,
      content: body.text,
      truncated: body.truncated,
    }
  },
}

export const readFileTool: AgentTool = {
  name: 'read_file',
  description:
    'Read a text file (or a line range) inside the workspace. Always read a file before editing it.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace.' },
      start_line: { type: 'integer', description: 'First line (1-based).', minimum: 1 },
      end_line: { type: 'integer', description: 'Last line (inclusive).', minimum: 1 },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const rel = requireString(input, 'path', { max: 1000 })
    const abs = await resolveInside(ctx.workspace, rel)
    const auth = await ctx.authorize({ kind: 'fs.read', path: abs, display: displayPath(ctx.workspace, abs) }, 'read_file')
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    let file
    try {
      file = await readFileBounded(abs, MAX_READ_BYTES)
    } catch (err) {
      return { ok: false, content: '', error: (err as Error).message }
    }
    if (file.binary) {
      return { ok: false, content: '', error: `${rel} looks like a binary file and was not read.` }
    }
    const allLines = file.text.split(/\r?\n/)
    const total = allLines.length
    const start = optionalNumber(input, 'start_line', { min: 1, integer: true }) ?? 1
    const requestedEnd = optionalNumber(input, 'end_line', { min: 1, integer: true }) ?? start + MAX_READ_LINES - 1
    const end = Math.min(total, Math.max(start, requestedEnd), start + MAX_READ_LINES - 1)
    if (start > total) {
      return { ok: false, content: '', error: `start_line ${start} is beyond the end of the file (${total} lines).` }
    }
    const width = String(end).length
    const numbered = allLines
      .slice(start - 1, end)
      .map((line, i) => `${String(start + i).padStart(width, ' ')} │ ${line}`)
      .join('\n')
    const notes: string[] = []
    if (file.truncated) notes.push(`File is larger than ${formatBytes(MAX_READ_BYTES)}; only the beginning was read.`)
    if (end < total) notes.push(`Showing lines ${start}-${end} of ${total}.`)
    const header = `${displayPath(ctx.workspace, abs)} (lines ${start}-${end} of ${total})`
    const body = cap(`${header}\n${numbered}${notes.length ? `\n\nNote: ${notes.join(' ')}` : ''}`)
    return { ok: true, content: redactSecrets(body.text), truncated: body.truncated || file.truncated }
  },
}

export const searchFilesTool: AgentTool = {
  name: 'search_files',
  description:
    'Search file contents inside the workspace. Returns matching lines with relative paths. Use it instead of reading many files.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regular expression to search for.' },
      path: { type: 'string', description: 'Directory to search (default ".").' },
      glob: { type: 'string', description: 'Optional file glob, e.g. "src/**/*.ts".' },
      regex: { type: 'boolean', description: 'Treat query as a regular expression.' },
      case_sensitive: { type: 'boolean', description: 'Case-sensitive search (default false).' },
      max_results: { type: 'integer', description: 'Maximum matches (default 50).', minimum: 1, maximum: 200 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const query = requireString(input, 'query', { max: 300 })
    const rel = optionalString(input, 'path', { max: 1000 }) ?? '.'
    const glob = optionalString(input, 'glob', { max: 300 })
    const useRegex = optionalBoolean(input, 'regex') ?? false
    const caseSensitive = optionalBoolean(input, 'case_sensitive') ?? false
    const maxResults = optionalNumber(input, 'max_results', { min: 1, max: 200, integer: true }) ?? 50
    const abs = await resolveInside(ctx.workspace, rel)
    const auth = await ctx.authorize({ kind: 'fs.list', path: abs, display: displayPath(ctx.workspace, abs) }, 'search_files')
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }

    let matcher: (line: string) => boolean
    if (useRegex) {
      let re: RegExp
      try {
        re = new RegExp(query, caseSensitive ? '' : 'i')
      } catch (err) {
        throw new ToolInputError(`Invalid regular expression: ${(err as Error).message}`)
      }
      matcher = (line) => re.test(line)
    } else {
      const needle = caseSensitive ? query : query.toLowerCase()
      matcher = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle)
    }
    const globRe = glob ? globToRegExp(glob) : null
    const files = await collectFiles(abs, { maxFiles: 3000, maxDepth: 12 })
    const matches: string[] = []
    let scanned = 0
    let skippedBinary = 0
    let stopped = false
    for (const entry of files) {
      if (ctx.signal.aborted) break
      if (entry.isDirectory) continue
      if (globRe && !globRe.test(entry.rel)) continue
      if (entry.size > 1024 * 1024) continue
      let buf: Buffer
      try {
        buf = await fs.readFile(entry.abs)
      } catch {
        continue
      }
      if (isProbablyBinary(buf)) {
        skippedBinary++
        continue
      }
      scanned++
      const lines = buf.toString('utf8').split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? ''
        if (matcher(line)) {
          matches.push(`${entry.rel}:${i + 1}: ${line.trim().slice(0, 300)}`)
          if (matches.length >= maxResults) {
            stopped = true
            break
          }
        }
      }
      if (stopped) break
    }
    if (matches.length === 0) {
      return { ok: true, content: `No matches for ${JSON.stringify(query)} in ${displayPath(ctx.workspace, abs)} (${scanned} files scanned).` }
    }
    const body = cap(
      [
        `Matches for ${JSON.stringify(query)} (${matches.length}${stopped ? '+' : ''}, ${scanned} files scanned${skippedBinary ? `, ${skippedBinary} binary skipped` : ''}):`,
        ...matches,
      ].join('\n'),
    )
    return { ok: true, content: redactSecrets(body.text), truncated: stopped || body.truncated }
  },
}

async function readOriginal(abs: string): Promise<string | null> {
  try {
    const stat = await fs.stat(abs)
    if (!stat.isFile()) return null
    if (stat.size > MAX_WRITE_BYTES) throw new Error(`File is larger than ${formatBytes(MAX_WRITE_BYTES)}.`)
    return await fs.readFile(abs, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function commitWrite(
  ctx: ToolContext,
  abs: string,
  rel: string,
  next: string,
  original: string | null,
): Promise<ToolResult> {
  ctx.signal.throwIfAborted()
  let current: string | null
  try {
    current = await readOriginal(abs)
  } catch (err) {
    return { ok: false, content: '', error: (err as Error).message }
  }
  if (current !== original) {
    return {
      ok: false,
      content: '',
      error: `The file changed after this edit was prepared: ${rel}. No write was made. Read it again and retry.`,
    }
  }
  ctx.signal.throwIfAborted()
  let backupPath: string | null = null
  if (ctx.config.backups) {
    const backup = await ctx.backups.backup(abs, next)
    backupPath = backup.backup
    if (backup.skipped) {
      ctx.events({ type: 'warning', message: backup.skipped })
    }
  }
  ctx.signal.throwIfAborted()
  await writeAtomic(abs, next)
  const diff = diffPreview(original ?? '', next, 60)
  ctx.ledger.addChanged({
    path: rel,
    change: original === null ? 'created' : 'modified',
    expectedHash: fingerprint(next),
    ...(backupPath ? { backup: backupPath } : {}),
  })
  ctx.events({
    type: 'files_changed',
    path: rel,
    change: original === null ? 'created' : 'modified',
    ...(backupPath ? { backup: backupPath } : {}),
  })
  const header = `${original === null ? 'Created' : 'Updated'} ${rel} (${formatBytes(Buffer.byteLength(next, 'utf8'))}, +${diff.added}/-${diff.removed} lines)`
  return {
    ok: true,
    content: redactSecrets(`${header}\n${diff.text}`),
    truncated: diff.truncated,
  }
}

export const writeFileTool: AgentTool = {
  name: 'write_file',
  description:
    'Create or replace a text file inside the workspace. Prefer edit_file for small changes. The change requires approval unless policy allows it.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace.' },
      content: { type: 'string', description: 'Complete new file content.' },
      reason: { type: 'string', description: 'Short reason for the change.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const rel = requireString(input, 'path', { max: 1000 })
    const content = requireString(input, 'content', { max: MAX_WRITE_BYTES, allowEmpty: true })
    const reason = optionalString(input, 'reason', { max: 300 })
    const abs = await resolveInside(ctx.workspace, rel)
    const display = displayPath(ctx.workspace, abs)
    let original: string | null
    try {
      original = await readOriginal(abs)
    } catch (err) {
      return { ok: false, content: '', error: (err as Error).message }
    }
    const next = original === null ? content : matchLineEndings(original, content)
    if (original === next) {
      return { ok: true, content: `No change: ${display} already has this content.` }
    }
    const diff = diffPreview(original ?? '', next, 50)
    const detail = [
      display,
      reason ? `Reason: ${reason}` : '',
      diff.text,
    ]
      .filter(Boolean)
      .join('\n')
    const auth = await ctx.authorize(
      { kind: 'fs.write', path: abs, display, existed: original !== null },
      'write_file',
      detail,
    )
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    return commitWrite(ctx, abs, display, next, original)
  },
}

export const editFileTool: AgentTool = {
  name: 'edit_file',
  description:
    'Replace exact text in a file inside the workspace. Fails if old_text is missing or ambiguous (unless replace_all is true). Read the file first.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace.' },
      old_text: { type: 'string', description: 'Exact existing text to replace.' },
      new_text: { type: 'string', description: 'Replacement text.' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
    },
    required: ['path', 'old_text', 'new_text'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const rel = requireString(input, 'path', { max: 1000 })
    const oldText = requireString(input, 'old_text', { max: MAX_WRITE_BYTES })
    const newText = requireString(input, 'new_text', { max: MAX_WRITE_BYTES, allowEmpty: true })
    const replaceAll = optionalBoolean(input, 'replace_all') ?? false
    const abs = await resolveInside(ctx.workspace, rel)
    const display = displayPath(ctx.workspace, abs)
    let original: string | null
    try {
      original = await readOriginal(abs)
    } catch (err) {
      return { ok: false, content: '', error: (err as Error).message }
    }
    if (original === null) {
      return { ok: false, content: '', error: `${display} does not exist. Use write_file to create it.` }
    }
    const crlf = original.includes('\r\n')
    const needle = crlf ? oldText.replace(/\r?\n/g, '\r\n') : oldText
    const replacement = crlf ? newText.replace(/\r?\n/g, '\r\n') : newText
    const occurrences = original.split(needle).length - 1
    if (occurrences === 0) {
      return {
        ok: false,
        content: '',
        error: `old_text was not found in ${display}. Read the file and copy the exact text (including indentation).`,
      }
    }
    if (occurrences > 1 && !replaceAll) {
      return {
        ok: false,
        content: '',
        error: `old_text appears ${occurrences} times in ${display}. Add more surrounding context or set replace_all.`,
      }
    }
    const next = replaceAll ? original.split(needle).join(replacement) : original.replace(needle, replacement)
    const diff = diffPreview(original, next, 50)
    const auth = await ctx.authorize(
      { kind: 'fs.write', path: abs, display, existed: true },
      'edit_file',
      `${display}\n${diff.text}`,
    )
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    return commitWrite(ctx, abs, display, next, original)
  },
}

export const fileTools: AgentTool[] = [listDirTool, readFileTool, searchFilesTool, writeFileTool, editFileTool]

export { lineCount, cap }
