import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { connectedVault } from './vault'
import { extractDocumentText } from '../document-extract'
import { spreadsheetText } from './spreadsheet'
export interface VaultFile { path: string; title: string; bytes: number; modifiedAt: string; kind: 'text' | 'document' | 'image' | 'unsupported'; readable: boolean; reason?: string }
const TEXT = new Set('md markdown mdx txt text csv tsv log json jsonc yaml yml xml html htm css scss js jsx ts tsx mjs cjs py c h cpp cc hpp sql rs go java cs rb php sh bash ps1 toml ini cfg tex canvas vue svelte ipynb'.split(' '))
const DOCS = new Set(['pdf', 'docx', 'zip', 'xlsx']), IMAGES = new Set(['png', 'jpg', 'jpeg', 'webp'])
const MAX_FILE_BYTES = 16 * 1024 * 1024
export function safeVaultPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\\:\x00-\x1f]/.test(value) || path.isAbsolute(value) || value.split('/').some((part) => !part || part.startsWith('.')) || /(?:^|\/)(?:secrets?|credentials?)(?:\.|\/|$)|\.(?:pem|key|pfx|db|sqlite)$/i.test(value) || /(?:^|\/)id_(?:rsa|ed25519)$/i.test(value)) throw new Error('Choose a non-secret file inside the connected vault.')
  return value
}
function classify(file: string, bytes: number) {
  const ext = path.posix.extname(file).slice(1).toLowerCase(), kind = TEXT.has(ext) ? 'text' : DOCS.has(ext) ? 'document' : IMAGES.has(ext) ? 'image' : 'unsupported'
  return { kind, readable: ['text', 'document'].includes(kind) && bytes <= MAX_FILE_BYTES, reason: bytes > MAX_FILE_BYTES ? 'Exceeds 16 MB read limit.' : kind === 'image' ? 'Use a vision-capable model and attach the image in Chat or Sessions.' : kind === 'unsupported' ? 'No safe reader for this format. Binary files are never executed.' : undefined } as Pick<VaultFile, 'kind' | 'readable' | 'reason'>
}
let cache: { connectionId: string; at: number; files: VaultFile[]; limited: boolean; fingerprint: string } | undefined
export async function vaultFileIndex(refresh = false) {
  const connection = await connectedVault()
  if (!refresh && cache?.connectionId === connection.id && Date.now() - cache.at < 5000) return { connection, ...cache }
  const files: VaultFile[] = []; let entries = 0, limited = false
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > 32) { limited = true; return }
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++entries > 30_000 || files.length >= 10_000) { limited = true; return }
      if (entry.name.startsWith('.') || ['node_modules', 'vendor'].includes(entry.name) || entry.isSymbolicLink()) continue
      const full = path.join(directory, entry.name), relative = path.relative(connection.root, full).split(path.sep).join('/')
      try { safeVaultPath(relative) } catch { continue }
      if (entry.isDirectory()) { if (await fs.realpath(full) === full) await walk(full, depth + 1) }
      else if (entry.isFile()) { const stat = await fs.stat(full); files.push({ path: relative, title: entry.name, bytes: stat.size, modifiedAt: stat.mtime.toISOString(), ...classify(relative, stat.size) }) }
    }
  }
  await walk(connection.root, 0); files.sort((a, b) => a.path.localeCompare(b.path))
  if ((await connectedVault()).id !== connection.id) throw new Error('Vault connection changed. Retry the request.')
  cache = { connectionId: connection.id, at: Date.now(), files, limited, fingerprint: createHash('sha256').update(files.map((file) => `${file.path}:${file.bytes}:${file.modifiedAt}`).join('\n')).digest('hex') }
  return { connection, ...cache }
}
export async function vaultFileText(value: unknown) {
  const relative = safeVaultPath(value), connection = await connectedVault(), target = path.join(connection.root, relative)
  if (await fs.realpath(target) !== target || !(await fs.lstat(target)).isFile()) throw new Error('Linked files and paths outside the vault cannot be read.')
  const handle = await fs.open(target, 'r')
  let buffer: Buffer
  try { const stat = await handle.stat(); if (stat.size > MAX_FILE_BYTES) throw new Error('This file exceeds the 16 MB read limit.'); buffer = await handle.readFile() } finally { await handle.close() }
  const info = classify(relative, buffer.length)
  if (!info.readable) throw new Error(info.reason)
  let text: string, truncated = false, warnings: string[] = []
  if (info.kind === 'text') {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.subarray(2).toString('utf16le')
    else { if (buffer.includes(0)) throw new Error('Binary data detected in a text file.'); text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  } else if (/\.xlsx$/i.test(relative)) { const result = spreadsheetText(buffer); text = result.text; truncated = result.truncated; warnings = result.warnings }
  else {
    const result = extractDocumentText(relative, '', buffer)
    if (!result.ok) throw new Error(result.error)
    text = result.text; truncated = result.truncated
    warnings = [result.method === 'pdf' ? 'PDF text extraction is best-effort; scanned pages require OCR.' : result.method === 'zip' ? 'ZIP source/text only; archive contents are not executed or unpacked to disk.' : 'Document text extraction.']
  }
  if ((await connectedVault()).id !== connection.id) throw new Error('Vault connection changed. Retry the read.')
  return { connection, path: relative, text: text.replace(/\r\n/g, '\n'), truncated, warnings, kind: info.kind, sha256: createHash('sha256').update(buffer).digest('hex') }
}
export async function readVaultFile(value: unknown, offsetValue: unknown = 0, limitValue: unknown = 12000) {
  const offset = Number(offsetValue), limit = Number(limitValue)
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16000) throw new Error('Use a character offset >= 0 and limit between 1 and 16,000.')
  const file = await vaultFileText(value)
  if (offset > file.text.length) throw new Error('Offset exceeds extracted file length.')
  const end = Math.min(file.text.length, offset + limit)
  return { path: file.path, content: file.text.slice(offset, end), offset, nextOffset: end < file.text.length ? end : null, totalCharacters: file.text.length, startLine: file.text.slice(0, offset).split('\n').length, endLine: file.text.slice(0, end).split('\n').length, extractionTruncated: file.truncated, warnings: file.warnings, sha256: file.sha256, connectionId: file.connection.id }
}
export async function listVaultFiles(query = '', offset = 0, limit = 100) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid file catalog page.')
  const index = await vaultFileIndex(), terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const matched = index.files.filter((file) => terms.every((term) => file.path.toLocaleLowerCase().includes(term)))
  const types = Object.fromEntries(['text', 'document', 'image', 'unsupported'].map((kind) => [kind, index.files.filter((file) => file.kind === kind).length]))
  return { files: matched.slice(offset, offset + limit), total: matched.length, allFiles: index.files.length, readable: index.files.filter((file) => file.readable).length, types, offset, nextOffset: offset + limit < matched.length ? offset + limit : null, limited: index.limited, connectionId: index.connection.id }
}
