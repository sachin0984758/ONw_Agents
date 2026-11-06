'use client'

import { validateBlocks, type DiagramBlock } from '@/lib/agent-hub/explain-protocol'
import { FlowDiagram } from './explain/flow-diagram'

export function parseChatDiagram(source: string): DiagramBlock | null {
  if (source.length > 24000) return null
  try {
    const parsed: unknown = JSON.parse(source)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return validateBlocks([{ ...parsed, type: 'diagram', format: 'flow' }]).find((block): block is DiagramBlock => block.type === 'diagram') ?? null
  } catch { return null }
}

export function ChatDiagram({ source }: { source: string }) {
  const block = parseChatDiagram(source)
  if (block) return <FlowDiagram block={block} />
  return <details className="my-3 rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
    <summary className="cursor-pointer">Diagram source — waiting for a complete diagram</summary>
    <pre className="hub-scroll mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{source.slice(0, 24000)}</pre>
  </details>
}
