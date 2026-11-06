import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { writeAtomic } from '../utils/fsx.ts'
import { ConfigError } from './types.ts'

export const CURRENT_CONFIG_VERSION = 1

export function validateConfigVersion(raw: Record<string, unknown>): void {
  const version = raw.schemaVersion ?? 0
  if (!Number.isInteger(version) || Number(version) < 0 || Number(version) > CURRENT_CONFIG_VERSION) {
    throw new ConfigError(['Unsupported configuration schemaVersion. Configuration was left unchanged.'])
  }
}

/** Explicit command only. Loading a legacy file never rewrites it. */
export async function migrateConfig(file: string, dryRun = false): Promise<{ changed: boolean; backup?: string; version: number }> {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error('Migration requires a regular config file at most 256 KB.')
  const before = await fs.readFile(file, 'utf8')
  const raw: unknown = JSON.parse(before)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Config must be an object.')
  const object = raw as Record<string, unknown>
  validateConfigVersion(object)
  if (object.schemaVersion === CURRENT_CONFIG_VERSION) return { changed: false, version: CURRENT_CONFIG_VERSION }
  if (dryRun) return { changed: true, version: CURRENT_CONFIG_VERSION }
  const backup = `${file}.v0-${randomUUID()}.bak`
  await fs.writeFile(backup, before, { flag: 'wx', mode: 0o600 })
  if (await fs.readFile(file, 'utf8') !== before) throw new Error(`Config changed during migration; retry after review. Backup: ${backup}`)
  // All unknown keys and values survive migration, including future extensions.
  await writeAtomic(file, `${JSON.stringify({ ...object, schemaVersion: CURRENT_CONFIG_VERSION }, null, 2)}\n`, 0o600)
  return { changed: true, backup, version: CURRENT_CONFIG_VERSION }
}
