import { emitKeypressEvents, type Key } from 'node:readline'
import readline from 'node:readline/promises'
import { PassThrough, Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { displayWidth, truncate, type Ansi } from '../utils/ansi.ts'
import { TerminalTranscript, jumpToLatestLabel, transcriptRows, transcriptText, userMessageBlock } from './transcript.ts'
import { ACTIVITY_LABELS, activityIsBusy, type Activity } from './activity.ts'
import { redactSecrets } from '../utils/redact.ts'
import { matchingCommands } from './slash-commands.ts'

const ESC = '\u001b['
const SAVE = '\u001b7'
const RESTORE = '\u001b8'
const FOOTER_ROWS = 5

export interface TerminalStatus {
  workspace: string
  usage: string
  model: string
}

type TerminalOutput = NodeJS.WritableStream & { columns?: number; rows?: number }

/** Resource names and paths are text, never terminal instructions. */
export function terminalText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
}

function fit(text: string, width: number, ascii: boolean): string {
  if (width <= 0) return ''
  return truncate(text, width, ascii ? '.'.repeat(Math.min(3, width)) : '…')
}

export function statusLine(left: string, right: string, width: number, ascii = false): string {
  left = terminalText(left)
  right = terminalText(right)
  if (displayWidth(left) + displayWidth(right) + 2 <= width) {
    return left + ' '.repeat(width - displayWidth(left) - displayWidth(right)) + right
  }
  // Preserve both the permission/usage and model on smaller terminals.
  const leftWidth = Math.max(0, Math.floor((width - 2) / 2))
  left = fit(left, leftWidth, ascii)
  right = fit(right, Math.max(0, width - displayWidth(left) - 2), ascii)
  return left + ' '.repeat(Math.max(0, width - displayWidth(left) - displayWidth(right))) + right
}

export function liveModelStatus(
  provider: string,
  model: string,
  loaded: boolean | undefined,
  connected: boolean,
  elapsed: string,
  ascii = false,
): string {
  const state = !connected ? 'offline' : loaded === true ? 'LIVE' : loaded === false ? 'not loaded' : 'unverified'
  const separator = ascii ? ' | ' : ' · '
  return `(${terminalText(provider)}) ${terminalText(model)}${separator}${state}${separator}${terminalText(elapsed)}`
}

/** A horizontally scrolling editor keeps long/pasted input out of the footer. */
export function inputViewport(line: string, cursor: number, width: number, ascii = false): { text: string; cursor: number } {
  width = Math.max(1, width)
  const before = Array.from(terminalText(line.slice(0, cursor)))
  let leftWidth = displayWidth(before.join(''))
  let start = 0
  while (leftWidth >= width && start < before.length) leftWidth -= displayWidth(before[start++] ?? '')
  const clipped = start > 0
  const marker = clipped ? (ascii ? '<' : '‹') : ''
  while (displayWidth(marker) + leftWidth >= width && start < before.length) leftWidth -= displayWidth(before[start++] ?? '')
  const left = before.slice(start).join('')
  const prefix = marker + left
  const after = terminalText(line.slice(cursor))
  return {
    text: prefix + truncate(after, Math.max(0, width - displayWidth(prefix)), ascii ? '>' : '›'),
    cursor: Math.min(width - 1, displayWidth(prefix)),
  }
}

/**
 * Keep the transcript in a scrolling region above a compact five-row composer. Node's
 * readline still owns editing/history/raw mode; its redraws go to a quiet sink
 * so a wrapped line can never overwrite the status bar.
 */
