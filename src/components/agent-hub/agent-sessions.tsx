'use client'

import { useState } from 'react'
import { History, Loader2, MessageSquarePlus, Pencil, Plus } from 'lucide-react'
import { useHub, flattenAgents } from '@/lib/agent-hub/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Agent → Sessions panel ───────────────────────────────────────────────
// Shows the sessions owned by one agent (derived from Session.agentId).
// New Session assigns the agent's stable ID; Open/Resume select the stored
// session without touching its owner.

export function AgentSessionsPanel({ agentId }: { agentId: string }) {
  const state = useHub((s) => s.state)
  const createSessionForAgent = useHub((s) => s.createSessionForAgent)
  const selectSession = useHub((s) => s.selectSession)
  const setView = useHub((s) => s.setView)
  const selectedSessionId = useHub((s) => s.selectedSessionId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const flat = flattenAgents(state.agents)
  const agent = flat.find((a) => a.id === agentId)
  const owned = state.sessions.filter((s) => s.agentId === agentId)

  const openSession = (sessionId: string) => {
    selectSession(sessionId)
    setView('sessions')
  }

  const handleNew = () => {
    setError(null)
    setBusy(true)
    try {
      createSessionForAgent(agentId)
      setView('sessions')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <History className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">
          Sessions · {owned.length}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{agentId}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {agent ? `Owned by ${agent.name}` : 'Orphaned sessions (owner missing)'}
      </p>

      <div className="mt-3 space-y-1.5">
        {owned.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-center">
            <p className="text-[11px] text-muted-foreground">No sessions for this agent yet.</p>
            <Button size="sm" className="mt-2 h-7 gap-1 text-xs" onClick={handleNew} disabled={busy}>
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
              Create Session
            </Button>
          </div>
        ) : (
          owned.map((s) => {
            const active = selectedSessionId === s.id
            const last = s.events[s.events.length - 1]
            return (
              <div
                key={s.id}
                className={cn(
                  'rounded-md border px-2.5 py-2 text-xs',
                  active ? 'border-primary/50 bg-primary/10' : 'bg-secondary/40'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate font-medium">{s.name}</span>
                  {active ? (
                    <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary">
                      active
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="font-mono">{s.id.slice(0, 8)}…</span>
                  <span className="truncate">{last ? last.content.slice(0, 40) : 'No activity yet'}</span>
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
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 gap-1 px-2 text-[10px]"
                    onClick={() => openSession(s.id)}
                    title="Resume this session"
                  >
                    <Pencil className="size-3" /> Resume
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {owned.length > 0 ? (
        <Button size="sm" variant="outline" className="mt-2.5 h-7 w-full gap-1 text-xs" onClick={handleNew} disabled={busy}>
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
          New Session for this agent
        </Button>
      ) : null}
      {error ? <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
        Counts are derived from stored Session.agentId — sessions never move owners unless
        explicitly reassigned.
      </p>
    </div>
  )
}
