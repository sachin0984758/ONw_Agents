import { execFile } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { DB_DIR } from '../db-path'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import { resolveWorkspace } from '../session/workspaces'
import { readRuntimePolicy } from '../runtime-policy'

const git = promisify(execFile)
export const UI_LIBRARY_DIRECTORY = path.join(DB_DIR, 'ui-library')
const templates = path.join(UI_LIBRARY_DIRECTORY, 'templates')
const featured = ['cruip/open-react-template', 'nextemplates/tailwind-landing-page-template']
const maxSize = 25_000
const refPattern = /^[a-z\d][a-z\d-]{0,38}\/[a-z\d_.-]{1,100}$/i
const allowed = /^(?:MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0|GPL-[23]\.0(?:-only|-or-later)?|LGPL-[23]\.\d(?:-only|-or-later)?|Unlicense|CC0-1\.0)$/i

export function normalizeGitHubRef(value: string) {
  if (!refPattern.test(value) || /\/(?:\.|\.\.)$/.test(value) || /[. ]$/.test(value) || value.split('/').some((part) => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Use a valid GitHub owner/repository reference.')
  return value.toLowerCase()
}

type GitHubRepo = { full_name: string; description: string | null; language: string | null; license: { spdx_id: string } | null; topics?: string[]; default_branch: string; stargazers_count: number; updated_at: string; size: number; private: boolean; archived: boolean; disabled: boolean }
async function github<T>(endpoint: string): Promise<T> {
  const token = process.env.AGENTHUB_GITHUB_TOKEN?.trim()
  const response = await fetch(new URL(endpoint, 'https://api.github.com'), {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AgentHub', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000),
  }).catch(() => { throw new Error('GitHub is unreachable. Saved templates are available offline.') })
  if (response.status === 429 || response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after'))) throw new Error('GitHub rate limit reached. Resume after the limit resets.')
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`)
  return response.json() as Promise<T>
}

function listing(repo: GitHubRepo) {
  const ref = normalizeGitHubRef(repo.full_name)
  const featuredRepo = featured.includes(ref)
  const hints = [repo.description, ...(repo.topics ?? []), ref].join(' ')
  const framework = /next[. -]?js|nextjs/i.test(hints) ? 'Next.js' : /react/i.test(hints) ? 'React' : /tailwind/i.test(hints) ? 'Tailwind CSS' : repo.language || 'Unknown'
  const license = featuredRepo ? 'GPL-3.0 per README' : repo.license?.spdx_id || 'Unknown'
  const eligible = !repo.private && !repo.disabled && !repo.archived && repo.size > 0 && repo.size <= maxSize && (featuredRepo || allowed.test(license))
  const warning = featuredRepo ? 'README permits project use and asks against republishing, redistribution or resale.' : eligible ? 'License and README are checked again before saving.' : 'Repository is oversized, inactive, or has an unsupported or unclear license.'
  return { ref, name: ref.split('/')[1], owner: ref.split('/')[0], url: `https://github.com/${ref}`, description: repo.description ?? '', framework, language: repo.language, license, eligible, warning, stars: repo.stargazers_count, updated: repo.updated_at, size: repo.size, branch: repo.default_branch,
    preview: ref === featured[1] ? `https://raw.githubusercontent.com/${ref}/${encodeURIComponent(repo.default_branch)}/public/preview.jpg` : undefined }
}

export async function discoverGitHub(source: string, query: string, page: number) {
  if (source !== 'topic') {
    const ref = source === 'tailwind' ? featured[1] : featured[0]
    const row = listing(await github<GitHubRepo>(`/repos/${ref}`))
    return { results: row.ref.includes(query.toLowerCase()) || row.description.toLowerCase().includes(query.toLowerCase()) ? [row] : [], next: false }
  }
  const words = query.replace(/[^a-z\d ._-]/gi, ' ').trim().slice(0, 100)
  const params = new URLSearchParams({ q: `topic:landing-page-template is:public ${words}`.trim(), per_page: '24', page: String(page) })
  const result = await github<{ items: GitHubRepo[]; total_count: number; incomplete_results: boolean }>(`/search/repositories?${params}`)
  const results = result.items.flatMap((repo) => { try { return [listing(repo)] } catch { return [] } })
  return { results, total: result.total_count, incomplete: result.incomplete_results, next: page * 24 < Math.min(result.total_count, 1000) }
}

const snapshotFile = path.join(UI_LIBRARY_DIRECTORY, 'github-catalog.json')
const serializeCatalog = createSerializer()
export async function readGitHubCatalog() {
  try { return JSON.parse(await fs.readFile(snapshotFile, 'utf8')) as CatalogSnapshot }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
interface CatalogSnapshot {
  id: string; query: string; synchronizedAt: string; pages: number; total: number; incomplete: boolean;
  results: ReturnType<typeof listing>[]
}
export async function syncGitHubCatalog(query: string, options: { maxKb: number; framework: string; license: string }) {
  return serializeCatalog(async () => {
    const rows = new Map<string, ReturnType<typeof listing>>()
    let page = 1
    let total = 0
    let incomplete = false
    for (;;) {
      const result = await discoverGitHub('topic', query, page)
      total = result.total ?? rows.size
      incomplete ||= result.incomplete === true || total > 1000
      for (const row of result.results) {
        const passes = row.size <= options.maxKb && (!options.framework || row.framework === options.framework) && (!options.license || row.license === options.license)
        rows.set(row.ref, { ...row, eligible: row.eligible && passes, warning: passes ? row.warning : 'Excluded by your batch filters.' })
      }
      if (!result.next) break
      page++
    }
    const snapshot = { id: crypto.randomUUID(), query, synchronizedAt: new Date().toISOString(), pages: page, total, incomplete, results: [...rows.values()] }
    await writeJsonAtomic(snapshotFile, snapshot)
    return snapshot
  })
}

export interface GitHubTemplate {
  ref: string; name: string; owner: string; url: string; description: string; framework: string; license: string; warning: string;
  commit: string; bytes: number; files: string[]; components: string[]; dependencies: Record<string, string>; downloadedAt: string
}

function templatePath(ref: string) { return path.join(templates, ...normalizeGitHubRef(ref).split('/')) }

export async function readGitHubTemplate(ref: string): Promise<GitHubTemplate | undefined> {
  try { return JSON.parse(await fs.readFile(path.join(templatePath(ref), 'manifest.json'), 'utf8')) as GitHubTemplate }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

export async function listGitHubTemplates(): Promise<GitHubTemplate[]> {
  const folders = async (dir: string) => (await fs.readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  const records: GitHubTemplate[] = []
  for (const owner of await folders(templates)) for (const repo of await folders(path.join(templates, owner.name))) {
    const record = await readGitHubTemplate(`${owner.name}/${repo.name}`)
    if (record) records.push(record)
  }
  return records
}

export async function readTemplateSource(ref: string, file: string) {
  const record = await readGitHubTemplate(ref)
  if (!record?.files.includes(file) || !safeTreePath(file) || !/\.(?:tsx?|jsx?|mjs|cjs|css|html|json|md|txt)$/i.test(file)) throw new Error('Choose an indexed text file.')
  const filename = await savedFile(ref, file, 512_000)
  const data = await fs.readFile(filename)
  if (data.byteLength > 512_000 || data.includes(0)) throw new Error('File is too large or binary.')
  return data.toString('utf8')
}

export async function savedFile(ref: string, file: string, maxBytes: number) {
  if (!safeTreePath(file)) throw new Error('Unsafe saved file path.')
  const root = path.join(templatePath(ref), 'source')
  const filename = path.join(root, ...file.split('/'))
  const [real, stat] = await Promise.all([fs.realpath(filename), fs.lstat(filename)])
  if (path.relative(root, real) !== path.join(...file.split('/')) || !stat.isFile() || stat.size > maxBytes) throw new Error('Saved file is unsafe or exceeds the preview size limit.')
  return filename
}

export async function readTemplatePreview(ref: string) {
  const record = await readGitHubTemplate(ref)
  const file = record?.files.find((name) => /(?:^|\/)(?:preview|screenshot)\.(?:png|jpe?g|webp)$/i.test(name))
  if (!file || !safeTreePath(file)) return
  const data = await fs.readFile(await savedFile(ref, file, 2_000_000))
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { data, type: 'image/png' }
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return { data, type: 'image/jpeg' }
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return { data, type: 'image/webp' }
}

export async function installGitHubTemplate(ref: string, workspaceId: string, commit: string, approved: boolean) {
  if (!approved || !/^[a-f0-9-]{36}$/i.test(workspaceId)) throw new Error('Review the template and explicitly approve installation into a registered workspace.')
  if (!(await readRuntimePolicy()).codeExecution) throw new Error('Project writes are disabled in AgentHub settings.')
  const record = await readGitHubTemplate(ref)
  if (!record || record.commit !== commit) throw new Error('Template revision changed. Review the saved template again.')
  const workspace = await resolveWorkspace(workspaceId)
  const root = await fs.realpath(workspace.root)
  const sourceRoot = path.join(templatePath(ref), 'source')
  const destination = await fs.mkdtemp(path.join(root, `${record.name}-`))
  try {
    for (const file of record.files) {
      if (!safeTreePath(file)) throw new Error('Unsafe source path in the saved template.')
      const source = path.join(sourceRoot, ...file.split('/'))
      const real = await fs.realpath(source)
      if (path.relative(sourceRoot, real) !== path.join(...file.split('/')) || !(await fs.lstat(source)).isFile()) throw new Error('Saved source contains an unexpected link.')
      const target = path.join(destination, ...file.split('/'))
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(source, target, constants.COPYFILE_EXCL)
    }
    return { folder: destination, files: record.files.length, commit }
  } catch (error) {
    if (path.dirname(destination) === root && path.basename(destination).startsWith(`${record.name}-`)) await fs.rm(destination, { recursive: true, force: true })
    throw error
  }
}

function safeTreePath(file: string) {
  return file.length < 240 && file.split('/').every((part) => part && !['.', '..', '.git'].includes(part.toLowerCase()) && !/[\\:*?"<>|\x00-\x1f]|[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}

export async function downloadGitHubTemplate(input: string): Promise<GitHubTemplate> {
  const ref = normalizeGitHubRef(input)
  const existing = await readGitHubTemplate(ref)
  if (existing) return existing
  const repo = listing(await github<GitHubRepo>(`/repos/${ref}`))
  if (repo.ref !== ref || !repo.eligible) throw new Error(repo.warning)
  await fs.mkdir(templates, { recursive: true })
  const temporary = await fs.mkdtemp(path.join(templates, '.incoming-'))
  try {
    const bundle = path.join(temporary, 'bundle')
    const source = path.join(bundle, 'source')
    const gitDir = path.join(temporary, 'git')
    await fs.mkdir(bundle)
    const options = { timeout: 75_000, maxBuffer: 4_000_000, windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' } }
    await git('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--depth=1', '--no-checkout', '--separate-git-dir', gitDir, `${repo.url}.git`, source], options)
    const run = (...args: string[]) => git('git', ['-c', 'core.hooksPath=/dev/null', '-C', source, ...args], options).then((result) => result.stdout)
    const commit = (await run('rev-parse', 'HEAD')).trim()
    const seen = new Set<string>()
    let bytes = 0
    const files = (await run('ls-tree', '-rlz', 'HEAD')).split('\0').filter(Boolean).map((row) => {
      const separator = row.indexOf('\t')
      const [mode, type, , size] = row.slice(0, separator).trim().split(/\s+/)
      const file = row.slice(separator + 1)
      if (!['100644', '100755'].includes(mode) || type !== 'blob' || !safeTreePath(file) || seen.has(file.toLowerCase())) throw new Error('Repository contains an unsafe path, symlink, or submodule.')
      seen.add(file.toLowerCase())
      bytes += Number(size)
      return file
    })
    if (files.length > 2000 || bytes > 40_000_000) throw new Error('Repository source exceeds the local download limit.')
    const readme = files.find((file) => /^readme(?:\.|$)/i.test(file))
    const license = files.find((file) => /^(?:license|licence|copying)(?:\.|$)/i.test(file))
    const terms = readme ? await run('show', `HEAD:${readme}`) : ''
    if (featured.includes(ref)) {
      if (!/gnu\.org\/licenses\/gpl-3\.0/i.test(terms) || !/personal and commercial projects/i.test(terms)) throw new Error('The featured repository terms changed. Review the license before downloading.')
    } else {
      const text = license ? await run('show', `HEAD:${license}`) : ''
      if (text.trim().length < 100 || /(?:no redistribution|all rights reserved|(?:not|don['’]t|prohibited to) (?:republish|redistribute|resell))/i.test(terms)) throw new Error('License file is missing or the README contains additional restrictions. Review the repository.')
    }
    await run('checkout', '--detach', commit)
    await fs.unlink(path.join(source, '.git'))
    const pkg = files.includes('package.json') ? JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8')) : {}
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>
    const framework = dependencies.next ? 'Next.js' : dependencies.react ? 'React' : repo.framework
    const components = files.filter((file) => /\.(?:tsx|jsx)$/i.test(file) && /(?:^|\/)(?:components|sections|ui)\//i.test(file))
    const record: GitHubTemplate = { ...repo, framework, commit, bytes, files, components, dependencies, downloadedAt: new Date().toISOString() }
    await writeJsonAtomic(path.join(bundle, 'manifest.json'), record)
    const target = templatePath(ref)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.rename(bundle, target)
    return record
  } finally {
    if (path.dirname(temporary) === templates && path.basename(temporary).startsWith('.incoming-')) await fs.rm(temporary, { recursive: true, force: true })
  }
}