export class TerminalUi {
  readonly readline: readline.Interface & { history: string[] }
  private readonly output: TerminalOutput
  private readonly ansi: Ansi
  private readonly ascii: boolean
  private readonly status: () => TerminalStatus
  private readonly input: NodeJS.ReadableStream
  private readonly sink: Writable & { columns?: number }
  private readonly editorInput: PassThrough
  private readonly onEnd: () => void
  private columns = 80
  private rows = 24
  private readonly transcript = new TerminalTranscript()
  private scrollTop: number | null = null
  private started = false
  private finished = false
  private drawQueued = false
  private closed = false
  private pending: { resolve: (line: string | null) => void; label: string; signal?: AbortSignal } | null = null
  private readonly onKey: (text: string, key: Key) => void
  private activity: Activity | null = null
  private activityStarted = 0
  private activityFrame = 0
  private activityTimer: NodeJS.Timeout | null = null
  private composerTop = 2
  private menuHeight = 0
  private menuQuery = ''
  private menuIndex = 0
  private dismissedMenu: string | null = null
  private rendered: { text: string; lines: string[] } | null = null

  constructor(options: {
    input: NodeJS.ReadableStream
    output: TerminalOutput
    ansi: Ansi
    ascii: boolean
    history: string[]
    status: () => TerminalStatus
    onInterrupt: () => void
    onDetails: () => void
    onClose?: () => void
  }) {
    this.input = options.input
    this.output = options.output
    this.ansi = options.ansi
    this.ascii = options.ascii
    this.status = options.status
    this.sink = new Writable({ write: (_chunk, _encoding, done) => done() })
    // Decode keys once, letting the picker consume navigation before readline
    // handles ordinary editing/history. Use public readline.write for the rest.
    const rawInput = options.input as NodeJS.ReadableStream & { setRawMode?: (enabled: boolean) => void }
    this.editorInput = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: (enabled: boolean) => rawInput.setRawMode?.(enabled),
    })
    this.readline = readline.createInterface({
      input: this.editorInput,
      output: this.sink,
      terminal: true,
      history: options.history,
      historySize: 500,
      removeHistoryDuplicates: true,
    }) as readline.Interface & { history: string[] }
    this.readline.on('SIGINT', () => {
      if (this.pending && !this.pending.signal && this.readline.line) {
        this.clearInput()
        this.draw()
      } else options.onInterrupt()
    })
    this.readline.on('close', () => {
      this.closed = true
      const pending = this.pending
      this.pending = null
      pending?.resolve(null)
      options.onClose?.()
    })
    this.onKey = (text, key) => {
      if (this.handleMenuKey(key)) {
        this.queueDraw()
        return
      }
      this.readline.write(text, key)
      if (key.ctrl && key.name === 'end') this.jumpToLatest()
      if (key.ctrl && key.name === 'home') this.scrollBy(-Infinity)
      if (key.shift && key.name === 'pageup') this.scrollBy(-Math.max(1, this.rows - FOOTER_ROWS - 1))
      if (key.shift && key.name === 'pagedown') this.scrollBy(Math.max(1, this.rows - FOOTER_ROWS - 1))
      if (key.ctrl && key.name === 'd' && this.pending && !this.pending.signal) this.clearInput()
      if (key.name === 'escape') {
        if (this.pending && !this.pending.signal) {
          this.clearInput()
        } else {
          options.onInterrupt()
        }
      }
      if (key.ctrl && key.name === 'o') options.onDetails()
      this.queueDraw()
    }
    this.onEnd = () => this.readline.close()
    emitKeypressEvents(options.input)
    options.input.on('keypress', this.onKey)
    options.input.on('end', this.onEnd)
    options.input.resume()
  }

  private queueDraw(): void {
    if (this.drawQueued) return
    this.drawQueued = true
    queueMicrotask(() => {
      this.drawQueued = false
      this.draw()
    })
  }

  private suggestions() {
    const line = this.readline.line
    if (line !== this.menuQuery) {
      this.menuQuery = line
      this.menuIndex = 0
      this.dismissedMenu = null
    }
    if (!this.pending || this.pending.signal || this.pending.label || this.scrollTop !== null || this.dismissedMenu === line) return []
    return matchingCommands(line)
  }

  private handleMenuKey(key: Key): boolean {
    const commands = this.suggestions()
    if (!commands.length) return false
    // Node marks a standalone Escape as meta on some terminal transports.
    if (key.name === 'escape') {
      this.dismissedMenu = this.readline.line
      return true
    }
    if (key.ctrl || key.meta) return false
    if (key.name === 'up' || key.name === 'down') {
      this.menuIndex = (this.menuIndex + (key.name === 'up' ? -1 : 1) + commands.length) % commands.length
      return true
    }
    if (key.name !== 'tab' && key.name !== 'return' && key.name !== 'enter') return false
    const command = commands[this.menuIndex]
    if (!command) return false
    this.clearInput()
    this.readline.write(command.name + (key.name === 'tab' && command.args ? ' ' : ''))
    this.menuQuery = this.readline.line
    this.dismissedMenu = this.menuQuery
    if (key.name !== 'tab') this.readline.write(null, { name: 'return' })
    return true
  }

  private transcriptView(): { text: string; lines: string[] } {
    if (!this.rendered) {
      const text = this.transcript.render(this.columns - 1, this.ansi, this.ascii)
      this.rendered = { text, lines: transcriptRows(text, this.columns) }
    }
    return this.rendered
  }

  private updateLayout(): boolean {
    const commands = this.suggestions()
    const capacity = Math.max(0, Math.min(5, this.rows - FOOTER_ROWS - 3))
    const menuHeight = commands.length && capacity ? Math.min(capacity, commands.length) + 1 : 0
    const bottom = this.rows - FOOTER_ROWS + 1
    const top = this.scrollTop !== null ? bottom : Math.min(bottom, Math.max(2, this.transcriptView().lines.length) + menuHeight + 1)
    const changed = top !== this.composerTop || menuHeight !== this.menuHeight
    this.composerTop = top
    this.menuHeight = menuHeight
    return changed
  }

  start(): void {
    this.started = true
    this.resize()
  }

  setActivity(activity: Activity | null): void {
    if (this.finished) return
    if (this.activity?.phase === activity?.phase && this.activity?.detail === activity?.detail) return
    this.activity = activity
    this.activityStarted = Date.now()
    this.activityFrame = 0
    if (this.activityTimer) clearInterval(this.activityTimer)
    this.activityTimer = null
    if (activityIsBusy(activity)) {
      this.activityTimer = setInterval(() => {
        this.activityFrame++
        this.drawActivity()
      }, 100)
      this.activityTimer.unref?.()
    }
    this.draw()
  }

  private topBorder(width: number): string {
    const rule = this.ascii ? '-' : '─'
    const sep = this.ascii ? '|' : '·'
    const label = this.pending?.label ?? ''
    let title = label
    if (this.activity) {
      const busy = activityIsBusy(this.activity)
      const frames = this.ascii ? ['|', '/', '-', '\\'] : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      const icon = busy ? frames[this.activityFrame % frames.length]
        : this.activity.phase === 'completed' ? (this.ascii ? '+' : '✓')
          : this.activity.phase === 'failed' ? (this.ascii ? 'x' : '✗') : (this.ascii ? '*' : '■')
      const elapsed = busy ? ` (${Math.floor((Date.now() - this.activityStarted) / 1000)}s)` : ''
      const detail = label || this.activity.detail
      title = `${icon} ${ACTIVITY_LABELS[this.activity.phase]}${elapsed}${detail ? ` ${sep} ${terminalText(redactSecrets(detail))}` : ''}`
    }
    const heading = title ? fit(`${rule} ${title} `, width, this.ascii) : ''
    const colour = this.activity?.phase === 'failed' ? this.ansi.red
      : this.activity?.phase === 'completed' ? this.ansi.green
        : this.activity?.phase === 'approval' || this.activity?.phase === 'partial' ? this.ansi.yellow : this.ansi.gray
    return colour(heading) + this.ansi.gray(rule.repeat(Math.max(0, width - displayWidth(heading))))
  }

  /** A spinner tick redraws only the top border, leaving input and chat intact. */
  private drawActivity(): void {
    if (!this.started || this.finished) return
    const width = this.columns - 1
    let frame = `${ESC}?25l${ESC}${this.composerTop};1H${ESC}2K${this.topBorder(width)}`
    if (this.pending) {
      const viewport = inputViewport(this.readline.line, this.readline.cursor, width, this.ascii)
      frame += `${ESC}${this.composerTop + 1};${1 + viewport.cursor}H${ESC}?25h`
    }
    this.output.write(frame)
  }

  write(text: string): void {
    if (!this.started || this.finished) {
      this.output.write(text)
      return
    }
    text = transcriptText(text)
    this.transcript.append(text)
    this.rendered = null
    this.appendOutput(text)
  }

  writeUserMessage(text: string): void {
    this.jumpToLatest()
    this.transcript.append(text, 'user')
    this.rendered = null
    this.appendOutput(userMessageBlock(text, this.columns - 1, this.ansi))
  }

  clearTranscript(): void {
    this.transcript.clear()
    this.rendered = null
    this.scrollTop = null
    this.replay()
  }

  private appendOutput(text: string): void {
    if (this.scrollTop !== null) {
      this.paintScrollback()
      return
    }
    if (this.updateLayout()) {
      this.replay()
      return
    }
    this.output.write(RESTORE + text.replace(/(?<!\r)\n/g, '\r\n') + SAVE)
    if (this.pending) this.draw()
  }

  resize(): void {
    if (!this.started || this.finished) return
    this.columns = Math.max(4, this.output.columns ?? 80)
    this.rows = Math.max(7, this.output.rows ?? 24)
    this.sink.columns = this.columns
    this.rendered = null
    this.updateLayout()
    if (this.scrollTop !== null) this.paintScrollback()
    else this.replay()
  }

  private replay(): void {
    this.updateLayout()
    const height = this.composerTop - this.menuHeight - 1
    this.output.write(`${ESC}?25l${ESC}r${ESC}2J${ESC}1;${height}r${ESC}H${ESC}2 q`
      + this.transcriptView().text.replace(/(?<!\r)\n/g, '\r\n') + SAVE)
    this.draw()
  }

  scrollBy(rows: number): void {
    if (!this.started || this.finished) return
    const lines = this.transcriptView().lines
    const maxTop = Math.max(0, lines.length - (this.rows - FOOTER_ROWS - 1))
    if (maxTop === 0) return
    const top = Math.max(0, Math.min(maxTop, (this.scrollTop ?? maxTop) + rows))
    if (top >= maxTop) this.jumpToLatest()
    else {
      this.scrollTop = top
      this.paintScrollback()
    }
  }

  jumpToLatest(): void {
    if (this.scrollTop === null || !this.started || this.finished) return
    this.scrollTop = null
    this.replay()
  }

  private paintScrollback(): void {
    this.updateLayout()
    const lines = this.transcriptView().lines
    const height = this.rows - FOOTER_ROWS - 1
    const top = Math.min(this.scrollTop ?? 0, Math.max(0, lines.length - height))
    this.scrollTop = top
    let frame = `${ESC}?25l${ESC}r`
    for (let row = 0; row < height; row++) {
      frame += `${ESC}${row + 1};1H${ESC}2K${lines[top + row] ?? ''}`
    }
    this.output.write(frame)
    this.draw()
  }

  private clearInput(): void {
    this.readline.write(null, { ctrl: true, name: 'e' })
    this.readline.write(null, { ctrl: true, name: 'u' })
  }

  question(label = '', signal?: AbortSignal): Promise<string | null> {
    if (this.closed || this.finished || signal?.aborted) return Promise.resolve(null)
    if (this.pending) throw new Error('A terminal question is already active.')
    if (signal) this.jumpToLatest()
    this.clearInput()
    this.dismissedMenu = null
    return new Promise((resolve) => {
      const pending = { resolve, label: terminalText(label).trim(), signal }
      this.pending = pending
      void this.readline.question('', { signal }).then((line) => {
        if (this.pending !== pending) return
        this.pending = null
        if (pending.label && signal) this.write(`${this.ansi.gray(pending.label)} ${terminalText(line)}\n`)
        this.draw()
        resolve(line)
      }, () => {
        if (this.pending === pending) {
          this.pending = null
          this.clearInput()
          this.draw()
        }
        resolve(null)
      })
      this.draw()
    })
  }

  draw(): void {
    if (!this.started || this.finished) return
    if (this.updateLayout()) {
      this.replay()
      return
    }
    // Leave one spare column to avoid auto-wrap on terminals without DECAWM.
    const width = this.columns - 1
    const rule = this.ascii ? '-' : '─'
    const viewport = inputViewport(this.readline.line, this.readline.cursor, width, this.ascii)
    const status = this.status()
    const lines = [
      this.topBorder(width),
      this.pending ? viewport.text : '',
      this.ansi.gray(rule.repeat(width)),
      this.ansi.gray(fit(terminalText(status.workspace), width, this.ascii)),
      this.ansi.gray(statusLine(status.usage, status.model, width, this.ascii)),
    ]
    let frame = `${ESC}?25l`
    const commands = this.suggestions()
    if (this.menuHeight) {
      const count = this.menuHeight - 1
      const start = Math.max(0, Math.min(this.menuIndex - count + 1, commands.length - count))
      const menu = commands.slice(start, start + count).map((command, index) => {
        const selected = start + index === this.menuIndex
        const label = `${selected ? '>' : ' '} ${command.name.padEnd(13)} ${command.description}`
        const row = fit(label, width, this.ascii)
        return selected ? this.ansi.inverse(row + ' '.repeat(Math.max(0, width - displayWidth(row)))) : this.ansi.gray(row)
      })
      menu.push(this.ansi.gray(fit(`${this.ascii ? 'Up/Down' : '↑↓'} select · Tab complete · Enter run · Esc close  ${this.menuIndex + 1}/${commands.length}`.replaceAll('·', this.ascii ? '|' : '·'), width, this.ascii)))
      for (const [index, line] of menu.entries()) {
        frame += `${ESC}${this.composerTop - this.menuHeight + index};1H${ESC}2K${line}`
      }
    }
    if (this.scrollTop !== null) {
      const hint = jumpToLatestLabel(this.ascii, this.ansi)
      const rendered = displayWidth(hint) <= width ? hint : this.ansi.gray(fit('Ctrl+End: latest', width, this.ascii))
      frame += `${ESC}${this.rows - FOOTER_ROWS};1H${ESC}2K${' '.repeat(Math.max(0, Math.floor((width - displayWidth(rendered)) / 2)))}${rendered}`
    }
    for (const [index, line] of lines.entries()) {
      frame += `${ESC}${this.composerTop + index};1H${ESC}2K${line}`
    }
    if (this.pending) frame += `${ESC}${this.composerTop + 1};${1 + viewport.cursor}H${ESC}?25h`
    this.output.write(frame)
  }

  close(): void {
    if (this.finished) return
    this.finished = true
    if (this.activityTimer) clearInterval(this.activityTimer)
    this.activityTimer = null
    this.input.removeListener('keypress', this.onKey)
    this.input.removeListener('end', this.onEnd)
    this.input.pause()
    this.readline.close()
    this.editorInput.destroy()
    this.sink.destroy()
    if (this.started) this.output.write(`${ESC}r${ESC}${this.composerTop + FOOTER_ROWS - 1};1H${ESC}2K${ESC}0 q${ESC}?25h\r\n`)
  }
}
