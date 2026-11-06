'use client'

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Check, Copy, Info, Lightbulb, TriangleAlert, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FlowDiagram } from './flow-diagram'
import { highlightCode } from '@/lib/agent-hub/agent-session'
import type {
  ExplainBlock,
  TextBlock,
  TableBlock,
  CodeBlock,
  DiagramBlock,
  ChartBlock,
  EquationBlock,
  StepsBlock,
  ChecklistBlock,
  InteractiveBlock,
  CalloutBlock,
  CalloutVariant,
  MetricsBlock,
} from '@/lib/agent-hub/explain-protocol'

// ─── Explanation Renderer ────────────────────────────────────────────────
// Renders validated blocks with app-defined components. Content is data —
// model output is never executed as code or HTML. Markdown is rendered with
// react-markdown (raw HTML is escaped by default).

const CODE_CLASS: Record<string, string> = {
  kw: 'text-violet-600 dark:text-violet-300',
  str: 'text-emerald-700 dark:text-emerald-300',
  com: 'text-zinc-500 italic',
  num: 'text-amber-700 dark:text-amber-300',
  fn: 'text-sky-700 dark:text-sky-300',
}

const PROSE_CLASS =
  'explain-prose text-[13.5px] leading-relaxed [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1.5 [&_ul]:list-disc'

function TextBlockView({ block }: { block: TextBlock }) {
  return (
    <div className={PROSE_CLASS}>
      <ReactMarkdown>{block.markdown}</ReactMarkdown>
    </div>
  )
}

