'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useHub } from '@/lib/agent-hub/store'
import { computeUsagePeriods, niceScaleCeil, type PeriodUsage } from '@/lib/agent-hub/token-usage'

// ── Period Token Monitor ─────────────────────────────────────────────────────
// Replaces the "Plan — plan.md" dashboard card with three semicircular gauges:
// Today · Weekly · Forever. Every count is derived from the persisted
// per-request token ledger (state.tokenUsage) via lib/agent-hub/token-usage —
// real model calls only, each placed by its own timestamp, nothing invented and
// no seeded demo data. The app stores no token
// quota, so the gauges share an explicit, labelled scale instead of a
// fabricated "percent of limit"; if a real limit is ever configured it is shown
// as a percentage instead.

// No token quota is tracked by the application today. Kept explicit so the
// "percent of limit" path stays real rather than fabricated.
const TOKEN_LIMIT: number | undefined = undefined

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`
  return n.toLocaleString('en-US')
}

// Multicolor arc, left → right, matching the UsageAtlas reference feel.
const ARC_STOPS = ['#22d3ee', '#34d399', '#a78bfa', '#fb7185', '#fbbf24']

function SemiGauge({
  usage,
  scaleMax,
  limit,
}: {
  usage: PeriodUsage
  scaleMax: number
  limit?: number
}) {
  const rawId = useId()
  const gradientId = `tokengauge-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  const cx = 80
  const cy = 80
  const r = 62
  const stroke = 14
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  const arcLen = Math.PI * r
  const ratio = scaleMax > 0 ? Math.max(0, Math.min(1, usage.total / scaleMax)) : 0
  const dash = arcLen * ratio

  const hasLimit = typeof limit === 'number' && limit > 0
  const pct = hasLimit ? Math.min(100, (usage.total / (limit as number)) * 100) : null

  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <svg
        viewBox="0 0 160 92"
        className="w-full max-w-[150px] text-foreground"
        role="img"
        aria-label={`${usage.label}: ${usage.total.toLocaleString('en-US')} tokens (${usage.input.toLocaleString('en-US')} input, ${usage.output.toLocaleString('en-US')} output)`}
      >
        <title>{`${usage.label} — ${usage.total.toLocaleString('en-US')} tokens · ${usage.input.toLocaleString('en-US')} in / ${usage.output.toLocaleString('en-US')} out`}</title>
        <defs>
          <linearGradient id={gradientId} x1="12" y1="0" x2="148" y2="0" gradientUnits="userSpaceOnUse">
            {ARC_STOPS.map((color, i) => (
              <stop key={color} offset={`${(i / (ARC_STOPS.length - 1)) * 100}%`} stopColor={color} />
            ))}
          </linearGradient>
        </defs>

        {/* track */}
        <path
          d={arc}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* fill */}
        {ratio > 0 ? (
          <path
            d={arc}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${arcLen}`}
          />
        ) : null}

        <text
          x={cx}
          y={54}
          textAnchor="middle"
          fill="currentColor"
          fontSize="22"
          fontWeight="600"
          className="tabular-nums"
        >
          {fmt(usage.total)}
        </text>
        <text
          x={cx}
          y={70}
          textAnchor="middle"
          fill="currentColor"
          fillOpacity="0.55"
          fontSize="9"
          letterSpacing="0.4"
        >
          {pct != null
            ? `${pct.toFixed(pct >= 99.5 ? 0 : 1)}% of limit`
            : `${fmt(usage.input)} in · ${fmt(usage.output)} out`}
        </text>
      </svg>

      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider">{usage.label}</div>
      <div className="text-[10px] text-muted-foreground">{usage.sub}</div>
    </div>
  )
}

export function PeriodTokenMonitor() {
  const ledger = useHub((s) => s.state.tokenUsage)
  // `now` starts at 0 — a time-independent snapshot (Today/Weekly = 0) — so the
  // server render and the hydrating client render agree. The deferred first
  // tick plus the 60s interval then stamp real local time, so Today/Weekly roll
  // over when the local date or week changes.
  const [now, setNow] = useState(0)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const kick = setTimeout(tick, 0)
    const id = setInterval(tick, 60_000)
    return () => {
      clearTimeout(kick)
      clearInterval(id)
    }
  }, [])

  const buckets = useMemo(() => computeUsagePeriods(ledger, now), [ledger, now])
  const totalRequests = buckets.find((b) => b.key === 'forever')?.requests ?? 0

  const maxTotal = buckets.reduce((m, b) => Math.max(m, b.total), 0)
  const scaleMax = TOKEN_LIMIT && TOKEN_LIMIT > 0 ? TOKEN_LIMIT : niceScaleCeil(maxTotal)

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4 text-primary" /> Token Usage
          </div>
          <span className="text-[11px] text-muted-foreground">
            {totalRequests} recorded {totalRequests === 1 ? 'call' : 'calls'}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {buckets.map((b) => (
            <SemiGauge key={b.key} usage={b} scaleMax={scaleMax} limit={TOKEN_LIMIT} />
          ))}
        </div>

        <div className="mt-3 border-t pt-2 text-[10px] text-muted-foreground">
          Input + output combined · relative scale 0–{fmt(scaleMax)}
          {TOKEN_LIMIT ? '' : ' · no limit configured'}
        </div>
      </CardContent>
    </Card>
  )
}
