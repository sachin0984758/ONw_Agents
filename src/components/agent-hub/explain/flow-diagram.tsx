'use client'

import { useId } from 'react'
import type { DiagramBlock } from '@/lib/agent-hub/explain-protocol'

type Node = NonNullable<DiagramBlock['nodes']>[number]
type PlacedNode = Node & { x: number; y: number; width: number; height: number; labels: string[]; descriptions: string[] }

function wrap(text: string, limit: number): string[] {
  return text.split(/\n/).flatMap((line) => {
    const result: string[] = []
    let current = ''
    for (const word of line.split(/\s+/).filter(Boolean)) {
      // Break long identifiers too, so generated labels cannot escape a node.
      for (let offset = 0; offset < word.length; offset += limit) {
        const part = word.slice(offset, offset + limit)
        if (current && current.length + part.length + 1 > limit) { result.push(current); current = '' }
        current = current ? `${current} ${part}` : part
      }
    }
    if (current) result.push(current)
    return result
  })
}

export function layoutFlowDiagram(block: DiagramBlock) {
  const nodes = block.nodes ?? []
  const edges = block.edges ?? []
  const ranks = new Map<string, number>()
  const pending = new Set(nodes.map((node) => node.id))
  // Process dependencies before dependants. For feedback loops choose a stable
  // starting node, then draw their backward edge without changing its rank.
  while (pending.size) {
    const ready = nodes.filter((node) => pending.has(node.id) && !edges.some((edge) => edge.to === node.id && pending.has(edge.from)))
    const batch = ready.length ? ready : [nodes.find((node) => pending.has(node.id))!]
    for (const node of batch) {
      ranks.set(node.id, Math.max(0, ...edges.filter((edge) => edge.to === node.id && ranks.has(edge.from)).map((edge) => ranks.get(edge.from)! + 1)))
      pending.delete(node.id)
    }
  }
  const rows: Node[][] = []
  for (const node of nodes) (rows[ranks.get(node.id) ?? 0] ??= []).push(node)
  const horizontal = block.direction === 'LR'
  const width = horizontal ? rows.length * 290 + 24 : Math.max(600, ...rows.map((row) => row.length * 236 + 24))
  const placed: PlacedNode[] = []
  let top = 24
  for (const [rank, row] of rows.entries()) {
    const measured = row.map((node) => {
      const nodeWidth = horizontal || row.length > 1 ? 212 : node.description ? 520 : 340
      const labels = wrap(node.label, Math.floor((nodeWidth - 32) / 8))
      const descriptions = wrap(node.description ?? '', Math.floor((nodeWidth - 32) / 6.5))
      return { ...node, width: nodeWidth, height: Math.max(66, 28 + labels.length * 20 + descriptions.length * 17), labels, descriptions }
    })
    const rowHeight = Math.max(...measured.map((node) => node.height))
    const groupWidth = measured.reduce((sum, node) => sum + node.width, 0) + (row.length - 1) * 24
    let left = (width - groupWidth) / 2
    let columnTop = 24
    for (const node of measured) {
      placed.push({ ...node, x: horizontal ? 24 + rank * 290 : left, y: horizontal ? columnTop : top })
      left += node.width + 24
      columnTop += node.height + 40
    }
    top += rowHeight + 64
  }
  const height = Math.max(100, ...placed.map((node) => node.y + node.height + 24))
  return { nodes: placed, width, height }
}

const TONES = {
  neutral: 'fill-secondary/60 stroke-slate-400 dark:stroke-slate-500',
  blue: 'fill-blue-50 stroke-blue-500 dark:fill-blue-950/30',
  violet: 'fill-violet-50 stroke-violet-500 dark:fill-violet-950/25',
  amber: 'fill-amber-50 stroke-amber-500 dark:fill-amber-950/20',
  green: 'fill-emerald-50 stroke-emerald-500 dark:fill-emerald-950/20',
  red: 'fill-red-50 stroke-red-500 dark:fill-red-950/20',
}

export function FlowDiagram({ block }: { block: DiagramBlock }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const { nodes, width, height } = layoutFlowDiagram(block)
  const positions = new Map(nodes.map((node) => [node.id, node]))
  const horizontal = block.direction === 'LR'
  return (
    <figure className="my-5 min-w-0" data-testid="teaching-diagram">
      {block.title ? <div className="mb-3 text-sm font-semibold">{block.title}</div> : null}
      <p className="mb-2 text-[11px] text-muted-foreground sm:hidden">Swipe sideways to explore all diagram nodes.</p>
      <div className="hub-scroll max-w-full overflow-x-auto rounded-xl border border-border/50 bg-background/40 p-2 sm:p-3" tabIndex={0} role="region" aria-label={`${block.title ?? 'Concept diagram'} — scroll to explore`}>
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" style={{ minWidth: Math.min(width, 560) }} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
          <title id={`${id}-title`}>{block.title ?? 'Concept diagram'}</title>
          <desc id={`${id}-desc`}>{(block.edges ?? []).map((edge) => `${positions.get(edge.from)?.label} ${edge.label ?? 'connects to'} ${positions.get(edge.to)?.label}`).join('. ')}</desc>
          <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-muted-foreground/70" /></marker></defs>
          {(block.edges ?? []).map((edge, index) => {
            const from = positions.get(edge.from)
            const to = positions.get(edge.to)
            if (!from || !to) return null
            const ax = horizontal ? from.x + from.width : from.x + from.width / 2
            const ay = horizontal ? from.y + from.height / 2 : from.y + from.height
            const bx = horizontal ? to.x : to.x + to.width / 2
            const by = horizontal ? to.y + to.height / 2 : to.y
            const midX = (ax + bx) / 2
            const midY = (ay + by) / 2
            const forward = horizontal ? bx > ax : by > ay
            const path = forward
              ? horizontal ? `M ${ax} ${ay} H ${midX} V ${by} H ${bx}` : `M ${ax} ${ay} V ${midY} H ${bx} V ${by}`
              : `M ${ax} ${ay} C ${ax + 24} ${ay + 32}, ${bx + 24} ${by - 32}, ${bx} ${by}`
            return <g key={index}>
              <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/60" markerEnd={`url(#${id}-arrow)`} />
              {edge.label ? <text x={midX} y={midY - 6} textAnchor="middle" className="fill-muted-foreground stroke-background" strokeWidth="4" paintOrder="stroke" fontSize="11">{edge.label}</text> : null}
            </g>
          })}
          {nodes.map((node) => <g key={node.id}>
            <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="15" className={TONES[node.tone ?? 'neutral']} strokeWidth="1.6" />
            <text textAnchor="middle" className="fill-foreground" fontSize="15" fontWeight="600">{node.labels.map((line, index) => <tspan key={index} x={node.x + node.width / 2} y={node.y + 27 + index * 20}>{line}</tspan>)}</text>
            <text textAnchor="middle" className="fill-muted-foreground" fontSize="12">{node.descriptions.map((line, index) => <tspan key={index} x={node.x + node.width / 2} y={node.y + 29 + node.labels.length * 20 + index * 17}>{line}</tspan>)}</text>
          </g>)}
        </svg>
      </div>
      {block.caption ? <figcaption className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">{block.caption}</figcaption> : null}
    </figure>
  )
}
