import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentConfig } from '../config/types.ts'
import { ensureDir, resolveInside, tempDir, writeAtomic } from '../utils/fsx.ts'
import { parseSkillMarkdown } from './parse.ts'
import { checkRepoCompat, probeApp } from './compat.ts'

export interface InstallOptions {
  source: string
  ref?: string
  dir?: string
  skill?: string
  user?: boolean
  force?: boolean
  signal: AbortSignal
  log: (line: string) => void
}

export interface InstallResult {
  ok: boolean
  installed: string[]
  targetRoot: string
  candidates?: Array<{ name: string; dir: string }>
  error?: string
  warnings: string[]
  commit?: string
  source: string
}

interface CloneResult {
  ok: boolean
  dir?: string
  commit?: string
  error?: string
}

function isUrl(source: string): boolean {
  return /^https?:\/\//i.test(source) || /^git@[^:]+:/i.test(source) || /^ssh:\/\//i.test(source)
}

function parseGitHub(source: string): { cloneUrl: string; ref?: string; dir?: string } | null {
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/i.exec(source.trim())
  if (!match) return null
  const owner = match[1]
  const repo = match[2]
  if (!owner || !repo) return null
  return {
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    ref: match[3],
    dir: match[4],
  }
}

function runGit(args: string[], cwd: string | undefined, signal: AbortSignal, timeoutMs = 120_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    const onAbort = () => child.kill()
    signal.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (c: Buffer) => {
      stdout = (stdout + c.toString('utf8')).slice(0, 40_000)
    })
    child.stderr?.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString('utf8')).slice(0, 40_000)
    })
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr })
    }
    child.on('error', (err) => {
      stderr += err.message
      finish(127)
    })
    child.on('close', (code) => finish(code))
  })
}

async function cloneRepo(url: string, ref: string | undefined, signal: AbortSignal, log: (s: string) => void): Promise<CloneResult> {
  const dir = tempDir('agenthub-install-')
  await ensureDir(dir)
  const isSha = Boolean(ref && /^[0-9a-f]{7,40}$/i.test(ref))
  const args = ['clone', '--depth', '1']
  if (ref && !isSha) args.push('--branch', ref)
  args.push(url, dir)
  log(`Cloning ${url}${ref ? ` @ ${ref}` : ''} (shallow, no submodules)…`)
  const result = await runGit(args, undefined, signal)
  if (result.code !== 0 && isSha) {
    const retry = tempDir('agenthub-install-')
    await ensureDir(retry)
    const base = await runGit(['clone', '--depth', '1', url, retry], undefined, signal)
    if (base.code !== 0) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
      await fs.rm(retry, { recursive: true, force: true }).catch(() => undefined)
      return { ok: false, error: (base.stderr || base.stdout).trim() || 'git clone failed.' }
    }
    log(`Fetching commit ${ref}…`)
    const fetch = await runGit(['fetch', '--depth', '1', 'origin', ref!], retry, signal)
    if (fetch.code !== 0) {
      await fs.rm(retry, { recursive: true, force: true }).catch(() => undefined)
      return { ok: false, error: (fetch.stderr || fetch.stdout).trim() || `Could not fetch ${ref}.` }
    }
    const checkout = await runGit(['checkout', '--detach', 'FETCH_HEAD'], retry, signal)
    if (checkout.code !== 0) {
      await fs.rm(retry, { recursive: true, force: true }).catch(() => undefined)
      return { ok: false, error: (checkout.stderr || checkout.stdout).trim() || 'git checkout failed.' }
    }
    const commit = await runGit(['rev-parse', 'HEAD'], retry, signal)
    return { ok: true, dir: retry, commit: commit.stdout.trim() || undefined }
  }
  if (result.code !== 0) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    return { ok: false, error: (result.stderr || result.stdout).trim() || 'git clone failed.' }
  }
  const commit = await runGit(['rev-parse', 'HEAD'], dir, signal)
  return { ok: true, dir, commit: commit.stdout.trim() || undefined }
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage'])

export async function findSkillDirs(root: string, maxDirs = 300): Promise<Array<{ name: string; dir: string }>> {
  const out: Array<{ name: string; dir: string }> = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (stack.length > 0 && out.length < 100) {
    const item = stack.pop()
    if (!item) break
    visited++
    if (visited > maxDirs) break
    const skillFile = path.join(item.dir, 'SKILL.md')
    try {
      const stat = await fs.stat(skillFile)
      if (stat.isFile()) {
        out.push({ name: path.basename(item.dir), dir: item.dir })
        continue
      }
    } catch {
      // not a skill dir
    }
    if (item.depth >= 5) continue
    let entries
    try {
      entries = await fs.readdir(item.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith('.') && entry.name !== '.claude' && entry.name !== '.agentskills') continue
      stack.push({ dir: path.join(item.dir, entry.name), depth: item.depth + 1 })
    }
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir))
}

