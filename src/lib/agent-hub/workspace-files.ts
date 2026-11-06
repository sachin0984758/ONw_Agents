import { workspaceResult } from './workspace-result'
import { promises as fs } from 'fs'
import path from 'path'
import { writeTextAtomic } from './fs-atomic'
import { readRuntimePolicy } from '@/lib/agent-hub/runtime-policy'
import { currentWorkspaceRoot as workspaceRoot } from '@/lib/agent-hub/session/workspaces'

// Shared workspace file service for HTTP adapters and server-owned Session /
// Auto tools. Runtime workspaces are data, not build-time trace dependencies.
//
//   GET   ?op=info                              → workspace root + project name
//   GET   ?op=list&path=<rel>                   → directory entries (capped)
//   GET   ?op=tree&path=<rel>&depth=<n>         → recursive listing (bounded)
//   GET   ?op=count&path=<rel>                 → recursive file count, no content reads
//   GET   ?op=read&path=<rel>&offset&limit      → text file range (capped)
//   GET   ?op=search&pattern=<re>&path=<rel>    → content search (bounded)
//   GET   ?op=filenames&q=<text>&path=<rel>     → filename search (capped)
//   POST  {op:'write', path, content, mode}     → create/overwrite file
//   POST  {op:'edit', path, oldText, newText, mode} → targeted replacement
//
// Safety: every path is resolved inside the workspace root (no escape);
// dot-env secrets and key material are never read; sensitive locations and
// lockfiles are never written. Writes additionally require mode:'edit'.
// This is a local-dashboard trust boundary (same as a terminal), not a
// sandbox: destructive shell-level actions are governed by the exec API's
// own policy plus the session's approval gates.
// ─────────────────────────────────────────────────────────────────────────────





function resolveInRoot(root: string, rel: unknown): { ok: true; abs: string; rel: string } | { ok: false; error: string } {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 1024) {
    return { ok: false, error: 'Path is required (max 1024 chars).' }
  }
  if (rel.includes('\0')) return { ok: false, error: 'Invalid path.' }
  const abs = path.resolve(root, rel)
  const outside = path.relative(root, abs).startsWith('..') || path.isAbsolute(path.relative(root, abs))
  if (outside) return { ok: false, error: `Path escapes the workspace: "${rel}".` }
  return { ok: true, abs, rel: path.relative(root, abs) || '.' }
}

async function realPathInRoot(root: string, target: string): Promise<string | null> {
  const realRoot = await fs.realpath(/* turbopackIgnore: true */ root)
  let ancestor = target
  const missing: string[] = []
  while (true) {
    try {
      const real = await fs.realpath(/* turbopackIgnore: true */ ancestor)
      const relative = path.relative(realRoot, real)
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? path.join(real, ...missing) : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(ancestor)
      if (parent === ancestor) return null
      missing.unshift(path.basename(ancestor))
      ancestor = parent
    }
  }
}

function posixRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/') || '.'
}

// path.relative hands back platform separators (backslashes on Windows), so
// normalize to forward slashes before matching the blocklists below — otherwise
// "node_modules\..." or "sub\package-lock.json" slip past the "/" checks.
function normalizeRel(rel: string): string {
  return rel.split('\\').join('/')
}

function baseName(p: string): string {
  return p.split('/').pop() ?? p
}

// Never read secrets. Never write sensitive or generated locations.
function isBlockedRead(rel: string): boolean {
  const b = baseName(normalizeRel(rel)).toLowerCase()
  return (
    b.startsWith('.env') ||
    b.endsWith('.pem') ||
    b.endsWith('.key') ||
    b.endsWith('.db') ||
    b === 'id_rsa' ||
    b === 'id_ed25519'
  )
}

function isBlockedWrite(rel: string): boolean {
  const posix = normalizeRel(rel)
  const lower = posix.toLowerCase()
  const b = baseName(lower)
  if (isBlockedRead(rel)) return true
  if (
    lower.startsWith('.git/') ||
    lower.startsWith('node_modules/') ||
    lower.startsWith('.next/') ||
    lower.startsWith('db/') ||
    lower === '.git' ||
    lower === 'node_modules' ||
    lower === '.next' ||
    lower === 'db'
  ) {
    return true
  }
  return (
    b === 'package-lock.json' ||
    b === 'bun.lock' ||
    b === 'yarn.lock' ||
    b === 'pnpm-lock.yaml' ||
    b === 'tsconfig.tsbuildinfo' ||
    b === 'next-env.d.ts'
  )
}

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', '.turbo'])
const MAX_LIST = 500
const MAX_TREE = 800
const MAX_READ_BYTES = 1024 * 1024
const MAX_SEARCH_FILES = 3000
const MAX_SEARCH_FILE_BYTES = 256 * 1024
const MAX_MATCHES = 100

