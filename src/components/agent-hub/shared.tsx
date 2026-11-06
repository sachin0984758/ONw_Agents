'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AgentStatus, AgentType, SessionEventType } from '@/lib/agent-hub/types'

// ── Status colors ────────────────────────────────────────────────────────────
export const statusStyles: Record<AgentStatus, { dot: string; text: string; label: string }> = {
  running: { dot: 'bg-emerald-500 dark:bg-emerald-400', text: 'text-emerald-700 dark:text-emerald-300', label: 'Running' },
  waiting: { dot: 'bg-amber-500 dark:bg-amber-400', text: 'text-amber-700 dark:text-amber-300', label: 'Waiting' },
  blocked: { dot: 'bg-red-500 dark:bg-red-400', text: 'text-red-700 dark:text-red-300', label: 'Blocked' },
  completed: { dot: 'bg-teal-500 dark:bg-teal-400', text: 'text-teal-700 dark:text-teal-300', label: 'Completed' },
  paused: { dot: 'bg-orange-500 dark:bg-orange-400', text: 'text-orange-700 dark:text-orange-300', label: 'Paused' },
}

export const agentTypeStyles: Record<AgentType, { chip: string; ring: string; label: string }> = {
  manager: { chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40', ring: 'border-violet-500/50', label: 'Manager' },
  architecture: { chip: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300 border-cyan-500/40', ring: 'border-cyan-500/50', label: 'Architecture' },
  backend: { chip: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/40', ring: 'border-emerald-500/50', label: 'Backend' },
  ui: { chip: 'bg-fuchsia-500/15 text-fuchsia-800 dark:text-fuchsia-300 border-fuchsia-500/40', ring: 'border-fuchsia-500/50', label: 'UI' },
  qa: { chip: 'bg-rose-500/15 text-rose-800 dark:text-rose-300 border-rose-500/40', ring: 'border-rose-500/50', label: 'QA' },
  database: { chip: 'bg-teal-500/15 text-teal-800 dark:text-teal-300 border-teal-500/40', ring: 'border-teal-500/50', label: 'Database' },
  service: { chip: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40', ring: 'border-amber-500/50', label: 'Service' },
  test: { chip: 'bg-lime-500/15 text-lime-800 dark:text-lime-300 border-lime-500/40', ring: 'border-lime-500/50', label: 'Test' },
  ipc: { chip: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/40', ring: 'border-slate-500/50', label: 'IPC' },
}

export const clusterStyles: Record<string, string> = {
  core: '#a78bfa',
  bridge: '#34d399',
  analysis: '#fbbf24',
  agents: '#fb7185',
  config: '#22d3ee',
  clients: '#2dd4bf',
}

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  const s = statusStyles[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('size-2 rounded-full', s.dot, status === 'running' && 'animate-pulse')} />
      <span className={s.text}>{s.label}</span>
    </span>
  )
}

export function TypeChip({ type }: { type: AgentType }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        agentTypeStyles[type].chip
      )}
    >
      {agentTypeStyles[type].label}
    </span>
  )
}

// ── Session event colors ─────────────────────────────────────────────────────
export const eventStyles: Record<SessionEventType, { dot: string; label: string }> = {
  system: { dot: 'bg-zinc-500 dark:bg-zinc-400', label: 'System' },
  user: { dot: 'bg-violet-500 dark:bg-violet-400', label: 'User' },
  assistant: { dot: 'bg-fuchsia-500 dark:bg-fuchsia-400', label: 'Assistant' },
  tool: { dot: 'bg-amber-500 dark:bg-amber-400', label: 'Tool' },
  result: { dot: 'bg-teal-500 dark:bg-teal-400', label: 'Result' },
  error: { dot: 'bg-red-500 dark:bg-red-400', label: 'Error' },
}

// ── Misc ─────────────────────────────────────────────────────────────────────
export function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: string
}) {
  return (
    <div className="rounded-lg border bg-card/60 p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', accent)}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className="ml-auto text-[10px] font-medium">
      {children}
    </Badge>
  )
}
