// ─── Intelligent Explanation Engine — Response Protocol ──────────────────
// A typed, validated content-block protocol shared by the chat API (server)
// and the renderer (client). Pure data + logic only — no fs, no SDK, no
// React — so it is safe to import from both sides.
//
// The model GENERATES the explanation content as JSON blocks. The app
// VALIDATES and RENDERS them with registered components. Model output is
// never executed as code, HTML, or UI.

// ── Block types ──────────────────────────────────────────────────────────

export interface TextBlock {
  type: 'text'
  /** Markdown source (no raw HTML — the renderer escapes it). */
  markdown: string
}

export interface TableBlock {
  type: 'table'
  caption?: string
  columns: string[]
  rows: string[][]
}

export interface CodeBlock {
  type: 'code'
  language: string
  code: string
  caption?: string
}

export type DiagramFormat = 'ascii' | 'flow'

export interface DiagramBlock {
  type: 'diagram'
  format: DiagramFormat
  title?: string
  direction?: 'TB' | 'LR'
  /** ASCII-art diagram source (format: 'ascii'). */
  ascii?: string
  /** Node/edge graph drawn by the app as SVG (format: 'flow'). */
  nodes?: Array<{ id: string; label: string; description?: string; tone?: 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'red' }>
  edges?: Array<{ from: string; to: string; label?: string }>
  caption?: string
}

export type ChartKind = 'line' | 'bar' | 'scatter'

export interface ChartBlock {
  type: 'chart'
  chart: ChartKind
  title?: string
  xLabel?: string
  yLabel?: string
  series: Array<{ name: string; points: Array<[number, number]> }>
}

export interface EquationBlock {
  type: 'equation'
  /** Human-readable math, e.g. "V = I × R". */
  expression?: string
  /** Optional step-by-step worked calculation. */
  steps?: string[]
  description?: string
}

export interface StepsBlock {
  type: 'steps'
  title?: string
  items: string[]
}

export interface ChecklistBlock {
  type: 'checklist'
  title?: string
  items: Array<{ text: string; hint?: string }>
}

export type InteractiveKind = 'ohm-law' | 'quadratic'

export interface InteractiveBlock {
  type: 'interactive'
  /** Whitelisted app-implemented interactive. Unknown kinds render as text. */
  kind: InteractiveKind
  title?: string
  note?: string
}

export type CalloutVariant = 'info' | 'tip' | 'warning' | 'success'

export interface CalloutBlock {
  type: 'callout'
  variant: CalloutVariant
  title?: string
  markdown: string
}

export interface MetricsBlock {
  type: 'metrics'
  items: Array<{ label: string; value: string; note?: string }>
}

export type ExplainBlock =
  | TextBlock
  | TableBlock
  | CodeBlock
  | DiagramBlock
  | ChartBlock
  | EquationBlock
  | StepsBlock
  | ChecklistBlock
  | InteractiveBlock
  | CalloutBlock
  | MetricsBlock

export interface ExplainResponse {
  blocks: ExplainBlock[]
}


// ── Validation ───────────────────────────────────────────────────────────
// Each validator returns a clean block or null. Anything the model produced
// that doesn't match the shape is dropped — never guessed, never executed.

function str(v: unknown, max = 20000): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 && t.length <= max ? t : null
}

function strArray(v: unknown, maxItems = 100): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const item of v) {
    const s = str(item)
    if (s) out.push(s)
  }
  return out.length > 0 && out.length <= maxItems ? out : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function validateText(b: Record<string, unknown>): ExplainBlock | null {
  const markdown = str(b.markdown)
  return markdown ? { type: 'text', markdown } : null
}

function validateTable(b: Record<string, unknown>): ExplainBlock | null {
  const columns = strArray(b.columns, 24)
  if (!columns || !Array.isArray(b.rows)) return null
  const rows: string[][] = []
  for (const r of b.rows.slice(0, 200)) {
    if (!Array.isArray(r)) continue
    const cells = r.slice(0, columns.length).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : ''))
    while (cells.length < columns.length) cells.push('')
    rows.push(cells)
  }
  if (rows.length === 0) return null
  const caption = str(b.caption, 300)
  return { type: 'table', ...(caption ? { caption } : {}), columns, rows }
}

