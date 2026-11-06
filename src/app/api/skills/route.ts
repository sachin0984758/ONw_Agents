import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { defaultWorkspaceRoot } from '@/lib/agent-hub/session/workspaces'
// ── Skills API ───────────────────────────────────────────────────────────────
// The single server endpoint behind the Skills Library (Sessions UI + slash
// commands). All skill files live under <workspace>/.agenthub/skills/<name>/;
// the registry lives in db/skills.json. Nothing here executes skill content.
//
// GET  ?op=list                                   — registry + disk reconciliation
//      ?op=show&id=<skill>                        — full record + SKILL.md body
//      ?op=read&id=<skill>&path=<rel>             — read one bundled resource
//      ?op=inspect&repo=<url>[&ref=][&subPath=]   — GitHub preview (no writes)
//      ?op=check-update&id=<skill>                — remote commit vs installed
// POST { action: install | enable | validate | update | uninstall, … }
//
// GitHub installs pin the resolved commit; files are fetched one by one via
// raw.githubusercontent.com (no archive extraction), validated, staged and
// renamed into place. Untrusted content is scanned and surfaced — never
// claimed safe.

import { NextRequest, NextResponse } from 'next/server'
import path from 'node:path'
import {
  installSkillToLibrary,
  readRegistry,
  readSkillInstructions,
  readSkillResource,
  reconcileRegistry,
  removeSkillFromLibrary,
  safeRelPath,
  scanLocalSkill,
  updateSkillInLibrary,
  withRegistryUpdate,
  writeRegistry,
  MAX_REGISTERED_SKILLS,
  type BundleFile,
  type SkillRecord,
  type SkillsRegistry,
} from '@/lib/agent-hub/skills-registry'
import {
  MAX_INSPECT_SKILLS,
  blobsInDir,
  fetchRepoTree,
  fetchSkillBundle,
  fetchSkillMarkdown,
  findSkillDirs,
  parseGitHubUrl,
  resolveCommit,
  type GitHubRef,
  type RepoTree,
} from '@/lib/agent-hub/skills-github'
import { parseSkillMarkdown, scanSkillText, SKILL_NAME_PATTERN } from '@/lib/agent-hub/skills-format'
import { fingerprintEnv, RUNTIME_TOOL_NAMES } from '@/lib/agent-hub/skills-compat'
import {
  bulkInstalledCompat,
  buildEnvInput,
  clearCompatStore,
  functionalTestSkill,
  installedSkillCompat,
  readCompatStore,
  repoCandidateCompat,
  summarizeCompat,
} from '@/lib/agent-hub/skills-compat-server'

export const runtime = 'nodejs'

const MAX_INSTALL_BATCH = 10

/** Parse `probe` / `mode` compatibility-scan options from a request. */
function compatMode(q: URLSearchParams): 'ro' | 'edit' {
  return q.get('mode') === 'ro' ? 'ro' : 'edit'
}

function workspaceRoot(): string {
  // Keep the Skills API aligned with the app's persisted project-root
  // resolver. In production, cwd may be `.next-*/standalone`, which is not
  // the directory that owns `.agenthub/skills` or the shared DB registry.
  return defaultWorkspaceRoot()
}



function jsonError(error: string, status = 400, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, error, ...extra }, { status })
}

function publicRecord(rec: SkillRecord): SkillRecord {
  return rec
}

function attentionNeeded(rec: SkillRecord): boolean {
  return rec.validation.status !== 'valid' || rec.validation.suspicious.length > 0 || rec.trust === 'unreviewed'
}

