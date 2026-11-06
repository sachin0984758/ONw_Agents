'use client'

import { ArrowRight, Cpu, Inbox, Play, Zap } from 'lucide-react'
import { useHub } from '@/lib/agent-hub/store'
import { ledgerTotals } from '@/lib/agent-hub/token-usage'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Metric } from './shared'
import { SystemConsole } from './system-console'
import { TokenUsageMeter } from './token-meter'
import { PeriodTokenMonitor } from './period-token-monitor'
import { useRuntimeModels } from '@/lib/agent-hub/use-runtime-models'
import { useOverviewUsage } from '@/lib/agent-hub/use-overview-usage'
import { cn } from '@/lib/utils'

export function OverviewView() {
  const ledger = useHub((state) => state.state.tokenUsage)
  const setView = useHub((state) => state.setView)
  const runtime = useRuntimeModels(5000)
  const live = useOverviewUsage()
  const usage = ledgerTotals(ledger)
  const recent = ledger.records.slice(-4).reverse()
  return <div className="space-y-6" data-testid="overview-live">
    <SystemConsole outputTokens={usage.output} inputTokens={usage.input} />
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-52 flex-1"><h1 className="text-xl font-semibold tracking-tight">Command Center</h1><p className="mt-1 text-sm text-muted-foreground">Actual AgentHub model requests, local runtime status, and host hardware.</p></div>
      <span data-testid="usage-live-status" className={cn('rounded-full border px-3 py-1 text-xs', live.status === 'live' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>{live.status === 'live' ? 'Usage · live updates' : live.status === 'paused' ? 'Updates paused while hidden' : live.status === 'error' ? 'Usage connection lost · reconnecting' : 'Connecting usage…'}</span>
      <Button onClick={() => setView('agent-api')} className="gap-2"><Zap className="size-4" />Agent API</Button>
      <Button variant="outline" onClick={() => setView('agents')} className="gap-2"><Play className="size-4" />Open Workspace</Button>
    </div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <div data-testid="overview-calls"><Metric label="Recorded model calls" value={usage.requests} sub="persisted AgentHub requests" /></div>
      <div data-testid="overview-active"><Metric label="Active model requests" value={live.status === 'live' ? live.active.length : '—'} sub={live.active.length ? 'inference in progress' : 'no inference in progress'} accent="text-primary" /></div>
      <div data-testid="overview-output"><Metric label="Output Tokens" value={usage.output.toLocaleString('en-US')} sub={usage.estimated ? `${usage.estimated} calls include labeled estimates` : 'provider-reported model usage'} /></div>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium"><Cpu className="size-4 text-primary" />Runtime</CardTitle><Button variant="ghost" size="sm" onClick={() => setView('models')} className="h-7 gap-1 text-xs">Models<ArrowRight className="size-3" /></Button></CardHeader>
        <CardContent className="space-y-3"><div className="rounded-lg border bg-secondary/40 p-3" data-testid="runtime-model" data-runtime-status={runtime.status}><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><span className={cn('size-2 rounded-full', runtime.loaded.length ? 'bg-emerald-400' : 'bg-muted-foreground/40')} />Loaded local models · checked every 5s while visible</div>{runtime.loaded.length ? <ul className="space-y-1">{runtime.loaded.map((model) => <li key={`${model.providerId}:${model.id}`} className="break-all font-mono text-xs" data-loaded-model={model.id}>{model.id}<span className="ml-1 text-[10px] text-muted-foreground">· {model.providerName}</span></li>)}</ul> : <p data-testid="runtime-model-none" className="text-xs text-muted-foreground">{runtime.status === 'loading' ? 'Checking providers…' : runtime.status === 'offline' ? 'Provider offline — no local provider reachable' : runtime.status === 'unavailable' || runtime.status === 'error' ? 'Provider status unavailable' : 'No model loaded'}</p>}</div>{live.active.length ? <div className="space-y-2" aria-label="Live inference requests">{live.active.map((request) => <div key={request.id} className="rounded-lg border p-3 text-xs"><p className="font-medium">{request.source}</p><p className="mt-1 break-all text-muted-foreground">{request.model}</p></div>)}</div> : null}<p className="text-[11px] leading-5 text-muted-foreground">Final token counts update when the provider reports usage. Requests made directly in LM Studio or another application are not included.</p></CardContent>
      </Card>
      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm font-medium"><Inbox className="size-4 text-primary" />Recent model usage</CardTitle></CardHeader><CardContent>{recent.length ? <ul className="space-y-3">{recent.map((record, index) => <li key={`${record.at}-${index}`} className="border-b pb-3 text-xs last:border-0 last:pb-0"><p className="truncate font-medium" title={record.model}>{record.model || 'Model request'}</p><p className="mt-1 text-muted-foreground">{record.input.toLocaleString('en-US')} input · {record.output.toLocaleString('en-US')} output{record.estimated ? ' · estimated' : ' · provider reported'}</p><time className="mt-1 block text-[10px] text-muted-foreground" dateTime={record.at}>{new Date(record.at).toLocaleString()}</time></li>)}</ul> : <p className="text-xs leading-6 text-muted-foreground">No recorded usage yet. Run a Chat, coding, Auto, Playground, or teaching request to begin tracking.</p>}</CardContent></Card>
    </div>
    <div className="grid gap-4 md:grid-cols-2"><TokenUsageMeter /><PeriodTokenMonitor /></div>
  </div>
}
