// ── Skills library: local files + registry ───────────────────────────────────
// Server-side only (node:fs). The skill library lives inside the workspace at
// `.agenthub/skills/<name>/` — deliberately separate from the website-template
// library at `.agenthub/website-template-library/`. The registry is a separate
// JSON file under the AgentHub DB dir (never merged into agent-hub-state.json)
// so a dashboard reset can never corrupt installed skills.
//
// Safety properties enforced here:
//   · every written/read/deleted path is contained inside the skill directory
//   · symlinks are never followed while walking, and resource reads refuse
//     paths whose real target escapes the skill directory
//   · size/file/count caps apply before anything is written
//   · installs are staged and renamed into place — a failed install leaves no
//     partial skill behind, and updating a skill keeps a recoverable backup
//   · nothing here executes skill content, ever

import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DB_DIR } from './db-path'
import { writeJsonAtomic, createSerializer } from './fs-atomic'
import {
  parseSkillMarkdown,
  scanSkillText,
  SKILL_FILE_NAME,
  SKILL_NAME_PATTERN,
  MAX_SKILL_MD_CHARS,
  type SuspiciousHit,
} from './skills-format'

export const SKILLS_ROOT_REL = '.agenthub/skills'
export const REGISTRY_FILE = path.join(DB_DIR, 'skills.json')
export const REGISTRY_VERSION = 1

export const MAX_SKILL_FILES = 300
export const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024
export const MAX_SKILL_TOTAL_BYTES = 24 * 1024 * 1024
export const MAX_REGISTERED_SKILLS = 200
export const MAX_RESOURCE_READ_BYTES = 512 * 1024

const STAGING_PREFIX = '.staging-'
const BACKUP_DIR_NAME = '.backups'

export interface SkillFileInfo {
  /** POSIX path relative to the skill directory. */
  path: string
  size: number
}

export interface SkillSourceInfo {
  kind: 'github' | 'local'
  repoUrl?: string
  owner?: string
  repo?: string
  /** Requested branch/tag/commit (default branch when absent). */
  ref?: string
  /** Directory inside the repository that contains the skill dir ('' = root). */
  subPath?: string
  /** Pinned commit SHA the files were fetched at. */
  commit?: string
  /** Full path of the skill directory inside the repository. */
  dirInRepo?: string
}

export interface SkillValidation {
  status: 'valid' | 'invalid' | 'unvalidated'
  errors: string[]
  warnings: string[]
  suspicious: SuspiciousHit[]
  checkedAt: string
}

export interface SkillRecord {
  id: string
  name: string
  description: string
  category: string
  license: string
  compatibility: string
  metadata: Record<string, string>
  /** Advisory only — never a permission (enforced by the runtime allow-lists). */
  allowedTools: string
  extras: Record<string, string>
  source: SkillSourceInfo
  /** POSIX path relative to the workspace root. */
  localPath: string
  enabled: boolean
  /** local = placed by the user · approved = installed after explicit review · unreviewed = not yet reviewed. */
  trust: 'local' | 'approved' | 'unreviewed'
  validation: SkillValidation
  files: SkillFileInfo[]
  hasScripts: boolean
  hasReferences: boolean
  hasAssets: boolean
  /** path → git blob SHA captured at install time (drives update previews). */
  sourceTree?: Record<string, string>
  /** sha256 over the file inventory contents at last validate/install. */
  integrity: string
  installedAt: string
  updatedAt: string
}

export interface SkillsRegistry {
  version: number
  updatedAt: string
  /** Repository URLs the user has explicitly approved installing from. */
  trustedSources: string[]
  skills: SkillRecord[]
}

export function emptyRegistry(): SkillsRegistry {
  return { version: REGISTRY_VERSION, updatedAt: new Date().toISOString(), trustedSources: [], skills: [] }
}

// ── Registry IO (atomic, serialized read-merge-write) ────────────────────────

const serializeRegistry = createSerializer()

