'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { harness2Status } from '@/lib/agent-hub/harness2'

type Status = Awaited<ReturnType<typeof harness2Status>>
export function AgentOptimization() {
  const [status, setStatus] = useState<Status>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/agent-optimization', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => { const data = await response.json(); if (!data.ok) throw new Error(data.error); setStatus(data.status) })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [])
  async function act(action: string) {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/agent-optimization', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, approved: action === 'test' }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error)
      setStatus(data.status)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed.') }
    finally { setBusy(false) }
  }
  return <section className="rounded-lg border bg-card p-4 space-y-3" aria-label="Agent Optimization">
    <h2 className="text-sm font-medium">Agent Optimization · Harness²</h2>
    <p className="text-xs text-muted-foreground">Experimental integration with the official Google Research framework. Optimization is disabled.</p>
    {status ? <>
      <p className="text-xs">Official source {status.sourceInstalled ? 'installed' : 'unavailable'} · {status.revision.slice(0, 12)}</p>
      {status.blockers.map((blocker) => <p key={blocker} className="text-xs text-amber-400">{blocker}</p>)}
      <ul className="text-xs">{status.adapters.map((adapter) => <li key={adapter.name}>{adapter.name} · {adapter.state}</li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled title="AgentHub adapter and verified improvements are required">Enable optimization</Button>
        <Button size="sm" variant="outline" disabled={busy || status.blockers.length > 0} onClick={() => void act('test')}>Test official demo in isolation</Button>
        <Button size="sm" variant="outline" disabled title="No verified improvements are available">Approve improvement</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act('disable')}>Disable</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act('rollback')}>Roll back optimization</Button>
      </div>
      {status.demo ? <details><summary className="text-xs">Last official demo result</summary><pre className="overflow-auto text-xs">{JSON.stringify(status.demo, null, 2)}</pre></details> : null}
    </> : <p className="text-xs">Checking official integration…</p>}
    {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
  </section>
}
