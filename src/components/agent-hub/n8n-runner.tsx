'use client'

// ── n8n runtime UI ───────────────────────────────────────────────────────────
// Two self-contained pieces used by the Workflows gallery:
//   <N8nConnectionBar />   live connection status + setup / configuration screen
//   <N8nTemplatePanel />   import · activate · run · real execution results
//
// Everything displayed comes from the n8n API through /api/n8n. Failures are
// shown as failures; there is no fake progress or fabricated output.
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  KeyRound,
  Loader2,
  Play,
  Plug,
  Power,
  RefreshCw,
  ShieldAlert,
  Workflow as WorkflowIcon,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { N8nExecutionRecord, N8nStatus, N8nTriggerInfo, N8nWorkflowLink } from '@/lib/agent-hub/n8n-types'
import type { N8nTemplate } from '@/lib/agent-hub/types'

// ── tiny fetch helpers ───────────────────────────────────────────────────────

interface N8nApiResponse {
  ok: boolean
  error?: { message?: string }
  status?: N8nStatus
  workflow?: WorkflowInfo
  executions?: N8nExecutionRecord[]
  execution?: N8nExecutionRecord
  record?: N8nExecutionRecord
  imported?: boolean
  link?: N8nWorkflowLink
  blockedReason?: string
  message?: string
  executed?: boolean
}

async function apiGet(qs: string): Promise<N8nApiResponse> {
  const res = await fetch(`/api/n8n?${qs}`, { cache: 'no-store' })
  const json = await res.json().catch(() => null) as N8nApiResponse | null
  if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? `Request failed (HTTP ${res.status}).`)
  return json
}

async function apiPost(body: Record<string, unknown>): Promise<N8nApiResponse> {
  const res = await fetch('/api/n8n', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null) as N8nApiResponse | null
  if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? `Request failed (HTTP ${res.status}).`)
  return json
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

