'use client'

import { useState } from 'react'
import {
  ChevronRight,
  CirclePause,
  CirclePlay,
  MessageSquare,
  Paperclip,
  Play,
  Plus,
  Send,
  SquareArrowOutUpRight,
  TriangleAlert,
} from 'lucide-react'
import { useHub, flattenAgents, countStatuses } from '@/lib/agent-hub/store'
import type { AgentNode, AgentStatus } from '@/lib/agent-hub/types'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { StatusDot, TypeChip, agentTypeStyles, statusStyles } from './shared'
import { AgentSessionsPanel } from './agent-sessions'
import { AgentsNetwork } from './agents-network'
import { cn } from '@/lib/utils'

function AgentCard({ agent, depth }: { agent: AgentNode; depth: number }) {
  const selectedAgentId = useHub((s) => s.selectedAgentId)
  const selectAgent = useHub((s) => s.selectAgent)
  const setAgentStatus = useHub((s) => s.setAgentStatus)
  const [open, setOpen] = useState(true)
  const active = selectedAgentId === agent.id
  const type = agentTypeStyles[agent.type]

  return (
    <div className={cn(depth > 0 && 'ml-5 border-l border-border/70 pl-4')}>
      <div
        className={cn(
          'group rounded-lg border bg-card/70 p-3 transition-all hover:bg-card',
          active ? type.ring : 'border-border'
        )}
      >
        <div className="flex items-start gap-3">
          {agent.children.length > 0 ? (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
            </button>
          ) : (
            <span className="mt-2 w-5" />
          )}
          <button className="min-w-0 flex-1 text-left" onClick={() => selectAgent(agent.id)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{agent.name}</span>
              <TypeChip type={agent.type} />
              {agent.status === 'blocked' ? (
                <TriangleAlert className="size-3.5 text-red-600 dark:text-red-400" />
              ) : null}
              <StatusDot status={agent.status} className="ml-auto text-[11px]" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{agent.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {agent.metrics.agents > 1 ? <span>{agent.metrics.agents} agents</span> : null}
              <span>{agent.metrics.worktrees} worktree</span>
              <span className="font-mono text-primary/80">{agent.worktree}</span>
              <div className="flex items-center gap-1.5">
                <Progress value={agent.metrics.completion} className="h-1 w-20" />
                <span className="tabular-nums">{agent.metrics.completion}%</span>
              </div>
            </div>
          </button>
          <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {agent.status === 'running' ? (
              <button
                title="Pause agent"
                onClick={() => setAgentStatus(agent.id, 'paused' as AgentStatus)}
                className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <CirclePause className="size-3.5" />
              </button>
            ) : (
              <button
                title="Run agent"
                onClick={() => setAgentStatus(agent.id, 'running' as AgentStatus)}
                className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <CirclePlay className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {open && agent.children.length > 0 ? (
        <div className="mt-1.5 space-y-1.5">
          {agent.children.map((c) => (
            <AgentCard key={c.id} agent={c} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AgentWorkspaceView() {
  const state = useHub((s) => s.state)
  const selectedAgentId = useHub((s) => s.selectedAgentId)
  const selectAgent = useHub((s) => s.selectAgent)
  const pushAgentChat = useHub((s) => s.pushAgentChat)
  const setAgentStatus = useHub((s) => s.setAgentStatus)
  const [prompt, setPrompt] = useState('')

  const counts = countStatuses(state.agents)
  const flat = flattenAgents(state.agents)
  const selected = flat.find((a) => a.id === selectedAgentId) ?? flat[0]
  const selectedChildren = selected?.children ?? []

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Multi-Agent Workspace</h1>
          <p className="text-xs text-muted-foreground">
            {state.projectName} · {flat.length} agents · {counts.running} running · {counts.blocked} blocked ·
            monorepo
          </p>
        </div>
        <Button size="sm" className="gap-1.5" disabled title="Not available in this build">
          <Plus className="size-3.5" /> Create Agent
        </Button>
      </div>

      {/* status strip */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(counts) as Array<keyof typeof counts>).map((k) => (
          <div
            key={k}
            className="flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1.5 text-xs"
          >
            <span className={cn('size-2 rounded-full', statusStyles[k].dot)} />
            <span className="text-muted-foreground">{statusStyles[k].label}</span>
            <span className="font-semibold tabular-nums">{counts[k]}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        {/* tree */}
        <div className="hub-scroll max-h-[calc(100vh-260px)] space-y-1.5 overflow-y-auto pr-1">
          {state.agents.map((a) => (
            <AgentCard key={a.id} agent={a} depth={0} />
          ))}
        </div>

        {/* detail panel */}
        <div className="space-y-3">
          {selected ? (
            <>
              <div className={cn('rounded-lg border bg-card p-4', agentTypeStyles[selected.type].ring)}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{selected.name}</span>
                  <StatusDot status={selected.status} className="ml-auto text-[11px]" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 flex-1 gap-1 text-xs"
                    onClick={() => setAgentStatus(selected.id, 'running')}
                  >
                    <Play className="size-3" /> Run
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 gap-1 text-xs"
                    onClick={() => setAgentStatus(selected.id, 'paused')}
                  >
                    Pause
                  </Button>
                </div>
              </div>

              {/* owned sessions (1 agent → N sessions) */}
              <AgentSessionsPanel agentId={selected.id} />

              {/* chat */}
              <div className="rounded-lg border bg-card">
                <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
                  <MessageSquare className="size-3.5 text-primary" /> Agent Chat
                </div>
                <div className="hub-scroll max-h-56 space-y-3 overflow-y-auto p-3">
                  {state.agentChat.map((m) => (
                    <div key={m.id} className="text-xs">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-primary">{m.from}</span>
                        <span className="text-[10px] text-muted-foreground">{m.time}</span>
                      </div>
                      <p className="mt-0.5 text-foreground/90">{m.text}</p>
                      {m.files ? (
                        <ul className="mt-1.5 space-y-0.5">
                          {m.files.map((f) => (
                            <li key={f} className="font-mono text-[10px] text-muted-foreground">
                              · {f}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {typeof m.progress === 'number' ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <Progress value={m.progress} className="h-1 flex-1" />
                          <span className="text-[10px] text-muted-foreground">{m.progress}%</span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                <form
                  className="flex items-center gap-1.5 border-t p-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!prompt.trim()) return
                    pushAgentChat(prompt.trim())
                    setPrompt('')
                  }}
                >
                  <input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Ask the agent to continue, modify…"
                    className="h-8 flex-1 rounded-md border border-input bg-secondary/50 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                  />
                  <button
                    type="button"
                    className="cursor-not-allowed rounded p-1.5 text-muted-foreground opacity-50"
                    aria-label="Attach"
                    title="Not available in this build"
                    disabled
                  >
                    <Paperclip className="size-3.5" />
                  </button>
                  <Button type="submit" size="sm" className="h-8 w-8 p-0">
                    <Send className="size-3.5" />
                  </Button>
                </form>
              </div>

              {/* sub-agents */}
              {selectedChildren.length > 0 ? (
                <div className="rounded-lg border bg-card p-3">
                  <div className="text-xs font-medium">Sub-agents</div>
                  <div className="mt-2 space-y-1.5">
                    {selectedChildren.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectAgent(c.id)}
                        className="flex w-full items-center gap-2 rounded-md border bg-secondary/40 px-2.5 py-1.5 text-left text-xs hover:bg-secondary"
                      >
                        <span className={cn('size-1.5 rounded-full', statusStyles[c.status].dot)} />
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="tabular-nums text-muted-foreground">{c.metrics.completion}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* quick actions */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Add Child Agent', icon: Plus, action: null },
                  { label: 'Create Worktree', icon: SquareArrowOutUpRight, action: null },
                  { label: 'View Dependencies', icon: ChevronRight, action: null },
                  {
                    label: 'Pause All',
                    icon: CirclePause,
                    action: () => {
                      flattenAgents(state.agents)
                        .filter((a) => a.status === 'running')
                        .forEach((a) => setAgentStatus(a.id, 'paused'))
                    },
                  },
                ].map((a) => {
                  const Icon = a.icon
                  const unavailable = !a.action
                  return (
                    <button
                      key={a.label}
                      onClick={a.action ?? undefined}
                      disabled={unavailable}
                      title={unavailable ? 'Not available in this build' : undefined}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-2 text-[11px] text-muted-foreground transition-colors',
                        unavailable
                          ? 'cursor-not-allowed opacity-50'
                          : 'hover:bg-secondary hover:text-foreground'
                      )}
                    >
                      <Icon className="size-3.5" /> {a.label}
                    </button>
                  )
                })}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function AgentsView() {
  const [workspaceOpen, setWorkspaceOpen] = useState(false)

  if (!workspaceOpen) return <AgentsNetwork onOpenWorkspace={() => setWorkspaceOpen(true)} />

  return (
    <div className="space-y-4">
      <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(false)}>
        <ChevronRight className="size-3.5 rotate-180" /> Back to network
      </Button>
      <AgentWorkspaceView />
    </div>
  )
}
