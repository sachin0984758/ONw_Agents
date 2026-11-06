'use client'

import { useMemo } from 'react'
import { useHub } from '@/lib/agent-hub/store'
import { ledgerTotals } from '@/lib/agent-hub/token-usage'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Gauge } from 'lucide-react'
import { useRuntimeModels } from '@/lib/agent-hub/use-runtime-models'

// ── Token Monitor ────────────────────────────────────────────────
// Displays real token usage accumulated from actual model calls across the
// app (Chat, the Agent Session runtime, Playground and Explain). Every value
// is summed from the persisted per-request ledger (state.tokenUsage) — no
// invented numbers, and the seeded demo sessions are never counted. Provider-
// reported usage is used when available; calls the provider reported no usage
// for are locally estimated and surfaced as such. Also probes the local
// runtimes (LM Studio / Ollama) on the same endpoints the Models view uses.
// Updated every 15s.

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function TokenUsageMeter() {
  const state = useHub((s) => s.state)
  const runtime = useRuntimeModels()
  const probes = ['LM Studio', 'Ollama'].map((name) => ({ name, available: runtime.onlineProviders.includes(name), models: runtime.loaded.filter((model) => model.providerName === name) }))

  // Real token usage from the recorded model-call ledger (no invented numbers).
  const usage = useMemo(() => ledgerTotals(state.tokenUsage), [state.tokenUsage])

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Gauge className="size-4 text-primary" /> Token Monitor
          </div>
          <span className="text-[11px] text-muted-foreground">
            {usage.requests} recorded {usage.requests === 1 ? 'call' : 'calls'}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-md bg-secondary/40 p-3">
            <div className="text-lg font-semibold tabular-nums">{fmt(usage.input)}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Input</div>
          </div>
          <div className="rounded-md bg-secondary/40 p-3">
            <div className="text-lg font-semibold tabular-nums">{fmt(usage.output)}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Output</div>
          </div>
          <div className="rounded-md bg-secondary/40 p-3">
            <div className="text-lg font-semibold tabular-nums text-primary">{fmt(usage.total)}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
          </div>
        </div>

        {usage.estimated > 0 ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {usage.estimated} of {usage.requests} {usage.requests === 1 ? 'call' : 'calls'} used locally estimated tokens — the provider reported no usage.
          </p>
        ) : null}

        {probes.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2 border-t pt-3 text-[11px]">
            {probes.map((p) => (
              <span
                key={p.name}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono',
                  p.available
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-border/60 bg-muted/40 text-muted-foreground',
                )}
              >
                <span className={cn('size-1.5 rounded-full', p.available ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500/60')} />
                {p.name}: {runtime.status === 'loading' ? 'checking' : runtime.status === 'error' ? 'unavailable' : p.available ? `${p.models.length} loaded` : 'offline'}
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
