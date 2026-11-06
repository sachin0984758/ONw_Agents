import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ProviderConfig } from '../config/types.ts'
import type { ModelInfo } from './types.ts'
import { withFileLock } from '../utils/lock.ts'
import { writeAtomic } from '../utils/fsx.ts'

type Capabilities = NonNullable<ModelInfo['capabilities']>
type Capability = keyof Capabilities
interface Entry { key: string; capabilities: Capabilities }
const NAMES = ['streaming', 'tools', 'json', 'vision', 'reasoning']
export class CapabilityRegistry {
  readonly file: string
  constructor(home: string) { this.file = path.join(home, 'capabilities.json') }
  private key(provider: ProviderConfig, model: string): string {
    return createHash('sha256').update(`${provider.id}\n${provider.baseUrl}\n${model}`).digest('hex')
  }
  private async read(): Promise<Entry[]> {
    let raw: unknown
    try {
      const stat = await fs.lstat(this.file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) throw new Error('Capability registry must be a regular file at most 512 KB.')
      raw = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err }
    if (!Array.isArray(raw) || raw.length > 512) throw new Error('Invalid capability registry.')
    return raw.filter((row): row is Entry => row && typeof row.key === 'string' && row.capabilities && typeof row.capabilities === 'object')
  }
  async get(provider: ProviderConfig, model: string): Promise<Capabilities> {
    const stored = (await this.read()).find((row) => row.key === this.key(provider, model))?.capabilities ?? {}
    const out: Capabilities = {}
    for (const name of NAMES as Capability[]) {
      const item = stored[name]
      if (item && typeof item.supported === 'boolean' && item.source === 'observed' && item.at && Date.now() - Date.parse(item.at) < 7 * 86400000 && Date.parse(item.at) <= Date.now()) out[name] = { ...item }
      const configured = provider.capabilities?.[name]
      if (configured !== undefined) out[name] = { supported: configured, source: 'configured' }
    }
    return out
  }
  async observe(provider: ProviderConfig, model: string, capability: Capability, supported: boolean): Promise<void> {
    await withFileLock(this.file, async () => {
      const entries = await this.read()
      const key = this.key(provider, model)
      const existing = entries.find((row) => row.key === key)
      const capabilities = { ...existing?.capabilities, [capability]: { supported, source: 'observed', at: new Date().toISOString() } }
      await writeAtomic(this.file, JSON.stringify([...entries.filter((row) => row.key !== key), { key, capabilities }].slice(-512), null, 2), 0o600)
    })
  }
}
