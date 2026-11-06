import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentConfig } from '../config/types.ts'
import { resolveInside, writeAtomic } from '../utils/fsx.ts'
import { withFileLock } from '../utils/lock.ts'
import { looksLikeSecret } from '../utils/redact.ts'

export const MEMORY_CATEGORIES = ['preference', 'fact', 'decision', 'history'] as const
export type MemoryCategory = typeof MEMORY_CATEGORIES[number]
export interface MemoryFact {
  id: string
  text: string
  category: MemoryCategory
  source: 'user-command' | 'explicit-user-request'
  updatedAt: string
  expiresAt?: string
}
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
const words = (s: string) => new Set(normalize(s).match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])

/** Lexical relevance; scores are inspectable and never imply semantic certainty. */
export function memoryScore(text: string, query: string): number {
  const terms = words(query)
  if (!terms.size) return 1
  const tokens = words(text)
  const common = [...terms].filter((word) => tokens.has(word)).length
  return common / Math.sqrt(Math.max(1, terms.size * tokens.size)) + (normalize(text).includes(normalize(query)) ? 1 : 0)
}

export class MemoryStore {
  readonly root: string
  readonly file: string
  constructor(config: AgentConfig, user = false) {
    this.root = user ? config.home : config.workspace
    this.file = user ? path.join(config.home, 'memory-facts.json') : path.join(config.workspace, '.agenthub', 'memory-facts.json')
  }
  async list(includeExpired = false): Promise<MemoryFact[]> {
    try { await fs.stat(this.root) } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err }
    await resolveInside(this.root, this.file)
    let raw: unknown
    try {
      const stat = await fs.stat(this.file)
      if (stat.size > 64 * 1024) throw new Error('Structured memory exceeds 64 KB.')
      raw = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err }
    if (!Array.isArray(raw) || raw.length > 200) throw new Error('Invalid structured memory.')
    for (const item of raw) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.text !== 'string' || item.text.length > 500 ||
        !MEMORY_CATEGORIES.includes(item.category) || !['user-command', 'explicit-user-request'].includes(item.source) ||
        !Number.isFinite(Date.parse(item.updatedAt)) || (item.expiresAt !== undefined && !Number.isFinite(Date.parse(item.expiresAt)))) {
        throw new Error('Malformed structured memory; left unchanged.')
      }
    }
    return (raw as MemoryFact[]).filter((item) => includeExpired || !item.expiresAt || Date.parse(item.expiresAt) > Date.now())
  }
  async put(text: string, category: MemoryCategory = 'fact', options: { id?: string; expiresAt?: string; source?: MemoryFact['source'] } = {}): Promise<MemoryFact> {
    text = text.replace(/\s+/g, ' ').trim()
    if (!text || text.length > 500 || looksLikeSecret(text)) throw new Error('Memory must be 1-500 characters without secret-like values.')
    if (!MEMORY_CATEGORIES.includes(category)) throw new Error('Invalid memory category.')
    if (options.expiresAt && !Number.isFinite(Date.parse(options.expiresAt))) throw new Error('Invalid memory expiry.')
    await fs.mkdir(this.root, { recursive: true })
    await resolveInside(this.root, this.file)
    return withFileLock(this.file, async () => {
      const entries = await this.list(true)
      const existing = options.id ? entries.find((item) => item.id === options.id) : entries.find((item) => normalize(item.text) === normalize(text))
      if (options.id && !existing) throw new Error('Memory entry does not exist.')
      const entry: MemoryFact = { id: existing?.id ?? randomUUID(), text, category,
        source: options.source ?? 'user-command', updatedAt: new Date().toISOString(),
        ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}) }
      const next = entries.filter((item) => item.id !== entry.id)
      next.push(entry)
      const encoded = JSON.stringify(next, null, 2)
      if (next.length > 200 || Buffer.byteLength(encoded) > 64 * 1024) throw new Error('Memory capacity reached; remove entries first.')
      await writeAtomic(this.file, encoded, 0o600)
      return entry
    })
  }
  async remove(id: string): Promise<void> {
    await resolveInside(this.root, this.file)
    await withFileLock(this.file, async () => {
      await writeAtomic(this.file, JSON.stringify((await this.list(true)).filter((item) => item.id !== id), null, 2), 0o600)
    })
  }
  /** Extract only explicitly labelled user facts verbatim. Never extract assistant/tool content. */
  async extract(task: string): Promise<MemoryFact[]> {
    const out: MemoryFact[] = []
    for (const line of task.split(/\r?\n/).slice(0, 50)) {
      const match = /^remember\s+(preference|fact|decision|history):\s*(.{1,500})$/i.exec(line.trim())
      if (match?.[1] && match[2]) out.push(await this.put(match[2], match[1].toLowerCase() as MemoryCategory, { source: 'explicit-user-request' }))
    }
    return out
  }
}

export async function retrieveMemory(config: AgentConfig, query: string): Promise<Array<{ path: string; text: string; truncated: boolean }>> {
  if (!config.memory) return []
  const candidates: Array<{ path: string; text: string; score: number }> = []
  for (const user of [false, true]) {
    const root = user ? config.home : config.workspace
    const file = user ? 'memory.md' : '.agenthub/memory.md'
    try {
      await fs.stat(root)
      const abs = await resolveInside(root, file)
      const stat = await fs.stat(abs)
      if (stat.size > 64 * 1024) throw new Error('Legacy memory exceeds 64 KB.')
      const text = await fs.readFile(abs, 'utf8')
      for (const line of text.split(/\r?\n/).filter((s) => s.trim())) candidates.push({ path: user ? '~/.agenthub/memory.md' : file, text: line, score: memoryScore(line, query) })
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err }
    for (const entry of await new MemoryStore(config, user).list()) {
      candidates.push({ path: user ? '~/.agenthub/memory-facts.json' : '.agenthub/memory-facts.json', text: `[${entry.category}] ${entry.text}`, score: memoryScore(entry.text, query) + (entry.category === 'preference' ? 0.25 : 0) })
    }
  }
  let remaining = config.memoryBudgetBytes ?? 6000
  const seen = new Set<string>()
  const out: Array<{ path: string; text: string; truncated: boolean }> = []
  for (const item of candidates.sort((a, b) => b.score - a.score)) {
    if (item.score <= 0 || seen.has(normalize(item.text))) continue
    const bytes = Buffer.byteLength(item.text)
    if (bytes > remaining) continue
    seen.add(normalize(item.text)); remaining -= bytes
    out.push({ path: item.path, text: item.text, truncated: false })
  }
  return out
}
