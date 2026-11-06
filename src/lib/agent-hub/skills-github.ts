// ── GitHub access for the Skills installer ───────────────────────────────────
// Server-side only. Uses the public GitHub REST API to resolve a ref to a
// pinned commit, list the repository tree, and fetch individual files from
// raw.githubusercontent.com. No git binary, no archive extraction (so there
// is no zip-slip class of bug), no repository code is executed.
//
// The API/raw hosts are overridable via env (SKILLS_GITHUB_API_BASE /
// SKILLS_GITHUB_RAW_BASE) so the automated suite can point them at a local
// mock server; production defaults stay on github.com. A GITHUB_TOKEN env var
// is honored for rate limits and is never echoed anywhere.
//
// An anonymous GitHub API budget (60 req/h) covers inspection + install of a
// handful of skills; the UI reports rate-limit errors honestly.

import path from 'node:path'
import {
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_FILES,
  MAX_SKILL_TOTAL_BYTES,
  safeRelPath,
  type BundleFile,
} from './skills-registry'

const DEFAULT_API_BASE = 'https://api.github.com'
const DEFAULT_RAW_BASE = 'https://raw.githubusercontent.com'
export const GITHUB_TIMEOUT_MS = 15_000
const MAX_TREE_ENTRIES = 20_000
const MAX_CANDIDATE_SKILLS = 50
const MAX_INSPECT_SKILLS = 20

export function githubApiBase(): string {
  return (process.env.SKILLS_GITHUB_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
}

export function githubRawBase(): string {
  return (process.env.SKILLS_GITHUB_RAW_BASE || DEFAULT_RAW_BASE).replace(/\/+$/, '')
}

export interface GitHubRef {
  repoUrl: string
  owner: string
  repo: string
  /** Set when the URL contained /tree/<ref>/<path…> — the shared remainder. */
  treeRest?: string
}

export type ParseGitHubResult = { ok: true; value: GitHubRef } | { ok: false; error: string }

const SEGMENT_RE = /^[A-Za-z0-9_.-]+$/

function validSegment(s: string): boolean {
  return SEGMENT_RE.test(s) && s !== '.' && s !== '..'
}

/** Parse a GitHub repository URL (optionally with /tree/<ref>/<subpath>). */
export function parseGitHubUrl(input: string): ParseGitHubResult {
  let raw = (input ?? '').trim()
  if (!raw) return { ok: false, error: 'Enter a GitHub repository URL.' }
  if (/^github\.com\//i.test(raw) || /^www\.github\.com\//i.test(raw)) raw = `https://${raw}`
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, error: `Not a valid URL: "${raw.slice(0, 80)}".` }
  }
  const host = u.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') {
    return { ok: false, error: `Only github.com repositories are supported (got "${u.hostname}").` }
  }
  const segs = u.pathname.split('/').filter(Boolean)
  if (segs.length < 2) return { ok: false, error: 'The URL must point at a repository: https://github.com/<owner>/<repo>.' }
  const owner = segs[0]
  let repo = segs[1]
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4)
  if (!validSegment(owner) || !validSegment(repo)) return { ok: false, error: 'Invalid owner or repository name in the URL.' }

  let treeRest: string | undefined
  if (segs[2]) {
    if (segs[2] !== 'tree' && segs[2] !== 'blob') {
      return { ok: false, error: `Unsupported GitHub URL shape ("/${segs[2]}/"). Use the repository URL or a /tree/<ref>/<path> URL.` }
    }
    const rest = segs.slice(3)
    if (segs[2] === 'blob') rest.pop() // blob URLs point at the file — use its directory
    if (!rest.length) return { ok: false, error: 'The /tree/ URL is missing a branch, tag or commit.' }
    treeRest = rest.join('/')
  }
  return { ok: true, value: { repoUrl: `https://github.com/${owner}/${repo}`, owner, repo, treeRest } }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

export interface GitHubError {
  ok: false
  error: string
  status?: number
  retryable?: boolean
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AgentHub-Skills',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

function describeHttp(status: number, context: string): string {
  if (status === 404) return `${context}: not found (HTTP 404).`
  if (status === 401) return `${context}: GitHub authentication failed (HTTP 401) — check GITHUB_TOKEN.`
  if (status === 403) return `${context}: GitHub refused the request (HTTP 403) — the anonymous rate limit (60/hour) is likely exhausted. Set GITHUB_TOKEN or try later.`
  if (status === 422) return `${context}: GitHub rejected the request (HTTP 422) — check the branch/tag name.`
  return `${context} failed (HTTP ${status}).`
}

async function fetchJson<T>(url: string, context: string): Promise<{ ok: true; value: T } | GitHubError> {
  let res: Response
  try {
    res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS), redirect: 'follow' })
  } catch (err) {
    return { ok: false, error: `${context}: network error — ${err instanceof Error ? err.message : 'unreachable'}`, retryable: true }
  }
  if (!res.ok) return { ok: false, error: describeHttp(res.status, context), status: res.status, retryable: res.status >= 500 }
  try {
    return { ok: true, value: (await res.json()) as T }
  } catch {
    return { ok: false, error: `${context}: GitHub returned malformed JSON.` }
  }
}