async function isBinary(abs: string): Promise<boolean> {
  const fh = await fs.open(abs, 'r')
  try {
    const buf = Buffer.alloc(8192)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead).includes(0)
  } finally {
    await fh.close()
  }
}

export async function readWorkspaceFiles(q: URLSearchParams, signal?: AbortSignal) {
  const root = workspaceRoot()
  const op = q.get('op') ?? 'info'

  try {
    if (op === 'info') {
      return workspaceResult({ ok: true, root, projectName: path.basename(root), platform: process.platform, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' })
    }

    const target = resolveInRoot(root, q.get('path') ?? '.')
    if (!target.ok) return workspaceResult({ ok: false, error: target.error }, { status: 400 })
    const realTargetPath = await realPathInRoot(root, target.abs)
    if (!realTargetPath) return workspaceResult({ ok: false, error: 'Path escapes the workspace through a symbolic link.' }, { status: 403 })
    if ((op === 'read' || op === 'search') && isBlockedRead(posixRel(root, realTargetPath))) return workspaceResult({ ok: false, error: 'Reading the resolved secret file is not allowed.' }, { status: 403 })

    if (op === 'count') {
      const r = resolveInRoot(root, q.get('path') ?? '.')
      if (!r.ok) return workspaceResult({ ok: false, error: r.error }, { status: 400 })
      const realRoot = await fs.realpath(/* turbopackIgnore: true */ root)
      const realTarget = await fs.realpath(/* turbopackIgnore: true */ r.abs).catch(() => null)
      if (!realTarget) return workspaceResult({ ok: false, error: `Not found: "${r.rel}".` }, { status: 404 })
      const relative = path.relative(realRoot, realTarget)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return workspaceResult({ ok: false, error: 'Path escapes the workspace through a symbolic link.' }, { status: 403 })
      }
      if (!(await fs.stat(/* turbopackIgnore: true */ realTarget)).isDirectory()) {
        return workspaceResult({ ok: false, error: `Not a directory: "${r.rel}".` }, { status: 400 })
      }
      const includeGenerated = q.get('includeGenerated') !== 'false'
      const recursive = q.get('recursive') !== 'false'
      const extension = (q.get('extension') ?? '').replace(/^\./, '').toLowerCase()
      if (extension && !/^[a-z0-9]{1,16}$/.test(extension)) {
        return workspaceResult({ ok: false, error: 'Invalid file extension.' }, { status: 400 })
      }
      const pending = [realTarget]
      const started = Date.now()
      let files = 0
      let directories = 0
      let skipped = 0
      let visited = 0
      let truncated = false
      while (pending.length) {
        if (signal?.aborted) return workspaceResult({ ok: false, error: 'File count cancelled.' }, { status: 408 })
        if (Date.now() - started > 30_000 || visited >= 2_000_000) { truncated = true; break }
        const dir = pending.pop()!
        try {
          const entries = await fs.readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true })
          for (const entry of entries) {
            visited++
            // Like find -type f, do not follow symlinks/junctions or count them as files.
            if (entry.isDirectory()) {
              if (!includeGenerated && SKIP_DIRS.has(entry.name)) continue
              directories++
              if (recursive) pending.push(path.join(dir, entry.name))
            } else if (entry.isFile() && (!extension || path.extname(entry.name).toLowerCase() === `.${extension}`)) files++
          }
        } catch { skipped++ }
      }
      return workspaceResult({ ok: true, path: r.rel, files, directories, recursive, includeGenerated, extension, exact: !truncated && skipped === 0, skipped, truncated })
    }

    if (op === 'list') {
      const r = resolveInRoot(root, q.get('path') ?? '.')
      if (!r.ok) return workspaceResult({ ok: false, error: r.error }, { status: 400 })
      let stat
      try {
        stat = await fs.stat(/* turbopackIgnore: true */ r.abs)
      } catch {
        return workspaceResult({ ok: false, error: `Not found: "${q.get('path')}".` }, { status: 404 })
      }
      if (!stat.isDirectory()) return workspaceResult({ ok: false, error: `Not a directory: "${q.get('path')}".` }, { status: 400 })
      const names = await fs.readdir(/* turbopackIgnore: true */ r.abs)
      const entries: Array<{ name: string; type: 'dir' | 'file'; size: number; hidden: boolean }> = []
      for (const name of names.slice(0, MAX_LIST)) {
        try {
          const st = await fs.lstat(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ r.abs, name))
          if (st.isSymbolicLink()) continue
          entries.push({
            name,
            type: st.isDirectory() ? 'dir' : 'file',
            size: st.isDirectory() ? 0 : st.size,
            hidden: name.startsWith('.'),
          })
        } catch {
          // entry vanished mid-listing — skip it
        }
      }
      entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      return workspaceResult({ ok: true, path: r.rel, entries, truncated: names.length > MAX_LIST })
    }

    if (op === 'tree') {
      const r = resolveInRoot(root, q.get('path') ?? '.')
      if (!r.ok) return workspaceResult({ ok: false, error: r.error }, { status: 400 })
      const depth = Math.min(5, Math.max(1, Number(q.get('depth') ?? 3) || 3))
      const out: Array<{ path: string; type: 'dir' | 'file' }> = []
      let truncated = false
      const walk = async (abs: string, d: number): Promise<void> => {
        if (out.length >= MAX_TREE) {
          truncated = true
          return
        }
        let names: string[]
        try {
          names = await fs.readdir(/* turbopackIgnore: true */ abs)
        } catch {
          return
        }
        names.sort()
        for (const name of names) {
          if (out.length >= MAX_TREE) {
            truncated = true
            return
          }
          const child = path.join(abs, name)
          let st
          try {
            st = await fs.lstat(/* turbopackIgnore: true */ child)
            if (st.isSymbolicLink()) continue
          } catch {
            continue
          }
          if (st.isDirectory()) {
            if (SKIP_DIRS.has(name)) continue
            out.push({ path: posixRel(root, child) + '/', type: 'dir' })
            // Installed skills can contain whole repositories. Keep their
            // root visible without letting them consume the project outline.
            if (d < depth && name !== '.agenthub') await walk(child, d + 1)
          } else {
            out.push({ path: posixRel(root, child), type: 'file' })
          }
        }
      }
      await walk(r.abs, 1)
      return workspaceResult({ ok: true, path: r.rel, tree: out, truncated })
    }

    if (op === 'read') {
      const r = resolveInRoot(root, q.get('path'))
      if (!r.ok) return workspaceResult({ ok: false, error: r.error }, { status: 400 })
      if (isBlockedRead(r.rel)) {
        return workspaceResult({ ok: false, error: `Reading "${r.rel}" is not allowed (secrets protection).` }, { status: 403 })
      }
      let stat
      try {
        stat = await fs.stat(/* turbopackIgnore: true */ r.abs)
      } catch {
        return workspaceResult({ ok: false, error: `Not found: "${r.rel}".` }, { status: 404 })
      }
      if (!stat.isFile()) return workspaceResult({ ok: false, error: `Not a file: "${r.rel}".` }, { status: 400 })
      if (stat.size > MAX_READ_BYTES) {
        return workspaceResult(
          { ok: false, error: `"${r.rel}" is too large (${stat.size} bytes, max ${MAX_READ_BYTES}).` },
          { status: 413 },
        )
      }
      if (await isBinary(r.abs)) {
        return workspaceResult({ ok: false, error: `"${r.rel}" looks binary — text reads are not supported.` }, { status: 415 })
      }
      const text = await fs.readFile(/* turbopackIgnore: true */ r.abs, 'utf-8')
      const lines = text.split('\n')
      const offset = Math.max(0, Number(q.get('offset') ?? 0) || 0)
      const limit = Math.min(1000, Math.max(1, Number(q.get('limit') ?? 200) || 200))
      const slice = lines.slice(offset, offset + limit)
      return workspaceResult({
        ok: true,
        path: r.rel,
        content: slice.join('\n'),
        totalLines: lines.length,
        offset,
        limit,
        size: stat.size,
        truncated: offset + limit < lines.length,
      })
    }

    if (op === 'search') {
      const pattern = q.get('pattern') ?? ''
      if (!pattern || pattern.length > 500) {
        return workspaceResult({ ok: false, error: 'Search pattern is required (max 500 chars).' }, { status: 400 })
      }
      const r = resolveInRoot(root, q.get('path') ?? '.')
      if (!r.ok) return workspaceResult({ ok: false, error: r.error }, { status: 400 })
      let re: RegExp
      try {
        re = new RegExp(pattern)
      } catch {
        re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      }
      const matches: Array<{ file: string; line: number; text: string }> = []
      let scanned = 0
      let truncated = false
      const walk = async (abs: string): Promise<void> => {
        if (truncated || scanned >= MAX_SEARCH_FILES || matches.length >= MAX_MATCHES) return
        let names: string[]
        try {
          const st = await fs.lstat(/* turbopackIgnore: true */ abs)
          if (st.isSymbolicLink()) return
          if (st.isFile()) {
            await scanFile(abs)
            return
          }
          names = await fs.readdir(/* turbopackIgnore: true */ abs)
        } catch {
          return
        }
        for (const name of names) {
          if (truncated || scanned >= MAX_SEARCH_FILES || matches.length >= MAX_MATCHES) {
            truncated = true
            return
          }
          const child = path.join(abs, name)
          let st
          try {
            st = await fs.lstat(/* turbopackIgnore: true */ child)
            if (st.isSymbolicLink()) continue
          } catch {
            continue
          }
          if (st.isDirectory()) {
            if (SKIP_DIRS.has(name)) continue
            await walk(child)
          } else {
            await scanFile(child)
          }
        }
      }
      const scanFile = async (abs: string): Promise<void> => {
        scanned += 1
        try {
          const st = await fs.lstat(/* turbopackIgnore: true */ abs)
          if (st.isSymbolicLink()) return
          if (st.size > MAX_SEARCH_FILE_BYTES || isBlockedRead(posixRel(root, abs))) return
          if (await isBinary(abs)) return
          const text = await fs.readFile(/* turbopackIgnore: true */ abs, 'utf-8')
          const lines = text.split('\n')
          for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
            re.lastIndex = 0
            if (re.test(lines[i])) {
              matches.push({ file: posixRel(root, abs), line: i + 1, text: lines[i].slice(0, 300) })
            }
          }
          if (matches.length >= MAX_MATCHES) truncated = true
        } catch {
          // unreadable file — skip it
        }
      }
      await walk(r.abs)
      return workspaceResult({ ok: true, pattern, matches, scanned, truncated })
    }

    if (op === 'filenames') {
      const needle = (q.get('q') ?? '').toLowerCase()
      if (!needle || needle.length > 200) {
        return workspaceResult({ ok: false, error: 'Query q is required (max 200 chars).' }, { status: 400 })
      }
      const r = resolveInRoot(root, q.get('path') ?? '.')
      if (!r.ok) return workspaceResult({ ok: false, error: r.error }, { status: 400 })
      const out: string[] = []
      let scanned = 0
      const walk = async (abs: string): Promise<void> => {
        if (out.length >= MAX_MATCHES || scanned >= MAX_SEARCH_FILES) return
        let names: string[]
        try {
          names = await fs.readdir(/* turbopackIgnore: true */ abs)
        } catch {
          return
        }
        for (const name of names) {
          if (out.length >= MAX_MATCHES || scanned >= MAX_SEARCH_FILES) return
          scanned += 1
          const child = path.join(abs, name)
          let st
          try {
            st = await fs.lstat(/* turbopackIgnore: true */ child)
            if (st.isSymbolicLink()) continue
          } catch {
            continue
          }
          if (st.isDirectory()) {
            if (SKIP_DIRS.has(name)) continue
            await walk(child)
          } else if (name.toLowerCase().includes(needle)) {
            out.push(posixRel(root, child))
          }
        }
      }
      await walk(r.abs)
      return workspaceResult({ ok: true, q: needle, files: out, truncated: out.length >= MAX_MATCHES })
    }

    return workspaceResult(
      { ok: false, error: `Unknown op "${op}". Use info, list, tree, count, read, search or filenames.` },
      { status: 400 },
    )
  } catch (err) {
    return workspaceResult(
      { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : 'File operation failed.' },
      { status: 500 },
    )
  }
}

