import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathSafetyError'
  }
}

const WINDOWS = process.platform === 'win32'

export const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.next-iso',
  '.next-reg',
  '.turbo',
  'coverage',
  '.cache',
  '.parcel-cache',
  'vendor',
  'target',
  'obj',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.agenthub',
])

function samePath(a: string, b: string): boolean {
  return WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b
}

function relativeIsInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  if (!rel) return true
  if (path.isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !rel.startsWith('../')
}

async function realpathNearest(target: string): Promise<{ real: string; missing: string[] }> {
  let current = target
  const missing: string[] = []
  for (;;) {
    try {
      const real = await fs.realpath(current)
      return { real, missing }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err
      const parent = path.dirname(current)
      if (parent === current) {
        throw new PathSafetyError(`Cannot resolve a real path for "${target}".`)
      }
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * Resolve a user/model supplied path and prove it is inside `root`, including
 * through symlinks. Missing path components are allowed (for new files), but
 * the nearest existing ancestor is resolved.
 */
export async function resolveInside(root: string, input: string): Promise<string> {
  if (!input || input.includes('\0')) {
    throw new PathSafetyError('Path is empty or contains a NUL byte.')
  }
  if (/^[\\/]{2}[.?][\\/]/.test(input)) {
    throw new PathSafetyError('Windows device paths are not allowed.')
  }
  const rootAbs = path.resolve(root)
  const target = path.isAbsolute(input) ? path.resolve(input) : path.resolve(rootAbs, input)
  if (!relativeIsInside(rootAbs, target) && !samePath(rootAbs, target)) {
    throw new PathSafetyError(`Path escapes the workspace: ${input}`)
  }

  let realRoot: string
  try {
    realRoot = await fs.realpath(rootAbs)
  } catch {
    throw new PathSafetyError(`Workspace does not exist: ${rootAbs}`)
  }

  const nearest = await realpathNearest(target)
  const candidateReal = path.resolve(nearest.real, ...nearest.missing)
  if (!relativeIsInside(realRoot, candidateReal) && !samePath(realRoot, candidateReal)) {
    throw new PathSafetyError(
      `Path resolves outside the workspace${nearest.missing.length ? ` (${nearest.missing.join('/')})` : ''}: ${input}`,
    )
  }
  return target
}

export function displayPath(root: string, abs: string): string {
  const rel = path.relative(root, abs)
  return (rel || '.').split(path.sep).join('/')
}

export async function readFileBounded(
  abs: string,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean; binary: boolean }> {
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new Error(`Not a file: ${abs}`)
  const bytes = stat.size
  const handle = await fs.open(abs, 'r')
  try {
    const length = Math.min(bytes, maxBytes)
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, 0)
    const binary = isProbablyBinary(buf)
    return {
      text: binary ? '' : buf.toString('utf8'),
      bytes,
      truncated: bytes > maxBytes,
      binary,
    }
  } finally {
    await handle.close()
  }
}

export function isProbablyBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function writeAtomic(abs: string, content: string, mode?: number): Promise<void> {
  await ensureDir(path.dirname(abs))
  const tmp = `${abs}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  const handle = await fs.open(tmp, 'w', mode)
  try {
    await handle.writeFile(content, 'utf8')
    // Flush before the rename. Without this, a power loss can leave a
    // correctly-named but empty file (or lose the most recent session state).
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(tmp, abs)
  } catch {
    // Windows can refuse to replace an existing file. This fallback is not
    // atomic, so fsync the destination before removing the temp file.
    await fs.copyFile(tmp, abs)
    const target = await fs.open(abs, 'r+')
    try {
      await target.sync()
    } finally {
      await target.close()
    }
    await fs.rm(tmp, { force: true })
  }
}

export function matchLineEndings(original: string, next: string): string {
  const crlf = original.includes('\r\n')
  const nextHasCrlf = next.includes('\r\n')
  if (crlf && !nextHasCrlf) return next.replace(/\n/g, '\r\n')
  if (!crlf && nextHasCrlf) return next.replace(/\r\n/g, '\n')
  return next
}

export interface WalkEntry {
  abs: string
  rel: string
  size: number
  isDirectory: boolean
}

export interface WalkOptions {
  maxFiles?: number
  maxDepth?: number
  excludeDirs?: Set<string>
  includeHidden?: boolean
}

export async function collectFiles(root: string, options: WalkOptions = {}): Promise<WalkEntry[]> {
  const maxFiles = options.maxFiles ?? 5000
  const maxDepth = options.maxDepth ?? 12
  const exclude = options.excludeDirs ?? EXCLUDED_DIRS
  const includeHidden = options.includeHidden ?? false
  const out: WalkEntry[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]

  while (stack.length > 0) {
    const item = stack.pop()
    if (!item) break
    let entries: Dirent[]
    try {
      entries = await fs.readdir(item.dir, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (out.length >= maxFiles) return out
      if (entry.isSymbolicLink()) continue
      if (!includeHidden && entry.name.startsWith('.')) {
        if (entry.isDirectory()) continue
      }
      const abs = path.join(item.dir, entry.name)
      const rel = displayPath(root, abs)
      if (entry.isDirectory()) {
        if (exclude.has(entry.name)) continue
        if (item.depth + 1 > maxDepth) continue
        out.push({ abs, rel, size: 0, isDirectory: true })
        stack.push({ dir: abs, depth: item.depth + 1 })
      } else if (entry.isFile()) {
        let size = 0
        try {
          size = (await fs.stat(abs)).size
        } catch {
          size = 0
        }
        out.push({ abs, rel, size, isDirectory: false })
      }
    }
  }
  return out
}

export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/')
  let re = ''
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        re += '.*'
        i++
        if (normalized[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else if ('\\^$+.()|{}[]'.includes(ch)) {
      re += `\\${ch}`
    } else {
      re += ch
    }
  }
  return new RegExp(`^${re}$`, 'i')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface DiffPreview {
  text: string
  added: number
  removed: number
  truncated: boolean
}

export function diffPreview(oldText: string, newText: string, maxLines = 80): DiffPreview {
  const a = oldText.split(/\r?\n/)
  const b = newText.split(/\r?\n/)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }
  const removed = a.slice(prefix, a.length - suffix)
  const added = b.slice(prefix, b.length - suffix)
  const lines: string[] = [`@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`]
  for (const line of removed) lines.push(`-${line}`)
  for (const line of added) lines.push(`+${line}`)
  const truncated = lines.length > maxLines
  let text = lines.slice(0, maxLines).join('\n')
  if (truncated) text += `\n… ${lines.length - maxLines} more diff line(s)`
  return { text, added: added.length, removed: removed.length, truncated }
}

export function tempDir(prefix = 'agenthub-'): string {
  return path.join(os.tmpdir(), `${prefix}${process.pid}-${Math.random().toString(36).slice(2)}`)
}