// ── Ref resolution ───────────────────────────────────────────────────────────

export interface ResolvedRef {
  commit: string
  refUsed: string
  /** Subdirectory derived from a /tree/<ref>/<path…> URL ('' = root). */
  subPath: string
}

async function lookupCommit(owner: string, repo: string, ref: string): Promise<{ ok: true; sha: string } | GitHubError> {
  const r = await fetchJson<{ sha?: string }>(
    `${githubApiBase()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`,
    `Commit "${ref}"`,
  )
  if (!r.ok) return r
  if (typeof r.value.sha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(r.value.sha)) {
    return { ok: false, error: `Commit "${ref}": GitHub returned no commit SHA.` }
  }
  return { ok: true, sha: r.value.sha }
}

/**
 * Resolve the source ref to a pinned commit. Handles branch names containing
 * slashes by trying the longest ref first and peeling path segments off.
 */
export async function resolveCommit(g: GitHubRef, explicitRef?: string): Promise<{ ok: true; value: ResolvedRef } | GitHubError> {
  if (explicitRef && explicitRef.trim()) {
    const ref = explicitRef.trim()
    const c = await lookupCommit(g.owner, g.repo, ref)
    if (!c.ok) return c
    return { ok: true, value: { commit: c.sha, refUsed: ref, subPath: '' } }
  }
  if (g.treeRest) {
    const segs = g.treeRest.split('/').filter(Boolean)
    const attempts = Math.min(segs.length, 4)
    let lastError: GitHubError = { ok: false, error: 'Could not resolve a ref in the URL.' }
    for (let take = segs.length; take >= segs.length - attempts + 1 && take >= 1; take--) {
      const ref = segs.slice(0, take).join('/')
      const c = await lookupCommit(g.owner, g.repo, ref)
      if (c.ok) {
        return { ok: true, value: { commit: c.sha, refUsed: ref, subPath: segs.slice(take).join('/') } }
      }
      lastError = c
      if (c.status === 403 && !c.retryable) break // rate limit — no point retrying other prefixes
    }
    return lastError
  }
  // Default branch.
  const repoInfo = await fetchJson<{ default_branch?: string }>(
    `${githubApiBase()}/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}`,
    `Repository ${g.owner}/${g.repo}`,
  )
  if (!repoInfo.ok) return repoInfo
  const branch = repoInfo.value.default_branch
  if (!branch) return { ok: false, error: 'GitHub did not report a default branch.' }
  const c = await lookupCommit(g.owner, g.repo, branch)
  if (!c.ok) return c
  return { ok: true, value: { commit: c.sha, refUsed: branch, subPath: '' } }
}

// ── Tree + files ─────────────────────────────────────────────────────────────

export interface TreeBlob {
  path: string
  size: number
  sha: string
  /** POSIX directory containing the blob ('' = repo root). */
  dir: string
}

export interface RepoTree {
  blobs: TreeBlob[]
  truncated: boolean
}

export async function fetchRepoTree(owner: string, repo: string, commit: string): Promise<{ ok: true; value: RepoTree } | GitHubError> {
  const r = await fetchJson<{ tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }>; truncated?: boolean }>(
    `${githubApiBase()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(commit)}?recursive=1`,
    'Repository tree',
  )
  if (!r.ok) return r
  const raw = Array.isArray(r.value.tree) ? r.value.tree : []
  if (raw.length > MAX_TREE_ENTRIES) return { ok: false, error: `Repository tree is too large (${raw.length} entries).` }
  const blobs: TreeBlob[] = []
  for (const e of raw) {
    if (e.type !== 'blob' || typeof e.path !== 'string' || typeof e.sha !== 'string') continue
    const dir = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : ''
    blobs.push({ path: e.path, size: typeof e.size === 'number' ? e.size : 0, sha: e.sha, dir })
  }
  return { ok: true, value: { blobs, truncated: r.value.truncated === true } }
}

/**
 * Skill candidate directories: any directory containing a `SKILL.md`, filtered
 * by an optional subPath (the skill dir itself or a descendant of it).
 */
export function findSkillDirs(tree: RepoTree, subPath?: string): string[] {
  const norm = subPath ? safeRelPath(subPath) : ''
  if (subPath && !norm) return []
  const dirs = new Set<string>()
  for (const b of tree.blobs) {
    if (!b.path.endsWith('/SKILL.md') && b.path !== 'SKILL.md') continue
    const dir = b.path === 'SKILL.md' ? '' : b.path.slice(0, -'/SKILL.md'.length)
    if (norm) {
      if (dir !== norm && !dir.startsWith(`${norm}/`)) continue
    }
    dirs.add(dir)
  }
  return [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).slice(0, MAX_CANDIDATE_SKILLS)
}

