// ── Local document text extraction (server-only) ─────────────────────────────
// Best-effort, dependency-free extraction of text from attachments so a DOCUMENT
// can be sent to the local model as context. Nothing here calls the network and
// nothing is executed. Failures are reported explicitly — the caller must never
// pretend a document's contents were read when extraction failed.
//
//   - text / source / markup / data files → UTF-8 text
//   - PDF                                 → best-effort text from content streams
//   - DOCX                                → text from word/document.xml (a zip)
//   - ZIP                                 → bounded text/source files only
//   - anything else                       → an explicit "unsupported" error

import zlib from 'node:zlib'
import { MAX_EXTRACTED_DOC_CHARS, extOf } from './attachments'

export interface ExtractResult {
  ok: true
  text: string
  /** How the text was obtained — surfaced so the UI can label it honestly. */
  method: 'text' | 'pdf' | 'docx' | 'zip'
  truncated: boolean
}
export interface ExtractFailure {
  ok: false
  error: string
}

const TEXT_EXTS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'json', 'jsonc', 'csv', 'tsv', 'log',
  'yml', 'yaml', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp',
  'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'ini', 'toml', 'env', 'gitignore', 'tex',
  'conf', 'cfg', 'properties', 'graphql', 'gql', 'vue', 'svelte',
])

function capText(text: string): { text: string; truncated: boolean } {
  const cleaned = text.replace(/\u0000/g, '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
  if (cleaned.length <= MAX_EXTRACTED_DOC_CHARS) return { text: cleaned, truncated: false }
  return { text: cleaned.slice(0, MAX_EXTRACTED_DOC_CHARS), truncated: true }
}

function inflate(buf: Buffer): Buffer | null {
  try {
    return zlib.inflateSync(buf, { maxOutputLength: 24 * 1024 * 1024 })
  } catch {
    /* not zlib-wrapped */
  }
  try {
    return zlib.inflateRawSync(buf, { maxOutputLength: 24 * 1024 * 1024 })
  } catch {
    return null
  }
}

function decodePdfString(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, g: string) => {
    switch (g) {
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case '(':
        return '('
      case ')':
        return ')'
      case '\\':
        return '\\'
      default:
        return String.fromCharCode(parseInt(g, 8))
    }
  })
}

function pdfContentToText(content: string): string {
  const out: string[] = []
  const btRe = /BT([\s\S]*?)ET/g
  let m: RegExpExecArray | null
  while ((m = btRe.exec(content))) {
    const block = m[1]
    const tokenRe = /\((?:\\.|[^\\()])*\)|\bTd\b|\bTD\b|\bT\*\b/g
    let t: RegExpExecArray | null
    while ((t = tokenRe.exec(block))) {
      const tok = t[0]
      if (tok.startsWith('(')) out.push(decodePdfString(tok.slice(1, -1)))
      else out.push('\n')
    }
  }
  return out.join('')
}

function extractPdfText(buf: Buffer): string {
  const raw = buf.toString('latin1')
  const chunks: string[] = []
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let m: RegExpExecArray | null
  while ((m = streamRe.exec(raw))) {
    const compressed = Buffer.from(m[1], 'latin1')
    const decoded = inflate(compressed)
    const text = (decoded ?? compressed).toString('latin1')
    if (!/BT[\s\S]*?ET/.test(text)) continue
    const extracted = pdfContentToText(text)
    if (extracted.trim()) chunks.push(extracted)
  }
  return chunks.join('\n').replace(/\n{2,}/g, '\n').trim()
}