export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin requests are not allowed.', 403)
  const q = req.nextUrl.searchParams
  const op = q.get('op') ?? 'list'
  const root = workspaceRoot()

  if (op === 'list') {
    const { registry, warning } = await readRegistry()
    const rec = await reconcileRegistry(root, registry)
    if (rec.added.length || rec.missing.length || rec.repaired.length) {
      await writeRegistry(rec.registry)
    }
    const skills = rec.registry.skills.map(publicRecord)
    const counts = {
      installed: skills.length,
      enabled: skills.filter((s) => s.enabled && s.validation.status === 'valid').length,
      disabled: skills.filter((s) => !s.enabled).length,
      attention: skills.filter(attentionNeeded).length,
    }
    return NextResponse.json({
      ok: true,
      root,
      skillsRoot: path.join(root, '.agenthub', 'skills'),
      counts,
      skills,
      trustedSources: rec.registry.trustedSources,
      discovered: rec.added,
      missing: rec.missing,
      ...(warning ? { warning } : {}),
    })
  }

  if (op === 'show') {
    const id = q.get('id') ?? ''
    const { registry } = await readRegistry()
    const skill = registry.skills.find((s) => s.id === id)
    if (!skill) return jsonError(`No skill "${id}" is registered.`, 404)
    const md = await readSkillInstructions(root, id)
    return NextResponse.json({
      ok: true,
      skill: publicRecord(skill),
      instructions: md.ok ? md.text ?? '' : null,
      instructionsError: md.ok ? undefined : md.error,
      truncated: md.truncated === true,
    })
  }

  if (op === 'read') {
    const id = q.get('id') ?? ''
    const rel = q.get('path') ?? ''
    if (!rel) return jsonError('Query parameter "path" is required.', 400)
    const r = await readSkillResource(root, id, rel)
    if (!r.ok) return jsonError(r.error ?? 'Read failed.', 400)
    return NextResponse.json({ ok: true, id, path: rel, text: r.text ?? '', truncated: r.truncated === true })
  }

  if (op === 'inspect') {
    const parsed = parseGitHubUrl(q.get('repo') ?? '')
    if (!parsed.ok) return jsonError(parsed.error, 400)
    const g = parsed.value
    const refOverride = (q.get('ref') ?? '').trim() || undefined
    const resolved = await resolveCommit(g, refOverride)
    if (!resolved.ok) return jsonError(resolved.error, 502, { retryable: resolved.retryable })
    const subPathInput = (q.get('subPath') ?? '').trim()
    let subPath = ''
    if (subPathInput) {
      const safe = safeRelPath(subPathInput)
      if (!safe) return jsonError(`Invalid subPath "${subPathInput.slice(0, 120)}".`, 400)
      subPath = safe
    } else if (resolved.value.subPath) {
      const safe = safeRelPath(resolved.value.subPath)
      if (!safe) return jsonError(`The repository URL contains an unsafe path "${resolved.value.subPath.slice(0, 120)}".`, 400)
      subPath = safe
    }
    const tree = await fetchRepoTree(g.owner, g.repo, resolved.value.commit)
    if (!tree.ok) return jsonError(tree.error, 502, { retryable: tree.retryable })
    const dirs = findSkillDirs(tree.value, subPath || undefined)
    const candidates: Array<Record<string, unknown>> = []
    for (const dir of dirs.slice(0, MAX_INSPECT_SKILLS)) {
      const blobs = blobsInDir(tree.value, dir)
      const dirName = dir ? dir.split('/').pop()! : ''
      const md = await fetchSkillMarkdown(g.owner, g.repo, resolved.value.commit, dir)
      if (!md.ok) {
        candidates.push({
          dir,
          dirName,
          name: dirName,
          description: '',
          license: '',
          compatibility: '',
          category: '',
          fileCount: blobs.length,
          totalBytes: blobs.reduce((n, b) => n + b.size, 0),
          hasScripts: false,
          errors: [md.error],
          warnings: [],
          suspicious: [],
          valid: false,
        })
        continue
      }
      const parsedMd = parseSkillMarkdown(md.text, dirName || undefined)
      const relPaths = blobs.map((b) => (dir ? b.path.slice(dir.length + 1) : b.path))
      const topSegs = new Set(relPaths.map((p) => p.split('/')[0]))
      candidates.push({
        dir,
        dirName,
        name: parsedMd.meta.name || dirName,
        description: parsedMd.meta.description,
        license: parsedMd.meta.license,
        compatibility: parsedMd.meta.compatibility,
        category: parsedMd.meta.metadata.category ?? '',
        metadata: parsedMd.meta.metadata,
        fileCount: blobs.length,
        totalBytes: blobs.reduce((n, b) => n + b.size, 0),
        hasScripts: topSegs.has('scripts'),
        hasReferences: topSegs.has('references'),
        hasAssets: topSegs.has('assets'),
        errors: parsedMd.errors,
        warnings: parsedMd.warnings,
        suspicious: scanSkillText(parsedMd.body, 6),
        valid: parsedMd.ok,
      })
    }
    return NextResponse.json({
      ok: true,
      repo: {
        repoUrl: g.repoUrl,
        owner: g.owner,
        repo: g.repo,
        refUsed: resolved.value.refUsed,
        commit: resolved.value.commit,
        subPath,
        treeTruncated: tree.value.truncated,
      },
      skills: candidates,
    })
  }

  if (op === 'check-update') {
    const id = q.get('id') ?? ''
    const { registry } = await readRegistry()
    const skill = registry.skills.find((s) => s.id === id)
    if (!skill) return jsonError(`No skill "${id}" is registered.`, 404)
    if (skill.source.kind !== 'github' || !skill.source.owner || !skill.source.repo || typeof skill.source.dirInRepo !== 'string') {
      return NextResponse.json({ ok: true, supported: false, reason: 'This skill was added locally — there is no remote source to update from.' })
    }
    const g: GitHubRef = { repoUrl: skill.source.repoUrl ?? '', owner: skill.source.owner, repo: skill.source.repo }
    const resolved = await resolveCommit(g, skill.source.ref)
    if (!resolved.ok) return jsonError(resolved.error, 502, { retryable: resolved.retryable })
    const tree = await fetchRepoTree(g.owner, g.repo, resolved.value.commit)
    if (!tree.ok) return jsonError(tree.error, 502, { retryable: tree.retryable })
    const repoDir = skill.source.dirInRepo
    const blobs = blobsInDir(tree.value, repoDir)
    const mdPath = repoDir ? `${repoDir}/SKILL.md` : 'SKILL.md'
    if (!blobs.some((b) => b.path === mdPath)) {
      return NextResponse.json({ ok: true, supported: true, available: false, reason: `The skill directory "${repoDir || '/'}" no longer exists at ${resolved.value.refUsed}.` })
    }
    const stored = skill.sourceTree ?? {}
    const remoteTree: Record<string, string> = {}
    for (const b of blobs) {
      const rel = safeRel(repoDir ? b.path.slice(repoDir.length + 1) : b.path)
      if (rel) remoteTree[rel] = b.sha
    }
    const added = Object.keys(remoteTree).filter((p) => !(p in stored))
    const removed = Object.keys(stored).filter((p) => !(p in remoteTree))
    const modified = Object.keys(remoteTree).filter((p) => p in stored && stored[p] !== remoteTree[p])
    return NextResponse.json({
      ok: true,
      supported: true,
      available: true,
      behind: resolved.value.commit !== skill.source.commit,
      installedCommit: skill.source.commit ?? '',
      remoteCommit: resolved.value.commit,
      refUsed: resolved.value.refUsed,
      changes: {
        added: added.slice(0, 20),
        removed: removed.slice(0, 20),
        modified: modified.slice(0, 20),
        addedCount: added.length,
        removedCount: removed.length,
        modifiedCount: modified.length,
      },
    })
  }

  if (op === 'compat-env') {
    const env = await buildEnvInput({ probe: q.get('probe') === '1', mode: compatMode(q) })
    return NextResponse.json({
      ok: true,
      fingerprint: fingerprintEnv(env),
      compiledTools: RUNTIME_TOOL_NAMES,
      env: {
        platform: env.platform,
        mode: env.mode,
        codeExecution: env.codeExecution,
        networkEgress: env.networkEgress,
        model: env.model ?? null,
        binaries: env.binaries ?? null,
        runtimeTools: env.runtimeTools ?? RUNTIME_TOOL_NAMES,
      },
    })
  }

  if (op === 'compat') {
    const probe = q.get('probe') === '1'
    const mode = compatMode(q)
    const id = (q.get('id') ?? '').trim()
    if (id) {
      const { registry } = await readRegistry()
      const rec = registry.skills.find((s) => s.id === id)
      if (!rec) return jsonError(`No skill "${id}" is registered.`, 404)
      const res = await installedSkillCompat(root, rec, { probe, mode })
      if (!res.ok) return jsonError(res.error, 400)
      return NextResponse.json({ ok: true, report: res.report })
    }
    const parsed = parseGitHubUrl(q.get('repo') ?? '')
    if (!parsed.ok) return jsonError(parsed.error, 400)
    const g = parsed.value
    const refOverride = (q.get('ref') ?? '').trim() || undefined
    const resolved = await resolveCommit(g, refOverride)
    if (!resolved.ok) return jsonError(resolved.error, 502, { retryable: resolved.retryable })
    const tree = await fetchRepoTree(g.owner, g.repo, resolved.value.commit)
    if (!tree.ok) return jsonError(tree.error, 502, { retryable: tree.retryable })
    let dir = (q.get('dir') ?? '').trim()
    if (dir) {
      const safe = safeRelPath(dir)
      if (!safe) return jsonError(`Invalid dir "${dir.slice(0, 120)}".`, 400)
      dir = safe
    } else {
      const subPathInput = (q.get('subPath') ?? '').trim() || resolved.value.subPath || ''
      let subPath = ''
      if (subPathInput) {
        const safe = safeRelPath(subPathInput)
        if (!safe) return jsonError(`Invalid subPath "${subPathInput.slice(0, 120)}".`, 400)
        subPath = safe
      }
      const dirs = findSkillDirs(tree.value, subPath || undefined)
      if (dirs.length === 0) return jsonError('No skill (a directory containing SKILL.md) was found at that location.', 404)
      if (dirs.length > 1) {
        return NextResponse.json({
          ok: true,
          multiple: true,
          candidates: dirs.map((d) => ({ dir: d, name: d ? d.split('/').pop() : resolved.value.commit.slice(0, 12) })),
        })
      }
      dir = dirs[0]
    }
    const res = await repoCandidateCompat({
      ref: g,
      commit: resolved.value.commit,
      refUsed: resolved.value.refUsed,
      dirInRepo: dir,
      tree: tree.value,
      envOptions: { probe, mode },
    })
    if (!res.ok) return jsonError(res.error, 400)
    return NextResponse.json({ ok: true, report: res.report })
  }

  if (op === 'compat-all') {
    const probe = q.get('probe') === '1'
    const { registry } = await readRegistry()
    const reports = await bulkInstalledCompat(root, registry, { probe, mode: compatMode(q), env: undefined })
    return NextResponse.json({ ok: true, summary: summarizeCompat(reports), reports })
  }

  if (op === 'compat-cache') {
    const store = await readCompatStore()
    return NextResponse.json({ ok: true, updatedAt: store.updatedAt, summary: summarizeCompat(store.reports), reports: store.reports })
  }

  return jsonError(`Unknown op "${op}".`, 400)
}

