import zlib from 'node:zlib'
import path from 'node:path'

const decode = (text: string) => text.replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, code: string) => { const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code); return n <= 0x10ffff ? String.fromCodePoint(n) : '' }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
/** Read-only cached worksheet values; never evaluates formulas, macros or external relationships. */
export function spreadsheetText(buffer: Buffer): { text: string; truncated: boolean; warnings: string[] } {
  let end = -1
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65_558); at--) if (buffer.readUInt32LE(at) === 0x06054b50) { end = at; break }
  if (end < 0 || buffer.readUInt16LE(end + 10) > 1000) throw new Error('This workbook is not a supported bounded XLSX archive.')
  const entries = new Map<string, { offset: number; size: number; compressed: number; method: number }>()
  let at = buffer.readUInt32LE(end + 16)
  for (let index = 0; index < buffer.readUInt16LE(end + 10); index++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('Invalid workbook directory.')
    const length = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32)
    if (at + 46 + length + extra + comment > buffer.length || buffer.readUInt16LE(at + 8) & 1) throw new Error('Encrypted or malformed workbook.')
    const name = buffer.toString('utf8', at + 46, at + 46 + length)
    entries.set(name, { offset: buffer.readUInt32LE(at + 42), size: buffer.readUInt32LE(at + 24), compressed: buffer.readUInt32LE(at + 20), method: buffer.readUInt16LE(at + 10) })
    at += 46 + length + extra + comment
  }
  let decodedBytes = 0
  const read = (name: string) => {
    const entry = entries.get(name)
    if (!entry) return ''
    if (entry.size > 4 * 1024 * 1024 || decodedBytes + entry.size > 24 * 1024 * 1024 || entry.offset + 30 > buffer.length || buffer.readUInt32LE(entry.offset) !== 0x04034b50) throw new Error('Workbook exceeds extraction limits.')
    const start = entry.offset + 30 + buffer.readUInt16LE(entry.offset + 26) + buffer.readUInt16LE(entry.offset + 28)
    if (start + entry.compressed > buffer.length) throw new Error('Invalid workbook entry.')
    const raw = buffer.subarray(start, start + entry.compressed)
    const output = entry.method === 0 ? raw : entry.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: 4 * 1024 * 1024 }) : null
    if (!output || output.length !== entry.size) throw new Error('Unsupported workbook compression or invalid entry size.')
    decodedBytes += output.length
    return output.toString('utf8')
  }
  const strings = [...read('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => decode(match[1]))
  const workbook = read('xl/workbook.xml'), relationships = read('xl/_rels/workbook.xml.rels')
  const targets = new Map([...relationships.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)].flatMap((match) => {
    const id = match[1].match(/\bId="([^"]+)"/)?.[1], target = match[1].match(/\bTarget="([^"]+)"/)?.[1]
    if (!id || !target || /TargetMode="External"/.test(match[1]) || /:|\\/.test(target)) return []
    const resolved = target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('xl', target))
    return resolved.startsWith('xl/worksheets/') ? [[id, resolved] as const] : []
  }))
  const sheets = [...workbook.matchAll(/<sheet\b([^>]+)\/?\s*>/g)].map((match) => ({ name: decode(match[1].match(/\bname="([^"]+)"/)?.[1] || 'Sheet'), file: targets.get(match[1].match(/\br:id="([^"]+)"/)?.[1] || '') }))
  const lines: string[] = []; let chars = 0; let truncated = sheets.length > 50
  for (const sheet of sheets.slice(0, 50)) {
    if (!sheet.file) continue
    lines.push(`Sheet: ${sheet.name}`)
    for (const row of read(sheet.file).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((cell) => {
        const address = cell[1].match(/\br="([^"]+)"/)?.[1] || '?', value = cell[2]?.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || ''
        const shared = /\bt="s"/.test(cell[1]), inline = /\bt="inlineStr"/.test(cell[1])
        const formula = cell[2]?.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1]
        return `${address}: ${shared ? strings[Number(value)] ?? '' : inline ? decode(cell[2] || '') : decode(value)}${formula ? ` [formula: ${decode(formula)}]` : ''}`
      }).join(' | ')
      chars += cells.length
      if (chars > 1_000_000) { truncated = true; break }
      lines.push(cells)
    }
    if (chars > 1_000_000) break
  }
  if (!lines.length) throw new Error('No readable worksheets were found.')
  return { text: lines.join('\n'), truncated, warnings: ['XLSX cached values and formula text only; formulas are not recalculated, date/style formatting is not interpreted, and macros/external data are not executed.'] }
}