export async function mutateWorkspaceFile(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return workspaceResult({ ok: false, error: 'Request body must be a JSON object.' }, { status: 400 })
  const body = input as { op?: unknown; path?: unknown; content?: unknown; oldText?: unknown; newText?: unknown; mode?: unknown }
  if (body.mode !== 'edit') {
    return workspaceResult({ ok: false, error: 'Writes require edit mode.' }, { status: 403 })
  }

  // Honour Settings → Capabilities → "Code execution and file creation".
  // Reads (GET) are unaffected; only file mutation is gated here.
  const policy = await readRuntimePolicy()
  if (!policy.codeExecution) {
    return workspaceResult(
      {
        ok: false,
        error:
          'File creation and editing are disabled (Settings → Capabilities → "Code execution and file creation"). Enable them to write files.',
      },
      { status: 403 },
    )
  }

  const root = workspaceRoot()

  try {
    const target = resolveInRoot(root, body.path)
    if (!target.ok) return workspaceResult({ ok: false, error: target.error }, { status: 400 })
    const realTargetPath = await realPathInRoot(root, target.abs)
    if (!realTargetPath) return workspaceResult({ ok: false, error: 'Path escapes the workspace through a symbolic link.' }, { status: 403 })
    if (isBlockedWrite(posixRel(root, realTargetPath))) return workspaceResult({ ok: false, error: 'Writing the resolved protected location is not allowed.' }, { status: 403 })
    if (body.op === 'write') {
      const r = resolveInRoot(root, body.path)
      if (!r.ok) return workspaceResult({ ok: false, error: r.error }, { status: 400 })
      if (isBlockedWrite(r.rel)) {
        return workspaceResult({ ok: false, error: `Writing "${r.rel}" is not allowed (protected location).` }, { status: 403 })
      }
      if (typeof body.content !== 'string') {
        return workspaceResult({ ok: false, error: 'content must be a string.' }, { status: 400 })
      }
      if (body.content.length > 1024 * 1024) {
        return workspaceResult({ ok: false, error: 'content is too large (max 1 MiB).' }, { status: 413 })
      }
      let existed = false
      try {
        const st = await fs.stat(/* turbopackIgnore: true */ r.abs)
        existed = st.isFile()
        if (!existed) return workspaceResult({ ok: false, error: `"${r.rel}" exists and is not a file.` }, { status: 400 })
      } catch {
        existed = false
      }
      await writeTextAtomic(r.abs, body.content)
      return workspaceResult({ ok: true, path: r.rel, bytes: body.content.length, created: !existed })
    }

    if (body.op === 'edit') {
      const r = resolveInRoot(root, body.path)
      if (!r.ok) return workspaceResult({ ok: false, error: r.error }, { status: 400 })
      if (isBlockedWrite(r.rel)) {
        return workspaceResult({ ok: false, error: `Editing "${r.rel}" is not allowed (protected location).` }, { status: 403 })
      }
      if (typeof body.oldText !== 'string' || !body.oldText) {
        return workspaceResult({ ok: false, error: 'oldText is required.' }, { status: 400 })
      }
      if (typeof body.newText !== 'string') {
        return workspaceResult({ ok: false, error: 'newText must be a string.' }, { status: 400 })
      }
      let text: string
      try {
        const st = await fs.stat(/* turbopackIgnore: true */ r.abs)
        if (!st.isFile()) return workspaceResult({ ok: false, error: `Not a file: "${r.rel}".` }, { status: 400 })
        if (st.size > MAX_READ_BYTES) {
          return workspaceResult({ ok: false, error: `"${r.rel}" is too large to edit safely.` }, { status: 413 })
        }
        if (await isBinary(r.abs)) {
          return workspaceResult({ ok: false, error: `"${r.rel}" looks binary.` }, { status: 415 })
        }
        text = await fs.readFile(/* turbopackIgnore: true */ r.abs, 'utf-8')
      } catch {
        return workspaceResult({ ok: false, error: `Not found: "${r.rel}".` }, { status: 404 })
      }
      const count = text.split(body.oldText).length - 1
      if (count === 0) {
        return workspaceResult({ ok: false, error: `No match for oldText in "${r.rel}". Copy the text exactly from the file.` }, { status: 400 })
      }
      if (count > 1) {
        return workspaceResult(
          { ok: false, error: `oldText matches ${count} times in "${r.rel}" — include more surrounding lines to make it unique.` },
          { status: 400 },
        )
      }
      const next = text.replace(body.oldText, body.newText)
      await writeTextAtomic(r.abs, next)
      return workspaceResult({ ok: true, path: r.rel, replacements: 1 })
    }

    if (body.op === 'delete') {
      const r = resolveInRoot(root, body.path)
      if (!r.ok) return workspaceResult({ ok: false, error: r.error }, { status: 400 })
      if (isBlockedWrite(r.rel)) {
        return workspaceResult({ ok: false, error: `Deleting "${r.rel}" is not allowed (protected location).` }, { status: 403 })
      }
      try {
        const st = await fs.stat(/* turbopackIgnore: true */ r.abs)
        if (!st.isFile()) return workspaceResult({ ok: false, error: `Not a file: "${r.rel}".` }, { status: 400 })
        await fs.rm(r.abs, { force: false })
        return workspaceResult({ ok: true, path: r.rel, deleted: true })
      } catch {
        return workspaceResult({ ok: false, error: `Not found: "${r.rel}".` }, { status: 404 })
      }
    }

    return workspaceResult({ ok: false, error: 'Unknown op. Use write, edit or delete.' }, { status: 400 })
  } catch (err) {
    return workspaceResult(
      { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Write operation failed.' },
      { status: 500 },
    )
  }
}
