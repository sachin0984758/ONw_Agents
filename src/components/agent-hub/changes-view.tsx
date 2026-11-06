'use client'

import { useState } from 'react'
import { ArrowUpRight, GitBranch, Info, MessageSquare, Plus } from 'lucide-react'
import { useHub } from '@/lib/agent-hub/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

export function ChangesView() {
  const state = useHub((s) => s.state)
  const stageFile = useHub((s) => s.stageFile)
  const stageAll = useHub((s) => s.stageAll)
  const [tab, setTab] = useState<'unified' | 'split'>('unified')
  const changes = state.changes

  const staged = changes.files.filter((f) => f.staged)
  const unstaged = changes.files.filter((f) => !f.staged)

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Changes</h1>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {changes.project} <span className="text-muted-foreground/50">/</span>
            <GitBranch className="size-3" /> {changes.branch}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {(['unified', 'split'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs capitalize transition-colors',
                tab === t ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* This view renders seeded sample diffs — it is not wired to a real git
          working tree. Say so plainly instead of implying live repo state. */}
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          Sample data — this view is not connected to git. The files, diffs, comments and the Commit action below
          are illustrative only and do not affect your repository.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_1fr_280px]">
        {/* left: files */}
        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-2.5">
            <div className="flex items-center justify-between px-1 pb-1.5 text-[11px] font-medium text-muted-foreground">
              <span>STAGED ({staged.length})</span>
              <button className="hover:text-foreground" onClick={() => stageAll(false)}>
                Unstage All
              </button>
            </div>
            {staged.map((f) => (
              <label
                key={f.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-secondary/50"
              >
                <input
                  type="checkbox"
                  checked={f.staged}
                  onChange={() => stageFile(f.id, false)}
                  className="size-3.5 accent-violet-500"
                />
                <span className="flex-1 truncate">{f.name}</span>
                {f.comments > 0 ? (
                  <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    <MessageSquare className="size-2.5" /> {f.comments}
                  </span>
                ) : null}
                <span
                  className={cn(
                    'rounded px-1 text-[10px] font-bold',
                    f.badge === 'A' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  )}
                >
                  {f.badge}
                </span>
              </label>
            ))}
          </div>

          <div className="rounded-lg border bg-card p-2.5">
            <div className="flex items-center justify-between px-1 pb-1.5 text-[11px] font-medium text-muted-foreground">
              <span>CHANGES ({unstaged.length})</span>
              <button className="hover:text-foreground" onClick={() => stageAll(true)}>
                Stage All
              </button>
            </div>
            {unstaged.map((f) => (
              <label
                key={f.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-secondary/50"
              >
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => stageFile(f.id, true)}
                  className="size-3.5 accent-violet-500"
                />
                <span className="flex-1 truncate text-muted-foreground">{f.name}</span>
                {f.comments > 0 ? (
                  <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    <MessageSquare className="size-2.5" /> {f.comments}
                  </span>
                ) : null}
                <span
                  className={cn(
                    'rounded px-1 text-[10px] font-bold',
                    f.badge === 'A' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  )}
                >
                  {f.badge}
                </span>
              </label>
            ))}
          </div>

          {/* commit box */}
          <div className="rounded-lg border bg-card p-2.5">
            <input
              disabled
              title="Sample data — this view is not connected to git"
              placeholder="Commit message (sample view — nothing is committed)"
              className="h-8 w-full cursor-not-allowed rounded-md border border-input bg-secondary/50 px-2.5 text-xs outline-none placeholder:text-muted-foreground"
            />
            <Button
              size="sm"
              className="mt-2 w-full text-xs"
              title="Sample data — this view is not connected to git"
              onClick={() =>
                toast({
                  title: 'Sample data — nothing was committed',
                  description: 'This view is illustrative only. Staging and comments stay local to the demo state.',
                })
              }
            >
              Commit
            </Button>
          </div>
        </div>

        {/* center: diff */}
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="font-mono text-xs">
              src/api/<span className="text-foreground">{changes.activeFile}</span>
            </span>
            <span className="text-[10px] text-muted-foreground">+20 −1</span>
          </div>
          <div className="hub-scroll max-h-[480px] overflow-auto font-mono text-[11.5px] leading-5">
            {changes.diff.map((l, i) => (
              <div
                key={i}
                className={cn(
                  'flex gap-2 px-3 whitespace-pre',
                  l.kind === 'add' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  l.kind === 'del' && 'bg-red-500/10 text-red-700 dark:text-red-300',
                  l.kind === 'hunk' && 'bg-secondary/60 text-violet-600 dark:text-violet-300',
                  l.warn && 'bg-amber-500/10'
                )}
              >
                <span className="w-6 shrink-0 select-none text-right text-muted-foreground/50">{i + 1}</span>
                <span className="w-2 shrink-0 select-none text-muted-foreground/60">
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
                </span>
                <span className={cn(l.warn && 'underline decoration-amber-500/60 decoration-wavy underline-offset-2')}>
                  {l.content || ' '}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* right: AI comments */}
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-medium">{changes.comments.length} Comments</span>
            <button
              type="button"
              disabled
              title="Not available in this build"
              className="cursor-not-allowed text-[11px] text-muted-foreground opacity-60"
            >
              Clear
            </button>
          </div>
          {changes.comments.map((c) => (
            <div key={c.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full',
                    c.severity === 'warning'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : c.severity === 'idea'
                        ? 'bg-fuchsia-500/15 text-fuchsia-400'
                        : 'bg-cyan-500/15 text-cyan-400'
                  )}
                >
                  {c.severity === 'warning' ? '!' : c.severity === 'idea' ? '💡' : 'i'}
                </span>
                <span className="font-mono">
                  {c.file}:{c.lines}
                </span>
                <button
                  type="button"
                  disabled
                  title="Not available in this build"
                  className="ml-auto cursor-not-allowed text-muted-foreground opacity-60"
                  aria-label="Link comment"
                >
                  <ArrowUpRight className="size-3" />
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto rounded bg-secondary/50 p-1.5 font-mono text-[10px] text-muted-foreground">
                {c.snippet}
              </pre>
              <p className="mt-2 text-xs leading-relaxed text-foreground/90">{c.suggestion}</p>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5 text-xs"
            title="Sample data — this view is not connected to git"
            onClick={() =>
              toast({
                title: 'Sample data — nothing was exported',
                description:
                  'This view is not connected to git, so no review file is written. The comments above are illustrative.',
              })
            }
          >
            <Plus className="size-3.5" /> Export for Agent
          </Button>
        </div>
      </div>
    </div>
  )
}
