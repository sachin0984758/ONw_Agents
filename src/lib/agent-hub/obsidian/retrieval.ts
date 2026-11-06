import { vaultFileIndex, vaultFileText } from './files'
import { connectedVault, memoryTerms } from './vault'
export interface VaultChunk { path: string; content: string; offset: number; startLine: number; endLine: number; sha256: string }
let cached: { fingerprint: string; connectionId: string; chunks: VaultChunk[]; indexedFiles: number; failures: Array<{ path: string; error: string }>; limited: boolean } | undefined
let building: { key: string; promise: Promise<NonNullable<typeof cached>> } | undefined
export function retrievalTerms(query: string) {
  const original = memoryTerms(query.replace(/[\/_.-]/g, ' '))
  if (/\bc\b/i.test(query)) original.push('c')
  return [...new Set(original.map((term) => term.length > 4 ? term.replace(/s$/, '') : term))].slice(0, 12)
}
export function chunkVaultText(path: string, text: string, sha256: string): VaultChunk[] {
  const chunks: VaultChunk[] = []; let offset = 0, line = 1
  while (offset < text.length && chunks.length < 1000) {
    let end = Math.min(text.length, offset + 1600)
    if (end < text.length) { const newline = text.lastIndexOf('\n', end); if (newline > offset + 700) end = newline + 1 }
    const content = text.slice(offset, end), count = (content.match(/\n/g) ?? []).length
    chunks.push({ path, content, offset, startLine: line, endLine: line + count, sha256 })
    line += count; offset = end
  }
  return chunks
}
export function rankVaultChunks(chunks: VaultChunk[], query: string, limit = 6) {
  const terms = retrievalTerms(query)
  if (!terms.length) return []
  const values = chunks.map((chunk) => {
    const words = chunk.content.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    const counts = new Map<string, number>()
    for (let word of words) { if (word.length > 4) word = word.replace(/s$/, ''); if (terms.includes(word)) counts.set(word, (counts.get(word) ?? 0) + 1) }
    const location = chunk.path.toLocaleLowerCase().replace(/[_/-]/g, ' ')
    return { chunk, words: words.length, counts, location }
  })
  const average = values.reduce((sum, value) => sum + value.words, 0) / Math.max(1, values.length)
  const frequencies = new Map(terms.map((term) => [term, values.filter((value) => value.counts.has(term)).length]))
  const ranked = values.map((value) => {
    let score = 0, hits = 0
    for (const term of terms) {
      const count = value.counts.get(term) ?? 0, named = value.location.includes(term)
      if (count || named) hits++
      const frequency = frequencies.get(term) ?? 0, idf = Math.log(1 + (values.length - frequency + .5) / (frequency + .5))
      score += idf * count * 2.2 / (count + 1.2 * (.25 + .75 * value.words / Math.max(1, average))) + (named ? 2 : 0)
    }
    const phrase = query.toLocaleLowerCase().trim()
    if (phrase.length > 3 && value.chunk.content.toLocaleLowerCase().includes(phrase)) score += 8
    return { ...value.chunk, score, hits }
  }).filter((value) => value.hits > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.offset - b.offset)
  const selected: typeof ranked = [], perFile = new Map<string, number>()
  for (const hit of ranked) {
    if ((perFile.get(hit.path) ?? 0) >= 2) continue
    selected.push(hit); perFile.set(hit.path, (perFile.get(hit.path) ?? 0) + 1)
    if (selected.length >= limit) break
  }
  return selected
}
export async function retrievalIndex(refresh = false) {
  const files = await vaultFileIndex(refresh), key = `${files.connection.id}:${files.fingerprint}`
  if (!refresh && cached?.connectionId === files.connection.id && cached.fingerprint === files.fingerprint) return cached
  if (building?.key === key) return building.promise
  const promise = (async () => {
    const chunks: VaultChunk[] = [], failures: Array<{ path: string; error: string }> = []
    let indexedFiles = 0, bytes = 0, limited = files.limited
    for (const file of files.files.filter((item) => item.readable)) {
      if (bytes + file.bytes > 64 * 1024 * 1024 || chunks.length >= 30_000) { limited = true; break }
      bytes += file.bytes
      try {
        const source = await vaultFileText(file.path), parts = chunkVaultText(file.path, source.text, source.sha256)
        if (parts.at(-1) && parts.at(-1)!.offset + parts.at(-1)!.content.length < source.text.length) limited = true
        if (source.truncated) limited = true
        const remaining = 30_000 - chunks.length
        if (parts.length > remaining) limited = true
        chunks.push(...parts.slice(0, remaining)); indexedFiles++
      } catch (e) { failures.push({ path: file.path, error: e instanceof Error ? e.message : 'Could not read file.' }) }
    }
    if ((await connectedVault()).id !== files.connection.id) throw new Error('Vault connection changed while indexing.')
    return cached = { fingerprint: files.fingerprint, connectionId: files.connection.id, chunks, indexedFiles, failures, limited }
  })()
  building = { key, promise }
  try { return await promise } finally { if (building?.promise === promise) building = undefined }
}
export async function retrieveVault(query: string, limit = 6) {
  const index = await retrievalIndex()
  const hits = rankVaultChunks(index.chunks, query.slice(0, 1000), Math.min(12, Math.max(1, limit)))
  if ((await connectedVault()).id !== index.connectionId) throw new Error('Vault connection changed. Retry retrieval.')
  return { hits, connectionId: index.connectionId, indexedFiles: index.indexedFiles, chunks: index.chunks.length, failedFiles: index.failures.length, failures: index.failures.slice(0, 10), limited: index.limited }
}
