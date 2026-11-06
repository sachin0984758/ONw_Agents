import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { DB_DIR } from '../db-path'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import { registerWorkspace, resolveWorkspace } from '../session/workspaces'
import { readRuntimePolicy } from '../runtime-policy'
import type { MemoryActivity, MemoryNote, MemoryProposal, MemoryRead, ObsidianVault, VaultConnection, VaultGraph } from './types'

interface Saved { version: 1; connection: VaultConnection | null; activity: MemoryActivity[]; proposals: MemoryProposal[] }
const file = path.join(DB_DIR, 'obsidian-memory.json')
const shared = globalThis as typeof globalThis & { obsidianQueue?: ReturnType<typeof createSerializer> }
const serialize = shared.obsidianQueue ??= createSerializer()
const MAX_NOTE = 256 * 1024
const inside = (root: string, target: string) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)) }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
let cached: { root: string; at: number; notes: MemoryNote[]; limited: boolean } | undefined

async function state(): Promise<Saved> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8')) as Saved
    if (value.version !== 1 || !Array.isArray(value.activity) || !Array.isArray(value.proposals) || (value.connection !== null && (!value.connection?.root || !value.connection.workspaceId))) throw new Error('Invalid memory state.')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, connection: null, activity: [], proposals: [] }
    throw new Error('Obsidian connection data could not be read. Existing data was preserved.')
  }
}
const addActivity = (saved: Saved, action: MemoryActivity['action'], scope: string, paths: string[]) => {
  saved.activity = [{ id: randomUUID(), at: new Date().toISOString(), action, scope: scope.slice(0, 100), paths: paths.slice(0, 12) }, ...saved.activity].slice(0, 30)
}
export async function recordMemoryActivity(action: MemoryActivity['action'], scope: string, paths: string[], connectionId: string) {
  await serialize(async () => { const saved = await state(); if (saved.connection?.id !== connectionId) return; addActivity(saved, action, scope, paths); await writeJsonAtomic(file, saved) })
}
export async function memoryState() {
  const saved = await state()
  return { ...saved, proposals: saved.proposals.filter((item) => Date.now() - Date.parse(item.createdAt) < 86_400_000 && item.connectionId === saved.connection?.id) }
}
export async function connectedVault(): Promise<VaultConnection> {
  const connection = (await state()).connection
  if (!connection) throw new Error('Connect an Obsidian vault in Capability packs first.')
  const selected = await resolveWorkspace(connection.workspaceId)
  const actual = await fs.realpath(connection.root).catch(() => { throw new Error('The connected vault folder is unavailable. Restore the folder or reconnect it.') })
  if (selected.root !== connection.root || actual !== connection.root) throw new Error('The vault location changed. Reconnect it before reading notes.')
  return connection
}
export async function discoverVaults(): Promise<ObsidianVault[]> {
  const config = process.env.AGENTHUB_OBSIDIAN_CONFIG || (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'obsidian', 'obsidian.json')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'obsidian', 'obsidian.json'))
  try {
    if ((await fs.stat(config)).size > 256_000) throw new Error('Obsidian system configuration is too large.')
    const value = JSON.parse(await fs.readFile(config, 'utf8')) as { vaults?: Record<string, { path?: string }> }
    const vaults: ObsidianVault[] = []
    for (const [id, entry] of Object.entries(value.vaults ?? {}).slice(0, 50)) {
      if (typeof entry.path !== 'string' || !path.isAbsolute(entry.path)) continue
      const root = await fs.realpath(entry.path).catch(() => null)
      if (root && (await fs.stat(path.join(root, '.obsidian')).catch(() => null))?.isDirectory() && !vaults.some((item) => item.root === root)) vaults.push({ id, root, name: path.basename(root) })
    }
    return vaults
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('Could not read Obsidian’s vault list. You can still connect by pasting the vault folder path.')
  }
}
export async function connectVault(value: unknown): Promise<VaultConnection> {
  if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value)) throw new Error('Choose a detected vault or paste its full folder path.')
  const root = await fs.realpath(value)
  if (!(await fs.stat(path.join(root, '.obsidian'))).isDirectory()) throw new Error('This folder is not an Obsidian vault: .obsidian was not found.')
  const workspace = await registerWorkspace(root)
  return serialize(async () => {
    const saved = await state()
    if (saved.connection?.root === root) return saved.connection
    const connection = { id: randomUUID(), root, name: path.basename(root), workspaceId: workspace.id, connectedAt: new Date().toISOString() }
    saved.connection = connection; saved.proposals = []; cached = undefined
    addActivity(saved, 'connected', 'user', [])
    await writeJsonAtomic(file, saved)
    return connection
  })
}
export async function disconnectVault() {
  await serialize(async () => { const saved = await state(); saved.connection = null; saved.proposals = []; cached = undefined; addActivity(saved, 'disconnected', 'user', []); await writeJsonAtomic(file, saved) })
}
export async function noteIndex(refresh = false) {
  const connection = await connectedVault()
  if (!refresh && cached?.root === connection.root && Date.now() - cached.at < 5000) return { connection, ...cached }
  const notes: MemoryNote[] = []; let entries = 0; let limited = false
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 32 || entries >= 20_000 || notes.length >= 5000) { limited = true; return }
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++entries > 20_000 || notes.length >= 5000) { limited = true; break }
      if (entry.name.startsWith('.') || ['node_modules', 'vendor'].includes(entry.name) || entry.isSymbolicLink()) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const stat = await fs.stat(full).catch(() => null)
        if (stat) notes.push({ path: path.relative(connection.root, full).split(path.sep).join('/'), title: entry.name.replace(/\.md$/i, '').replace(/[_-]/g, ' '), bytes: stat.size, modifiedAt: stat.mtime.toISOString() })
      }
    }
  }
  await walk(connection.root, 0)
  notes.sort((a, b) => a.path.localeCompare(b.path))
  cached = { root: connection.root, at: Date.now(), notes, limited }
  return { connection, ...cached }
}
function relativeNote(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024 || !/\.md$/i.test(value) || /[\\:\x00-\x1f]/.test(value) || value.split('/').some((part) => !part || part.startsWith('.')) || path.isAbsolute(value)) throw new Error('Choose a Markdown note inside the connected vault.')
  return value
}
async function noteText(connection: VaultConnection, value: unknown) {
  const relative = relativeNote(value)
  const target = path.join(connection.root, relative)
  const canonical = await fs.realpath(target)
  if (!inside(connection.root, canonical) || canonical !== target || !(await fs.lstat(target)).isFile()) throw new Error('Linked files and paths outside the vault cannot be read.')
  const handle = await fs.open(canonical, 'r')
  try {
    const size = (await handle.stat()).size
    const buffer = Buffer.alloc(Math.min(size, MAX_NOTE))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (buffer.subarray(0, bytesRead).includes(0)) throw new Error('This note contains binary data.')
    const content = buffer.subarray(0, bytesRead).toString('utf8')
    return { content, truncated: size > MAX_NOTE }
  } finally { await handle.close() }
}
const STOP_WORDS = new Set('a an the and or of to in on my me i is are was what how why can could you your please tell about from with for it this that notes note vault obsidian memory remember explain summarize show read search find use using'.split(' '))
export function memoryTerms(query: string) { return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])].filter((word) => !STOP_WORDS.has(word)).slice(0, 12) }
export async function searchNotes(query: string, limit = 12, refresh = false) {
  const index = await noteIndex(refresh)
  const terms = memoryTerms(query.slice(0, 500))
  if (!terms.length) return { connection: index.connection, notes: index.notes.slice(0, limit), limited: index.limited }
  const matches: Array<MemoryNote & { score: number }> = []; let bytes = 0; let limited = index.limited
  for (const note of index.notes) {
    if (bytes + Math.min(note.bytes, MAX_NOTE) > 32 * 1024 * 1024) { limited = true; break }
    bytes += Math.min(note.bytes, MAX_NOTE)
    const text = await noteText(index.connection, note.path).catch(() => null)
    if (!text) continue
    const lower = text.content.toLocaleLowerCase(), location = note.path.toLocaleLowerCase()
    const hits = terms.filter((term) => location.includes(term) || lower.includes(term))
    if (hits.length < Math.min(2, terms.length)) continue
    const score = hits.reduce((sum, term) => sum + (location.includes(term) ? 12 : 1), 0)
    const first = Math.max(0, lower.indexOf(hits.find((term) => lower.includes(term)) ?? '') - 70)
    const heading = text.content.match(/^#\s+(.+)$/m)?.[1]
    matches.push({ ...note, title: heading || note.title, snippet: text.content.slice(first, first + 260).replace(/\s+/g, ' '), score })
  }
  if ((await connectedVault()).id !== index.connection.id) throw new Error('The memory connection changed. Search again.')
  return { connection: index.connection, notes: matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit), limited }
}
export async function readNote(value: unknown, relationships = true): Promise<MemoryRead> {
  const index = await noteIndex()
  const relative = relativeNote(value)
  const text = await noteText(index.connection, relative)
  const keys = [...text.content.matchAll(/\[\[([^\]\n|#]+)(?:[^\]\n]*)\]\]/g)].map((match) => match[1].replace(/\\$/, '').replace(/\.md$/i, '').toLocaleLowerCase())
  const links = index.notes.filter((note) => keys.some((key) => note.path.replace(/\.md$/i, '').toLocaleLowerCase() === key || path.posix.basename(note.path, '.md').toLocaleLowerCase() === key)).slice(0, 30)
  const backlinks: MemoryNote[] = []
  // Backlink inspection is bounded separately; agent retrieval never scans it.
  if (relationships) {
    const stem = relative.replace(/\.md$/i, '').toLocaleLowerCase(), base = path.posix.basename(stem)
    let bytes = 0
    for (const note of index.notes) {
      if (bytes > 32 * 1024 * 1024 || backlinks.length >= 30) break
      bytes += Math.min(note.bytes, MAX_NOTE)
      if (note.path === relative) continue
      const source = await noteText(index.connection, note.path).catch(() => null)
      if (source && [...source.content.matchAll(/\[\[([^\]\n|#]+)(?:[^\]\n]*)\]\]/g)].some((match) => [stem, base].includes(match[1].replace(/\.md$/i, '').toLocaleLowerCase()))) backlinks.push(note)
    }
  }
  if ((await connectedVault()).id !== index.connection.id) throw new Error('The memory connection changed. Open the note again.')
  return { path: relative, title: text.content.match(/^#\s+(.+)$/m)?.[1] || path.posix.basename(relative, '.md'), ...text, links, backlinks, obsidianUrl: `obsidian://open?path=${encodeURIComponent(path.join(index.connection.root, relative))}` }
}
let graphCache: { at: number; value: VaultGraph } | undefined
/** Edges are actual note references, never invented semantic similarity. */
export async function vaultGraph(refresh = false): Promise<VaultGraph> {
  const index = await noteIndex(refresh)
  if (!refresh && graphCache?.value.connectionId === index.connection.id && Date.now() - graphCache.at < 30_000) return graphCache.value
  const byPath = new Map(index.notes.map((note) => [note.path.toLocaleLowerCase(), note.path]))
  const byName = new Map<string, string[]>()
  for (const note of index.notes) { const name = path.posix.basename(note.path).toLocaleLowerCase(); byName.set(name, [...(byName.get(name) ?? []), note.path]) }
  const links: VaultGraph['links'] = [], seen = new Set<string>()
  let bytes = 0, scanned = 0, limited = index.limited
  for (const note of index.notes) {
    if (bytes + Math.min(note.bytes, MAX_NOTE) > 32 * 1024 * 1024 || links.length >= 15_000) { limited = true; break }
    bytes += Math.min(note.bytes, MAX_NOTE)
    const text = await noteText(index.connection, note.path).catch(() => null)
    if (!text) continue
    scanned++
    const targets = [...text.content.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) => match[1].replace(/\\\|/g, '|').split(/[|#]/)[0])
    targets.push(...[...text.content.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)].map((match) => { try { return decodeURIComponent(match[1].split('#')[0]) } catch { return '' } }))
    for (let target of targets) {
      if (links.length >= 15_000) { limited = true; break }
      target = target.trim()
      if (!target || /[:\\]/.test(target) || target.startsWith('/')) continue
      if (!/\.md$/i.test(target)) target += '.md'
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(note.path), target)).toLocaleLowerCase()
      const named = byName.get(target.toLocaleLowerCase())
      const resolved = byPath.get(target.toLocaleLowerCase()) ?? byPath.get(relative) ?? (named?.length === 1 ? named[0] : undefined)
      if (!resolved || resolved === note.path) continue
      const key = [note.path, resolved].sort().join('\0')
      if (!seen.has(key)) { seen.add(key); links.push({ from: note.path, to: resolved }) }
    }
  }
  if ((await connectedVault()).id !== index.connection.id) throw new Error('The vault connection changed. Refresh the graph.')
  const value = { connectionId: index.connection.id, name: index.connection.name, notes: index.notes, links, limited, scanned }
  graphCache = { at: Date.now(), value }
  return value
}
export async function proposeMemory(title: unknown, content: unknown, scope: string): Promise<MemoryProposal> {
  if (typeof title !== 'string' || !title.trim() || title.length > 160 || typeof content !== 'string' || !content.trim() || content.length > 16_000) throw new Error('A memory needs a title (up to 160 characters) and text (up to 16,000 characters).')
  const connection = await connectedVault()
  return serialize(async () => {
    const saved = await memoryState()
    if (saved.connection?.id !== connection.id) throw new Error('The vault connection changed.')
    if (saved.proposals.length >= 20) throw new Error('Review the pending memory proposals before adding more.')
    const proposal: MemoryProposal = { id: randomUUID(), connectionId: connection.id, title: title.trim(), content: content.trim(), hash: digest(`${title.trim()}\n${content.trim()}`), scope, createdAt: new Date().toISOString() }
    saved.proposals.push(proposal); addActivity(saved, 'proposed', scope, [])
    await writeJsonAtomic(file, saved)
    return proposal
  })
}
export async function reviewMemory(id: unknown, hash: unknown, approved: boolean) {
  return serialize(async () => {
    const saved = await memoryState(), connection = await connectedVault()
    const proposal = saved.proposals.find((item) => item.id === id && item.hash === hash && item.connectionId === connection.id)
    if (!proposal) throw new Error('This memory review expired or changed. Prepare it again.')
    let relative: string | undefined
    if (approved) {
      if (!(await readRuntimePolicy()).codeExecution) throw new Error('File writes are disabled in AgentHub settings.')
      const directory = path.join(connection.root, 'AgentHub Memory')
      await fs.mkdir(directory, { recursive: true })
      if (await fs.realpath(directory) !== directory || !(await fs.lstat(directory)).isDirectory()) throw new Error('The memory folder must be a real directory inside the vault, not a link.')
      relative = `AgentHub Memory/${proposal.id}.md`
      await fs.writeFile(path.join(connection.root, relative), `# ${proposal.title.replace(/[\r\n]/g, ' ')}\n\n${proposal.content}\n`, { flag: 'wx', encoding: 'utf8' })
      cached = undefined
    }
    saved.proposals = saved.proposals.filter((item) => item.id !== proposal.id)
    addActivity(saved, approved ? 'saved' : 'declined', 'user', relative ? [relative] : [])
    await writeJsonAtomic(file, saved)
    return { path: relative, saved: approved }
  })
}
