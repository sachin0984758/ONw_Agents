import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentConfig } from '../../config/types.ts'
import { ensureDir, writeAtomic } from '../../utils/fsx.ts'
import { looksLikeSecret } from '../../utils/redact.ts'
import { defaultAnsi } from '../../utils/ansi.ts'
import type { ParsedArgs } from '../args.ts'
import { UsageError } from '../args.ts'
import { MemoryStore, memoryScore } from '../../context/memory.ts'

const MAX_MEMORY_BYTES = 64 * 1024

function memoryPath(config: AgentConfig, user: boolean): string {
  return user ? path.join(config.home, 'memory.md') : path.join(config.workspace, '.agenthub', 'memory.md')
}

async function readMemory(file: string): Promise<string> {
  try {
    const stat = await fs.stat(file)
    if (stat.size > MAX_MEMORY_BYTES) throw new Error(`Memory file is larger than 64 KB: ${file}`)
    return await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

interface Bullet {
  index: number
  line: number
  text: string
  id?: string
  category?: string
  expiresAt?: string
}

function bullets(text: string): Bullet[] {
  const out: Bullet[] = []
  const lines = text.split(/\r?\n/)
  let index = 1
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*[-*]\s+(.*)$/.exec(lines[i] ?? '')
    if (match) {
      out.push({ index: index++, line: i, text: match[1] ?? '' })
    }
  }
  return out
}

export async function listMemoryEntries(config: AgentConfig, user = false): Promise<Bullet[]> {
  const legacy = bullets(await readMemory(memoryPath(config, user)))
  const facts = await new MemoryStore(config, user).list(true)
  return [...legacy, ...facts.map((entry, i) => ({ index: legacy.length + i + 1, line: -1, text: entry.text, id: entry.id, category: entry.category, expiresAt: entry.expiresAt }))]
}

export async function removeMemoryEntry(config: AgentConfig, index: number, user = false): Promise<string | null> {
  if (!Number.isInteger(index) || index < 1) throw new UsageError('Memory entry index must be a positive number.')
  const file = memoryPath(config, user)
  const text = await readMemory(file)
  const target = bullets(text).find((item) => item.index === index)
  if (!target) {
    const fact = (await listMemoryEntries(config, user)).find((item) => item.index === index && item.id)
    if (!fact?.id) return null
    await new MemoryStore(config, user).remove(fact.id)
    return fact.text
  }
  const lines = text.split(/\r?\n/)
  lines.splice(target.line, 1)
  await writeAtomic(file, `${lines.join('\n').replace(/\n+$/, '')}\n`)
  return target.text
}

export async function runMemoryCommand(config: AgentConfig, args: ParsedArgs): Promise<number> {
  const ansi = defaultAnsi()
  const print = (line = '') => process.stdout.write(`${line}\n`)
  const sub = args.subcommand ?? 'list'
  const file = memoryPath(config, args.user)
  const scope = args.user ? 'user' : 'project'

  if (sub === 'extract') {
    const entries = await new MemoryStore(config, args.user).extract(args.rest.join(' '))
    print(args.json ? JSON.stringify({ ok: true, scope, entries }) : `Stored ${entries.length} explicit fact(s). Use remember fact: <text>, remember preference: <text>, remember decision: <text>, or remember history: <text>.`)
    return 0
  }
  if (sub === 'update') {
    const index = Number(args.rest[0])
    const entry = (await listMemoryEntries(config, args.user)).find((item) => item.index === index)
    if (!entry?.id) throw new UsageError('Use the index of a structured entry from memory list; legacy Markdown entries can be removed and re-added.')
    const updated = await new MemoryStore(config, args.user).put(args.rest.slice(1).join(' '), entry.category as 'fact', { id: entry.id, ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}) })
    print(args.json ? JSON.stringify({ ok: true, scope, updated }) : `Updated entry ${index}.`)
    return 0
  }
  if (sub === 'expire') {
    const entry = (await listMemoryEntries(config, args.user)).find((item) => item.index === Number(args.rest[0]))
    if (!entry?.id || !args.rest[1]) throw new UsageError('Usage: memory expire <structured-entry-index> <ISO-date>')
    const updated = await new MemoryStore(config, args.user).put(entry.text, entry.category as 'fact', { id: entry.id, expiresAt: args.rest[1] })
    print(args.json ? JSON.stringify({ ok: true, scope, updated }) : `Set expiry for entry ${entry.index}.`)
    return 0
  }

  if (sub === 'list') {
    const items = await listMemoryEntries(config, args.user)
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, scope, file, entries: items }, null, 2)}\n`)
      return 0
    }
    print(ansi.bold(`Memory (${scope})`))
    print(ansi.gray(file))
    if (items.length === 0) {
      print('(empty)')
      return 0
    }
    for (const item of items) print(`${String(item.index).padStart(3, ' ')}. ${item.text}`)
    print('')
    print(ansi.gray('Change with: agenthub memory add "text"   /   agenthub memory remove <index>'))
    return 0
  }

  if (sub === 'search') {
    const query = args.rest.join(' ').trim()
    if (!query) throw new UsageError('Usage: agenthub memory search <text> [--user]')
    const items = (await listMemoryEntries(config, args.user)).map((item) => ({ ...item, score: memoryScore(item.text, query) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
    if (args.json) process.stdout.write(`${JSON.stringify({ ok: true, scope, query, entries: items }, null, 2)}\n`)
    else {
      print(ansi.bold(`Memory search (${scope}): ${query}`))
      if (items.length === 0) print('(no matches)')
      for (const item of items) print(`${String(item.index).padStart(3, ' ')}. ${item.text}`)
    }
    return 0
  }

  if (sub === 'add') {
    const text = args.rest.join(' ').replace(/\s+/g, ' ').trim()
    if (!text) throw new UsageError('Usage: agenthub memory add "text" [--user]')
    if (text.length > 500) throw new UsageError('A memory entry must be at most 500 characters.')
    if (looksLikeSecret(text)) {
      if (args.json) print(JSON.stringify({ ok: false, scope, error: 'Refusing to store a value that looks like a secret.' }))
      else {
        print(`${ansi.red('Refusing to store a value that looks like a secret.')}`)
        print(ansi.gray('Memory is for durable preferences and project facts, not credentials.'))
      }
      return 2
    }
    const existing = await readMemory(file)
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()
    if (bullets(existing).some((item) => normalize(item.text) === normalize(text))) {
      if (args.json) print(JSON.stringify({ ok: true, scope, file, duplicate: true }))
      else print(`${ansi.yellow('That entry already exists.')}`)
      return 0
    }
    const next = `${existing.trimEnd()}${existing.trim() ? '\n' : ''}- ${text}\n`
    if (Buffer.byteLength(next, 'utf8') > MAX_MEMORY_BYTES) {
      const error = 'Memory file would exceed 64 KB. Remove older entries first.'
      if (args.json) print(JSON.stringify({ ok: false, scope, file, error }))
      else print(ansi.red(error))
      return 1
    }
    await ensureDir(path.dirname(file))
    await writeAtomic(file, next)
    if (args.json) process.stdout.write(`${JSON.stringify({ ok: true, scope, file, added: text }, null, 2)}\n`)
    else print(`${ansi.green('✓')} Added to ${scope} memory (${file})`)
    return 0
  }

  if (sub === 'remove' || sub === 'delete') {
    const raw = args.rest[0]
    const index = Number(raw)
    if (!Number.isInteger(index) || index < 1) throw new UsageError('Usage: agenthub memory remove <index> [--user]')
    const removed = await removeMemoryEntry(config, index, args.user)
    if (removed === null) {
      const error = `No memory entry ${index}.`
      if (args.json) print(JSON.stringify({ ok: false, scope, file, error }))
      else print(ansi.red(error))
      return 1
    }
    if (args.json) process.stdout.write(`${JSON.stringify({ ok: true, scope, file, removed }, null, 2)}\n`)
    else print(`${ansi.green('✓')} Removed: ${removed}`)
    return 0
  }

  if (sub === 'help') {
    print('Usage: agenthub memory <list|search|add|remove|delete> [--user]')
    print('  list              List curated memory entries')
    print('  search <text>     Search entries (case-insensitive)')
    print('  add "text"        Add an entry (rejects secret-like values)')
    print('  remove <index>    Remove an entry by its list index')
    return 0
  }

  throw new UsageError(`Unknown memory subcommand: ${sub}`)
}