function findZipEntry(buf: Buffer, names: string[]): Buffer | null {
  let eocd = -1
  const minPos = Math.max(0, buf.length - 22 - 65536)
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (names.includes(name)) {
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      const data = buf.subarray(dataStart, dataStart + compSize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) {
        try {
          return zlib.inflateRawSync(data, { maxOutputLength: 24 * 1024 * 1024 })
        } catch {
          return null
        }
      }
      return null
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return null
}

function extractDocxText(buf: Buffer): string {
  const doc = findZipEntry(buf, ['word/document.xml'])
  if (!doc) return ''
  let xml = doc.toString('utf8')
  xml = xml.replace(/<w:p\b[^>]*>/g, '\n').replace(/<w:tab\b[^>]*\/?>/g, '\t').replace(/<w:br\b[^>]*\/?>/g, '\n')
  xml = xml.replace(/<[^>]+>/g, '')
  xml = xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
  return xml.replace(/\n{3,}/g, '\n\n').trim()
}

function extractZipText(buf: Buffer): string {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return ''

  const count = buf.readUInt16LE(eocd + 10)
  if (count > 1000) return ''
  let off = buf.readUInt32LE(eocd + 16)
  const parts: string[] = []
  let chars = 0
  for (let i = 0; i < count && chars < MAX_EXTRACTED_DOC_CHARS; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) return ''
    const flags = buf.readUInt16LE(off + 8)
    const method = buf.readUInt16LE(off + 10)
    const compressedSize = buf.readUInt32LE(off + 20)
    const uncompressedSize = buf.readUInt32LE(off + 24)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const nextOff = off + 46 + nameLen + extraLen + commentLen
    if (nextOff > buf.length) return ''
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    off = nextOff

    // Read only bounded text files. Never unpack to disk or execute content.
    if (name.endsWith('/') || !TEXT_EXTS.has(extOf(name)) || (flags & 1) || uncompressedSize > 1024 * 1024) continue
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) return ''
    const localNameLen = buf.readUInt16LE(localOff + 26)
    const localExtraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + localNameLen + localExtraLen
    if (start + compressedSize > buf.length) return ''
    const compressed = buf.subarray(start, start + compressedSize)
    let decoded: Buffer
    try {
      if (method === 0) decoded = Buffer.from(compressed)
      else if (method === 8) decoded = zlib.inflateRawSync(compressed, { maxOutputLength: 1024 * 1024 })
      else continue
    } catch {
      continue
    }
    const text = decoded.toString('utf8').replace(/\u0000/g, '').trim()
    if (!text) continue
    const remaining = MAX_EXTRACTED_DOC_CHARS - chars
    const part = `File: ${name}\n${text.slice(0, remaining)}`
    parts.push(part)
    chars += part.length
  }
  return parts.join('\n\n')
}

export function extractDocumentText(name: string, mime: string, buf: Buffer): ExtractResult | ExtractFailure {
  const ext = extOf(name)
  const m = (mime || '').toLowerCase()
  try {
    if (ext === 'pdf' || m === 'application/pdf') {
      const text = extractPdfText(buf)
      if (!text) {
        return {
          ok: false,
          error: `“${name}” could not be read: no extractable text was found (it may be a scanned/image PDF). It was not attached.`,
        }
      }
      const capped = capText(text)
      return { ok: true, method: 'pdf', ...capped }
    }
    if (ext === 'docx' || m.includes('wordprocessingml')) {
      const text = extractDocxText(buf)
      if (!text) {
        return { ok: false, error: `“${name}” could not be read as a DOCX document. It was not attached.` }
      }
      const capped = capText(text)
      return { ok: true, method: 'docx', ...capped }
    }
    if (ext === 'zip' || m === 'application/zip' || m === 'application/x-zip-compressed') {
      const text = extractZipText(buf)
      if (!text) return { ok: false, error: `“${name}” has no readable text/source files or could not be read as a ZIP archive. It was not attached.` }
      const capped = capText(text)
      return { ok: true, method: 'zip', ...capped }
    }
    if (m.startsWith('text/') || TEXT_EXTS.has(ext)) {
      const capped = capText(buf.toString('utf8'))
      return { ok: true, method: 'text', ...capped }
    }
    return { ok: false, error: `“${name}” is not a supported document type. It was not attached.` }
  } catch {
    return { ok: false, error: `“${name}” could not be processed. It was not attached.` }
  }
}