function normalizeRegistry(raw: unknown): SkillsRegistry {
  const out = emptyRegistry()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Partial<SkillsRegistry>
  if (Array.isArray(r.trustedSources)) out.trustedSources = r.trustedSources.filter((s): s is string => typeof s === 'string')
  if (Array.isArray(r.skills)) {
    out.skills = r.skills.filter((s): s is SkillRecord => !!s && typeof s === 'object' && typeof (s as SkillRecord).id === 'string')
  }
  return out
}

export async function readRegistry(): Promise<{ registry: SkillsRegistry; warning?: string }> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, 'utf-8')
    return { registry: normalizeRegistry(JSON.parse(raw)) }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { registry: emptyRegistry() }
    // Unreadable/corrupt: quarantine the file and start clean rather than
    // crashing every Skills view. The corrupt copy is kept for inspection.
    try {
      await fs.rename(REGISTRY_FILE, `${REGISTRY_FILE}.corrupt-${Date.now()}`)
    } catch {
      /* best effort */
    }
    return { registry: emptyRegistry(), warning: 'The skill registry was unreadable and has been reset (the corrupt copy was kept).' }
  }
}

export async function writeRegistry(registry: SkillsRegistry): Promise<void> {
  const next: SkillsRegistry = {
    ...registry,
    version: REGISTRY_VERSION,
    updatedAt: new Date().toISOString(),
    skills: registry.skills.slice(0, MAX_REGISTERED_SKILLS),
  }
  await writeJsonAtomic(REGISTRY_FILE, next)
}

/** Serialized read-modify-write so concurrent UI actions cannot clobber each other. */
export function withRegistryUpdate<T>(fn: (registry: SkillsRegistry) => Promise<{ registry: SkillsRegistry; result: T }>): Promise<T> {
  return serializeRegistry(async () => {
    const { registry } = await readRegistry()
    const { registry: next, result } = await fn(registry)
    await writeRegistry(next)
    return result
  }) as Promise<T>
}

// ── Path safety ──────────────────────────────────────────────────────────────

/** Normalize a relative POSIX path; returns null for anything unsafe. */
export function safeRelPath(input: string): string | null {
  if (typeof input !== 'string') return null
  const p = input.replace(/\\/g, '/').trim()
  if (!p || p.length > 512) return null
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null
  const parts: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return null
    if (/[\0<>:"|?*]/.test(seg)) return null
    parts.push(seg)
  }
  if (!parts.length) return null
  return parts.join('/')
}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

export function skillsRootAbs(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.agenthub', 'skills')
}

export function skillDirAbs(workspaceRoot: string, id: string): string {
  return path.join(skillsRootAbs(workspaceRoot), id)
}

export function skillLocalPath(id: string): string {
  return `${SKILLS_ROOT_REL}/${id}`
}

// ── Local scanning ───────────────────────────────────────────────────────────

const SCRIPT_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.ps1', '.cmd', '.bat', '.py', '.js', '.mjs', '.cjs', '.ts', '.rb', '.pl'])
const TEXT_EXTENSIONS = new Set([...SCRIPT_EXTENSIONS, '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.html', '.css'])

interface WalkResult {
  files: SkillFileInfo[]
  totalBytes: number
  errors: string[]
  warnings: string[]
}

async function walkSkillFiles(absDir: string): Promise<WalkResult> {
  const files: SkillFileInfo[] = []
  const errors: string[] = []
  const warnings: string[] = []
  let totalBytes = 0

  const walk = async (abs: string, rel: string): Promise<void> => {
    if (files.length >= MAX_SKILL_FILES) {
      errors.push(`Skill contains more than ${MAX_SKILL_FILES} files — refusing to continue.`)
      return
    }
    let entries
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (files.length >= MAX_SKILL_FILES) {
        errors.push(`Skill contains more than ${MAX_SKILL_FILES} files — refusing to continue.`)
        return
      }
      if (e.isSymbolicLink()) {
        warnings.push(`Skipped symlink "${rel ? `${rel}/` : ''}${e.name}" — symlinks are not part of a skill installation.`)
        continue
      }
      const childAbs = path.join(abs, e.name)
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules' || e.name.startsWith(STAGING_PREFIX)) continue
        await walk(childAbs, childRel)
      } else if (e.isFile()) {
        let size = 0
        try {
          size = (await fs.stat(childAbs)).size
        } catch {
          continue
        }
        if (size > MAX_SKILL_FILE_BYTES) {
          errors.push(`File "${childRel}" exceeds the ${Math.round(MAX_SKILL_FILE_BYTES / 1024)}KB per-file limit.`)
          continue
        }
        totalBytes += size
        if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
          errors.push(`Skill exceeds the ${Math.round(MAX_SKILL_TOTAL_BYTES / (1024 * 1024))}MB total size limit.`)
          return
        }
        files.push({ path: childRel, size })
      }
    }
  }
  await walk(absDir, '')
  return { files, totalBytes, errors, warnings }
}