const STATE_STYLE: Record<N8nStatus['state'], { dot: string; text: string; label: string }> = {
  connected: { dot: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', label: 'Connected' },
  unauthorized: { dot: 'bg-amber-400', text: 'text-amber-600 dark:text-amber-400', label: 'Auth failed' },
  unreachable: { dot: 'bg-rose-400', text: 'text-rose-600 dark:text-rose-400', label: 'Unreachable' },
  error: { dot: 'bg-rose-400', text: 'text-rose-600 dark:text-rose-400', label: 'Error' },
  not_configured: { dot: 'bg-muted-foreground/60', text: 'text-muted-foreground', label: 'Not configured' },
}

const EXEC_STYLE: Record<string, { text: string; Icon: typeof CheckCircle2 }> = {
  success: { text: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 },
  running: { text: 'text-cyan-600 dark:text-cyan-400', Icon: Loader2 },
  waiting: { text: 'text-amber-600 dark:text-amber-400', Icon: Clock },
  queued: { text: 'text-amber-600 dark:text-amber-400', Icon: Clock },
  error: { text: 'text-rose-600 dark:text-rose-400', Icon: XCircle },
  canceled: { text: 'text-muted-foreground', Icon: XCircle },
  blocked: { text: 'text-amber-600 dark:text-amber-400', Icon: ShieldAlert },
  unknown: { text: 'text-muted-foreground', Icon: Clock },
}

const fmtTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { hour12: false })
}
const fmtDuration = (ms: number | null) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`)

// ── Connection bar ───────────────────────────────────────────────────────────

export function N8nConnectionBar() {
  const [status, setStatus] = useState<N8nStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ baseUrl: '', apiKey: '', webhookBaseUrl: '', timeoutMs: '' })
  const [formMsg, setFormMsg] = useState<string | null>(null)

  const applyStatus = useCallback((next: N8nStatus) => {
    setStatus(next)
    setForm((f) => ({ ...f, baseUrl: f.baseUrl || next.config.baseUrl, webhookBaseUrl: f.webhookBaseUrl || next.config.webhookBaseUrl }))
  }, [])

  useEffect(() => {
    let alive = true
    apiGet('resource=status')
      .then((j) => alive && j.status && applyStatus(j.status))
      .catch((e) => alive && setError(msgOf(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [applyStatus])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const j = await apiPost({ action: 'test' })
      if (!j.status) throw new Error('The n8n status response was incomplete.')
      applyStatus(j.status)
    } catch (e) {
      setError(msgOf(e))
    } finally {
      setLoading(false)
    }
  }, [applyStatus])

  const save = useCallback(async () => {
    setSaving(true)
    setFormMsg(null)
    try {
      const j = await apiPost({
        action: 'config',
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        webhookBaseUrl: form.webhookBaseUrl,
        timeoutMs: form.timeoutMs ? Number(form.timeoutMs) : undefined,
      })
      if (!j.status) throw new Error('The n8n status response was incomplete.')
      applyStatus(j.status)
      setForm((f) => ({ ...f, apiKey: '' }))
      setFormMsg(j.status.state === 'connected' ? 'Saved and connected.' : j.status.message)
    } catch (e) {
      setFormMsg(msgOf(e))
    } finally {
      setSaving(false)
    }
  }, [form, applyStatus])

  const clear = useCallback(async () => {
    setSaving(true)
    setFormMsg(null)
    try {
      const res = await fetch('/api/n8n', { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
      applyStatus(json.status)
      setFormMsg('Stored configuration cleared.')
    } catch (e) {
      setFormMsg(msgOf(e))
    } finally {
      setSaving(false)
    }
  }, [applyStatus])

  const style = STATE_STYLE[status?.state ?? 'not_configured']

  return (
    <div className="rounded-lg border bg-card/60">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <span className="flex items-center gap-2 text-xs font-medium">
          <Plug className="size-3.5 text-muted-foreground" />
          n8n runtime
        </span>
        <span className={cn('flex items-center gap-1.5 text-[11px]', style.text)}>
          {loading ? <Loader2 className="size-3 animate-spin" /> : <span className={cn('size-1.5 rounded-full', style.dot)} />}
          {style.label}
          {status?.version ? <span className="text-muted-foreground">· n8n {status.version}</span> : null}
          {status?.state === 'connected' && status.workflowCount != null ? (
            <span className="text-muted-foreground">· {status.workflowCount} workflow(s) visible</span>
          ) : null}
        </span>
        <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted-foreground sm:block">{error ?? status?.message}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2.5 text-[11px]" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn('size-3', loading && 'animate-spin')} /> Test
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2.5 text-[11px]" onClick={() => setOpen((v) => !v)}>
            <KeyRound className="size-3" /> {open ? 'Hide setup' : 'Connection setup'}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="space-y-3 border-t p-3.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Point AgentHub at a running n8n instance. Credentials are stored server-side only (
            <code className="rounded bg-secondary px-1">db/n8n-config.json</code>) and are never sent to the browser. You can also set{' '}
            <code className="rounded bg-secondary px-1">N8N_BASE_URL</code> and <code className="rounded bg-secondary px-1">N8N_API_KEY</code> in the
            environment (env vars take precedence). Create an API key in n8n under <span className="text-foreground/90">Settings → n8n API</span>.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px]">
              <span className="text-muted-foreground">Base URL</span>
              <input
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                placeholder="http://localhost:5678"
                className="mt-1 h-8 w-full rounded-md border border-input bg-secondary/50 px-2 text-xs outline-none focus:border-ring"
              />
            </label>
            <label className="text-[11px]">
              <span className="text-muted-foreground">API key {status?.config.hasApiKey ? '(set — leave blank to keep)' : ''}</span>
              <input
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                type="password"
                autoComplete="off"
                placeholder={status?.config.hasApiKey ? '••••••••' : 'n8n_api_…'}
                className="mt-1 h-8 w-full rounded-md border border-input bg-secondary/50 px-2 text-xs outline-none focus:border-ring"
              />
            </label>
            <label className="text-[11px]">
              <span className="text-muted-foreground">Webhook base URL (optional)</span>
              <input
                value={form.webhookBaseUrl}
                onChange={(e) => setForm((f) => ({ ...f, webhookBaseUrl: e.target.value }))}
                placeholder="defaults to base URL"
                className="mt-1 h-8 w-full rounded-md border border-input bg-secondary/50 px-2 text-xs outline-none focus:border-ring"
              />
            </label>
            <label className="text-[11px]">
              <span className="text-muted-foreground">Timeout (ms)</span>
              <input
                value={form.timeoutMs}
                onChange={(e) => setForm((f) => ({ ...f, timeoutMs: e.target.value }))}
                inputMode="numeric"
                placeholder={String(status?.config.timeoutMs ?? 15000)}
                className="mt-1 h-8 w-full rounded-md border border-input bg-secondary/50 px-2 text-xs outline-none focus:border-ring"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-7 gap-1.5 px-2.5 text-[11px]" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />} Save & test
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2.5 text-[11px]" onClick={clear} disabled={saving}>
              Clear stored config
            </Button>
            {formMsg ? <span className="text-[11px] text-muted-foreground">{formMsg}</span> : null}
          </div>

          <details className="rounded-md border bg-secondary/30 p-2.5 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground/90">Running n8n locally (setup guide)</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4 leading-relaxed">
              <li>
                Start n8n: <code className="rounded bg-secondary px-1">npx n8n</code> (defaults to http://localhost:5678).
              </li>
              <li>
                In n8n, open <span className="text-foreground/90">Settings → n8n API</span>, create an API key and copy it.
              </li>
              <li>Paste the base URL and API key above, then Save & test.</li>
              <li>
                Import a template from the gallery below, configure any required credentials in n8n, activate it, and run it.
              </li>
            </ol>
            <p className="mt-2">
              Recommended env vars: <code className="rounded bg-secondary px-1">N8N_BASE_URL</code>,{' '}
              <code className="rounded bg-secondary px-1">N8N_API_KEY</code>, optional{' '}
              <code className="rounded bg-secondary px-1">N8N_WEBHOOK_BASE_URL</code>,{' '}
              <code className="rounded bg-secondary px-1">N8N_TIMEOUT_MS</code>,{' '}
              <code className="rounded bg-secondary px-1">N8N_ALLOWED_HOSTS</code>.
            </p>
          </details>
        </div>
      ) : null}
    </div>
  )
}

// ── Per-template actions + execution panel ───────────────────────────────────

interface WorkflowInfo {
  templateId: string
  name: string
  trigger: N8nTriggerInfo
  requiredCredentials: string[]
  imported: boolean
  link: N8nWorkflowLink | null
  deepLink: string | null
  connected: boolean
}

function ExecutionRow({ record }: { record: N8nExecutionRecord }) {
  const style = EXEC_STYLE[record.status] ?? EXEC_STYLE.unknown
  const { Icon } = style
  return (
    <div className="rounded-md border bg-secondary/30 p-2.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn('flex items-center gap-1 font-medium capitalize', style.text)}>
          <Icon className={cn('size-3', record.status === 'running' && 'animate-spin')} /> {record.status}
        </span>
        <span className="text-muted-foreground">mode {record.mode ?? '—'}</span>
        {record.n8nExecutionId ? <span className="text-muted-foreground">exec #{record.n8nExecutionId}</span> : null}
        {record.httpStatus != null ? <span className="text-muted-foreground">HTTP {record.httpStatus}</span> : null}
        <span className="ml-auto text-muted-foreground">{fmtTime(record.startedAt)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>duration {fmtDuration(record.n8nDurationMs ?? record.requestDurationMs)}</span>
        {record.finishedAt ? <span>finished {fmtTime(record.finishedAt)}</span> : null}
      </div>
      {record.error ? (
        <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 p-1.5 leading-relaxed text-amber-700 dark:text-amber-300">
          {record.error}
        </div>
      ) : null}
      {record.resultPreview ? (
        <pre className="hub-scroll mt-1.5 max-h-32 overflow-auto rounded border bg-background/60 p-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {record.resultPreview}
        </pre>
      ) : null}
    </div>
  )
}

export function N8nTemplatePanel({ template }: { template: N8nTemplate }) {
  const [info, setInfo] = useState<WorkflowInfo | null>(null)
  const [history, setHistory] = useState<N8nExecutionRecord[]>([])
  const [latest, setLatest] = useState<N8nExecutionRecord | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmCreds, setConfirmCreds] = useState(false)

  const load = useCallback(async () => {
    try {
      const [wf, ex] = await Promise.all([
        apiGet(`resource=workflow&templateId=${encodeURIComponent(template.id)}`),
        apiGet(`resource=executions&templateId=${encodeURIComponent(template.id)}`),
      ])
      if (!wf.workflow || !ex.executions) throw new Error('The workflow response was incomplete.')
      setInfo(wf.workflow)
      setHistory(ex.executions)
      setLatest(ex.executions[0] ?? null)
      setError(null)
    } catch (e) {
      setError(msgOf(e))
    }
  }, [template.id])

  useEffect(() => {
    let alive = true
    Promise.all([
      apiGet(`resource=workflow&templateId=${encodeURIComponent(template.id)}`),
      apiGet(`resource=executions&templateId=${encodeURIComponent(template.id)}`),
    ])
      .then(([wf, ex]) => {
        if (!alive) return
        if (!wf.workflow || !ex.executions) throw new Error('The workflow response was incomplete.')
        setInfo(wf.workflow)
        setHistory(ex.executions)
        setLatest(ex.executions[0] ?? null)
      })
      .catch((e) => alive && setError(msgOf(e)))
    return () => {
      alive = false
    }
  }, [template.id])

  // Poll a running execution until n8n reports a terminal status.
  useEffect(() => {
    if (!latest || (latest.status !== 'running' && latest.status !== 'waiting' && latest.status !== 'queued')) return
    const id = latest.id
    const timer = setInterval(async () => {
      try {
        const j = await apiGet(`resource=execution&id=${encodeURIComponent(id)}`)
        const rec = j.execution
        if (!rec) throw new Error('The execution response was incomplete.')
        setLatest(rec)
        setHistory((h) => h.map((r) => (r.id === rec.id ? rec : r)))
        if (rec.status !== 'running' && rec.status !== 'waiting' && rec.status !== 'queued') clearInterval(timer)
      } catch {
        clearInterval(timer)
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [latest])

  const run = useCallback(
    async (label: string, body: Record<string, unknown>) => {
      setBusy(label)
      setError(null)
      setNotice(null)
      try {
        const j = await apiPost(body)
        if (j.record) {
          const record = j.record
          setLatest(record)
          setHistory((h) => [record, ...h.filter((r) => r.id !== record.id)])
        }
        if (j.status) setInfo((i) => (i ? { ...i, imported: j.imported ?? i.imported, link: j.link ?? i.link, connected: j.status!.state === 'connected' } : i))
        const link = j.link
        if (link) setInfo((i) => (i ? { ...i, imported: true, link } : i))
        if (j.blockedReason) setNotice(j.message ?? 'This workflow cannot be run from here.')
        else if (j.executed === true) setNotice('Workflow run finished — see the execution record below.')
        else if (j.executed === false) setNotice(j.message ?? 'The run did not succeed. See the execution record below.')
        return j
      } catch (e) {
        setError(msgOf(e))
        return null
      } finally {
        setBusy(null)
      }
    },
    []
  )

  const link = info?.link ?? null
  const trigger = info?.trigger
  const canActivate = trigger && (trigger.kind === 'webhook' || trigger.kind === 'form' || trigger.kind === 'schedule' || trigger.kind === 'event')
  const runnable = !!trigger?.runnableOnDemand && !!link?.activated
  const needsCreds = (info?.requiredCredentials.length ?? 0) > 0 && !confirmCreds

  return (
    <div className="rounded-lg border bg-secondary/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium">
          <WorkflowIcon className="size-3.5 text-muted-foreground" /> n8n
        </span>
        {info ? (
          link ? (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3" /> Imported · id {link.n8nWorkflowId}
              {link.activated ? <span className="text-cyan-600 dark:text-cyan-400">· active</span> : <span className="text-muted-foreground">· inactive</span>}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">Not imported</span>
          )
        ) : (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        )}
        {trigger ? <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{trigger.kind} trigger</span> : null}
        {trigger?.webhookPath ? <span className="font-mono text-[10px] text-muted-foreground">/{trigger.webhookPath}</span> : null}
        <div className="ml-auto flex items-center gap-1.5">
          {info?.deepLink ? (
            <Button asChild size="sm" variant="ghost" className="h-7 gap-1.5 px-2.5 text-[11px]">
              <a href={info.deepLink} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3" /> Open in n8n
              </a>
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2.5 text-[11px]" onClick={load} disabled={!!busy}>
            <RefreshCw className={cn('size-3', busy === 'refresh' && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      {trigger ? <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{trigger.note}</p> : null}

      {info && info.requiredCredentials.length > 0 ? (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3" /> Requires credentials: {info.requiredCredentials.join(', ')}
          </div>
          <label className="mt-1.5 flex items-center gap-1.5">
            <input type="checkbox" checked={confirmCreds} onChange={(e) => setConfirmCreds(e.target.checked)} className="size-3" />
            I have configured these credentials in n8n
          </label>
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {!link ? (
          <Button
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-[11px]"
            onClick={() => run('import', { action: 'import', templateId: template.id })}
            disabled={!!busy}
          >
            {busy === 'import' ? <Loader2 className="size-3 animate-spin" /> : <Plug className="size-3" />} Import to n8n
          </Button>
        ) : null}

        {link && canActivate ? (
          <Button
            size="sm"
            variant={link.activated ? 'ghost' : 'outline'}
            className="h-7 gap-1.5 px-2.5 text-[11px]"
            onClick={() => run(link.activated ? 'deactivate' : 'activate', { action: link.activated ? 'deactivate' : 'activate', templateId: template.id })}
            disabled={!!busy}
          >
            {busy === 'activate' || busy === 'deactivate' ? <Loader2 className="size-3 animate-spin" /> : <Power className="size-3" />}
            {link.activated ? 'Deactivate' : 'Activate'}
          </Button>
        ) : null}

        {link && runnable ? (
          <Button
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-[11px]"
            onClick={() => run('execute', { action: 'execute', templateId: template.id, confirmCredentials: confirmCreds })}
            disabled={!!busy || needsCreds}
            title={needsCreds ? 'Confirm the required credentials first' : 'Run this workflow now'}
          >
            {busy === 'execute' ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />} Run Workflow
          </Button>
        ) : null}

        {link && trigger && !runnable && trigger.kind === 'manual' ? (
          <span className="text-[11px] text-muted-foreground">Open in n8n to run this manual workflow.</span>
        ) : null}
      </div>

      {notice ? <p className="mt-2 text-[11px] text-muted-foreground">{notice}</p> : null}
      {error ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
          <XCircle className="size-3" /> {error}
        </p>
      ) : null}

      {latest ? (
        <div className="mt-2.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Latest execution</div>
          <ExecutionRow record={latest} />
        </div>
      ) : null}

      {history.length > 1 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">Execution history ({history.length})</summary>
          <div className="mt-1.5 space-y-1.5">
            {history.slice(1, 8).map((r) => (
              <ExecutionRow key={r.id} record={r} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