function validateCode(b: Record<string, unknown>): ExplainBlock | null {
  const code = typeof b.code === 'string' && b.code.trim() ? b.code : null
  if (!code || code.length > 20000) return null
  const language = str(b.language, 30) ?? 'text'
  const caption = str(b.caption, 300)
  return { type: 'code', language, code, ...(caption ? { caption } : {}) }
}

function validateDiagram(b: Record<string, unknown>): ExplainBlock | null {
  const format: DiagramFormat = b.format === 'flow' ? 'flow' : 'ascii'
  const caption = str(b.caption, 300)
  if (format === 'ascii') {
    const ascii = str(b.ascii, 8000)
    if (!ascii) return null
    return { type: 'diagram', format, ascii, ...(caption ? { caption } : {}) }
  }
  if (!Array.isArray(b.nodes) || b.nodes.length === 0 || b.nodes.length > 60) return null
  const nodes: NonNullable<DiagramBlock['nodes']> = []
  const seenIds = new Set<string>()
  for (const n of b.nodes) {
    if (!n || typeof n !== 'object') continue
    const id = str((n as Record<string, unknown>).id, 60)
    const label = str((n as Record<string, unknown>).label, 120)
    const description = str((n as Record<string, unknown>).description, 300)
    const tone = (n as Record<string, unknown>).tone
    if (id && label && !seenIds.has(id)) {
      seenIds.add(id)
      nodes.push({ id, label, ...(description ? { description } : {}), ...(['neutral', 'blue', 'violet', 'amber', 'green', 'red'].includes(String(tone)) ? { tone: tone as NonNullable<DiagramBlock['nodes']>[number]['tone'] } : {}) })
    }
  }
  if (nodes.length === 0) return null
  const ids = new Set(nodes.map((n) => n.id))
  const edges: Array<{ from: string; to: string; label?: string }> = []
  if (Array.isArray(b.edges)) {
    for (const e of b.edges.slice(0, 120)) {
      if (!e || typeof e !== 'object') continue
      const from = str((e as Record<string, unknown>).from, 60)
      const to = str((e as Record<string, unknown>).to, 60)
      const label = str((e as Record<string, unknown>).label, 60)
      if (from && to && ids.has(from) && ids.has(to)) edges.push({ from, to, ...(label ? { label } : {}) })
    }
  }
  const title = str(b.title, 160)
  const direction = b.direction === 'LR' ? 'LR' : 'TB'
  return { type: 'diagram', format, nodes, edges, direction, ...(title ? { title } : {}), ...(caption ? { caption } : {}) }
}


function validateChart(b: Record<string, unknown>): ExplainBlock | null {
  const chart: ChartKind = b.chart === 'bar' ? 'bar' : b.chart === 'scatter' ? 'scatter' : 'line'
  if (!Array.isArray(b.series) || b.series.length === 0 || b.series.length > 8) return null
  const series: Array<{ name: string; points: Array<[number, number]> }> = []
  for (const s of b.series) {
    if (!s || typeof s !== 'object' || !Array.isArray((s as Record<string, unknown>).points)) continue
    const name = str((s as Record<string, unknown>).name, 80) ?? 'series'
    const points: Array<[number, number]> = []
    for (const p of ((s as Record<string, unknown>).points as unknown[]).slice(0, 500)) {
      if (!Array.isArray(p) || p.length < 2) continue
      const x = num(p[0])
      const y = num(p[1])
      if (x != null && y != null) points.push([x, y])
    }
    if (points.length > 0) series.push({ name, points })
  }
  if (series.length === 0) return null
  const title = str(b.title, 200)
  const xLabel = str(b.xLabel, 80)
  const yLabel = str(b.yLabel, 80)
  return { type: 'chart', chart, series, ...(title ? { title } : {}), ...(xLabel ? { xLabel } : {}), ...(yLabel ? { yLabel } : {}) }
}

