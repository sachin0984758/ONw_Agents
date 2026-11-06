// Terminal styling with no dependency. Colour is opt-in (TTY + not NO_COLOR),
// and an ASCII glyph set is available for terminals without Unicode support.

export interface Ansi {
  enabled: boolean
  bold(s: string): string
  dim(s: string): string
  italic(s: string): string
  red(s: string): string
  green(s: string): string
  yellow(s: string): string
  blue(s: string): string
  magenta(s: string): string
  cyan(s: string): string
  gray(s: string): string
  inverse(s: string): string
  reset(s: string): string
}

const ESC = '\u001b['

function wrap(code: string, s: string): string {
  return `${ESC}${code}m${s}${ESC}0m`
}

export function createAnsi(enabled: boolean): Ansi {
  if (!enabled) {
    const id = (s: string) => s
    return {
      enabled: false,
      bold: id,
      dim: id,
      italic: id,
      red: id,
      green: id,
      yellow: id,
      blue: id,
      magenta: id,
      cyan: id,
      gray: id,
      inverse: id,
      reset: id,
    }
  }
  return {
    enabled: true,
    bold: (s) => wrap('1', s),
    dim: (s) => wrap('2', s),
    italic: (s) => wrap('3', s),
    red: (s) => wrap('31', s),
    green: (s) => wrap('32', s),
    yellow: (s) => wrap('33', s),
    blue: (s) => wrap('34', s),
    magenta: (s) => wrap('35', s),
    cyan: (s) => wrap('36', s),
    gray: (s) => wrap('90', s),
    inverse: (s) => wrap('7', s),
    reset: (s) => s,
  }
}

let colorOverride: boolean | undefined

/**
 * Set by the CLI after configuration is merged. `undefined` keeps the
 * automatic TTY/NO_COLOR behaviour; `true` and `false` force colour on or off.
 */
export function setColorOverride(value: boolean | undefined): void {
  colorOverride = value
}

export function defaultAnsi(): Ansi {
  if (colorOverride !== undefined) return createAnsi(colorOverride)
  const noColor = Object.prototype.hasOwnProperty.call(process.env, 'NO_COLOR')
  const force = process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === 'true'
  const enabled = force || (!noColor && Boolean(process.stdout.isTTY))
  return createAnsi(enabled)
}

export interface Glyphs {
  ok: string
  fail: string
  warn: string
  bullet: string
  prompt: string
  arrow: string
  ellipsis: string
  rule: string
}

export function createGlyphs(ascii: boolean): Glyphs {
  if (ascii) {
    return { ok: '+', fail: 'x', warn: '!', bullet: '*', prompt: '>', arrow: '->', ellipsis: '...', rule: '-' }
  }
  return { ok: '✓', fail: '✗', warn: '!', bullet: '●', prompt: '›', arrow: '→', ellipsis: '…', rule: '─' }
}

const ANSI_RE = /\u001b\[[0-9;]*m/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

// Approximate wcwidth: enough to keep CJK/emoji from corrupting alignment.
function codePointWidth(cp: number): number {
  if (cp === 0) return 0
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f)
  ) {
    return 0
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

export function displayWidth(s: string): number {
  const plain = stripAnsi(s)
  let width = 0
  for (const ch of plain) {
    width += codePointWidth(ch.codePointAt(0) ?? 0)
  }
  return width
}

export function truncate(s: string, maxWidth: number, ellipsis = '…'): string {
  if (maxWidth <= 0) return ''
  if (displayWidth(s) <= maxWidth) return s
  const budget = Math.max(0, maxWidth - displayWidth(ellipsis))
  let out = ''
  let width = 0
  for (const ch of s) {
    const w = codePointWidth(ch.codePointAt(0) ?? 0)
    if (width + w > budget) break
    out += ch
    width += w
  }
  return out + ellipsis
}

export function wrapText(s: string, width: number): string[] {
  if (width <= 0) return [s]
  const lines: string[] = []
  for (const paragraph of s.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push('')
      continue
    }
    let current = ''
    let currentWidth = 0
    for (const word of paragraph.split(/(\s+)/)) {
      if (!word) continue
      const w = displayWidth(word)
      if (currentWidth > 0 && currentWidth + w > width) {
        lines.push(current.trimEnd())
        current = word.trimStart()
        currentWidth = displayWidth(current)
      } else {
        current += word
        currentWidth += w
      }
      while (displayWidth(current) > width) {
        // A single token longer than the line: hard-split it.
        let piece = ''
        let pw = 0
        for (const ch of current) {
          const cw = codePointWidth(ch.codePointAt(0) ?? 0)
          if (pw + cw > width) break
          piece += ch
          pw += cw
        }
        if (!piece) break
        lines.push(piece)
        current = current.slice(piece.length)
      }
    }
    if (current.trimEnd()) lines.push(current.trimEnd())
  }
  return lines
}

export function padEnd(s: string, width: number): string {
  const pad = width - displayWidth(s)
  return pad > 0 ? s + ' '.repeat(pad) : s
}
