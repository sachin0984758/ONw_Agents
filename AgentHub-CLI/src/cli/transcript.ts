import { stripVTControlCharacters } from 'node:util'
import { displayWidth, padEnd, type Ansi } from '../utils/ansi.ts'

const RESET = '\u001b[0m'
const SGR = /^\u001b\[[0-9;]*m$/

/** Keep renderer colours, but prevent message text from moving the UI cursor. */
export function transcriptText(text: string): string {
  return text.split(/(\u001b\[[0-9;]*m)/g).map((part) => SGR.test(part)
    ? part
    : stripVTControlCharacters(part).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ''),
  ).join('')
}

/** Wrap styled output into terminal rows, carrying colour across a wrap. */
export function transcriptRows(text: string, width: number): string[] {
  width = Math.max(1, width)
  const rows: string[] = []
  let row = ''
  let columns = 0
  let style = ''
  const newline = (): void => {
    rows.push(row + (style ? RESET : ''))
    row = style
    columns = 0
  }
  for (const token of transcriptText(text).match(/\u001b\[[0-9;]*m|[^\u001b]/gu) ?? []) {
    if (SGR.test(token)) {
      style = token === RESET || token === '\u001b[m' ? '' : style + token
      row += token
    } else if (token === '\n') {
      newline()
    } else {
      for (let ch of token === '\t' ? ' '.repeat(4 - columns % 4) : token) {
        if (displayWidth(ch) > width) ch = '?'
        const size = displayWidth(ch)
        if (columns + size > width) newline()
        row += ch
        columns += size
      }
    }
  }
  rows.push(row + (style ? RESET : ''))
  return rows
}

export function userMessageBlock(text: string, width: number, ansi: Ansi): string {
  width = Math.max(3, width)
  const plain = stripVTControlCharacters(text).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, ' ')
  const rows = transcriptRows(plain, width - 2)
  const paint = (line: string): string => {
    const padded = padEnd(line, width)
    return ansi.enabled ? `\u001b[48;2;28;41;72m\u001b[38;2;210;214;224m${padded}${RESET}` : padded
  }
  return rows.map((row) => paint(` ${row} `)).join('\n') + '\n\n'
}

function messageSeparator(width: number, ansi: Ansi, ascii: boolean): string {
  const rule = (ascii ? '-' : '─').repeat(Math.max(1, width))
  return `${ansi.enabled ? ansi.blue(rule) : rule}\n`
}

export function jumpToLatestLabel(ascii: boolean, ansi: Ansi): string {
  const label = ` ${ascii ? 'v' : '↓'} Jump to latest message ${ascii ? '|' : '·'} Ctrl+End `
  return ansi.enabled ? `\u001b[48;2;28;41;72m\u001b[38;2;210;214;224m${label}${RESET}` : label
}

type Entry = { kind: 'text' | 'user'; text: string }

/** Retain message boundaries so blue panels can be resized without old padding. */
export class TerminalTranscript {
  private entries: Entry[] = []
  private characters = 0

  clear(): void {
    this.entries = []
    this.characters = 0
  }

  append(text: string, kind: Entry['kind'] = 'text'): void {
    const previous = this.entries.at(-1)
    if (kind === 'text' && previous?.kind === 'text') previous.text += text
    else this.entries.push({ kind, text })
    this.characters += text.length
    if (this.characters <= 256_000) return
    while (this.entries.length > 1 && this.characters > 200_000) {
      this.characters -= this.entries.shift()?.text.length ?? 0
    }
    const first = this.entries[0]
    if (first && first.text.length > 256_000) {
      const boundary = first.text.indexOf('\n', first.text.length - 200_000)
      first.text = first.text.slice(boundary < 0 ? -200_000 : boundary + 1)
      this.characters = first.text.length
    }
  }

  render(width: number, ansi: Ansi, ascii = false): string {
    return this.entries.map((entry, index) => {
      const separator = entry.kind === 'user' && index > 0 ? messageSeparator(width, ansi, ascii) : ''
      return separator + (entry.kind === 'user' ? userMessageBlock(entry.text, width, ansi) : entry.text)
    }).join('')
  }
}