function validateEquation(b: Record<string, unknown>): ExplainBlock | null {
  const expression = str(b.expression, 500)
  const steps = strArray(b.steps, 30)
  const description = str(b.description, 2000)
  if (!expression && !steps && !description) return null
  return {
    type: 'equation',
    ...(expression ? { expression } : {}),
    ...(steps ? { steps } : {}),
    ...(description ? { description } : {}),
  }
}

function validateSteps(b: Record<string, unknown>): ExplainBlock | null {
  const items = strArray(b.items, 40)
  if (!items) return null
  const title = str(b.title, 200)
  return { type: 'steps', items, ...(title ? { title } : {}) }
}

function validateChecklist(b: Record<string, unknown>): ExplainBlock | null {
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 30) return null
  const items: Array<{ text: string; hint?: string }> = []
  for (const it of b.items) {
    if (!it || typeof it !== 'object') continue
    const text = str((it as Record<string, unknown>).text, 500)
    if (!text) continue
    const hint = str((it as Record<string, unknown>).hint, 500)
    items.push({ text, ...(hint ? { hint } : {}) })
  }
  if (items.length === 0) return null
  const title = str(b.title, 200)
  return { type: 'checklist', items, ...(title ? { title } : {}) }
}

function validateInteractive(b: Record<string, unknown>): ExplainBlock | null {
  const kind: InteractiveKind = b.kind === 'quadratic' ? 'quadratic' : 'ohm-law'
  const title = str(b.title, 200)
  const note = str(b.note, 500)
  return { type: 'interactive', kind, ...(title ? { title } : {}), ...(note ? { note } : {}) }
}

function validateCallout(b: Record<string, unknown>): ExplainBlock | null {
  const markdown = str(b.markdown, 4000)
  if (!markdown) return null
  const variant: CalloutVariant =
    b.variant === 'tip' ? 'tip' : b.variant === 'warning' ? 'warning' : b.variant === 'success' ? 'success' : 'info'
  const title = str(b.title, 200)
  return { type: 'callout', variant, markdown, ...(title ? { title } : {}) }
}

function validateMetrics(b: Record<string, unknown>): ExplainBlock | null {
  if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 12) return null
  const items: Array<{ label: string; value: string; note?: string }> = []
  for (const it of b.items) {
    if (!it || typeof it !== 'object') continue
    const label = str((it as Record<string, unknown>).label, 120)
    const value = str((it as Record<string, unknown>).value, 120)
    if (!label || !value) continue
    const note = str((it as Record<string, unknown>).note, 200)
    items.push({ label, value, ...(note ? { note } : {}) })
  }
  if (items.length === 0) return null
  return { type: 'metrics', items }
}

const VALIDATORS: Record<string, (b: Record<string, unknown>) => ExplainBlock | null> = {
  text: validateText,
  table: validateTable,
  code: validateCode,
  diagram: validateDiagram,
  chart: validateChart,
  equation: validateEquation,
  steps: validateSteps,
  checklist: validateChecklist,
  interactive: validateInteractive,
  callout: validateCallout,
  metrics: validateMetrics,
}

export function validateBlocks(raw: unknown): ExplainBlock[] {
  if (!Array.isArray(raw)) return []
  const out: ExplainBlock[] = []
  for (const item of raw.slice(0, 60)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const b = item as Record<string, unknown>
    const fn = typeof b.type === 'string' ? VALIDATORS[b.type] : undefined
    if (!fn) continue
    const block = fn(b)
    if (block) out.push(block)
  }
  return out
}

