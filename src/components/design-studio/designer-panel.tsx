'use client'

// ── Design Studio panel (inside Sessions) ────────────────────────────────────
// Template-driven, plug-and-play customisation. The application (this panel)
// owns the registry, the valid options, the preview rendering, the form state
// and the validation; the local model only ever proposes operations, which are
// validated against the catalog before anything is applied. "Apply Design" hands
// the validated config to the real Sessions execution pipeline.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  type SectionKind,
  type TemplateId,
  getTemplate,
  listTemplates,
  sectionVariantIds,
} from '@/lib/agent-hub/design-catalog'
import {
  CONTENT_KEYS,
  CONTENT_LABELS,
  type ContentKey,
  type DesignConfig,
  type DesignOp,
  applyOp,
  availableMiddleKinds,
  createDefaultConfig,
  describeConfig,
  validateConfig,
} from '@/lib/agent-hub/design-engine'
import {
  applyDesignConfig,
  getAgentSessionState,
  runDesignIntent,
  subscribeAgentSession,
} from '@/lib/agent-hub/agent-session'
import { SiteRenderer, TemplateThumbnail, paletteSwatch } from './site-renderer'
import { HubSelect, HubSelectItem } from '../agent-hub/hub-select'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export function DesignerPanel({ seed = '', onClose }: { seed?: string; onClose: () => void }) {
  const [config, setConfig] = useState<DesignConfig>(() => createDefaultConfig('editorial'))
  const [history, setHistory] = useState<DesignConfig[]>([])
  const [request, setRequest] = useState(seed)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(() => {
    try {
      return getAgentSessionState().isRunning
    } catch {
      return false
    }
  })
  const [notice, setNotice] = useState<string | null>(null)
  const [rejected, setRejected] = useState<Array<{ op: DesignOp; reason: string }>>([])
  const [applyResult, setApplyResult] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = subscribeAgentSession((s) => setRunning(s.isRunning))
    return unsub
  }, [])

  useEffect(() => {
    // Seed a detected design request from the composer, without setState in the
    // effect body (react-hooks/set-state-in-effect).
    if (!seed) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) setRequest(seed)
    })
    return () => {
      cancelled = true
    }
  }, [seed])

  const template = getTemplate(config.templateId)
  const templates = useMemo(() => listTemplates(), [])

  const commit = (next: DesignConfig, label: string) => {
    setHistory((h) => [...h.slice(-40), config])
    setConfig(next)
    setNotice(label)
    setRejected([])
  }

  const runOp = (op: DesignOp) => {
    const r = applyOp(config, op)
    if (r.ok) commit(r.config, `Applied: ${op.op}`)
    else setNotice(`Rejected: ${r.reason}`)
  }

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setConfig(prev)
      setNotice('Undid the last change.')
      return h.slice(0, -1)
    })
  }

  const reset = () => {
    setHistory((h) => [...h.slice(-40), config])
    setConfig(createDefaultConfig(config.templateId))
    setNotice('Reset to the template default.')
    setRejected([])
    setApplyResult(null)
  }

  const parseWithModel = async () => {
    const text = request.trim()
    if (!text || busy) return
    setBusy(true)
    setNotice('Asking the UI/UX Design Agent (local model first)…')
    setRejected([])
    try {
      const res = await runDesignIntent(text, config)
      const next = res.ops.reduce((acc, op) => applyOp(acc, op).config, config)
      if (res.ops.length) {
        setHistory((h) => [...h.slice(-40), config])
        setConfig(next)
      }
      setRejected(res.rejected)
      setNotice(res.reply)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not parse the request.')
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    const invalid = validateConfig(config)
    if (invalid) {
      setNotice(`Cannot apply: ${invalid}`)
      return
    }
    setBusy(true)
    setApplyResult(null)
    setNotice('Running Apply Design through the session pipeline…')
    try {
      const task = await applyDesignConfig(config)
      const files = (task.changedFiles ?? []).map((c) => `${c.status === 'added' ? '+' : '~'} ${c.path}`)
      setApplyResult(
        `${task.status.toUpperCase()} — ${describeConfig(config)}` +
          (files.length ? `\n${files.join('\n')}` : '') +
          (task.result ? `\n\n${task.result}` : ''),
      )
      setNotice(`Apply finished: ${task.status}.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Apply failed.')
    } finally {
      setBusy(false)
    }
  }

  const sectionVariants = (kind: SectionKind) => sectionVariantIds(config.templateId, kind)
  const addableKinds = availableMiddleKinds(config.templateId).filter(
    (k) => !config.sections.some((s) => s.kind === k),
  )

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-semibold">Design Studio</span>
        <span className="rounded-md border bg-secondary/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {describeConfig(config)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={undo} disabled={history.length === 0 || busy}>
            <Undo2 className="size-3.5" /> Undo
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={reset} disabled={busy}>
            <RotateCcw className="size-3.5" /> Reset
          </Button>
          <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={apply} disabled={busy || running}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Apply Design
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onClose} title="Close the Design Studio">
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Left: templates + configuration ── */}
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Template family ({templates.length})
            </div>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((t) => {
                const active = t.id === config.templateId
                const select = () => runOp({ op: 'select-template', templateId: t.id })
                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={select}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        select()
                      }
                    }}
                    className={cn(
                      'cursor-pointer space-y-1 rounded-lg border p-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                      active ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/60',
                    )}
                    title={t.categories.join(' · ')}
                  >
                    <TemplateThumbnail config={createDefaultConfig(t.id)} height={120} />
                    <div className="flex items-center justify-between px-0.5">
                      <span className="text-xs font-medium">{t.name}</span>
                      {active ? <Check className="size-3.5 text-primary" /> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Theme">
              <HubSelect
                ariaLabel="Theme"
                value={config.theme}
                onValueChange={(v) => runOp({ op: 'set-theme', theme: v as DesignConfig['theme'] })}
                className="w-full"
              >
                {template.tokens.themes.map((th) => (
                  <HubSelectItem key={th} value={th}>
                    {th}
                  </HubSelectItem>
                ))}
              </HubSelect>
            </Field>
            <Field label="Typography">
              <HubSelect
                ariaLabel="Typography"
                value={config.typography}
                onValueChange={(v) => runOp({ op: 'set-typography', typography: v as DesignConfig['typography'] })}
                className="w-full"
              >
                {template.tokens.typography.map((ty) => (
                  <HubSelectItem key={ty} value={ty}>
                    {ty}
                  </HubSelectItem>
                ))}
              </HubSelect>
            </Field>
            <Field label="Navbar">
              <HubSelect
                ariaLabel="Navbar variant"
                value={config.navbar}
                onValueChange={(v) => runOp({ op: 'set-navbar', variant: v })}
                className="w-full"
              >
                {template.navbarVariants.map((v) => (
                  <HubSelectItem key={v.id} value={v.id}>
                    {v.label}
                  </HubSelectItem>
                ))}
              </HubSelect>
            </Field>
            <Field label="Hero">
              <HubSelect
                ariaLabel="Hero variant"
                value={config.hero}
                onValueChange={(v) => runOp({ op: 'set-hero', variant: v })}
                className="w-full"
              >
                {template.heroVariants.map((v) => (
                  <HubSelectItem key={v.id} value={v.id}>
                    {v.label}
                  </HubSelectItem>
                ))}
              </HubSelect>
            </Field>
            <Field label="Buttons">
              <HubSelect
                ariaLabel="Button variant"
                value={config.button}
                onValueChange={(v) => runOp({ op: 'set-button', variant: v })}
                className="w-full"
              >
                {template.buttonVariants.map((v) => (
                  <HubSelectItem key={v.id} value={v.id}>
                    {v.label}
                  </HubSelectItem>
                ))}
              </HubSelect>
            </Field>
            <Field label="Cards">
              <HubSelect
                ariaLabel="Card variant"
                value={config.card}
                onValueChange={(v) => runOp({ op: 'set-card', variant: v })}
                className="w-full"
              >
                {template.cardVariants.map((v) => (
                  <HubSelectItem key={v.id} value={v.id}>
                    {v.label}
                  </HubSelectItem>
                ))}
              </HubSelect>
            </Field>
          </div>

          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Palette</div>
            <div className="flex flex-wrap gap-1.5">
              {template.tokens.palettes.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => runOp({ op: 'set-palette', palette: p })}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] capitalize',
                    p === config.palette ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/60',
                  )}
                >
                  <span className="flex">
                    {paletteSwatch(p)
                      .slice(0, 2)
                      .map((c, i) => (
                        <span key={i} className="size-3 rounded-full border border-black/10" style={{ background: c }} />
                      ))}
                  </span>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Sections: add / remove / reorder */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sections ({config.sections.length})
              </span>
              {addableKinds.length > 0 ? (
                <HubSelect
                  ariaLabel="Add section"
                  placeholder="+ Add section…"
                  value=""
                  onValueChange={(kind) => { if (kind) runOp({ op: 'add-section', kind: kind as SectionKind }) }}
                  size="sm"
                >
                  {addableKinds.map((k) => (
                    <HubSelectItem key={k} value={k}>
                      {k}
                    </HubSelectItem>
                  ))}
                </HubSelect>
              ) : null}
            </div>
            <div className="space-y-1">
              {config.sections.map((s, i) => (
                <div key={s.id} className="flex items-center gap-1.5 rounded-md border bg-secondary/20 px-2 py-1">
                  <span className="w-24 shrink-0 text-[11px] font-medium capitalize">{s.kind}</span>
                  <HubSelect
                    ariaLabel={`Variant for ${s.kind}`}
                    value={s.variant}
                    onValueChange={(v) => runOp({ op: 'set-section-variant', sectionId: s.id, variant: v })}
                    size="sm"
                    className="min-w-0 flex-1"
                  >
                    {sectionVariants(s.kind).map((v) => (
                      <HubSelectItem key={v} value={v}>
                        {v}
                      </HubSelectItem>
                    ))}
                  </HubSelect>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={i === 0}
                    onClick={() => runOp({ op: 'move-section', sectionId: s.id, direction: 'up' })}
                    title="Move up"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={i === config.sections.length - 1}
                    onClick={() => runOp({ op: 'move-section', sectionId: s.id, direction: 'down' })}
                    title="Move down"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    onClick={() => runOp({ op: 'remove-section', sectionId: s.id })}
                    title="Remove section"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {config.sections.length === 0 ? (
                <p className="rounded-md border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground">
                  No middle sections. Add one above.
                </p>
              ) : null}
            </div>
          </div>

          {/* Content */}
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Copy</div>
            <div className="grid grid-cols-2 gap-2">
              {CONTENT_KEYS.map((k: ContentKey) => (
                <Field key={k} label={CONTENT_LABELS[k]}>
                  <input
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={config.content[k]}
                    maxLength={240}
                    onChange={(e) => runOp({ op: 'set-content', key: k, value: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: live preview + request + log ── */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between border-b bg-secondary/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Live preview · {templateName(config.templateId)}</span>
              <span className="font-mono normal-case">{config.theme}</span>
            </div>
            <div ref={previewRef} className="max-h-[420px] overflow-auto">
              <SiteRenderer
                config={config}
                onToggleTheme={() => runOp({ op: 'set-theme', theme: config.theme === 'dark' ? 'light' : 'dark' })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Field label="Describe a design change (the UI/UX Design Agent proposes; the app validates)">
              <textarea
                className="min-h-[64px] w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder='e.g. "Use the second template.", "Replace the hero with the split-screen hero.", "Change the theme to light mode.", "Remove the gallery section."'
                value={request}
                onChange={(e) => setRequest(e.target.value)}
              />
            </Field>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={parseWithModel} disabled={busy || !request.trim()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Parse with Design Agent
              </Button>
              <span className="text-[10px] text-muted-foreground">local model first · validated ops only</span>
            </div>
          </div>

          {rejected.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px]">
              <div className="font-medium text-destructive">Rejected (nothing applied):</div>
              <ul className="mt-0.5 list-disc pl-4">
                {rejected.map((r, i) => (
                  <li key={i}>
                    <span className="font-mono">{r.op.op}</span> — {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {notice ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-secondary/30 p-2 font-mono text-[11px]">{notice}</pre>
          ) : null}

          {applyResult ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-[11px]">
              <div className="font-medium">Apply Design result</div>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{applyResult}</pre>
              <a className="mt-1 inline-block text-primary underline" href="/design-studio" target="_blank" rel="noreferrer">
                Open the generated site →
              </a>
            </div>
          ) : null}

          <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
            <Plus className="mt-0.5 size-3 shrink-0" />
            Applying writes only the generated site&apos;s config (a colour-only change touches one file). It runs through the real session pipeline: file-scope lock, approval gate, the UI/UX Design Agent for the write, and the Checker&apos;s verification.
          </p>
        </div>
      </div>
    </div>
  )
}

function templateName(id: TemplateId): string {
  return getTemplate(id).name
}
