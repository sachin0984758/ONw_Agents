'use client'

// ── Playground feedback panel ────────────────────────────────────────────────
// Renders ONE current analysis result — the response to the action the learner
// most recently completed. Earlier results stay available through a compact
// history menu (newest first) but never clutter the current reading view.
//
// The result is rendered exactly as received from the local model (Markdown,
// with code highlighted through the existing CodeBlock). Error entries show the
// real provider error — nothing is fabricated and the user's work is untouched.
// When an answer contains a suggestion, the user can explicitly apply it; until
// then the original content stays as it was.

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, Check, Clock, History, Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '../code-block'
import { cn } from '@/lib/utils'
import { ANALYSIS_LABELS } from '@/lib/agent-hub/playground-types'
import type { FeedbackEntry, PlaygroundMode } from '@/lib/agent-hub/playground-types'
import { activeFeedback } from '@/lib/agent-hub/playground-feedback'
import type { PlaygroundActionSpec } from '@/lib/agent-hub/playground-languages'

// Long model names / URLs / table cells must never stretch this pane: text
// wraps (overflow-wrap anywhere where unbreakable strings occur), while code
// and tables keep scrolling inside their own containers.

const PROSE_CLASS =
  'explain-prose text-[13px] leading-relaxed [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_strong]:font-semibold [&_strong]:text-foreground [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2.5 [&_h3]:text-[13px] [&_h3]:font-semibold [&_li]:ml-4 [&_li]:my-0.5 [&_li]:[overflow-wrap:anywhere] [&_ol]:my-1.5 [&_ol]:list-decimal [&_p]:my-1.5 [&_p]:[overflow-wrap:anywhere] [&_ul]:my-1.5 [&_ul]:list-disc [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12.5px] [&_td]:border [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_td]:[overflow-wrap:anywhere] [&_th]:border [&_th]:border-border/60 [&_th]:bg-secondary/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_th]:[overflow-wrap:anywhere] [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground'

export interface FeedbackPanelProps {
  mode: PlaygroundMode
  /** Full history for this practice (newest first); only the active one shows. */
  entries: FeedbackEntry[]
  /** Id of the entry that is the current result (falls back to newest). */
  activeId: string | null
  busy: PlaygroundActionSpec | null
  onApplySuggestion: (entry: FeedbackEntry) => void
  onClear: () => void
  onSelectEntry: (id: string) => void
  className?: string
}