// ── Parsing model output ─────────────────────────────────────────────────
// Order: strict JSON → embedded JSON (fenced or bare) → Markdown fallback.
// Never throws; always returns a usable ExplainResponse.

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Extract the first balanced {...} or [...] span from text. */
function extractFirstJsonSpan(text: string): string | null {
  const start = text.search(/[[{]/)
  if (start < 0) return null
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function blocksFromParsed(parsed: unknown): ExplainBlock[] {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.blocks)) return validateBlocks(obj.blocks)
    // A single block object
    const single = validateBlocks([obj])
    if (single.length) return single
  }
  if (Array.isArray(parsed)) return validateBlocks(parsed)
  return []
}

/**
 * Markdown fallback: split a reply into text and code blocks so fenced code
 * still renders with syntax highlighting even when structured output failed.
 */
export function markdownToBlocks(markdown: string): ExplainBlock[] {
  const blocks: ExplainBlock[] = []
  const re = /```(\w+)?\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(markdown)) !== null) {
    const before = markdown.slice(last, m.index).trim()
    if (before) blocks.push({ type: 'text', markdown: before })
    blocks.push({ type: 'code', language: (m[1] || 'text').slice(0, 30), code: m[2].replace(/\n$/, '') })
    last = re.lastIndex
  }
  const tail = markdown.slice(last).trim()
  if (tail) blocks.push({ type: 'text', markdown: tail })
  return blocks.length ? blocks : markdown.trim() ? [{ type: 'text', markdown: markdown.trim() }] : []
}

/**
 * Parse a raw model reply into validated blocks. `fallbackMarkdown` should be
 * true when the caller asked for structured output and wants a readable
 * Markdown fallback if the model did not comply.
 */
export function parseExplainResponse(raw: string, fallbackMarkdown = true): ExplainResponse {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { blocks: [] }

  // 1. strict JSON
  const direct = tryParseJson(trimmed)
  if (direct) {
    const blocks = blocksFromParsed(direct)
    if (blocks.length) return { blocks }
  }

  // 2. embedded JSON (fenced ```json or bare object/array)
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    const inner = tryParseJson(fenced[1].trim())
    if (inner) {
      const blocks = blocksFromParsed(inner)
      if (blocks.length) return { blocks }
    }
  }
  const span = extractFirstJsonSpan(trimmed)
  if (span) {
    const inner = tryParseJson(span)
    if (inner) {
      const blocks = blocksFromParsed(inner)
      if (blocks.length) return { blocks }
    }
  }

  // 3. Markdown fallback
  return { blocks: fallbackMarkdown ? markdownToBlocks(trimmed) : [{ type: 'text', markdown: trimmed }] }
}

/** Plain-text rendering of a response — used for chat history persistence. */
export function blocksToPlainText(blocks: ExplainBlock[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'text':
      case 'callout':
        parts.push(b.markdown)
        break
      case 'code':
        parts.push('```' + b.language + '\n' + b.code + '\n```')
        break
      case 'table': {
        parts.push('| ' + b.columns.join(' | ') + ' |')
        for (const r of b.rows) parts.push('| ' + r.join(' | ') + ' |')
        break
      }
      case 'diagram':
        parts.push(b.format === 'ascii' && b.ascii ? b.ascii : (b.nodes ?? []).map((n) => n.label).join(' → '))
        break
      case 'equation':
        if (b.expression) parts.push(b.expression)
        if (b.steps) parts.push(b.steps.join('\n'))
        if (b.description) parts.push(b.description)
        break
      case 'steps':
        if (b.title) parts.push(b.title)
        parts.push(b.items.map((s, i) => `${i + 1}. ${s}`).join('\n'))
        break
      case 'checklist':
        if (b.title) parts.push(b.title)
        parts.push(b.items.map((s) => `- [ ] ${s.text}`).join('\n'))
        break
      case 'chart':
        parts.push(b.title ?? 'chart')
        break
      case 'metrics':
        parts.push(b.items.map((m) => `${m.label}: ${m.value}`).join('\n'))
        break
      case 'interactive':
        parts.push(`[interactive: ${b.kind}]`)
        break
    }
  }
  return parts.join('\n\n')
}