export async function copySkillTree(
  src: string,
  dest: string,
  warnings: string[],
): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  const stack: Array<{ from: string; to: string }> = [{ from: src, to: dest }]
  while (stack.length > 0) {
    const item = stack.pop()
    if (!item) break
    await ensureDir(item.to)
    const entries = await fs.readdir(item.from, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const from = path.join(item.from, entry.name)
      const to = path.join(item.to, entry.name)
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symlink "${path.relative(src, from)}".`)
        continue
      }
      if (entry.isDirectory()) {
        stack.push({ from, to })
        continue
      }
      if (!entry.isFile()) continue
      const stat = await fs.stat(from)
      files++
      bytes += stat.size
      if (files > 1000) throw new Error('The skill contains more than 1000 files.')
      if (bytes > 50 * 1024 * 1024) throw new Error('The skill is larger than 50 MB.')
      await fs.copyFile(from, to)
    }
  }
  return { files, bytes }
}

export interface InstalledMeta {
  source: string
  ref?: string
  commit?: string
  installedAt: string
  dir: string
  /** Content revision for local sources that are not Git repositories. */
  contentHash?: string
}

async function readInstalled(targetRoot: string): Promise<Record<string, InstalledMeta>> {
  const file = path.join(targetRoot, '.agenthub-installed.json')
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, InstalledMeta>
    }
  } catch {
    // no metadata yet
  }
  return {}
}

export async function recordInstalled(targetRoot: string, name: string, meta: InstalledMeta): Promise<void> {
  const file = path.join(targetRoot, '.agenthub-installed.json')
  const data = await readInstalled(targetRoot)
  data[name] = meta
  await writeAtomic(file, JSON.stringify(data, null, 2), 0o600)
}

async function gitRevision(dir: string, signal: AbortSignal): Promise<string | undefined> {
  const result = await runGit(['rev-parse', 'HEAD'], dir, signal, 10_000)
  return result.code === 0 ? result.stdout.trim() || undefined : undefined
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  const stack = [root]
  const files: string[] = []
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) break
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const abs = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) stack.push(abs)
      else if (entry.isFile()) files.push(abs)
    }
  }
  files.sort()
  for (const file of files) {
    hash.update(path.relative(root, file).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(await fs.readFile(file))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

interface FileDigest {
  rel: string
  hash: string
  size: number
}

async function digestTree(root: string): Promise<Map<string, FileDigest>> {
  const out = new Map<string, FileDigest>()
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir) break
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const abs = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(abs)
        continue
      }
      if (!entry.isFile()) continue
      const data = await fs.readFile(abs)
      out.set(path.relative(root, abs).split(path.sep).join('/'), {
        rel: path.relative(root, abs).split(path.sep).join('/'),
        hash: createHash('sha256').update(data).digest('hex'),
        size: data.length,
      })
    }
  }
  return out
}

export interface SkillFileChange {
  path: string
  kind: 'added' | 'modified' | 'removed'
  bytes?: number
}

function compareTrees(current: Map<string, FileDigest>, proposed: Map<string, FileDigest>): SkillFileChange[] {
  const changes: SkillFileChange[] = []
  for (const [rel, file] of proposed) {
    const old = current.get(rel)
    if (!old) changes.push({ path: rel, kind: 'added', bytes: file.size })
    else if (old.hash !== file.hash) changes.push({ path: rel, kind: 'modified', bytes: file.size })
  }
  for (const rel of current.keys()) {
    if (!proposed.has(rel)) changes.push({ path: rel, kind: 'removed' })
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

function resolveLocalSource(config: AgentConfig, source: string): string {
  if (path.isAbsolute(source)) return path.normalize(source)
  // Older metadata may contain a relative source. It was recorded relative to
  // the workspace by earlier versions of the installer.
  return path.resolve(config.workspace, source)
}

export interface UpdateOptions {
  name: string
  ref?: string
  dir?: string
  user?: boolean
  force?: boolean
  dryRun?: boolean
  signal: AbortSignal
  log: (line: string) => void
}

export interface UpdateResult {
  ok: boolean
  name: string
  targetRoot?: string
  target?: string
  fromRevision?: string
  toRevision?: string
  previousCommit?: string
  commit?: string
  changes: SkillFileChange[]
  backup?: string
  metadataUpdated?: boolean
  permissionsChanged: false
  compatibility: {
    checked: boolean
    overall?: string
    error?: string
  }
  warnings: string[]
  error?: string
}

async function locateSkill(name: string, root: string, dirHint: string | undefined): Promise<{ dir: string; rel: string } | { error: string; candidates?: Array<{ name: string; dir: string }> }> {
  let searchRoot = root
  if (dirHint) {
    try {
      searchRoot = await resolveInside(root, dirHint)
    } catch (err) {
      return { error: (err as Error).message }
    }
    const stat = await fs.stat(searchRoot).catch(() => null)
    if (!stat?.isDirectory()) return { error: `Recorded skill directory "${dirHint}" no longer exists in the source.` }
    const hinted = await findSkillDirs(searchRoot)
    if (hinted.length === 1) return { dir: hinted[0]!.dir, rel: dirHint }
    if (hinted.length > 1) {
      return { error: 'The recorded skill directory now contains multiple skills.', candidates: hinted }
    }
  }
  const candidates = await findSkillDirs(root)
  const matches: Array<{ name: string; dir: string }> = []
  for (const candidate of candidates) {
    try {
      const text = await fs.readFile(path.join(candidate.dir, 'SKILL.md'), 'utf8')
      const parsed = parseSkillMarkdown(text, candidate.name)
      if (parsed.ok && parsed.meta?.name === name) matches.push(candidate)
    } catch {
      // Ignore unreadable candidates; the error below is clearer.
    }
  }
  if (matches.length === 1) {
    return { dir: matches[0]!.dir, rel: path.relative(root, matches[0]!.dir).split(path.sep).join('/') || '.' }
  }
  if (matches.length > 1) return { error: 'Multiple updated skills have the same name.', candidates: matches }
  return {
    error: `The skill "${name}" was removed or renamed in the source. Nothing was changed.`,
    candidates,
  }
}

export async function updateSkill(config: AgentConfig, opts: UpdateOptions): Promise<UpdateResult> {
  const warnings: string[] = []
  const changes: SkillFileChange[] = []
  let targetRoot: string | undefined
  let target: string | undefined
  let fromRevision: string | undefined
  let toRevision: string | undefined
  let previousCommit: string | undefined
  let commit: string | undefined
  let backup: string | undefined
  const compatibility: UpdateResult['compatibility'] = { checked: false }
  const cleanup: string[] = []
  try {
    const { discoverSkills, findSkill } = await import('./discover.ts')
    const index = await discoverSkills(config)
    const entry = findSkill(index, opts.name)
    if (!entry) return { ok: false, name: opts.name, changes, compatibility, warnings, permissionsChanged: false, error: `No active skill named "${opts.name}".` }
    target = entry.dir
    targetRoot = path.dirname(entry.dir)
    const metadata = await readInstalled(targetRoot)
    const meta = metadata[opts.name]
    if (!meta) {
      return {
        ok: false,
        name: opts.name,
        targetRoot,
        target,
        changes,
        compatibility,
        warnings,
        permissionsChanged: false,
        error: `No update source is recorded for "${opts.name}". Reinstall it with \`skills install\` and a source path or URL.`,
      }
    }
    if (opts.user && !path.resolve(targetRoot).startsWith(path.resolve(config.home, 'skills'))) {
      return { ok: false, name: opts.name, targetRoot, target, changes, compatibility, warnings, permissionsChanged: false, error: `"${opts.name}" is not installed in the user skills directory.` }
    }

    const sourceIsUrl = /^https?:\/\//i.test(meta.source) || /^git@[^:]+:/i.test(meta.source) || /^ssh:\/\//i.test(meta.source)
    let root: string
    if (sourceIsUrl) {
      const cloned = await cloneRepo(meta.source, opts.ref ?? meta.ref, opts.signal, opts.log)
      if (!cloned.ok || !cloned.dir) {
        return { ok: false, name: opts.name, targetRoot, target, changes, compatibility, warnings, permissionsChanged: false, error: cloned.error ?? 'Could not clone the update source.' }
      }
      cleanup.push(cloned.dir)
      root = cloned.dir
      commit = cloned.commit
    } else {
      root = resolveLocalSource(config, meta.source)
      const stat = await fs.stat(root).catch(() => null)
      if (!stat?.isDirectory()) {
        return { ok: false, name: opts.name, targetRoot, target, changes, compatibility, warnings, permissionsChanged: false, error: `The recorded local source is not a directory: ${root}` }
      }
      previousCommit = await gitRevision(root, opts.signal)
    }

    const located = await locateSkill(opts.name, root, opts.dir ?? meta.dir)
    if ('error' in located) {
      return {
        ok: false,
        name: opts.name,
        targetRoot,
        target,
        changes,
        compatibility,
        warnings,
        permissionsChanged: false,
        error: located.error,
      }
    }
    const skillFile = path.join(located.dir, 'SKILL.md')
    const parsed = parseSkillMarkdown(await fs.readFile(skillFile, 'utf8'), opts.name)
    if (!parsed.ok || !parsed.meta) {
      return { ok: false, name: opts.name, targetRoot, target, changes, compatibility, warnings, permissionsChanged: false, error: `The updated skill is invalid:\n- ${parsed.errors.join('\n- ')}` }
    }
    if (parsed.meta.name !== opts.name) {
      return { ok: false, name: opts.name, targetRoot, target, changes, compatibility, warnings, permissionsChanged: false, error: `The updated skill is named "${parsed.meta.name}", not "${opts.name}". Renaming is not performed automatically.` }
    }

    fromRevision = meta.commit ?? meta.contentHash ?? (await hashTree(target))
    toRevision = commit ?? previousCommit ?? (await hashTree(located.dir))

    const staged = tempDir('agenthub-update-')
    await ensureDir(staged)
    cleanup.push(staged)
    const copied = await copySkillTree(located.dir, staged, warnings)
    const currentDigest = await digestTree(target)
    const proposedDigest = await digestTree(staged)
    changes.push(...compareTrees(currentDigest, proposedDigest))

    // Re-check with the existing AgentHub scanner, not a second implementation.
    const app = await probeApp(config.appUrl, opts.signal)
    if (app.ok) {
      const report = await checkRepoCompat(config.appUrl, meta.source, {
        ...(opts.ref ?? meta.ref ? { ref: opts.ref ?? meta.ref } : {}),
        ...(located.rel && located.rel !== '.' ? { dir: located.rel } : {}),
      }, opts.signal)
      if (report.ok) {
        const overall = report.report && typeof report.report === 'object'
          ? (report.report as Record<string, unknown>).overall
          : undefined
        compatibility.checked = true
        if (typeof overall === 'string') compatibility.overall = overall
        if (overall === 'incompatible' && !opts.force) {
          return {
            ok: false,
            name: opts.name,
            targetRoot,
            target,
            fromRevision,
            toRevision,
            previousCommit,
            commit,
            changes,
            compatibility,
            warnings,
            permissionsChanged: false,
            error: 'The existing AgentHub compatibility scanner reports this update as incompatible. Nothing was changed. Re-run with --force only if you accept the risk.',
          }
        }
      } else {
        compatibility.error = report.error ?? 'Compatibility scan failed.'
        warnings.push(`Compatibility recheck failed: ${compatibility.error}`)
      }
    } else {
      compatibility.error = app.error ?? 'The AgentHub app is not reachable.'
      warnings.push(`Compatibility recheck skipped: ${compatibility.error}`)
    }

    if (opts.dryRun) {
      return {
        ok: true,
        name: opts.name,
        targetRoot,
        target,
        fromRevision,
        toRevision,
        previousCommit,
        commit,
        changes,
        compatibility,
        warnings,
        permissionsChanged: false,
      }
    }

    const backupRoot = path.join(config.home, 'backups', 'skills')
    await ensureDir(backupRoot)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    backup = path.join(backupRoot, `${opts.name}-${stamp}-update`)
    await fs.rename(target, backup)
    try {
      await fs.rename(staged, target)
      // Write the rollback sidecar before updating the installed metadata. If
      // either write fails, restore both the files and the previous metadata so
      // a failed update cannot leave a half-updated skill behind.
      await fs.writeFile(
        `${backup}.json`,
        JSON.stringify({ name: opts.name, at: new Date().toISOString(), meta, fromRevision, toRevision }, null, 2),
        { encoding: 'utf8', mode: 0o600 },
      )
      await recordInstalled(targetRoot, opts.name, {
        source: meta.source,
        ...(opts.ref ?? meta.ref ? { ref: opts.ref ?? meta.ref } : {}),
        ...(commit ?? previousCommit ? { commit: commit ?? previousCommit } : {}),
        installedAt: new Date().toISOString(),
        dir: located.rel,
        ...(sourceIsUrl ? {} : { contentHash: await hashTree(target) }),
      })
    } catch (err) {
      await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
      await fs.rename(backup, target).catch(() => undefined)
      await recordInstalled(targetRoot, opts.name, meta).catch(() => undefined)
      await fs.rm(`${backup}.json`, { force: true }).catch(() => undefined)
      backup = undefined
      throw err
    }
    opts.log(`Updated ${opts.name}: ${changes.length} file change(s), ${copied.files} file(s) now installed.`)
    return {
      ok: true,
      name: opts.name,
      targetRoot,
      target,
      fromRevision,
      toRevision,
      previousCommit,
      commit,
      changes,
      backup,
      metadataUpdated: true,
      compatibility,
      warnings,
      permissionsChanged: false,
    }
  } catch (err) {
    return {
      ok: false,
      name: opts.name,
      targetRoot,
      target,
      fromRevision,
      toRevision,
      previousCommit,
      commit,
      changes,
      ...(backup ? { backup } : {}),
      compatibility,
      warnings,
      permissionsChanged: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    for (const dir of cleanup) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export async function rollbackSkill(
  config: AgentConfig,
  name: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; name: string; backup?: string; restoredFrom?: string; error?: string }> {
  try {
    const { discoverSkills, findSkill } = await import('./discover.ts')
    const index = await discoverSkills(config)
    const entry = findSkill(index, name)
    if (!entry) return { ok: false, name, error: `No active skill named "${name}".` }
    const backupRoot = path.join(config.home, 'backups', 'skills')
    const candidates = (await fs.readdir(backupRoot).catch(() => [] as string[]))
      .filter((file) => file.startsWith(`${name}-`) && file.endsWith('-update'))
      .sort()
    const latest = candidates.at(-1)
    if (!latest) return { ok: false, name, error: `No update backup exists for "${name}".` }
    const source = await resolveInside(backupRoot, latest)
    const current = entry.dir
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safety = path.join(backupRoot, `${name}-${timestamp}-pre-rollback`)
    await fs.rename(current, safety)
    try {
      await fs.rename(source, current)
    } catch (err) {
      await fs.rename(safety, current).catch(() => undefined)
      throw err
    }
    // Restore the metadata sidecar when present.
    try {
      const meta = JSON.parse(await fs.readFile(`${source}.json`, 'utf8')) as { meta?: InstalledMeta }
      if (meta.meta) await recordInstalled(path.dirname(current), name, meta.meta)
      await fs.rm(`${source}.json`, { force: true })
    } catch {
      // The skill content is restored even when the sidecar is missing.
    }
    return { ok: true, name, backup: safety, restoredFrom: source, ...(signal.aborted ? { error: 'Cancelled after restore.' } : {}) }
  } catch (err) {
    return { ok: false, name, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function installSkill(config: AgentConfig, opts: InstallOptions): Promise<InstallResult> {
  const warnings: string[] = []
  const targetRoot = opts.user ? path.join(config.home, 'skills') : path.join(config.workspace, '.agenthub', 'skills')
  const cleanup: string[] = []
  let root: string
  let sourceLabel = opts.source
  let commit: string | undefined
  let ref = opts.ref
  let dirHint = opts.dir

  try {
    if (isUrl(opts.source)) {
      const gh = parseGitHub(opts.source)
      const cloneUrl = gh?.cloneUrl ?? opts.source
      if (gh) {
        ref = ref ?? gh.ref
        dirHint = dirHint ?? gh.dir
      }
      const cloned = await cloneRepo(cloneUrl, ref, opts.signal, opts.log)
      if (!cloned.ok || !cloned.dir) {
        return { ok: false, installed: [], targetRoot, error: cloned.error ?? 'Clone failed.', warnings, source: sourceLabel }
      }
      cleanup.push(cloned.dir)
      root = cloned.dir
      commit = cloned.commit
      if (gh) sourceLabel = gh.cloneUrl
    } else {
      root = path.resolve(opts.source)
      const stat = await fs.stat(root).catch(() => null)
      if (!stat || !stat.isDirectory()) {
        return { ok: false, installed: [], targetRoot, error: `Local source is not a directory: ${root}`, warnings, source: sourceLabel }
      }
      sourceLabel = root
    }

    let searchRoot = root
    if (dirHint) {
      const safe = await resolveInside(root, dirHint)
      const stat = await fs.stat(safe).catch(() => null)
      if (!stat || !stat.isDirectory()) {
        return {
          ok: false,
          installed: [],
          targetRoot,
          error: `Skill directory "${dirHint}" does not exist in the source.`,
          warnings,
          source: sourceLabel,
        }
      }
      searchRoot = safe
      const hinted = await findSkillDirs(safe)
      if (hinted.length > 1) {
        return {
          ok: false,
          installed: [],
          targetRoot,
          candidates: hinted.map((c) => ({ name: c.name, dir: path.relative(root, c.dir).split(path.sep).join('/') })),
          error: 'Multiple skills were found; choose one with --skill <name>.',
          warnings,
          source: sourceLabel,
        }
      }
    }

    // Only the selected subtree may be searched; otherwise --dir would still
    // report every skill in the repository.
    const candidates = await findSkillDirs(searchRoot)
    if (candidates.length === 0) {
      return {
        ok: false,
        installed: [],
        targetRoot,
        error: 'No SKILL.md was found in that source.',
        warnings,
        source: sourceLabel,
      }
    }
    let chosen: Array<{ name: string; dir: string }>
    if (opts.skill) {
      const matches = candidates.filter((c) => c.name.toLowerCase() === opts.skill!.toLowerCase())
      if (matches.length === 0) {
        return {
          ok: false,
          installed: [],
          targetRoot,
          candidates: candidates.map((c) => ({ name: c.name, dir: path.relative(root, c.dir).split(path.sep).join('/') })),
          error: `No skill named "${opts.skill}" was found.`,
          warnings,
          source: sourceLabel,
        }
      }
      chosen = matches.slice(0, 1)
    } else if (candidates.length > 1) {
      return {
        ok: false,
        installed: [],
        targetRoot,
        candidates: candidates.map((c) => ({ name: c.name, dir: path.relative(root, c.dir).split(path.sep).join('/') })),
        error: 'The source contains multiple skills; choose one with --skill <name>.',
        warnings,
        source: sourceLabel,
      }
    } else {
      chosen = candidates
    }

    const installed: string[] = []
    await ensureDir(targetRoot)
    for (const candidate of chosen) {
      const skillFile = path.join(candidate.dir, 'SKILL.md')
      const text = await fs.readFile(skillFile, 'utf8')
      const parsed = parseSkillMarkdown(text, candidate.name)
      if (!parsed.ok || !parsed.meta) {
        return {
          ok: false,
          installed,
          targetRoot,
          error: `"${candidate.name}" is not a valid skill:\n- ${parsed.errors.join('\n- ')}`,
          warnings,
          source: sourceLabel,
          commit,
        }
      }
      const name = parsed.meta.name
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
        return { ok: false, installed, targetRoot, error: `Invalid skill name "${name}".`, warnings, source: sourceLabel, commit }
      }
      const target = await resolveInside(targetRoot, name)
      const exists = await fs.stat(target).then(() => true).catch(() => false)
      if (exists) {
        if (!opts.force) {
          return {
            ok: false,
            installed,
            targetRoot,
            error: `Skill "${name}" is already installed at ${target}. Use --force to replace it (the old copy is backed up).`,
            warnings,
            source: sourceLabel,
            commit,
          }
        }
        const backupRoot = path.join(config.home, 'backups', 'skills')
        await ensureDir(backupRoot)
        const backup = path.join(backupRoot, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
        await fs.rename(target, backup)
        warnings.push(`Existing skill was moved to ${backup}.`)
      }
      await ensureDir(target)
      const copied = await copySkillTree(candidate.dir, target, warnings)
      const localCommit = commit ?? (isUrl(opts.source) ? undefined : await gitRevision(root, opts.signal))
      await recordInstalled(targetRoot, name, {
        source: sourceLabel,
        ref,
        ...(localCommit ? { commit: localCommit } : {}),
        installedAt: new Date().toISOString(),
        dir: path.relative(root, candidate.dir).split(path.sep).join('/') || '.',
        ...(isUrl(opts.source) ? {} : { contentHash: await hashTree(target) }),
      })
      opts.log(`Installed ${name} (${copied.files} files, ${(copied.bytes / 1024).toFixed(1)} KB) → ${target}`)
      installed.push(name)
    }
    return { ok: true, installed, targetRoot, warnings, source: sourceLabel, commit }
  } catch (err) {
    return {
      ok: false,
      installed: [],
      targetRoot,
      error: err instanceof Error ? err.message : String(err),
      warnings,
      source: sourceLabel,
      commit,
    }
  } finally {
    for (const dir of cleanup) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
