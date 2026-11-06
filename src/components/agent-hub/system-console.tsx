'use client'

import { useCallback, useState } from 'react'
import { Activity, Cpu, MemoryStick, RefreshCw, Thermometer, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SystemTelemetry } from '@/lib/agent-hub/types'
import { useLivePoll } from '@/lib/agent-hub/use-live-poll'

// ── System console (LM Studio-style hardware panel) ──────────────────────────
// Polls /api/system-metrics and renders live GPU / CPU / RAM dials plus the
// spend-vs-hosted-API estimate. Everything shown comes from the host machine;
// a missing GPU renders an explicit "unavailable" dial rather than fake zeros.

const POLL_MS = 3000

/** A circular progress dial. `value` is 0..100. */
function Dial({
  label,
  sublabel,
  pct,
  value,
  icon: Icon,
  tone = 'primary',
  unavailable,
}: {
  label: string
  sublabel?: string
  pct: number
  value: string
  icon: React.ElementType
  tone?: 'primary' | 'emerald' | 'amber' | 'rose' | 'cyan'
  unavailable?: boolean
}) {
  const r = 34
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const tones: Record<string, string> = {
    primary: 'stroke-violet-400',
    emerald: 'stroke-emerald-400',
    amber: 'stroke-amber-400',
    rose: 'stroke-rose-400',
    cyan: 'stroke-cyan-400',
  }
  const textTones: Record<string, string> = {
    primary: 'text-violet-600 dark:text-violet-300',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    amber: 'text-amber-700 dark:text-amber-300',
    rose: 'text-rose-700 dark:text-rose-300',
    cyan: 'text-cyan-700 dark:text-cyan-300',
  }
  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="relative mx-auto mt-3 size-[92px]">
        <svg viewBox="0 0 80 80" className="size-full -rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" strokeWidth="7" className="stroke-secondary" />
          {!unavailable ? (
            <circle
              cx="40"
              cy="40"
              r={r}
              fill="none"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - clamped / 100)}
              className={cn('transition-[stroke-dashoffset] duration-700 ease-out', tones[tone])}
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-lg font-semibold tabular-nums', unavailable ? 'text-muted-foreground' : textTones[tone])}>
            {unavailable ? '—' : `${Math.round(clamped)}%`}
          </span>
        </div>
      </div>
      <div className="mt-2 text-center text-xs font-medium tabular-nums">{value}</div>
      {sublabel ? <div className="mt-0.5 text-center text-[10px] text-muted-foreground">{sublabel}</div> : null}
    </div>
  )
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function SystemConsole({ outputTokens, inputTokens }: { outputTokens: number; inputTokens: number }) {
  const [tele, setTele] = useState<SystemTelemetry | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/system-metrics', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) })
      const json = (await res.json()) as SystemTelemetry
      if (!res.ok || !json?.ok) throw new Error('Telemetry unavailable')
      if (signal?.aborted) return
      setTele(json)
      setError('')
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Telemetry unavailable')
    }
  }, [])

  useLivePoll(load, POLL_MS)

  const gpu = tele?.gpu ?? null
  const cpu = tele?.cpu
  const mem = tele?.memory

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">System Console</h2>
          <p className="text-[11px] text-muted-foreground">
            {tele ? `${tele.hostname} · ${tele.cpu.model} · up ${formatUptime(tele.uptimeSec)}` : 'Reading host hardware…'}
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', tele ? 'bg-emerald-500 dark:bg-emerald-400 animate-pulse' : 'bg-muted-foreground')} />
          {error ? 'Hardware update unavailable' : tele ? `Live · every ${POLL_MS / 1000}s while visible` : 'Connecting…'}
        </span>
        <button
          onClick={async () => {
            setRefreshing(true)
            await load()
            setRefreshing(false)
          }}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] hover:bg-secondary"
        >
          <RefreshCw className={cn('size-3', refreshing && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* Hardware spec line */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border bg-card/40 px-3.5 py-2.5 text-center text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{gpu ? gpu.name : 'GPU telemetry unavailable'}</span>
        <span>·</span>
        <span>{cpu ? cpu.model : 'CPU unknown'}</span>
        <span>·</span>
        <span>{cpu ? `${cpu.threads} threads @ ${cpu.clockGhz.toFixed(2)} GHz` : ''}</span>
        {gpu ? (
          <>
            <span>·</span>
            <span>{gpu.vramTotalMb >= 1024 ? `${(gpu.vramTotalMb / 1024).toFixed(1)} GiB VRAM` : `${gpu.vramTotalMb} MB VRAM`}</span>
            {gpu.driverVersion ? (
              <>
                <span>·</span>
                <span>driver {gpu.driverVersion}</span>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {/* Spend vs hosted API */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/8 p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300/80">
            <Activity className="size-3" /> Input tokens
          </div>
          <div data-testid="overview-input-tokens" className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{inputTokens.toLocaleString('en-US')}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">recorded AgentHub requests</div>
        </div>
        <div className="rounded-lg border bg-card/60 p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Activity className="size-3" /> Output tokens
          </div>
          <div data-testid="overview-output-tokens" className="mt-1 text-2xl font-semibold tabular-nums">{outputTokens.toLocaleString('en-US')}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">output tokens recorded</div>
        </div>
        <div className="rounded-lg border bg-card/60 p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Activity className="size-3" /> Total tokens
          </div>
          <div data-testid="overview-total-tokens" className="mt-1 text-2xl font-semibold tabular-nums">{(inputTokens + outputTokens).toLocaleString('en-US')}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">input + output · all recorded calls</div>
        </div>
        <div className="rounded-lg border bg-card/60 p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Thermometer className="size-3" /> GPU temp
          </div>
          <div className={cn('mt-1 text-2xl font-semibold tabular-nums', !gpu ? 'text-muted-foreground' : gpu.temperatureC >= 80 ? 'text-rose-600 dark:text-rose-400' : gpu.temperatureC >= 65 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
            {gpu ? `${Math.round(gpu.temperatureC)}°C` : '—'}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">{gpu ? `${gpu.powerDrawW.toFixed(1)} W draw` : 'no sensor'}</div>
        </div>
      </div>

      {/* Dials */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Dial
          label="GPU VRAM"
          icon={MemoryStick}
          pct={gpu ? (gpu.vramUsedMb / Math.max(1, gpu.vramTotalMb)) * 100 : 0}
          value={gpu ? `${(gpu.vramUsedMb / 1024).toFixed(2)} / ${(gpu.vramTotalMb / 1024).toFixed(1)} GiB` : 'No NVIDIA GPU'}
          sublabel={gpu ? 'VRAM in use' : 'nvidia-smi unavailable'}
          tone="cyan"
          unavailable={!gpu}
        />
        <Dial
          label="GPU util"
          icon={Zap}
          pct={gpu ? gpu.utilizationPct : 0}
          value={gpu ? 'CUDA' : 'unavailable'}
          sublabel={gpu ? `${gpu.utilizationPct}% of capacity` : 'no GPU'}
          tone="primary"
          unavailable={!gpu}
        />
        <Dial
          label="Memory"
          icon={MemoryStick}
          pct={mem ? mem.utilizationPct : 0}
          value={mem ? `${mem.usedGb} / ${mem.totalGb} GiB` : '—'}
          sublabel="RAM"
          tone="emerald"
          unavailable={!mem}
        />
        <Dial
          label="CPU util"
          icon={Cpu}
          pct={cpu ? cpu.utilizationPct : 0}
          value={cpu ? `${cpu.threads} threads` : '—'}
          sublabel={cpu ? `${cpu.utilizationPct}% across all cores` : ''}
          tone="amber"
          unavailable={!cpu}
        />
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">{error}</p>
      ) : null}
    </section>
  )
}