function safeRel(p: string): string | null {
  const clean = p.replace(/\\/g, '/')
  if (!clean || clean.startsWith('/') || clean.includes('..')) return null
  return clean
}

interface GitHubSourceInput {
  repoUrl: string
  owner: string
  repo: string
  refUsed: string
  subPath: string
  commit: string
  dirInRepo: string
}

type BundleResult =
  | { ok: true; files: BundleFile[]; sourceTree: Record<string, string>; source: GitHubSourceInput }
  | { ok: false; error: string; status?: number }

interface PreparedInstall {
  ok: true
  source: GitHubSourceInput
  bundles: Array<{ name: string; bundle: BundleResult }>
}

async function prepareInstall(
  g: GitHubRef,
  refOverride: string | undefined,
  subPathInput: string,
  expectedCommit: string | undefined,
  names: string[],
): Promise<PreparedInstall | { ok: false; status: number; error: string }> {
  const resolved = await resolveCommit(g, refOverride)
  if (!resolved.ok) return { ok: false, status: 502, error: resolved.error }
  if (expectedCommit && expectedCommit !== resolved.value.commit) {
    return { ok: false, status: 409, error: 'The repository moved since the preview — inspect the repository again before installing.' }
  }
  let subPath = ''
  const rawSub = subPathInput.trim() || resolved.value.subPath || ''
  if (rawSub) {
    const safe = safeRelPath(rawSub)
    if (!safe) return { ok: false, status: 400, error: `Invalid subPath "${rawSub.slice(0, 120)}".` }
    subPath = safe
  }
  const tree = await fetchRepoTree(g.owner, g.repo, resolved.value.commit)
  if (!tree.ok) return { ok: false, status: 502, error: tree.error }
  const source: GitHubSourceInput = {
    repoUrl: g.repoUrl,
    owner: g.owner,
    repo: g.repo,
    refUsed: resolved.value.refUsed,
    subPath,
    commit: resolved.value.commit,
    dirInRepo: '',
  }
  const bundles: Array<{ name: string; bundle: BundleResult }> = []
  for (const name of names) {
    const dir = await findSkillDirForName(g, tree.value, resolved.value.commit, subPath, name)
    if (dir === null) {
      bundles.push({
        name,
        bundle: {
          ok: false,
          error: `No "${name}/SKILL.md" found under "${subPath || '/'}" at commit ${resolved.value.commit.slice(0, 12)}.`,
          status: 404,
        },
      })
      continue
    }
    const blobs = blobsInDir(tree.value, dir)
    const got = await fetchSkillBundle(g.owner, g.repo, resolved.value.commit, dir, blobs)
    if (!got.ok) {
      bundles.push({ name, bundle: { ok: false, error: got.error, status: got.status } })
      continue
    }
    const src: GitHubSourceInput = { ...source, dirInRepo: dir }
    bundles.push({ name, bundle: { ok: true, files: got.value.files, sourceTree: got.value.sourceTree, source: src } })
  }
  return { ok: true, source, bundles }
}