export function blobsInDir(tree: RepoTree, dir: string): TreeBlob[] {
  if (!dir) return tree.blobs
  const prefix = `${dir}/`
  return tree.blobs.filter((b) => b.path.startsWith(prefix))
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

async function fetchBlob(owner: string, repo: string, commit: string, blobPath: string): Promise<{ ok: true; value: Buffer } | GitHubError> {
  const url = `${githubRawBase()}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(commit)}/${encodePath(blobPath)}`
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'AgentHub-Skills' }, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS), redirect: 'follow' })
  } catch (err) {
    return { ok: false, error: `File "${blobPath}": network error — ${err instanceof Error ? err.message : 'unreachable'}`, retryable: true }
  }
  if (!res.ok) return { ok: false, error: describeHttp(res.status, `File "${blobPath}"`), status: res.status, retryable: res.status >= 500 }
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MAX_SKILL_FILE_BYTES) return { ok: false, error: `File "${blobPath}" is larger than the per-file limit.` }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_SKILL_FILE_BYTES) return { ok: false, error: `File "${blobPath}" is larger than the per-file limit.` }
  return { ok: true, value: buf }
}

export interface SkillBundle {
  /** Files relative to the skill directory. */
  files: BundleFile[]
  /** path → git blob SHA (update previews compare against this). */
  sourceTree: Record<string, string>
}

/**
 * Download one skill directory at a pinned commit. Bounded by the same caps as
 * the local library so a hostile repository cannot exhaust memory/disk.
 */
export async function fetchSkillBundle(owner: string, repo: string, commit: string, dir: string, blobs: TreeBlob[]): Promise<{ ok: true; value: SkillBundle } | GitHubError> {
  const files: BundleFile[] = []
  const sourceTree: Record<string, string> = {}
  let total = 0
  const seen = new Set<string>()
  if (blobs.length === 0) return { ok: false, error: `No files found in "${dir || '.'}" at commit ${commit.slice(0, 12)}.` }
  if (blobs.length > MAX_SKILL_FILES) return { ok: false, error: `Skill contains ${blobs.length} files (limit ${MAX_SKILL_FILES}).` }
  for (const blob of blobs) {
    const rel = safeRelPath(dir ? blob.path.slice(dir.length + 1) : blob.path)
    if (!rel) return { ok: false, error: `Refusing unsafe path "${blob.path}".` }
    if (seen.has(rel)) return { ok: false, error: `Duplicate path "${rel}" in the repository.` }
    seen.add(rel)
    if (blob.size > MAX_SKILL_FILE_BYTES) return { ok: false, error: `File "${rel}" is larger than the per-file limit.` }
    total += blob.size
    if (total > MAX_SKILL_TOTAL_BYTES) return { ok: false, error: 'Skill exceeds the total size limit.' }
    const got = await fetchBlob(owner, repo, commit, blob.path)
    if (!got.ok) return got
    files.push({ path: rel, bytes: got.value })
    sourceTree[rel] = blob.sha
  }
  return { ok: true, value: { files, sourceTree } }
}

/** Fetch just the SKILL.md of a candidate directory (bounded) for inspection. */
export async function fetchSkillMarkdown(owner: string, repo: string, commit: string, dir: string): Promise<{ ok: true; text: string } | GitHubError> {
  const mdPath = dir ? `${dir}/SKILL.md` : 'SKILL.md'
  const got = await fetchBlob(owner, repo, commit, mdPath)
  if (!got.ok) return got
  return { ok: true, text: got.value.toString('utf-8') }
}

/**
 * Fetch a single text file (bounded) for compatibility inspection. Binary
 * content and oversized files are reported, never executed or extracted.
 */
export async function fetchRepoTextFile(
  owner: string,
  repo: string,
  commit: string,
  blobPath: string,
  maxBytes = 256 * 1024,
): Promise<{ ok: true; text: string; truncated: boolean } | GitHubError> {
  const got = await fetchBlob(owner, repo, commit, blobPath)
  if (!got.ok) return got
  const buf = got.value
  if (buf.includes(0)) return { ok: false, error: `File "${blobPath}" looks binary — skipped in content inspection.` }
  const truncated = buf.length > maxBytes
  return { ok: true, text: buf.subarray(0, maxBytes).toString('utf-8'), truncated }
}

/** Where a skill directory sits inside the repo, for display. */
export function skillDirLabel(dir: string): string {
  return dir ? `${dir}/` : '/'
}

export function repoBasename(dir: string): string {
  return dir ? path.posix.basename(dir) : ''
}

export { MAX_INSPECT_SKILLS }
