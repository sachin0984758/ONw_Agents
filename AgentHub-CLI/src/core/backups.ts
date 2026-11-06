import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentConfig } from '../config/types.ts'
import { ensureDir, resolveInside, writeAtomic } from '../utils/fsx.ts'
import { withFileLock } from '../utils/lock.ts'

export interface BackupEntry {
  at: string
  original: string
  /** Absolute backup path, or null when the file did not exist. */
  backup: string | null
  existed: boolean
  /** SHA-256 of the file content written by AgentHub; absent on legacy entries. */
  expectedHash?: string
  /** SHA-256 of the saved original, used to detect a damaged backup. */
  originalHash?: string
  restored?: boolean
}

export interface BackupResult {
  backup: string | null
  existed: boolean
  skipped?: string
}

function contentHash(content: Uint8Array | string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Bounded, per-workspace file backups powering /undo and safe edits. Backups
 * live under the user's AgentHub home, never inside the project.
 */
export class BackupStore {
  readonly root: string
  private readonly indexPath: string
  private readonly workspace: string
  private readonly config: AgentConfig

  constructor(config: AgentConfig) {
    this.config = config
    const hash = createHash('sha1').update(process.platform === 'win32' ? config.workspace.toLowerCase() : config.workspace).digest('hex').slice(0, 10)
    const slug = path.basename(config.workspace).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'workspace'
    this.root = path.join(config.backupsDir, `${slug}-${hash}`)
    this.indexPath = path.join(this.root, 'index.json')
    this.workspace = config.workspace
  }

  private async readIndex(): Promise<BackupEntry[]> {
    let raw: string
    try {
      raw = await fs.readFile(this.indexPath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch (err) {
      throw new Error(`Backup index is not valid JSON: ${(err as Error).message}`)
    }
    if (!Array.isArray(parsed)) throw new Error('Backup index must contain a JSON array.')
    const entries: BackupEntry[] = []
    for (const value of parsed) {
      if (!value || typeof value !== 'object') throw new Error('Backup index contains an invalid entry.')
      const entry = value as Record<string, unknown>
      const validHash = (hash: unknown) => typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash)
      if (
        typeof entry.original !== 'string' ||
        typeof entry.at !== 'string' ||
        typeof entry.existed !== 'boolean' ||
        !(typeof entry.backup === 'string' || entry.backup === null) ||
        (entry.expectedHash !== undefined && !validHash(entry.expectedHash)) ||
        (entry.originalHash !== undefined && !validHash(entry.originalHash)) ||
        (entry.restored !== undefined && typeof entry.restored !== 'boolean')
      ) {
        throw new Error('Backup index contains a malformed entry; it was left unchanged.')
      }
      entries.push(entry as unknown as BackupEntry)
    }
    return entries
  }

  private async writeIndex(entries: BackupEntry[]): Promise<void> {
    await ensureDir(this.root)
    if (entries.length > 10000) throw new Error('Backup index capacity reached; review retention before making more changes.')
    await writeAtomic(this.indexPath, JSON.stringify(entries, null, 2))
  }

  async backup(abs: string, expectedCurrent?: string): Promise<BackupResult> {
    return withFileLock(this.indexPath, () => this.backupUnlocked(abs, expectedCurrent))
  }

  private async backupUnlocked(abs: string, expectedCurrent?: string): Promise<BackupResult> {
    abs = await resolveInside(this.workspace, abs)
    const rel = path.relative(this.workspace, abs)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Refusing to back up a path outside the workspace: ${abs}`)
    }
    let existed = false
    let size = 0
    try {
      const stat = await fs.stat(abs)
      if (!stat.isFile()) throw new Error(`Cannot back up a non-file path: ${abs}`)
      existed = true
      size = stat.size
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      existed = false
    }
    const at = new Date().toISOString()
    const id = `${at.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`
    const expectedHash = expectedCurrent === undefined ? undefined : contentHash(expectedCurrent)
    const entries = await this.readIndex()
    // One pending slot lets explicit pruning preserve the newest undo point.
    if (entries.length > (this.config.backupMaxEntries ?? 200)) throw new Error('Backup retention count reached. Review agenthub backups prune --dry-run before explicitly pruning history.')
    let totalBytes = 0
    for (const entry of entries) {
      if (entry.backup) {
        const safe = await resolveInside(this.root, entry.backup)
        try { totalBytes += (await fs.stat(safe)).size }
        catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err }
      }
    }
    if (totalBytes + size > (this.config.backupMaxBytes ?? 100 * 1024 * 1024)) throw new Error('Backup space limit reached; review and explicitly prune old backups before editing.')
    if (!existed) {
      entries.push({ at, original: abs, backup: null, existed: false, ...(expectedHash ? { expectedHash } : {}) })
      await this.writeIndex(entries)
      return { backup: null, existed: false }
    }
    if (size > 5 * 1024 * 1024) {
      entries.push({ at, original: abs, backup: null, existed: true, ...(expectedHash ? { expectedHash } : {}) })
      await this.writeIndex(entries)
      return { backup: null, existed: true, skipped: 'File is larger than 5 MB; no backup was made.' }
    }
    const target = path.join(this.root, id, rel)
    await ensureDir(path.dirname(target))
    await fs.copyFile(abs, target)
    const originalHash = contentHash(await fs.readFile(target))
    entries.push({ at, original: abs, backup: target, existed: true, originalHash, ...(expectedHash ? { expectedHash } : {}) })
    await this.writeIndex(entries)
    return { backup: target, existed: true }
  }

  async restoreLast(): Promise<{ original: string; backup: string | null; deleted: boolean } | null> {
    return withFileLock(this.indexPath, () => this.restoreUnlocked())
  }

  private async restoreUnlocked(): Promise<{ original: string; backup: string | null; deleted: boolean } | null> {
    const entries = await this.readIndex()
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (!entry || entry.restored) continue
      const original = await resolveInside(this.workspace, entry.original)
      if (path.resolve(original) === path.resolve(this.workspace)) throw new Error('Cannot undo the workspace directory.')
      if (!entry.expectedHash) {
        throw new Error(`Cannot safely undo ${original}: this backup has no recorded post-change fingerprint. The current file was left untouched.`)
      }
      if (entry.existed && !entry.backup) {
        throw new Error(`Cannot undo ${original}: no backup was saved for this file.`)
      }
      if (entry.existed && entry.backup) {
        const current = await fs.readFile(original).catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') return null
          throw err
        })
        if (!current || contentHash(current) !== entry.expectedHash) {
          throw new Error(`Cannot safely undo ${original}: it changed after AgentHub recorded the write. The current file was left untouched.`)
        }
        const backup = await resolveInside(this.root, entry.backup)
        if (!entry.originalHash || contentHash(await fs.readFile(backup)) !== entry.originalHash) {
          throw new Error(`Cannot safely undo ${original}: the saved backup is missing or has changed. The current file was left untouched.`)
        }
        await ensureDir(path.dirname(original))
        await fs.copyFile(backup, original)
        entry.restored = true
        await this.writeIndex(entries)
        return { original: entry.original, backup: entry.backup, deleted: false }
      }
      const current = await fs.readFile(original).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return null
        throw err
      })
      if (!current || contentHash(current) !== entry.expectedHash) {
        throw new Error(`Cannot safely undo ${original}: it changed after AgentHub created it. The current file was left untouched.`)
      }
      await fs.rm(original, { force: true })
      entry.restored = true
      await this.writeIndex(entries)
      return { original: entry.original, backup: null, deleted: true }
    }
    return null
  }

  async list(limit = 20): Promise<BackupEntry[]> {
    const entries = await this.readIndex()
    return entries.filter((e) => !e.restored).slice(-limit).reverse()
  }

  /** Explicit maintenance only. Orphans and tampered/legacy backups are reported, never deleted. */
  async prune(dryRun = true): Promise<{ removed: number; bytes: number; preserved: number; manifest?: string; orphans: string[] }> {
    return withFileLock(this.indexPath, async () => {
      const entries = await this.readIndex()
      const rows: Array<{ entry: BackupEntry; bytes: number; safe: string | null }> = []
      const known = new Set<string>()
      for (const entry of entries) {
        let safe: string | null = null
        let bytes = 0
        if (entry.backup) {
          safe = await resolveInside(this.root, entry.backup)
          known.add(safe)
          try {
            const stat = await fs.lstat(safe)
            if (!stat.isFile() || stat.isSymbolicLink() || !entry.originalHash || contentHash(await fs.readFile(safe)) !== entry.originalHash) safe = null
            else bytes = stat.size
          } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; safe = null }
        }
        rows.push({ entry, bytes, safe })
      }
      const orphans: string[] = []
      const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > 30 || orphans.length >= 500) return
        for (const item of await fs.readdir(dir, { withFileTypes: true })) {
          const file = path.join(dir, item.name)
          if (item.isSymbolicLink()) { orphans.push(file); continue }
          if (item.isDirectory()) await walk(file, depth + 1)
          else if (file !== this.indexPath && !file.endsWith('.lock') && !item.name.startsWith('prune-') && !known.has(file)) orphans.push(file)
        }
      }
      await walk(this.root, 0)
      let total = rows.reduce((sum, row) => sum + row.bytes, 0)
      let count = rows.length
      const remove = new Set<BackupEntry>()
      const latest = [...entries].reverse().find((entry) => !entry.restored)
      for (const row of rows) {
        const age = Date.now() - Date.parse(row.entry.at)
        const excess = count > (this.config.backupMaxEntries ?? 200) || total > (this.config.backupMaxBytes ?? 100 * 1024 * 1024) || age > (this.config.backupMaxAgeDays ?? 90) * 86400000
        if (row.entry === latest || !excess || (row.entry.backup && !row.safe)) continue
        remove.add(row.entry); count--; total -= row.bytes
      }
      const removedRows = rows.filter((row) => remove.has(row.entry))
      const result = { removed: remove.size, bytes: removedRows.reduce((sum, row) => sum + row.bytes, 0), preserved: entries.length - remove.size, orphans }
      if (dryRun || !remove.size) return result
      const manifest = path.join(this.root, `prune-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
      await writeAtomic(manifest, JSON.stringify({ at: new Date().toISOString(), removed: removedRows.map((row) => row.entry) }, null, 2), 0o600)
      await this.writeIndex(entries.filter((entry) => !remove.has(entry)))
      for (const row of removedRows) {
        if (row.safe) {
          const safe = await resolveInside(this.root, row.safe)
          if (contentHash(await fs.readFile(safe)) !== row.entry.originalHash) throw new Error('Backup changed during pruning; deletion stopped. Review the pruning manifest.')
          await fs.unlink(safe)
        }
      }
      return { ...result, manifest }
    })
  }
}
