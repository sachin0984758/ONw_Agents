import type { Ansi } from './ansi.ts'

/**
 * Small, dependency-free Markdown renderer for terminal output. It streams a
 * line at a time so model output still appears progressively, while fenced
 * code, headings, lists, quotes and diffs stay readable.
 *
 * This is intentionally not a full CommonMark implementation. It never uses
 * terminal control sequences that move the cursor or erase scrollback, so a
 * crash or cancellation cannot leave the terminal in a modified state.
 */
export class MarkdownStream {
  private readonly ansi: Ansi
  private readonly writeRaw: (text: string) => void
  private readonly ascii: boolean
  private buffer = ''
  private inFence = false
  private fenceLanguage = ''

  constructor(ansi: Ansi, write: (text: string) => void, ascii = false) {
    this.ansi = ansi
    this.writeRaw = write
    this.ascii = ascii
  }

  get insideFence(): boolean {
    return this.inFence
  }

  write(delta: string): void {
    this.buffer += delta
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) break
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      this.writeLine(line)
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.writeLine(this.buffer.replace(/\r$/, ''))
      this.buffer = ''
    }
    if (this.inFence) {
      // Do not leave a dangling code fence in the transcript if the model was
      // cancelled mid-block.
      this.writeRaw(`${this.ansi.gray(this.ascii ? '  +-- end code --' : '  └─ end code ─')}\n`)
      this.inFence = false
      this.fenceLanguage = ''
    }
  }

  private inline(text: string): string {
    const ansi = this.ansi
    let out = text
    out = out.replace(/`([^`\n]+)`/g, (_match, code: string) => ansi.cyan(code))
    out = out.replace(/\*\*([^*\n]+)\*\*/g, (_match, bold: string) => ansi.bold(bold))
    out = out.replace(/__([^_\n]+)__/g, (_match, bold: string) => ansi.bold(bold))
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, (_match, prefix: string, italic: string) => `${prefix}${ansi.italic(italic)}`)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => `${label} ${ansi.gray(`(${url})`)}`)
    return out
  }

  private writeLine(line: string): void {
    const ansi = this.ansi
    const fence = /^\s*```([^`]*)$/.exec(line)
    if (fence) {
      if (!this.inFence) {
        this.inFence = true
        this.fenceLanguage = (fence[1] ?? '').trim()
        const label = this.fenceLanguage ? ` ${this.fenceLanguage} ` : ''
        if (this.ascii) {
          this.writeRaw(`${ansi.cyan(`  +--${label}${'-'.repeat(Math.max(0, 12 - label.length))}`)}\n`)
        } else {
          this.writeRaw(`${ansi.cyan(`  ┌─${label}${'─'.repeat(Math.max(0, 12 - label.length))}`)}\n`)
        }
      } else {
        this.inFence = false
        this.fenceLanguage = ''
        this.writeRaw(`${ansi.cyan(this.ascii ? '  +-- end code --' : '  └─ end code ─')}\n`)
      }
      return
    }
    if (this.inFence) {
      this.writeRaw(`${ansi.gray(this.ascii ? '  | ' : '  │ ')}${ansi.cyan(line)}\n`)
      return
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      this.writeRaw(`${ansi.gray((this.ascii ? '-' : '─').repeat(Math.min(48, process.stdout.columns ?? 48)))}\n`)
      return
    }
    if (/^\s*(\+\+\+|---)\s/.test(line) && line.includes('/')) {
      this.writeRaw(`${ansi.bold(line)}\n`)
      return
    }
    if (line.startsWith('@@')) {
      this.writeRaw(`${ansi.cyan(line)}\n`)
      return
    }
    if (line.startsWith('+') && !line.startsWith('+++') && !/^\+\s/.test(line)) {
      this.writeRaw(`${ansi.green(line)}\n`)
      return
    }
    if (line.startsWith('-') && !/^-\s/.test(line)) {
      // Unified-diff deletion (`-old`), not a Markdown bullet (`- item`).
      if (/^-{3}\s/.test(line)) {
        this.writeRaw(`${ansi.bold(line)}\n`)
        return
      }
      this.writeRaw(`${ansi.red(line)}\n`)
      return
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const text = this.inline(heading[2] ?? '')
      this.writeRaw(`${ansi.bold(ansi.cyan(text))}\n`)
      return
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const indent = (/^\s*/.exec(line)?.[0] ?? '').slice(0, 12)
      const text = line.replace(/^\s*[-*+]\s+/, '')
      this.writeRaw(`${indent}${ansi.cyan(this.ascii ? '*' : '•')} ${this.inline(text)}\n`)
      return
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const match = /^(\s*\d+[.)]\s+)(.*)$/.exec(line)
      if (match) {
        this.writeRaw(`${match[1]}${this.inline(match[2] ?? '')}\n`)
        return
      }
    }
    if (/^\s*>\s?/.test(line)) {
      this.writeRaw(`${ansi.gray(`  ${this.ascii ? '|' : '│'} ${this.inline(line.replace(/^\s*>\s?/, ''))}`)}\n`)
      return
    }
    this.writeRaw(`${this.inline(line)}\n`)
  }
}

export function renderMarkdown(
  text: string,
  ansi: Ansi,
  write: (text: string) => void = (chunk) => process.stdout.write(chunk),
  ascii = false,
): void {
  const stream = new MarkdownStream(ansi, write, ascii)
  stream.write(text)
  stream.flush()
}
