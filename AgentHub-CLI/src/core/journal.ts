import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { AgentConfig } from '../config/types.ts'
import { resolveInside } from '../utils/fsx.ts'
import { withFileLock } from '../utils/lock.ts'

interface ActionRecord {
  id: string
  runId: string
  tool: string
  at: string
  state: 'started' | 'succeeded' | 'failed' | 'observed-applied'
  path?: string
  expectedHash?: string
}
export const fingerprint = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

/** Write-ahead tool journal. No tool arguments, file contents or outputs are stored. */
export class ActionJournal {
  readonly file: string
  private readonly config: AgentConfig
  constructor(config: AgentConfig, sessionId: string) {
    this.config = config
    const key = fingerprint(`${config.workspace}\n${sessionId}`).slice(0, 32)
    this.file = path.join(config.sessionsDir, 'journals', `${key}.jsonl`)
  }
  private async records(): Promise<ActionRecord[]> {
    let text: string
    try {
      const stat = await fs.lstat(this.file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('Journal is unsafe or exceeds 4 MB; archive it after review.')
      text = await fs.readFile(this.file, 'utf8')
    } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err }
    const rows = text.split('\n')
    const out: ActionRecord[] = []
    for (const [i, line] of rows.entries()) {
      if (!line) continue
      let value: ActionRecord
      try { value = JSON.parse(line) as ActionRecord }
      catch { if (i === rows.length - 1) throw new Error('Journal has an interrupted final record; review it before continuing.'); throw new Error('Journal is corrupt.') }
      if (!value || typeof value.id !== 'string' || typeof value.runId !== 'string' || typeof value.tool !== 'string' ||
        !Number.isFinite(Date.parse(value.at)) || !['started', 'succeeded', 'failed', 'observed-applied'].includes(value.state) ||
        (value.path !== undefined && typeof value.path !== 'string') ||
        (value.expectedHash !== undefined && !/^[a-f0-9]{64}$/.test(value.expectedHash))) throw new Error('Journal contains an invalid record.')
      out.push(value)
    }
    return out
  }
  private async append(record: ActionRecord): Promise<void> {
    await withFileLock(this.file, async () => {
      // Validate the existing stream before appending to it.
      await this.records()
      const handle = await fs.open(this.file, 'a', 0o600)
      try { await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync() }
      finally { await handle.close() }
    })
  }
  async start(runId: string, id: string, tool: string, args: Record<string, unknown>): Promise<void> {
    let metadata: Partial<ActionRecord> = {}
    if (tool === 'write_file' && typeof args.path === 'string' && typeof args.content === 'string') {
      // Resolve boundaries without reading the target; tool policy still decides access.
      const safe = await resolveInside(this.config.workspace, args.path)
      metadata = { path: path.relative(this.config.workspace, safe), expectedHash: fingerprint(args.content) }
    }
    await this.append({ id, runId, tool, at: new Date().toISOString(), state: 'started', ...metadata })
  }
  async finish(runId: string, id: string, tool: string, ok: boolean): Promise<void> {
    await this.append({ id, runId, tool, at: new Date().toISOString(), state: ok ? 'succeeded' : 'failed' })
  }
  async recover(): Promise<{ observedApplied: number; unresolved: string[] }> {
    const actions = new Map<string, ActionRecord>()
    for (const row of await this.records()) actions.set(`${row.runId}:${row.id}`, row)
    let observedApplied = 0
    const unresolved: string[] = []
    for (const row of actions.values()) {
      if (row.state !== 'started') continue
      if (row.path && row.expectedHash) {
        try {
          const file = await resolveInside(this.config.workspace, row.path)
          const stat = await fs.stat(file)
          if (stat.isFile() && stat.size <= 5 * 1024 * 1024 && fingerprint(await fs.readFile(file)) === row.expectedHash) {
            await this.append({ ...row, state: 'observed-applied', at: new Date().toISOString() })
            observedApplied++; continue
          }
        } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err }
      }
      unresolved.push(`${row.runId}/${row.id} (${row.tool})`)
    }
    return { observedApplied, unresolved }
  }
}
