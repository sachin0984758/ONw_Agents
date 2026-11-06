'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, FileJson, Plug, RefreshCw, Terminal } from 'lucide-react'
import { useHub } from '@/lib/agent-hub/store'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard?.writeText(text).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="rounded p-1 text-muted-foreground hover:text-foreground"
      aria-label="Copy"
    >
      {copied ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function AgentApiView() {
  const resetState = useHub((s) => s.resetState)
  const [live, setLive] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string>('')

  const fetchLive = async () => {
    setLoading(true)
    setStatus('')
    try {
      const res = await fetch('/api/agent')
      const json = await res.json()
      setLive(JSON.stringify(json.state, null, 2).slice(0, 4000))
      setStatus(`GET /api/agent → 200 OK · ${(JSON.stringify(json.state).length / 1024).toFixed(1)} KB`)
    } catch {
      setStatus('GET failed — is the server running?')
    }
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/agent')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        setLive(JSON.stringify(json.state, null, 2).slice(0, 4000))
        setStatus(
          `GET /api/agent → 200 OK · ${(JSON.stringify(json.state).length / 1024).toFixed(1)} KB`
        )
      })
      .catch(() => {
        if (!cancelled) setStatus('GET failed — is the server running?')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const curlGet = `curl http://localhost:3000/api/agent | jq .state`
  const curlPost = `curl -X POST http://localhost:3000/api/agent \\
  -H "Content-Type: application/json" \\
  -d '{"plan":{"autoRun":false}}'   # any partial HubState`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Plug className="size-5 text-primary" /> Agent API
          </h1>
          <p className="text-xs text-muted-foreground">
            Machine-readable interface — the AI agent on your laptop can read and write this entire dashboard
            through one endpoint.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={fetchLive} disabled={loading}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Test GET
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={resetState}>
          Reset state
        </Button>
      </div>

      {/* endpoints */}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            method: 'GET',
            path: '/api/agent',
            desc: 'Read the full dashboard state (agents, sessions, models, graph, plan, changes, workflow, settings) as JSON.',
            color: 'border-emerald-500/30',
          },
          {
            method: 'POST',
            path: '/api/agent',
            desc: 'Send a full or partial HubState to update the dashboard. Changes render instantly in every view.',
            color: 'border-violet-500/30',
          },
          {
            method: 'DELETE',
            path: '/api/agent',
            desc: 'Reset the persisted state back to the seed demo data.',
            color: 'border-red-500/30',
          },
          {
            method: 'GET',
            path: '/api/chat',
            desc: 'Read the persisted chat history between you and the built-in assistant.',
            color: 'border-emerald-500/30',
          },
          {
            method: 'POST',
            path: '/api/chat',
            desc: 'Send {"message": "…", "settings": {"model": "local-model-id", "systemPrompt": "…"}} → model-powered reply (context: system prompt + the last 20 messages). settings is optional — omit it to use the defaults. The response reports which model actually served the reply.',
            color: 'border-violet-500/30',
          },
          {
            method: 'DELETE',
            path: '/api/chat',
            desc: 'Clear the chat history on this machine.',
            color: 'border-red-500/30',
          },
        ].map((e) => (
          <div key={e.method + e.path} className={cn('rounded-lg border bg-card p-4', e.color)}>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
                  e.method === 'GET'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : e.method === 'POST'
                      ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
                      : 'bg-red-500/15 text-red-600 dark:text-red-400'
                )}
              >
                {e.method}
              </span>
              <span className="font-mono text-xs">{e.path}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{e.desc}</p>
          </div>
        ))}
      </div>

      {/* curl examples */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Terminal className="size-3.5 text-primary" />
            <span className="text-xs font-medium">Read state (agent → dashboard)</span>
            <span className="ml-auto"><CopyBtn text={curlGet} /></span>
          </div>
          <pre className="hub-scroll overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300">
            {curlGet}
          </pre>
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Terminal className="size-3.5 text-primary" />
            <span className="text-xs font-medium">Write state (agent → dashboard)</span>
            <span className="ml-auto"><CopyBtn text={curlPost} /></span>
          </div>
          <pre className="hub-scroll overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-violet-600 dark:text-violet-300">
            {curlPost}
          </pre>
        </div>
      </div>

      {/* live state */}
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <FileJson className="size-3.5 text-primary" />
          <span className="text-xs font-medium">Live state — GET /api/agent</span>
          {status ? (
            <span className={cn('ml-auto text-[10px]', status.includes('200') ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
              {status}
            </span>
          ) : null}
        </div>
        <pre className="hub-scroll max-h-96 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          {live || 'Loading…'}
        </pre>
      </div>

      {/* how the agent uses it */}
      <div className="rounded-lg border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
        <div className="mb-2 text-sm font-medium text-foreground">How your laptop agent uses this hub</div>
        <ol className="list-decimal space-y-1.5 pl-4">
          <li>
            <span className="font-mono text-foreground/90">GET /api/agent</span> — poll current state: which agents
            are running, what step the plan is on, which files changed.
          </li>
          <li>
            <span className="font-mono text-foreground/90">POST /api/agent</span> — update anything: advance plan
            steps, log session events, load a model, mark a task blocked. Every view refreshes instantly.
          </li>
          <li>
            Human and agent share the same source of truth — you watch the dashboard while the agent works, and
            the agent reads what you changed.
          </li>
        </ol>
      </div>
    </div>
  )
}