export function FeedbackMarkdown({ text }: { text: string }) {
  return (
    <div className={PROSE_CLASS}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="hub-scroll my-2 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const raw = String(children ?? '')
            const lang = /language-([\w-]+)/.exec(className || '')?.[1] ?? ''
            const isBlock = /language-/.test(className ?? '') || raw.includes('\n')
            if (!isBlock) {
              return <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[12px]">{children}</code>
            }
            return <CodeBlock language={lang} code={raw.replace(/\n$/, '')} />
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function timeLabel(at: string): string {
  if (!at) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export function FeedbackPanel({
  mode,
  entries,
  activeId,
  busy,
  onApplySuggestion,
  onClear,
  onSelectEntry,
  className,
}: FeedbackPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const active = activeFeedback(entries, activeId)

  return (
    <aside className={cn('flex min-h-0 min-w-0 flex-col gap-2', className)} data-testid="playground-feedback">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-primary" />
        <h2 className="shrink-0 text-sm font-semibold">Guidance</h2>
        {active && !busy ? (
          <span
            className="min-w-0 truncate text-xs font-medium text-foreground/80"
            data-testid="feedback-active-label"
          >
            {active.actionLabel || 'Analysis'}
          </span>
        ) : null}
        {active?.model && !busy ? (
          <span
            className="hidden max-w-[40%] min-w-0 truncate text-[10px] text-muted-foreground sm:inline"
            title={active.model}
          >
            · {active.model}
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {entries.length > 1 ? (
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground"
                onClick={() => setHistoryOpen((open) => !open)}
                aria-expanded={historyOpen}
                data-testid="feedback-history-toggle"
              >
                <History className="size-3.5" />
                History
                <span className="rounded-full bg-secondary px-1.5 text-[10px]">{entries.length}</span>
              </Button>
              {historyOpen ? (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setHistoryOpen(false)} />
                  <div
                    className="absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-md border bg-popover shadow-lg"
                    data-testid="feedback-history"
                  >
                    <div className="hub-scroll max-h-72 overflow-y-auto p-1">
                      {entries.map((entry) => (
                        <button
                          key={entry.id}
                          onClick={() => {
                            onSelectEntry(entry.id)
                            setHistoryOpen(false)
                          }}
                          data-history-entry={entry.id}
                          data-history-action={entry.actionId}
                          className={cn(
                            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
                            entry.id === active?.id ? 'bg-secondary/70' : 'hover:bg-secondary/50',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {entry.actionLabel || 'Analysis'}
                          </span>
                          {entry.status === 'error' ? (
                            <span className="shrink-0 text-[10px] text-red-500">error</span>
                          ) : null}
                          <span className="shrink-0 text-[10px] text-muted-foreground">{timeLabel(entry.at)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          {entries.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground"
              onClick={onClear}
              data-testid="feedback-clear"
            >
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <p
        className="rounded-md border border-border/60 bg-secondary/40 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground"
        data-testid="analysis-only-label"
      >
        {ANALYSIS_LABELS[mode]}
      </p>

      <div className="hub-scroll min-h-0 flex-1 overflow-y-auto pr-0.5">
        <div className="mx-auto w-full min-w-0 max-w-4xl">
          {busy ? (
            <div
              className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2.5 text-xs text-muted-foreground"
              data-testid="feedback-busy"
            >
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
              Analysing with the local model — {busy.label}…
            </div>
          ) : null}

          {!busy && !active ? (
            <div
              className="rounded-md border border-dashed border-border/70 p-4 text-xs leading-relaxed text-muted-foreground"
              data-testid="feedback-empty"
            >
              <p className="font-medium text-foreground/80">No feedback yet</p>
              <p className="mt-1">
                Write or load some practice material, then use the analysis buttons under the editor. The local model
                reads your work and explains, reviews or debugs it — the request is plain text and nothing runs.
              </p>
            </div>
          ) : null}

          {!busy && active ? (
            <article
              key={active.id}
              data-feedback-entry={active.id}
              data-testid="feedback-active"
              data-active-action={active.actionId}
              data-active-at={active.at}
              className={cn(
                'rounded-lg border p-4 sm:p-5',
                active.status === 'error'
                  ? 'border-red-500/40 bg-red-500/5'
                  : 'border-border/60 bg-card',
              )}
            >
              <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border/50 pb-2.5">
                <span className="text-sm font-semibold" data-testid="feedback-active-action">
                  {active.actionLabel || 'Analysis'}
                </span>
                {active.estimated ? (
                  <span
                    className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                    data-estimated-label="true"
                  >
                    AI estimate — not executed
                  </span>
                ) : null}
                <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                  {active.at ? <Clock className="size-3" /> : null}
                  {timeLabel(active.at)}
                </span>
              </header>

              {active.status === 'error' ? (
                <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-red-600 dark:text-red-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{active.text}</span>
                </p>
              ) : (
                <div className="mt-2.5">
                  <FeedbackMarkdown text={active.text} />
                </div>
              )}

              {active.suggestion ? (
                <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                    <Wand2 className="size-3" />
                    Suggested {active.suggestionKind === 'formula' ? 'formula' : 'replacement'}
                  </div>
                  <CodeBlock
                    language={active.suggestionKind === 'formula' ? 'excel' : undefined}
                    code={active.suggestion}
                    showLineNumbers={false}
                  />
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {active.applied ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                        <Check className="size-3.5" />
                        Applied — Undo (Ctrl+Z) still reverts it
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        data-apply-suggestion={active.id}
                        onClick={() => onApplySuggestion(active)}
                      >
                        Apply suggestion
                      </Button>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      Your original stays until you apply it.
                    </span>
                  </div>
                </div>
              ) : null}
            </article>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