function TableBlockView({ block }: { block: TableBlock }) {
  return (
    <div className="my-2 overflow-x-auto rounded-lg border">
      {block.caption ? <div className="border-b bg-secondary/40 px-3 py-1.5 text-[11px] text-muted-foreground">{block.caption}</div> : null}
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b bg-secondary/30">
            {block.columns.map((c, i) => (
              <th key={i} className="px-3 py-2 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((cell, j) => (
                <td key={j} className="px-3 py-1.5 align-top">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CodeBlockView({ block }: { block: CodeBlock }) {
  const [copied, setCopied] = useState(false)
  const tokens = highlightCode(block.code, block.language)
  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-secondary/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <span className="font-mono text-[10px] text-muted-foreground">{block.language || 'code'}</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(block.code).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="hub-scroll overflow-x-auto p-3 font-mono text-[12px] leading-relaxed">
        <code>
          {tokens.map((t, i) => (
            <span key={i} className={t.cls ? CODE_CLASS[t.cls] : undefined}>{t.text}</span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function DiagramBlockView({ block }: { block: DiagramBlock }) {
  return (
    <div className="my-2">
      {block.format === 'ascii' && block.ascii ? (
        <pre className="hub-scroll overflow-x-auto rounded-lg border bg-secondary/40 p-3 font-mono text-[12px] leading-relaxed">{block.ascii}</pre>
      ) : block.nodes ? (
        <FlowDiagram block={block} />
      ) : null}
      {block.format === 'ascii' && block.caption ? <div className="mt-1 text-[11px] text-muted-foreground">{block.caption}</div> : null}
    </div>
  )
}

const SERIES_COLORS = ['#8b7cf6', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#a3a3a3', '#fb7185', '#4ade80']

type RechartsModule = typeof import('recharts')
let rechartsCache: RechartsModule | null = null
function useRecharts() {
  const [mod, setMod] = useState<RechartsModule | null>(rechartsCache)
  useEffect(() => {
    if (rechartsCache) return
    let cancelled = false
    import('recharts')
      .then((m) => {
        rechartsCache = m
        if (!cancelled) setMod(m)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return mod
}

function ChartBlockView({ block }: { block: ChartBlock }) {
  const R = useRecharts()
  if (!R) {
    return <div className="my-2 rounded-lg border bg-card p-6 text-center text-[11px] text-muted-foreground">Loading chart…</div>
  }
  const { ResponsiveContainer, LineChart, Line, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend } = R
  const axis = (extra: Record<string, unknown>) => ({ tick: { fontSize: 10 }, ...extra })
  const chart =
    block.chart === 'bar' ? (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={block.series[0]?.points.map(([x, y]) => ({ x, y })) ?? []}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis {...axis({ dataKey: 'x', type: 'number' })} />
          <YAxis {...axis({})} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {block.series.map((s, i) => (
            <Bar key={i} dataKey="y" name={s.name} data={s.points.map(([x, y]) => ({ x, y }))} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    ) : block.chart === 'scatter' ? (
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis {...axis({ type: 'number', dataKey: 'x' })} />
          <YAxis {...axis({ type: 'number', dataKey: 'y' })} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {block.series.map((s, i) => (
            <Scatter key={i} name={s.name} data={s.points.map(([x, y]) => ({ x, y }))} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    ) : (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={block.series[0]?.points.map(([x, y]) => ({ x, y })) ?? []}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis {...axis({ dataKey: 'x', type: 'number' })} />
          <YAxis {...axis({})} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {block.series.map((s, i) => (
            <Line key={i} type="monotone" dataKey="y" name={s.name} data={s.points.map(([x, y]) => ({ x, y }))} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  return (
    <div className="my-2 rounded-lg border bg-card p-2">
      {block.title ? <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{block.title}</div> : null}
      {chart}
    </div>
  )
}

function EquationBlockView({ block }: { block: EquationBlock }) {
  return (
    <div className="my-2 rounded-lg border bg-card p-3">
      {block.expression ? (
        <div className="rounded-md bg-secondary/40 px-3 py-2 text-center font-mono text-sm">{block.expression}</div>
      ) : null}
      {block.steps?.length ? (
        <ol className="mt-2 space-y-1">
          {block.steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-xs">
              <span className="shrink-0 font-mono text-muted-foreground">{i + 1}.</span>
              <span className="font-mono">{s}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {block.description ? <p className="mt-2 text-xs text-muted-foreground">{block.description}</p> : null}
    </div>
  )
}

function StepsBlockView({ block }: { block: StepsBlock }) {
  return (
    <div className="my-2">
      {block.title ? <div className="mb-1.5 text-xs font-semibold">{block.title}</div> : null}
      <ol className="space-y-1.5">
        {block.items.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-[13px]">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ChecklistBlockView({ block }: { block: ChecklistBlock }) {
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [showHints, setShowHints] = useState(false)
  return (
    <div className="my-2 rounded-lg border bg-card p-3">
      {block.title ? <div className="mb-2 text-xs font-semibold">{block.title}</div> : null}
      <div className="space-y-2">
        {block.items.map((it, i) => {
          const done = checked.has(i)
          return (
            <div key={i} className="space-y-1">
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
                <button
                  onClick={() => setChecked((c) => { const n = new Set(c); if (n.has(i)) n.delete(i); else n.add(i); return n })}
                  className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border', done ? 'border-emerald-500 bg-emerald-500/20 text-emerald-600' : 'border-muted-foreground/40 text-transparent hover:border-muted-foreground')}
                >
                  <Check className="size-3" />
                </button>
                <span className={cn(done && 'text-muted-foreground line-through')}>{it.text}</span>
              </label>
              {showHints && it.hint ? <div className="ml-6 rounded bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground">{it.hint}</div> : null}
            </div>
          )
        })}
      </div>
      {block.items.some((it) => it.hint) ? (
        <button onClick={() => setShowHints((v) => !v)} className="mt-2 text-[11px] text-primary underline-offset-2 hover:underline">
          {showHints ? 'Hide hints' : 'Show hints'}
        </button>
      ) : null}
    </div>
  )
}

const CALLOUT_STYLES: Record<CalloutVariant, { box: string; icon: React.ReactNode }> = {
  info: { box: 'border-sky-500/30 bg-sky-500/5', icon: <Info className="size-3.5 text-sky-600 dark:text-sky-400" /> },
  tip: { box: 'border-violet-500/30 bg-violet-500/5', icon: <Lightbulb className="size-3.5 text-violet-600 dark:text-violet-400" /> },
  warning: { box: 'border-amber-500/30 bg-amber-500/5', icon: <TriangleAlert className="size-3.5 text-amber-600 dark:text-amber-400" /> },
  success: { box: 'border-emerald-500/30 bg-emerald-500/5', icon: <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" /> },
}

function CalloutBlockView({ block }: { block: CalloutBlock }) {
  const s = CALLOUT_STYLES[block.variant]
  return (
    <div className={cn('my-2 rounded-lg border p-3', s.box)}>
      {block.title ? <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">{s.icon}{block.title}</div> : null}
      <TextBlockView block={{ type: 'text', markdown: block.markdown }} />
    </div>
  )
}

function MetricsBlockView({ block }: { block: MetricsBlock }) {
  return (
    <div className="my-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {block.items.map((m, i) => (
        <div key={i} className="rounded-lg border bg-card p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums">{m.value}</div>
          {m.note ? <div className="mt-0.5 text-[10px] text-muted-foreground">{m.note}</div> : null}
        </div>
      ))}
    </div>
  )
}

function Slider({ label, value, onChange, min, max, step, unit }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; unit?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 flex-1 accent-primary" />
      <span className="w-16 shrink-0 text-right font-mono tabular-nums">{value}{unit ?? ''}</span>
    </label>
  )
}

function OhmsLaw({ note }: { note?: string }) {
  const [v, setV] = useState(12)
  const [r, setR] = useState(100)
  const i = r > 0 ? v / r : 0
  const p = v * i
  return (
    <div className="my-2 rounded-lg border bg-card p-3">
      <div className="mb-2 text-xs font-semibold">Ohm&apos;s law · V = I × R</div>
      <div className="space-y-2">
        <Slider label="Voltage V" value={v} onChange={setV} min={0} max={50} step={0.5} unit=" V" />
        <Slider label="Resistance R" value={r} onChange={setR} min={1} max={1000} step={1} unit=" Ω" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Current I = V/R</div>
          <div className="font-mono text-sm font-semibold tabular-nums">{(i * 1000).toFixed(1)} mA</div>
        </div>
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Power P = V·I</div>
          <div className="font-mono text-sm font-semibold tabular-nums">{p.toFixed(2)} W</div>
        </div>
      </div>
      {note ? <p className="mt-2 text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  )
}

function Quadratic({ note }: { note?: string }) {
  const [a, setA] = useState(1)
  const [b, setB] = useState(-3)
  const [c, setC] = useState(2)
  const disc = b * b - 4 * a * c
  let roots: string
  if (a === 0) roots = 'not quadratic (a = 0)'
  else if (disc > 0) {
    const r1 = (-b + Math.sqrt(disc)) / (2 * a)
    const r2 = (-b - Math.sqrt(disc)) / (2 * a)
    roots = `x₁ = ${r1.toFixed(3)},  x₂ = ${r2.toFixed(3)}`
  } else if (disc === 0) roots = `x = ${(-b / (2 * a)).toFixed(3)} (double root)`
  else {
    const re = (-b / (2 * a)).toFixed(3)
    const im = (Math.sqrt(-disc) / (2 * a)).toFixed(3)
    roots = `x = ${re} ± ${im}i`
  }
  return (
    <div className="my-2 rounded-lg border bg-card p-3">
      <div className="mb-2 text-xs font-semibold">Quadratic · ax² + bx + c = 0</div>
      <div className="grid grid-cols-3 gap-2">
        <Slider label="a" value={a} onChange={setA} min={-5} max={5} step={0.5} />
        <Slider label="b" value={b} onChange={setB} min={-10} max={10} step={0.5} />
        <Slider label="c" value={c} onChange={setC} min={-10} max={10} step={0.5} />
      </div>
      <div className="mt-3 space-y-1 text-xs">
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Discriminant Δ = b² − 4ac</div>
          <div className="font-mono text-sm font-semibold tabular-nums">{disc.toFixed(2)}</div>
        </div>
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="text-[10px] text-muted-foreground">Roots</div>
          <div className="font-mono text-sm font-semibold">{roots}</div>
        </div>
      </div>
      {note ? <p className="mt-2 text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  )
}

function InteractiveBlockView({ block }: { block: InteractiveBlock }) {
  if (block.kind === 'quadratic') return <Quadratic note={block.note} />
  return <OhmsLaw note={block.note} />
}

export function BlockView({ block }: { block: ExplainBlock }) {
  switch (block.type) {
    case 'text': return <TextBlockView block={block} />
    case 'table': return <TableBlockView block={block} />
    case 'code': return <CodeBlockView block={block} />
    case 'diagram': return <DiagramBlockView block={block} />
    case 'chart': return <ChartBlockView block={block} />
    case 'equation': return <EquationBlockView block={block} />
    case 'steps': return <StepsBlockView block={block} />
    case 'checklist': return <ChecklistBlockView block={block} />
    case 'interactive': return <InteractiveBlockView block={block} />
    case 'callout': return <CalloutBlockView block={block} />
    case 'metrics': return <MetricsBlockView block={block} />
    default: return null
  }
}

export function ExplainBlocks({ blocks }: { blocks: ExplainBlock[] }) {
  return (
    <div className="space-y-1">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  )
}
