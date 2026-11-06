'use client'

import { useState } from 'react'
import { History, Loader2, MessageSquarePlus } from 'lucide-react'
import { useHub, flattenAgents } from '@/lib/agent-hub/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { HubSelect, HubSelectItem } from './hub-select'

export function TrackedSessionsPanel() {
  const state = useHub((s) => s.state)
  const selectSession = useHub((s) => s.selectSession)
  const selectAgent = useHub((s) => s.selectAgent)
  const setView = useHub((s) => s.setView)
  const reassignSessionOwner = useHub((s) => s.reassignSessionOwner)
  const selectedSessionId = useHub((s) => s.selectedSessionId)
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [busy, setBusy] = useState(false)

  const flat = flattenAgents(state.agents)
  const nameById = new Map(flat.map((a) => [a.id, a.name]))
  const filtered =
    agentFilter === 'all'
      ? state.sessions
      : agentFilter === 'unassigned'
        ? state.sessions.filter((s) => !s.agentId || !nameById.has(s.agentId))
        : state.sessions.filter((s) => s.agentId === agentFilter)


  const openSession = (sessionId: string) => {
    selectSession(sessionId)
  }

  const goToOwner = (agentId: string) => {
    selectAgent(agentId)
    setView('agents')
  }

  const handleReassign = (sessionId: string, agentId: string) => {
    setBusy(true)
    try {
      reassignSessionOwner(sessionId, agentId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-none border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <History className="size-3.5" /> Tracked sessions
        <span className="ml-auto tabular-nums">{filtered.length}/{state.sessions.length}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {[{ id: 'all', label: 'All agents' }, ...flat.map((a) => ({ id: a.id, label: a.name })), { id: 'unassigned', label: 'Unassigned' }].map((o) => (
          <button
            key={o.id}
            onClick={() => setAgentFilter(o.id)}
            className={cn(
              'rounded-none border px-2 py-0.5 text-[10px]',
              agentFilter === o.id
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="hub-scroll mt-2 max-h-56 space-y-1.5 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="rounded-none border border-dashed p-3 text-center text-[11px] text-muted-foreground">
            No sessions match this filter.
          </div>
        ) : (
          filtered.map((s) => {
            const ownerName = s.agentId && nameById.has(s.agentId) ? nameById.get(s.agentId)! : null
            const orphaned = !s.agentId || !nameById.has(s.agentId)
            const active = selectedSessionId === s.id
            return (
              <div
                key={s.id}
                className={cn(
                  'rounded-none border px-2 py-1.5 text-xs',
                  active ? 'border-primary/50 bg-primary/10' : 'border-transparent bg-secondary/30'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  {active ? (
                    <span className="rounded-none bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary">
                      active
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{s.id.slice(0, 13)}…</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                  {orphaned ? (
                    <>
                      <span className="rounded-none border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                        {s.agentId ? 'Orphaned' : 'Unassigned'}
                      </span>
                      <HubSelect
                        ariaLabel={`Reassign ${s.name}`}
                        placeholder="Reassign to…"
                        value=""
                        onValueChange={(next) => {
                          if (next) handleReassign(s.id, next)
                        }}
                        disabled={busy}
                        size="xs"
                        className="rounded-none"
                        contentClassName="rounded-none"
                      >
                        {flat.map((a) => (
                          <HubSelectItem key={a.id} value={a.id}>
                            {a.name}
                          </HubSelectItem>
                        ))}
                      </HubSelect>
                    </>
                  ) : (
                    <button
                      onClick={() => goToOwner(s.agentId)}
                      className="rounded-none border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-medium text-primary hover:bg-primary/20"
                      title={`Owning agent ${ownerName} (${s.agentId}) — click to open in Agents view`}
                    >
                      {ownerName} →
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <Button
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    className="h-6 flex-1 gap-1 px-2 text-[10px]"
                    onClick={() => openSession(s.id)}
                  >
                    <MessageSquarePlus className="size-3" /> Open
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>
      {busy ? (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Saving…
        </p>
      ) : null}
      <p className="mt-1.5 rounded-none border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300/90">
        These are ownership registry entries, not live executors. The coding runtime
        supports <span className="font-semibold">one active execution session at a time</span>
        (the console above); tracked sessions record who owns what, and never run
        concurrently.
      </p>
    </div>
  )
}