async function computeIntegrity(absDir: string, files: SkillFileInfo[]): Promise<string> {
  const hash = crypto.createHash('sha256')
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(f.path)
    hash.update('\0')
    try {
      const buf = await fs.readFile(path.join(absDir, f.path.split('/').join(path.sep)))
      hash.update(buf)
    } catch {
      hash.update('missing')
    }
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function featureFlags(files: SkillFileInfo[]): { hasScripts: boolean; hasReferences: boolean; hasAssets: boolean } {
  let hasScripts = false
  let hasReferences = false
  let hasAssets = false
  for (const f of files) {
    const top = f.path.split('/')[0]
    if (top === 'scripts') hasScripts = true
    else if (top === 'references') hasReferences = true
    else if (top === 'assets') hasAssets = true
  }
  return { hasScripts, hasReferences, hasAssets }
}

export interface LocalScanResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  suspicious: SuspiciousHit[]
  record?: Omit<SkillRecord, 'id' | 'source' | 'localPath' | 'enabled' | 'trust' | 'installedAt' | 'updatedAt'>
}

/** Scan a local skill directory: SKILL.md + inventory + suspicious content. */
export async function scanLocalSkill(workspaceRoot: string, id: string): Promise<LocalScanResult> {
  return scanSkillDir(skillDirAbs(workspaceRoot, id), id)
}

/**
 * Scan any directory as a skill. `expectedName` is the declared skill id used
 * for the spec's directory/name match — the physical directory name differs
 * during staging, so the two are deliberately separate.
 */
export async function scanSkillDir(abs: string, expectedName?: string): Promise<LocalScanResult> {
  const id = expectedName ?? path.basename(abs)
  const errors: string[] = []
  const warnings: string[] = []
  let mdRaw = ''
  try {
    const stat = await fs.stat(abs)
    if (!stat.isDirectory()) return { ok: false, errors: ['Skill path is not a directory.'], warnings: [], suspicious: [] }
  } catch {
    return { ok: false, errors: ['Skill directory is missing.'], warnings: [], suspicious: [] }
  }
  try {
    const mdStat = await fs.stat(path.join(abs, SKILL_FILE_NAME))
    if (mdStat.size > MAX_SKILL_MD_CHARS) return { ok: false, errors: [`SKILL.md exceeds the ${Math.round(MAX_SKILL_MD_CHARS / 1024)}KB limit.`], warnings: [], suspicious: [] }
    mdRaw = await fs.readFile(path.join(abs, SKILL_FILE_NAME), 'utf-8')
  } catch {
    return { ok: false, errors: [`${SKILL_FILE_NAME} is missing.`], warnings: [], suspicious: [] }
  }
  const parsed = parseSkillMarkdown(mdRaw, id)
  errors.push(...parsed.errors)
  warnings.push(...parsed.warnings)

  const walked = await walkSkillFiles(abs)
  errors.push(...walked.errors)
  warnings.push(...walked.warnings)

  // Suspicious-content scan: instruction body + script files (bounded reads).
  const suspicious: SuspiciousHit[] = scanSkillText(parsed.body)
  const scriptFiles = walked.files.filter((f) => SCRIPT_EXTENSIONS.has(path.extname(f.path).toLowerCase())).slice(0, 5)
  for (const sf of scriptFiles) {
    try {
      const buf = await fs.readFile(path.join(abs, sf.path.split('/').join(path.sep)))
      const text = buf.toString('utf-8').slice(0, 64 * 1024)
      const hits = scanSkillText(text).map((h) => ({ ...h, label: `script ${sf.path}: ${h.label}` }))
      suspicious.push(...hits)
    } catch {
      /* unreadable script — skip */
    }
  }

  const integrity = await computeIntegrity(abs, walked.files)
  const flags = featureFlags(walked.files)
  const valid = errors.length === 0
  return {
    ok: valid,
    errors,
    warnings,
    suspicious,
    record: {
      name: parsed.meta.name || id,
      description: parsed.meta.description,
      category: parsed.meta.metadata.category ?? '',
      license: parsed.meta.license,
      compatibility: parsed.meta.compatibility,
      metadata: parsed.meta.metadata,
      allowedTools: parsed.meta.allowedTools,
      extras: parsed.meta.extras,
      validation: { status: valid ? 'valid' : 'invalid', errors, warnings, suspicious, checkedAt: new Date().toISOString() },
      files: walked.files,
      integrity,
      ...flags,
    },
  }
}