async function findSkillDirForName(
  g: GitHubRef,
  tree: RepoTree,
  commit: string,
  subPath: string,
  name: string,
): Promise<string | null> {
  const dirs = findSkillDirs(tree, subPath || undefined)
  for (const dir of dirs) {
    const base = dir ? dir.split('/').pop()! : ''
    if (base === name) return dir
  }
  // A repository-root skill has no directory name to match, so its declared
  // name (from the root SKILL.md) is the only identification.
  if (!subPath && dirs.includes('')) {
    const md = await fetchSkillMarkdown(g.owner, g.repo, commit, '')
    if (md.ok) {
      const parsed = parseSkillMarkdown(md.text)
      if (parsed.ok && parsed.meta.name === name) return ''
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return jsonError('Cross-origin requests are not allowed.', 403)
  let body: Record<string, unknown> | null = null
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = null
  }
  if (!body || typeof body !== 'object') return jsonError('Invalid JSON body.', 400)
  const action = typeof body.action === 'string' ? body.action : ''
  const root = workspaceRoot()

  if (action === 'install') {
    if (body.confirm !== true) {
      return jsonError('Installing skills requires explicit confirmation of the source and validate result.', 400)
    }
    const parsed = parseGitHubUrl(typeof body.repo === 'string' ? body.repo : '')
    if (!parsed.ok) return jsonError(parsed.error, 400)
    const names = Array.isArray(body.names)
      ? body.names.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter(Boolean)
      : []
    if (!names.length) return jsonError('Select at least one skill to install.', 400)
    if (names.length > MAX_INSTALL_BATCH) return jsonError(`Too many skills in one install (limit ${MAX_INSTALL_BATCH}).`, 400)
    for (const n of names) {
      if (!SKILL_NAME_PATTERN.test(n)) return jsonError(`Invalid skill name "${n}" — must match the declared skill name.`, 400)
    }
    const prepared = await prepareInstall(
      parsed.value,
      typeof body.ref === 'string' ? body.ref.trim() || undefined : undefined,
      typeof body.subPath === 'string' ? body.subPath : '',
      typeof body.commit === 'string' ? body.commit : undefined,
      names,
    )
    if (!prepared.ok) return jsonError(prepared.error, prepared.status)

    const results: Array<Record<string, unknown>> = []
    const successRecords: SkillRecord[] = []
    for (const entry of prepared.bundles) {
      const bundle = entry.bundle
      if (!bundle.ok) {
        results.push({ name: entry.name, ok: false, error: bundle.error, status: bundle.status })
        continue
      }
      const md = bundle.files.find((f) => f.path === 'SKILL.md')
      if (!md) {
        results.push({ name: entry.name, ok: false, error: 'The bundle has no SKILL.md.' })
        continue
      }
      const parsedMd = parseSkillMarkdown(md.bytes.toString('utf-8'), entry.name)
      if (!parsedMd.ok) {
        results.push({ name: entry.name, ok: false, error: `Validation failed: ${parsedMd.errors.join(' ')}` })
        continue
      }
      const install = await installSkillToLibrary(root, {
        id: entry.name,
        files: bundle.files,
        sourceTree: bundle.sourceTree,
        trust: 'approved',
        source: {
          kind: 'github',
          repoUrl: bundle.source.repoUrl,
          owner: bundle.source.owner,
          repo: bundle.source.repo,
          ref: bundle.source.refUsed,
          subPath: bundle.source.subPath,
          commit: bundle.source.commit,
          dirInRepo: bundle.source.dirInRepo,
        },
      })
      if (!install.ok || !install.record) {
        const status = install.error?.includes('already installed') ? 409 : 400
        results.push({ name: entry.name, ok: false, error: install.error ?? 'Install failed.', status })
        continue
      }
      successRecords.push(install.record)
      const suspicious = scanSkillText(parsedMd.body, 6)
      results.push({
        name: entry.name,
        ok: true,
        warnings: [...parsedMd.warnings, ...suspicious.map((h) => `Possible ${h.label} (line ${h.line}).`)],
        files: install.record.files.length,
        suspicious,
      })
    }

    if (successRecords.length) {
      await withRegistryUpdate(async (registry) => {
        const next = mergeInstalled(registry, successRecords, prepared.source.repoUrl)
        return { registry: next, result: null }
      })
    }
    const okAll = results.length > 0 && results.every((r) => r.ok === true)
    return NextResponse.json({ ok: okAll, repo: prepared.source, commit: prepared.source.commit, results }, { status: 200 })
  }

  if (action === 'enable' || action === 'disable') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return jsonError('"id" is required.', 400)
    const enabled = action === 'enable'
    const found = await readRegistry()
    if (!found.registry.skills.some((s) => s.id === id)) return jsonError(`No skill "${id}" is registered.`, 404)
    await withRegistryUpdate(async (registry) => {
      const next: SkillsRegistry = {
        ...registry,
        skills: registry.skills.map((s) => (s.id === id ? { ...s, enabled, updatedAt: new Date().toISOString() } : s)),
      }
      return { registry: next, result: null }
    })
    return NextResponse.json({ ok: true, id, enabled })
  }

  if (action === 'validate') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return jsonError('"id" is required.', 400)
    const found = await readRegistry()
    if (!found.registry.skills.some((s) => s.id === id)) return jsonError(`No skill "${id}" is registered.`, 404)
    const scan = await scanLocalSkill(root, id)
    if (!scan.record) return NextResponse.json({ ok: false, id, errors: scan.errors, warnings: scan.warnings, suspicious: scan.suspicious }, { status: 200 })
    let updated: SkillRecord | null = null
    await withRegistryUpdate(async (registry) => {
      const next: SkillsRegistry = {
        ...registry,
        skills: registry.skills.map((s) => {
          if (s.id !== id) return s
          updated = {
            ...s,
            name: scan.record!.name,
            description: scan.record!.description,
            category: scan.record!.category,
            license: scan.record!.license,
            compatibility: scan.record!.compatibility,
            metadata: scan.record!.metadata,
            allowedTools: scan.record!.allowedTools,
            extras: scan.record!.extras,
            validation: scan.record!.validation,
            files: scan.record!.files,
            integrity: scan.record!.integrity,
            hasScripts: scan.record!.hasScripts,
            hasReferences: scan.record!.hasReferences,
            hasAssets: scan.record!.hasAssets,
            updatedAt: new Date().toISOString(),
          }
          return updated
        }),
      }
      return { registry: next, result: null }
    })
    return NextResponse.json({ ok: scan.ok, id, skill: updated, errors: scan.errors, warnings: scan.warnings, suspicious: scan.suspicious })
  }

  if (action === 'uninstall') {
    if (body.confirm !== true) return jsonError('Uninstalling a skill requires confirmation.', 400)
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return jsonError('"id" is required.', 400)
    const found = await readRegistry()
    if (!found.registry.skills.some((s) => s.id === id)) return jsonError(`No skill "${id}" is registered.`, 404)
    const removed = await removeSkillFromLibrary(root, id)
    if (!removed.ok) return jsonError(removed.error ?? 'Removal failed.', 500)
    await withRegistryUpdate(async (registry) => {
      const next: SkillsRegistry = { ...registry, skills: registry.skills.filter((s) => s.id !== id) }
      return { registry: next, result: null }
    })
    return NextResponse.json({ ok: true, id, removed: true })
  }

  if (action === 'update') {
    if (body.confirm !== true) return jsonError('Updating a skill requires confirmation.', 400)
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return jsonError('"id" is required.', 400)
    const found = await readRegistry()
    const skill = found.registry.skills.find((s) => s.id === id)
    if (!skill) return jsonError(`No skill "${id}" is registered.`, 404)
    if (skill.source.kind !== 'github' || !skill.source.owner || !skill.source.repo || skill.source.dirInRepo === undefined) {
      return jsonError('This skill was added locally — there is no remote source to update from.', 400)
    }
    const g: GitHubRef = { repoUrl: skill.source.repoUrl ?? '', owner: skill.source.owner, repo: skill.source.repo }
    const resolved = await resolveCommit(g, skill.source.ref)
    if (!resolved.ok) return jsonError(resolved.error, 502)
    if (resolved.value.commit === skill.source.commit) {
      return jsonError('Already up to date at the pinned commit.', 409)
    }
    const tree = await fetchRepoTree(g.owner, g.repo, resolved.value.commit)
    if (!tree.ok) return jsonError(tree.error, 502)
    const dir = skill.source.dirInRepo ?? ''
    const blobs = blobsInDir(tree.value, dir)
    if (!blobs.some((b) => b.path === `${dir ? `${dir}/` : ''}SKILL.md`)) {
      return jsonError(`The skill directory "${dir || '/'}" no longer exists at ${resolved.value.refUsed}.`, 409)
    }
    const bundle = await fetchSkillBundle(g.owner, g.repo, resolved.value.commit, dir, blobs)
    if (!bundle.ok) return jsonError(bundle.error, 502)
    const md = bundle.value.files.find((f) => f.path === 'SKILL.md')
    if (!md) return jsonError('The update bundle has no SKILL.md.', 400)
    const parsedMd = parseSkillMarkdown(md.bytes.toString('utf-8'), id)
    if (!parsedMd.ok) return jsonError(`Update rejected — validation failed: ${parsedMd.errors.join(' ')}`, 400)

    let updated: SkillRecord | null = null
    let updateError: string | null = null
    await withRegistryUpdate(async (registry) => {
      const current = registry.skills.find((s) => s.id === id)
      if (!current) {
        updateError = `No skill "${id}" is registered.`
        return { registry, result: null }
      }
      const outcome = await updateSkillInLibrary(root, current, {
        files: bundle.value.files,
        sourceTree: bundle.value.sourceTree,
        source: {
          kind: 'github',
          repoUrl: g.repoUrl,
          owner: g.owner,
          repo: g.repo,
          ref: resolved.value.refUsed,
          subPath: current.source.subPath,
          commit: resolved.value.commit,
          dirInRepo: dir,
        },
      })
      if (!outcome.ok || !outcome.record) {
        updateError = outcome.error ?? 'Update failed.'
        return { registry, result: null }
      }
      updated = outcome.record
      const next: SkillsRegistry = { ...registry, skills: registry.skills.map((s) => (s.id === id ? outcome.record! : s)) }
      return { registry: next, result: null }
    })
    if (updateError) return jsonError(updateError, 400)
    return NextResponse.json({ ok: true, id, commit: resolved.value.commit, skill: updated })
  }

  if (action === 'test-skill') {
    if (body.confirm !== true) return jsonError('Running a skill test requires confirmation.', 400)
    const id = typeof body.id === 'string' ? body.id : ''
    if (!id) return jsonError('"id" is required.', 400)
    const found = await readRegistry()
    const rec = found.registry.skills.find((s) => s.id === id)
    if (!rec) return jsonError(`No skill "${id}" is registered.`, 404)
    const functional = await functionalTestSkill(root, rec)
    const res = await installedSkillCompat(root, rec, {
      functional,
      probe: body.probe === true,
      mode: body.mode === 'ro' ? 'ro' : 'edit',
    })
    if (!res.ok) return NextResponse.json({ ok: false, id, functional, error: res.error }, { status: 200 })
    return NextResponse.json({ ok: true, id, functional, report: res.report })
  }

  if (action === 'compat-clear') {
    await clearCompatStore()
    return NextResponse.json({ ok: true, cleared: true })
  }

  return jsonError(`Unknown action "${action}".`, 400)
}

function mergeInstalled(registry: SkillsRegistry, records: SkillRecord[], repoUrl: string): SkillsRegistry {
  const byId = new Map(registry.skills.map((s) => [s.id, s]))
  for (const rec of records) byId.set(rec.id, rec)
  const trusted = registry.trustedSources.includes(repoUrl) ? registry.trustedSources : [...registry.trustedSources, repoUrl]
  return {
    ...registry,
    trustedSources: trusted.slice(0, 200),
    skills: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_REGISTERED_SKILLS),
  }
}
