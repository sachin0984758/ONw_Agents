'use client'

import { useEffect, useState } from 'react'
import { Check, ListChecks, Loader2, Play, Wrench } from 'lucide-react'
import { useHub } from '@/lib/agent-hub/store'
import { Button } from '@/components/ui/button'
import {
  subscribeAgentSession,
  type AgentSessionState,
  type AgentStep,
} from '@/lib/agent-hub/agent-session'
import { cn } from '@/lib/utils'
import { initialAgentState } from './session-state'



const STEP_STATUS: Record<AgentStep['status'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'text-muted-foreground' },
  running: { label: 'Running', className: 'text-amber-600 dark:text-amber-400' },
  completed: { label: 'Completed', className: 'text-emerald-600 dark:text-emerald-400' },
  failed: { label: 'Failed', className: 'text-red-600 dark:text-red-400' },
  skipped: { label: 'Skipped', className: 'text-muted-foreground' },
}

function StepIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'completed') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500">
        <Check className="size-3 text-black" />
      </span>
    )
  }
  if (status === 'running') return <Loader2 className="size-5 animate-spin text-amber-600 dark:text-amber-400" />
  if (status === 'failed') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full border-2 border-red-500/60 text-red-500">
        <span className="text-[10px] font-bold">!</span>
      </span>
    )
  }
  return <span className="size-5 rounded-full border-2 border-zinc-600" />
}

export function TasksView() {
  const setView = useHub((s) => s.setView)
  const [agentState, setAgentState] = useState<AgentSessionState>(initialAgentState)

  useEffect(() => {
    const unsub = subscribeAgentSession(setAgentState)
    return unsub
  }, [])

  const task = agentState.task
  const steps = task?.plan ?? []
  const hasPlan = steps.length > 0
  const done = steps.filter((s) => s.status === 'completed').length
  const pct = hasPlan ? Math.round((done / steps.length) * 100) : 0

  // The plan/tasks session only exists once an agent has actually done work.
  // Before that, show an empty state instead of fabricated steps.
  if (!task || !hasPlan) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Plan / Tasks</h1>
            <p className="text-xs text-muted-foreground">
              The plan appears once an agent starts working on a task.
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setView('sessions')}>
            <Play className="size-3.5" /> Go to Sessions
          </Button>
        </div>
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ListChecks className="mx-auto size-8 text-muted-foreground/60" />
          <div className="mt-3 text-sm font-medium">No active plan</div>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Ask an agent to do a task in the Sessions workspace — its plan and step-by-step
            progress will show up here automatically.
          </p>
          <Button size="sm" variant="outline" className="mt-4 gap-1.5" onClick={() => setView('sessions')}>
            <Play className="size-3.5" /> Start a task in Sessions
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-52">
          <h1 className="text-lg font-semibold">Plan / Tasks</h1>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{task.request}</p>
        </div>
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px]',
            agentState.isRunning
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-border bg-secondary/40 text-muted-foreground'
          )}
        >
          {agentState.isRunning ? <Loader2 className="size-3 animate-spin" /> : null}
          {agentState.isRunning ? task.status : task.status === 'completed' ? 'Completed' : task.status}
        </span>
      </div>

      {/* steps */}
      <div className="space-y-2">
        {steps.map((s, i) => {
          const meta = STEP_STATUS[s.status]
          const isCurrent = i === task.currentStepIndex && task.status === 'executing'
          return (
            <div
              key={s.id}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border p-3.5 text-left',
                s.status === 'completed'
                  ? 'border-emerald-500/25 bg-emerald-500/5'
                  : s.status === 'failed'
                    ? 'border-red-500/25 bg-red-500/5'
                    : s.status === 'running' || isCurrent
                      ? 'border-amber-500/30 bg-amber-500/5'
                      : 'border-border bg-card'
              )}
            >
              <span className="font-mono text-[10px] text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
              <StepIcon status={s.status} />
              <div className="flex-1">
                <div className={cn('text-sm font-medium', s.status === 'pending' && 'text-muted-foreground')}>
                  {s.description}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Wrench className="size-3" />
                  <span className="font-mono">{s.tool}</span>
                </div>
              </div>
              <span className={cn('text-[11px]', meta.className)}>{meta.label}</span>
            </div>
          )
        })}
      </div>

      {/* progress */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Task progress</span>
          <span className="font-semibold tabular-nums text-violet-600 dark:text-violet-300">{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {done} of {steps.length} steps complete
        </p>
      </div>
    </div>
  )
}