// ── Reconciliation (registry ⇄ disk) ─────────────────────────────────────────

export interface ReconcileResult {
  registry: SkillsRegistry
  added: string[]
  missing: string[]
  repaired: string[]
}

/**
 * Reconcile registry entries with the local library:
 *  · records whose directory vanished are marked invalid + disabled (never
 *    silently kept as usable skills)
 *  · directories added by hand are discovered and registered
 *  · validation status is refreshed from the real SKILL.md on disk
 */
export async function reconcileRegistry(workspaceRoot: string, registry: SkillsRegistry): Promise<ReconcileResult> {
  const added: string[] = []
  const missing: string[] = []
  const repaired: string[] = []
  const next: SkillsRegistry = { ...registry, skills: [] }

  for (const rec of registry.skills) {
    let stat: import('node:fs').Stats | null = null
    try {
      stat = await fs.stat(skillDirAbs(workspaceRoot, rec.id))
    } catch {
      stat = null
    }
    if (!stat || !stat.isDirectory()) {
      missing.push(rec.id)
      next.skills.push({
        ...rec,
        enabled: false,
        validation: {
          ...rec.validation,
          status: 'invalid',
          errors: [`Skill directory is missing: ${rec.localPath}`],
          checkedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      })
      continue
    }
    const scan = await scanLocalSkill(workspaceRoot, rec.id)
    if (
      scan.record &&
      scan.record.validation.status === 'valid' &&
      (rec.validation.status !== 'valid' || rec.name !== scan.record.name || rec.description !== scan.record.description)
    ) {
      repaired.push(rec.id)
    }
    next.skills.push(
      scan.record
        ? {
            ...rec,
            name: scan.record.name,
            description: scan.record.description,
            category: scan.record.category,
            license: scan.record.license,
            compatibility: scan.record.compatibility,
            metadata: scan.record.metadata,
            allowedTools: scan.record.allowedTools,
            extras: scan.record.extras,
            validation: scan.record.validation,
            files: scan.record.files,
          integrity: scan.record.integrity,
            hasScripts: scan.record.hasScripts,
            hasReferences: scan.record.hasReferences,
            hasAssets: scan.record.hasAssets,
          }
        : {
            ...rec,
            validation: {
              status: 'invalid',
              errors: scan.errors,
              warnings: scan.warnings,
              suspicious: scan.suspicious,
              checkedAt: new Date().toISOString(),
            },
          },
    )
  }

  // Discovery — directories placed in the library by the user.
  const known = new Set(next.skills.map((s) => s.id))
  let names: string[] = []
  try {
    names = await fs.readdir(skillsRootAbs(workspaceRoot))
  } catch {
    names = []
  }
  for (const name of names) {
    if (name.startsWith('.') || known.has(name)) continue
    if (!SKILL_NAME_PATTERN.test(name)) continue
    let isDir = false
    try {
      isDir = (await fs.stat(skillDirAbs(workspaceRoot, name))).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) continue
    // Only directories with a SKILL.md are skills.
    try {
      await fs.stat(path.join(skillDirAbs(workspaceRoot, name), SKILL_FILE_NAME))
    } catch {
      continue
    }
    if (next.skills.length >= MAX_REGISTERED_SKILLS) break
    const scan = await scanLocalSkill(workspaceRoot, name)
    if (!scan.record) continue
    const now = new Date().toISOString()
    const rec: SkillRecord = {
      id: name,
      ...scan.record,
      source: { kind: 'local' },
      localPath: skillLocalPath(name),
      enabled: true,
      trust: 'local',
      installedAt: now,
      updatedAt: now,
    }
    next.skills.push(rec)
    added.push(name)
  }

  next.skills.sort((a, b) => a.id.localeCompare(b.id))
  return { registry: next, added, missing, repaired }
}

// ── Install / update / remove ────────────────────────────────────────────────

export interface BundleFile {
  /** POSIX path relative to the skill directory. */
  path: string
  bytes: Buffer
}

export interface InstallInput {
  id: string
  files: BundleFile[]
  source: SkillSourceInfo
  sourceTree?: Record<string, string>
  trust: SkillRecord['trust']
}

export interface InstallOutcome {
  ok: boolean
  error?: string
  record?: SkillRecord
}

async function stageBundle(workspaceRoot: string, id: string, files: BundleFile[]): Promise<{ staging: string; errors: string[] }> {
  const errors: string[] = []
  const staging = path.join(skillsRootAbs(workspaceRoot), `${STAGING_PREFIX}${id}-${Date.now()}`)
  const seen = new Set<string>()
  let total = 0
  for (const f of files) {
    const rel = safeRelPath(f.path)
    if (!rel) {
      errors.push(`Refusing unsafe file path "${String(f.path).slice(0, 80)}".`)
      continue
    }
    if (seen.has(rel)) {
      errors.push(`Duplicate file path "${rel}".`)
      continue
    }
    seen.add(rel)
    if (f.bytes.length > MAX_SKILL_FILE_BYTES) {
      errors.push(`File "${rel}" exceeds the per-file size limit.`)
      continue
    }
    total += f.bytes.length
    if (total > MAX_SKILL_TOTAL_BYTES) {
      errors.push('Skill exceeds the total size limit.')
      break
    }
    const target = path.join(staging, rel.split('/').join(path.sep))
    if (!isInside(staging, target)) {
      errors.push(`Refusing file outside the skill directory: "${rel}".`)
      continue
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, f.bytes)
  }
  return { staging, errors }
}

function bundleHasSkillFile(files: BundleFile[]): boolean {
  return files.some((f) => safeRelPath(f.path) === SKILL_FILE_NAME)
}

/** Stage + validate + atomically place a new skill. Never overwrites. */
export async function installSkillToLibrary(workspaceRoot: string, input: InstallInput): Promise<InstallOutcome> {
  const { id } = input
  if (!SKILL_NAME_PATTERN.test(id)) return { ok: false, error: `Invalid skill id "${id}" (lowercase letters, numbers, single hyphens).` }
  if (input.files.length === 0) return { ok: false, error: 'No files to install.' }
  if (!bundleHasSkillFile(input.files)) return { ok: false, error: `The skill bundle has no ${SKILL_FILE_NAME}.` }

  const target = skillDirAbs(workspaceRoot, id)
  try {
    await fs.stat(target)
    return { ok: false, error: `A skill named "${id}" is already installed. Use update instead.` }
  } catch {
    /* does not exist — good */
  }

  const { staging, errors } = await stageBundle(workspaceRoot, id, input.files)
  try {
    if (errors.length) return { ok: false, error: errors.join(' ') }
    const md = input.files.find((f) => safeRelPath(f.path) === SKILL_FILE_NAME)!
    const parsed = parseSkillMarkdown(md.bytes.toString('utf-8'), id)
    if (!parsed.ok) return { ok: false, error: `Skill validation failed: ${parsed.errors.join(' ')}` }

    const scan = await scanSkillDir(staging, id)
    if (!scan.record || !scan.ok) {
      return { ok: false, error: `Skill validation failed: ${(scan.errors.length ? scan.errors : ['unknown error']).join(' ')}` }
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.rename(staging, target)
    const now = new Date().toISOString()
    const record: SkillRecord = {
      id,
      ...scan.record,
      source: input.source,
      localPath: skillLocalPath(id),
      enabled: true,
      trust: input.trust,
      installedAt: now,
      updatedAt: now,
    }
    if (input.sourceTree) {
      const safeTree: Record<string, string> = {}
      for (const [k, v] of Object.entries(input.sourceTree)) {
        const rel = safeRelPath(k)
        if (rel && typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v)) safeTree[rel] = v
      }
      record.sourceTree = safeTree
    }
    return { ok: true, record }
  } finally {
    try {
      await fs.rm(staging, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

/**
 * Replace an installed skill with a staged bundle, keeping one recoverable
 * backup under `.backups/<id>-<timestamp>/`. The registry entry is preserved.
 */
export async function updateSkillInLibrary(
  workspaceRoot: string,
  existing: SkillRecord,
  input: { files: BundleFile[]; source: SkillSourceInfo; sourceTree?: Record<string, string> },
): Promise<InstallOutcome> {
  const id = existing.id
  if (input.files.length === 0) return { ok: false, error: 'No files to install.' }
  if (!bundleHasSkillFile(input.files)) return { ok: false, error: `The update bundle has no ${SKILL_FILE_NAME}.` }

  const target = skillDirAbs(workspaceRoot, id)
  try {
    const stat = await fs.stat(target)
    if (!stat.isDirectory()) return { ok: false, error: 'Installed skill directory is not a directory.' }
  } catch {
    return { ok: false, error: 'Installed skill directory is missing — reinstall instead of updating.' }
  }

  const { staging, errors } = await stageBundle(workspaceRoot, id, input.files)
  const backupDir = path.join(skillsRootAbs(workspaceRoot), BACKUP_DIR_NAME, `${id}-${Date.now()}`)
  let backedUp = false
  try {
    if (errors.length) return { ok: false, error: errors.join(' ') }
    const md = input.files.find((f) => safeRelPath(f.path) === SKILL_FILE_NAME)!
    const parsed = parseSkillMarkdown(md.bytes.toString('utf-8'), id)
    if (!parsed.ok) return { ok: false, error: `Skill validation failed: ${parsed.errors.join(' ')}` }

    // Back up the current files before touching them.
    await fs.mkdir(path.dirname(backupDir), { recursive: true })
    await fs.cp(target, backupDir, { recursive: true })
    backedUp = true
    const scanStaged = await scanSkillDir(staging, id)
    if (!scanStaged.record || !scanStaged.ok) {
      return { ok: false, error: `Skill validation failed: ${(scanStaged.errors.length ? scanStaged.errors : ['unknown error']).join(' ')}` }
    }
    await fs.rm(target, { recursive: true, force: true })
    await fs.rename(staging, target)

    // Prune old backups for this skill (keep the newest 2).
    try {
      const backupsRoot = path.join(skillsRootAbs(workspaceRoot), BACKUP_DIR_NAME)
      const entries = (await fs.readdir(backupsRoot)).filter((n) => n.startsWith(`${id}-`)).sort().reverse()
      for (const old of entries.slice(2)) await fs.rm(path.join(backupsRoot, old), { recursive: true, force: true })
    } catch {
      /* best effort */
    }

    const scan = await scanLocalSkill(workspaceRoot, id)
    const now = new Date().toISOString()
    const record: SkillRecord = {
      id,
      ...(scan.record ?? {
        name: existing.name,
        description: existing.description,
        category: existing.category,
        license: existing.license,
        compatibility: existing.compatibility,
        metadata: existing.metadata,
        allowedTools: existing.allowedTools,
        extras: existing.extras,
        validation: { status: 'unvalidated' as const, errors: scan.errors, warnings: scan.warnings, suspicious: scan.suspicious, checkedAt: now },
        files: existing.files,
        hasScripts: existing.hasScripts,
        hasReferences: existing.hasReferences,
        hasAssets: existing.hasAssets,
        integrity: existing.integrity,
      }),
      source: input.source,
      localPath: skillLocalPath(id),
      enabled: existing.enabled,
      trust: existing.trust,
      installedAt: existing.installedAt,
      updatedAt: now,
    }
    if (input.sourceTree) {
      const safeTree: Record<string, string> = {}
      for (const [k, v] of Object.entries(input.sourceTree)) {
        const rel = safeRelPath(k)
        if (rel && typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v)) safeTree[rel] = v
      }
      record.sourceTree = safeTree
    }
    return { ok: true, record }
  } catch (err) {
    // Attempt to restore from the backup if the replacement failed midway.
    if (backedUp) {
      try {
        await fs.rm(target, { recursive: true, force: true })
        await fs.cp(backupDir, target, { recursive: true })
      } catch {
        /* best effort */
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Update failed.' }
  } finally {
    try {
      await fs.rm(staging, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

/** Remove an installed skill directory. Backups are intentionally kept. */
export async function removeSkillFromLibrary(workspaceRoot: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (!SKILL_NAME_PATTERN.test(id)) return { ok: false, error: 'Invalid skill id.' }
  const target = skillDirAbs(workspaceRoot, id)
  if (!isInside(skillsRootAbs(workspaceRoot), target)) return { ok: false, error: 'Refusing to remove a path outside the skill library.' }
  try {
    await fs.rm(target, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Removal failed.' }
  }
}

// ── Resource reads (details viewer) ──────────────────────────────────────────

export interface ResourceRead {
  ok: boolean
  text?: string
  error?: string
  truncated?: boolean
}

/**
 * Read a bundled file from an installed skill. Containment is checked on the
 * resolved real path so a symlink (or crafted path) cannot escape the skill.
 */
export async function readSkillResource(workspaceRoot: string, id: string, rel: string): Promise<ResourceRead> {
  if (!SKILL_NAME_PATTERN.test(id)) return { ok: false, error: 'Invalid skill id.' }
  const relSafe = safeRelPath(rel)
  if (!relSafe) return { ok: false, error: 'Unsafe path.' }
  const dir = skillDirAbs(workspaceRoot, id)
  const target = path.join(dir, relSafe.split('/').join(path.sep))
  if (!isInside(dir, target)) return { ok: false, error: 'Path escapes the skill directory.' }
  try {
    const [realDir, realTarget] = await Promise.all([fs.realpath(dir), fs.realpath(target)])
    if (!isInside(realDir, realTarget) && realDir !== path.dirname(realTarget)) {
      return { ok: false, error: 'Path escapes the skill directory.' }
    }
    const stat = await fs.stat(realTarget)
    if (!stat.isFile()) return { ok: false, error: 'Not a file.' }
    if (stat.size > MAX_RESOURCE_READ_BYTES) {
      const fh = await fs.open(realTarget, 'r')
      try {
        const buf = Buffer.alloc(MAX_RESOURCE_READ_BYTES)
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
        return { ok: true, text: buf.subarray(0, bytesRead).toString('utf-8'), truncated: true }
      } finally {
        await fh.close()
      }
    }
    const buf = await fs.readFile(realTarget)
    if (buf.includes(0) && !TEXT_EXTENSIONS.has(path.extname(relSafe).toLowerCase())) {
      return { ok: false, error: 'Binary file — not shown in the viewer.' }
    }
    return { ok: true, text: buf.toString('utf-8') }
  } catch {
    return { ok: false, error: `File not found: ${relSafe}` }
  }
}

/** Full SKILL.md text for the details viewer. */
export async function readSkillInstructions(workspaceRoot: string, id: string): Promise<ResourceRead> {
  return readSkillResource(workspaceRoot, id, SKILL_FILE_NAME)
}
