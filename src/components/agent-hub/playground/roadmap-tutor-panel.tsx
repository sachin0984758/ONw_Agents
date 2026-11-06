'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, CheckCircle2, Loader2, Map, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { FeedbackMarkdown } from './feedback-panel'
import { RoadmapDiorama } from './roadmap-diorama'
import type { RoadmapGraph } from '@/lib/agent-hub/roadmap-library'

export interface RoadmapTutorMessage {
  role: 'assistant' | 'user'
  content: string
}

interface RoadmapTutorPanelProps {
  title: string
  currentTopicId: string
  currentTopicLabel: string
  messages: RoadmapTutorMessage[]
  busy: boolean
  visualLoading: boolean
  visualGraph: RoadmapGraph | null
  completedTopicIds: string[]
  onReply: (message: string) => void
  onRestart: () => void
  onCompleteTopic: () => void
  onContinue: () => void
  onBackFromVisual: () => void
  className?: string
}

export function RoadmapTutorPanel({
  title, currentTopicId, currentTopicLabel, messages, busy, visualLoading, visualGraph,
  completedTopicIds, onReply, onRestart, onCompleteTopic, onContinue, onBackFromVisual, className,
}: RoadmapTutorPanelProps) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  function submit() {
    const message = draft.trim()
    if (!message || busy) return
    setDraft('')
    onReply(message)
  }

  return (
    <aside className={cn('flex min-h-0 min-w-0 flex-col gap-2', className)} data-testid="playground-roadmap-tutor">
      <header className="flex min-w-0 items-center gap-2">
        <Map className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Roadmap tutor</h2>
          <p className="truncate text-[11px] text-muted-foreground">{title} · {currentTopicLabel || 'loading first topic'} · Understand Anything</p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={onRestart} disabled={busy}>
          <RotateCcw className="size-3.5" />
          Start over
        </Button>
      </header>

      {visualGraph ? (
        <RoadmapDiorama
          key={currentTopicId}
          roadmap={visualGraph}
          focusTopicId={currentTopicId}
          completedTopicIds={completedTopicIds}
          currentLesson={[...messages].reverse().find((message) => message.role === 'assistant')?.content ?? ''}
          onContinue={onContinue}
          onBack={onBackFromVisual}
          className="min-h-0 flex-1"
        />
      ) : (
        <>
          <div ref={scrollRef} className="hub-scroll min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border border-border/60 bg-secondary/20 p-3" aria-live="polite">
            {messages.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
                The tutor will teach one roadmap topic at a time, explain its relationships, then wait for your completion before opening the visual map.
              </p>
            ) : messages.map((message, index) => (
              <div key={`${index}-${message.role}`} className={cn('rounded-lg px-3 py-2.5', message.role === 'user' ? 'ml-auto max-w-[88%] bg-primary/10' : 'mr-auto w-full border border-border/50 bg-card')}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{message.role === 'user' ? 'You' : 'Tutor'}</p>
                {message.role === 'assistant' ? <FeedbackMarkdown text={message.content} /> : <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{message.content}</p>}
              </div>
            ))}
            {busy ? (
              <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground" data-testid="roadmap-tutor-busy">
                <Loader2 className="size-3.5 animate-spin text-primary" />
                Preparing the next step…
              </div>
            ) : null}
          </div>

          {messages.some((message) => message.role === 'assistant') ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card/70 px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground">When you understand this topic, mark it complete to open its Dioramas map.</p>
              <Button size="sm" className="h-7 px-2 text-[10px]" onClick={onCompleteTopic} disabled={busy || visualLoading || !currentTopicId} data-testid="roadmap-complete-topic">
                {visualLoading ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                Complete & visualize
              </Button>
            </div>
          ) : null}
        </>
      )}

      {!visualGraph ? <form className="flex items-end gap-2 rounded-md border bg-background p-2" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={messages.length ? 'Choose a branch or ask a question…' : 'Starting the roadmap…'}
          aria-label="Choose a roadmap branch or ask a question"
          disabled={busy || messages.length === 0}
          rows={2}
          className="max-h-28 min-h-10 min-w-0 flex-1 resize-y bg-transparent px-1 py-1 text-xs outline-none placeholder:text-muted-foreground disabled:opacity-60"
          data-testid="roadmap-tutor-input"
        />
        <Button type="submit" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label="Continue roadmap" disabled={busy || !draft.trim()}>
          <ArrowUp className="size-4" />
        </Button>
      </form>
        : null}
      {!visualGraph ? <p className="text-[10px] text-muted-foreground">Enter to continue · Shift+Enter for a new line</p> : null}
    </aside>
  )
}
