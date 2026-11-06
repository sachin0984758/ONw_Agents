'use client'

import { useCallback, useEffect, useState } from 'react'
import { Boxes, Check, Loader2, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { InstalledCapabilityPack } from '@/lib/agent-hub/capabilities/types'
import { ObsidianMemoryPanel } from './obsidian-memory-panel'

const AGENTS = [
  { id: 'website', name: 'Website Builder' },
  { id: 'game', name: 'Game Developer' },
  { id: 'research', name: 'Research Analyst' },
  { id: 'other', name: 'General Task Agent' },
]

async function request(action?: string, extra: Record<string, unknown> = {}) {
  const response = await fetch('/api/capabilities', {
    ...(action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) } : { cache: 'no-store' as RequestCache }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.ok) throw new Error(data?.error || `Capability registry returned HTTP ${response.status}.`)
  return data as { packs: InstalledCapabilityPack[] }
}

export function CapabilitiesView() {
  const [packs, setPacks] = useState<InstalledCapabilityPack[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const refresh = useCallback(async () => { const result = await request(); setPacks(result.packs) }, [])
  useEffect(() => { const reload = () => { void refresh().catch(() => {}) }; window.addEventListener('agenthub-capabilities-refresh', reload); return () => window.removeEventListener('agenthub-capabilities-refresh', reload) }, [refresh])
  useEffect(() => {
    let active = true
    void request().then((result) => { if (active) setPacks(result.packs) }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Could not load capabilities.') })
    return () => { active = false }
  }, [])

  const act = async (key: string, action: string, extra: Record<string, unknown>) => {
    setBusy(key); setError(''); setNotice('')
    try { const result = await request(action, extra); setPacks(result.packs); setNotice('Capability settings saved.'); window.dispatchEvent(new Event('agenthub-memory-refresh')) }
    catch (e) { setError(e instanceof Error ? e.message : 'Capability operation failed.') }
    finally { setBusy('') }
  }

  return <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-3 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">AgentHub · local capability registry</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Capability packs</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Install reusable capability definitions, assign them to compatible agents, and load relevant guidance only when a request needs it.</p></div>
      <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => { void refresh().catch((e) => setError(e instanceof Error ? e.message : 'Could not refresh capabilities.')) }}><RefreshCw size={15} /> Refresh</Button>
    </header>

    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <ShieldAlert className="mt-0.5 shrink-0 text-amber-600" size={18} /><p><strong>Pack assignments route existing resources.</strong> They do not install software, run downloaded code, or grant tools or permissions. File edits, commands, desktop actions and external connections keep their existing approval and access checks.</p>
    </div>

    {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
    <ObsidianMemoryPanel />
    <section className="grid gap-4 md:grid-cols-2" aria-label="Capability pack catalog">
      {packs.map((pack) => <article key={pack.id} className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3"><span className="rounded-xl border bg-muted p-2"><Boxes size={19} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{pack.name}</h2><span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{pack.category}</span></div><p className="mt-1 text-xs text-muted-foreground">{pack.id} · v{pack.version}</p></div><span className={`rounded-full px-2 py-1 text-[11px] ${pack.enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>{pack.enabled ? 'Enabled' : pack.installed ? 'Installed' : 'Available'}</span></div>
        <p className="text-sm leading-6 text-muted-foreground">{pack.description}</p>
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Compatible agents</p><div className="flex flex-wrap gap-2">{AGENTS.filter((agent) => pack.compatibleAgents.includes(agent.id)).map((agent) => {
          const checked = pack.assignedAgents.includes(agent.id)
          return <label key={agent.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${checked ? 'border-primary/40 bg-primary/5' : 'bg-background'} ${!pack.installed || busy === pack.id ? 'cursor-not-allowed opacity-55' : ''}`}>
            <input type="checkbox" checked={checked} disabled={!pack.installed || Boolean(busy)} onChange={(event) => { void act(pack.id, 'assign', { id: pack.id, agentId: agent.id, assigned: event.target.checked }) }} />{agent.name}
          </label>
        })}</div></div>
        <details className="rounded-lg bg-muted/50 px-3 py-2 text-xs"><summary className="cursor-pointer font-medium">Included references and permissions</summary><dl className="mt-3 grid gap-2 text-muted-foreground"><div><dt className="font-medium text-foreground">Capabilities</dt><dd>{pack.capabilities.join(', ') || 'None'}</dd></div><div><dt className="font-medium text-foreground">Existing tools</dt><dd>{pack.tools.join(', ') || 'None'}</dd></div><div><dt className="font-medium text-foreground">Permissions required</dt><dd>{pack.requiredPermissions.join(', ') || 'None declared'}</dd></div><div><dt className="font-medium text-foreground">Resources</dt><dd>{[...pack.skills.map((id) => `Skill: ${id}`), ...pack.components.map((id) => `Component: ${id}`), ...pack.templates.map((id) => `Template: ${id}`)].join(', ') || 'None'}</dd></div></dl></details>
        <div className="mt-auto flex flex-wrap gap-2 border-t pt-4">
          {!pack.installed ? <Button size="sm" disabled={Boolean(busy)} onClick={() => { void act(pack.id, 'install', { id: pack.id }) }}><Check size={15} />Install pack</Button> : <>
            <Button size="sm" variant={pack.enabled ? 'outline' : 'default'} disabled={Boolean(busy)} onClick={() => { void act(pack.id, pack.enabled ? 'disable' : 'enable', { id: pack.id }) }}>{busy === pack.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}{pack.enabled ? 'Disable' : 'Enable'}</Button>
            <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => { void act(pack.id, 'uninstall', { id: pack.id }) }}><Trash2 size={15} />Uninstall</Button>
          </>}
          {pack.healthMessage && <p className="basis-full text-xs text-amber-700 dark:text-amber-300">{pack.healthMessage}</p>}
        </div>
      </article>)}
    </section>
  </main>
}

