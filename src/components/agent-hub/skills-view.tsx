'use client'

// ── Skills Library (inside Sessions) ─────────────────────────────────────────
// Real registry data only: every count, badge and file row comes from
// /api/skills (which reads db/skills.json and reconciles it against
// .agenthub/skills/ on disk). Installing from GitHub is a reviewed flow:
// inspect → show source/commit/licence/warnings → explicit confirm → install.
// Nothing here executes skill content; scripts are inventoried, never run.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  FileText,
  FlaskConical,
  FolderGit2,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  getAgentSessionState,
  subscribeAgentSession,
  type AgentSessionState,
} from '@/lib/agent-hub/agent-session'
import {
  checkAllInstalledSkills,
  checkRepoCompatibility,
  checkSkillCompatibility,
  checkSkillUpdate,
  confirmSkillUpdate,
  inspectSkillRepo,
  loadSkillInstructions,
  setSkillEnabled,
  testSkillWithModel,
  uninstallSkill,
  validateSkillById,
  type SkillInspectResult,
  type SkillUpdateCheck,
} from '@/lib/agent-hub/skills'
import type {
  CapabilitySupport,
  CompatReport,
  CompatStatus,
  FunctionalTestResult,
} from '@/lib/agent-hub/skills-compat'

// ── UI-side shapes (mirror the API payloads) ────────────────────────────────

interface SkillRecordUI {
  id: string
  name: string
  description: string
  category: string
  license: string
  compatibility: string
  metadata: Record<string, string>
  allowedTools: string
  source: {
    kind: 'github' | 'local'
    repoUrl?: string
    owner?: string
    repo?: string
    ref?: string
    subPath?: string
    commit?: string
    dirInRepo?: string
  }
  localPath: string
  enabled: boolean
  trust: 'local' | 'approved' | 'unreviewed'
  validation: {
    status: 'valid' | 'invalid' | 'unvalidated'
    errors: string[]
    warnings: string[]
    suspicious: Array<{ label: string; line: number; excerpt: string }>
    checkedAt: string
  }
  files: Array<{ path: string; size: number }>
  hasScripts: boolean
  hasReferences: boolean
  hasAssets: boolean
  integrity: string
  installedAt: string
  updatedAt: string
}

interface ListPayload {
  ok: boolean
  root?: string
  counts: { installed: number; enabled: number; disabled: number; attention: number }
  skills: SkillRecordUI[]
  trustedSources: string[]
  discovered: string[]
  missing: string[]
  warning?: string
  error?: string
}

type Filter = 'all' | 'enabled' | 'disabled' | 'attention'

const inputClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function shortCommit(c: string | undefined): string {
  return c ? c.slice(0, 12) : ''
}

function repoLabel(rec: SkillRecordUI): string {
  if (rec.source.kind === 'github' && rec.source.repoUrl) {
    return rec.source.repoUrl.replace('https://github.com/', '')
  }
  return 'local'
}

function needsAttention(rec: SkillRecordUI): boolean {
  return rec.validation.status !== 'valid' || rec.validation.suspicious.length > 0 || rec.trust === 'unreviewed'
}

function fileKind(p: string): 'script' | 'reference' | 'asset' | 'other' {
  const top = p.split('/')[0]
  if (top === 'scripts') return 'script'
  if (top === 'references') return 'reference'
  if (top === 'assets') return 'asset'
  return 'other'
}

function Badge({ children, tone = 'muted', title }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'err' | 'muted' | 'info'; title?: string }) {
  const tones: Record<string, string> = {
    ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    err: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
    muted: 'border-border bg-secondary/40 text-muted-foreground',
    info: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  }
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px]', tones[tone])} title={title}>
      {children}
    </span>
  )
}

// ── Compatibility presentation helpers ───────────────────────────────────────

const COMPAT_STATUS_TEXT: Record<CompatStatus, string> = {
  'fully-compatible': 'Fully compatible',
  'partially-compatible': 'Partially compatible',
  incompatible: 'Incompatible',
  'needs-review': 'Needs review',
  'not-verified': 'Not verified',
}

const CAPABILITY_SUPPORT_TEXT: Record<CapabilitySupport, string> = {
  available: 'Available',
  'available-when-permitted': 'Available when permitted',
  'check-required': 'Check required',
  unavailable: 'Unavailable',
}

function statusTone(s: CompatStatus): 'ok' | 'warn' | 'err' | 'muted' | 'info' {
  if (s === 'fully-compatible') return 'ok'
  if (s === 'incompatible') return 'err'
  if (s === 'needs-review') return 'warn'
  if (s === 'not-verified') return 'muted'
  return 'info'
}

function supportTone(s: CapabilitySupport): 'ok' | 'warn' | 'err' | 'muted' | 'info' {
  if (s === 'available') return 'ok'
  if (s === 'available-when-permitted') return 'info'
  if (s === 'check-required') return 'warn'
  return 'err'
}

export function SkillsLibraryPanel({ onClose }: { onClose: () => void }) {
  const [payload, setPayload] = useState<ListPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Install flow
  const [installOpen, setInstallOpen] = useState(false)
  const [repoUrl, setRepoUrl] = useState('')
  const [repoRef, setRepoRef] = useState('')
  const [repoSubPath, setRepoSubPath] = useState('')
  const [inspect, setInspect] = useState<SkillInspectResult | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [installResults, setInstallResults] = useState<Array<{ name: string; ok: boolean; error?: string }> | null>(null)
  const [hintSeen, setHintSeen] = useState('')

  // Detail flow
  const [instructions, setInstructions] = useState<{ ok: boolean; text: string; error?: string } | null>(null)
  const [resource, setResource] = useState<{ path: string; text: string; error?: string } | null>(null)
  const [updateCheck, setUpdateCheck] = useState<SkillUpdateCheck | null>(null)
  const [confirming, setConfirming] = useState<'update' | 'uninstall' | null>(null)

  // Compatibility flow — installed reports keyed by skill id, repo reports by dir.
  const [installedReports, setInstalledReports] = useState<Record<string, CompatReport>>({})
  const [repoReports, setRepoReports] = useState<Record<string, CompatReport>>({})
  const [bulkSummary, setBulkSummary] = useState<Record<string, number> | null>(null)
  const [functional, setFunctional] = useState<{ id: string; result: FunctionalTestResult } | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch('/api/skills?op=list')
      const json = (await res.json().catch(() => null)) as ListPayload | null
      if (!json || json.ok !== true) {
        setLoadError(json?.error ?? `Skills endpoint failed (HTTP ${res.status})`)
        setPayload(null)
      } else {
        setPayload(json)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Skills endpoint unreachable')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Kick the first load off the synchronous effect pass (a sync setState
    // here trips react-hooks/set-state-in-effect).
    const t = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(t)
  }, [refresh])

  // `/skills install <url>` prefills the flow (confirmation still happens here).
  useEffect(() => {
    const applyHint = (s: AgentSessionState) => {
      const hint = s.skillInstallHint
      if (!hint || hint.at === hintSeen) return
      setHintSeen(hint.at)
      setInstallOpen(true)
      setRepoUrl(hint.repo)
      setNotice({
        kind: 'ok',
        text: `Prefilled from /skills install — ${hint.skills.length} skill(s) found at ${shortCommit(hint.commit)}. Press Inspect to reload the review data, then confirm the install.`,
      })
    }
    applyHint(getAgentSessionState())
    return subscribeAgentSession(applyHint)
  }, [hintSeen])

  const skills = useMemo(() => payload?.skills ?? [], [payload?.skills])
  const selected = skills.find((s) => s.id === selectedId) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skills.filter((s) => {
      if (filter === 'enabled' && !s.enabled) return false
      if (filter === 'disabled' && s.enabled) return false
      if (filter === 'attention' && !needsAttention(s)) return false
      if (!q) return true
      const hay = `${s.id} ${s.name} ${s.description} ${s.category} ${repoLabel(s)}`.toLowerCase()
      return hay.includes(q)
    })
  }, [skills, query, filter])

  const runInspect = async () => {
    if (!repoUrl.trim()) {
      setNotice({ kind: 'err', text: 'Enter a GitHub repository URL first.' })
      return
    }
    setBusy('inspect')
    setNotice(null)
    setInstallResults(null)
    setInspect(null)
    const res = await inspectSkillRepo(repoUrl.trim(), repoRef.trim() || undefined, repoSubPath.trim() || undefined)
    setBusy('')
    if (!res.ok) {
      setNotice({ kind: 'err', text: res.error ?? 'Inspection failed.' })
      return
    }
    setInspect(res)
    setPicked(new Set(res.skills.filter((s) => s.valid).map((s) => s.name)))
    if (!res.skills.length) setNotice({ kind: 'err', text: 'No skill (a directory containing SKILL.md) was found at that location.' })
  }

  const runInstall = async () => {
    if (!inspect?.repo) return
    if (!picked.size) {
      setNotice({ kind: 'err', text: 'Select at least one skill to install.' })
      return
    }
    setBusy('install')
    setNotice(null)
    try {
      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'install',
          repo: repoUrl.trim(),
          ref: repoRef.trim() || undefined,
          subPath: repoSubPath.trim() || undefined,
          commit: inspect.repo.commit,
          names: [...picked],
          confirm: true,
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; results?: Array<{ name: string; ok: boolean; error?: string }> } | null
      if (!json) {
        setNotice({ kind: 'err', text: `Install request failed (HTTP ${res.status}).` })
        return
      }
      if (json.error) {
        setNotice({ kind: 'err', text: json.error })
        return
      }
      setInstallResults(json.results ?? [])
      const failures = (json.results ?? []).filter((r) => !r.ok)
      setNotice(
        failures.length
          ? { kind: 'err', text: `${(json.results ?? []).length - failures.length} installed, ${failures.length} failed — see results below.` }
          : { kind: 'ok', text: `Installed ${(json.results ?? []).length} skill(s) from ${inspect.repo.repoUrl} @ ${shortCommit(inspect.repo.commit)}.` },
      )
      await refresh()
      // Re-validate the installed result through the same static pipeline, so the
      // pre-install report can be compared with the post-install one.
      const installedOk = (json.results ?? []).filter((r) => r.ok).map((r) => r.name)
      if (installedOk.length) {
        const fresh: Record<string, CompatReport> = {}
        for (const name of installedOk) {
          const c = await checkSkillCompatibility(name)
          if (c.ok && c.report) fresh[name] = c.report
        }
        if (Object.keys(fresh).length) {
          setInstalledReports((prev) => ({ ...prev, ...fresh }))
          const counts = Object.values(fresh).reduce<Record<string, number>>((acc, r) => {
            acc[r.overall] = (acc[r.overall] ?? 0) + 1
            return acc
          }, {})
          const parts = Object.entries(counts).map(([s, n]) => `${n} ${COMPAT_STATUS_TEXT[s as CompatStatus].toLowerCase()}`)
          const risky = Object.values(fresh).some((r) => r.overall === 'incompatible' || r.overall === 'needs-review')
          setNotice({
            kind: risky ? 'err' : 'ok',
            text: `Installed ${(json.results ?? []).length - failures.length} skill(s) from ${inspect.repo.repoUrl} @ ${shortCommit(inspect.repo.commit)}. Post-install check: ${parts.join(', ')}${risky ? ' — open a skill to review the requirements and adaptation path.' : '.'}`,
          })
        }
      }
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Install request failed.' })
    } finally {
      setBusy('')
    }
  }

  const toggleEnabled = async (rec: SkillRecordUI) => {
    setBusy(`enable:${rec.id}`)
    const res = await setSkillEnabled(rec.id, !rec.enabled)
    setBusy('')
    setNotice(res.ok ? { kind: 'ok', text: `Skill "${rec.id}" ${rec.enabled ? 'disabled' : 'enabled'}.` } : { kind: 'err', text: res.error ?? 'Action failed.' })
    if (res.ok) await refresh()
  }

  const runValidate = async (rec: SkillRecordUI) => {
    setBusy(`validate:${rec.id}`)
    const res = await validateSkillById(rec.id)
    setBusy('')
    if (!res.ok) {
      setNotice({ kind: 'err', text: `Validation failed: ${(res.errors?.length ? res.errors : [res.error ?? 'unknown error']).join(' ')}` })
    } else {
      setNotice({
        kind: res.status === 'valid' ? 'ok' : 'err',
        text: res.status === 'valid' ? `Skill "${rec.id}" is valid${res.warnings?.length ? ` — ${res.warnings.length} warning(s)` : ''}.` : `Skill "${rec.id}": ${(res.errors ?? []).join(' ') || 'invalid'}`,
      })
    }
    await refresh()
  }

  const runCheckUpdate = async (rec: SkillRecordUI) => {
    setBusy(`update:${rec.id}`)
    setConfirming(null)
    const res = await checkSkillUpdate(rec.id)
    setBusy('')
    setUpdateCheck(res)
  }

  const runConfirmUpdate = async (rec: SkillRecordUI) => {
    setBusy(`confirm-update:${rec.id}`)
    const res = await confirmSkillUpdate(rec.id)
    setBusy('')
    setConfirming(null)
    setNotice(res.ok ? { kind: 'ok', text: `Skill "${rec.id}" updated to ${shortCommit(res.commit)} (previous version backed up).` } : { kind: 'err', text: res.error ?? 'Update failed.' })
    setUpdateCheck(null)
    await refresh()
  }

  const runUninstall = async (rec: SkillRecordUI) => {
    setBusy(`uninstall:${rec.id}`)
    const res = await uninstallSkill(rec.id)
    setBusy('')
    setConfirming(null)
    if (!res.ok) {
      setNotice({ kind: 'err', text: res.error ?? 'Removal failed.' })
      return
    }
    setNotice({ kind: 'ok', text: `Skill "${rec.id}" uninstalled (files and registry entry removed).` })
    setSelectedId(null)
    await refresh()
  }

  const runCompatInstalled = async (rec: SkillRecordUI) => {
    setBusy(`compat:${rec.id}`)
    setNotice(null)
    const res = await checkSkillCompatibility(rec.id)
    setBusy('')
    if (!res.ok || !res.report) {
      setNotice({ kind: 'err', text: res.error ?? 'Compatibility check failed.' })
      return
    }
    setInstalledReports((prev) => ({ ...prev, [rec.id]: res.report! }))
    setNotice({
      kind: res.report.overall === 'incompatible' ? 'err' : 'ok',
      text: `Compatibility: ${COMPAT_STATUS_TEXT[res.report.overall]} — ${res.report.capabilities.length} capability requirement(s), ${res.report.scripts.length} script(s).`,
    })
  }

  const runCompatRepo = async (dir: string) => {
    setBusy(`compat-repo:${dir}`)
    setNotice(null)
    const res = await checkRepoCompatibility(repoUrl.trim(), {
      ref: repoRef.trim() || undefined,
      subPath: repoSubPath.trim() || undefined,
      dir,
    })
    setBusy('')
    if (!res.ok || !res.report) {
      setNotice({ kind: 'err', text: res.error ?? 'Compatibility check failed.' })
      return
    }
    setRepoReports((prev) => ({ ...prev, [dir]: res.report! }))
    setNotice({ kind: res.report.overall === 'incompatible' ? 'err' : 'ok', text: `Compatibility: ${COMPAT_STATUS_TEXT[res.report.overall]}.` })
  }

  const runTestSkill = async (rec: SkillRecordUI) => {
    setBusy(`test:${rec.id}`)
    setNotice(null)
    const res = await testSkillWithModel(rec.id)
    setBusy('')
    if (res.functional) setFunctional({ id: rec.id, result: res.functional })
    if (res.report) setInstalledReports((prev) => ({ ...prev, [rec.id]: res.report! }))
    if (res.functional?.status === 'passed') {
      setNotice({
        kind: 'ok',
        text: `Functional test passed on ${res.functional.model?.label ?? res.functional.model?.id ?? 'the local model'} (${Math.round((res.functional.durationMs ?? 0) / 1000)}s).`,
      })
    } else {
      setNotice({ kind: 'err', text: res.functional?.error ?? res.error ?? 'The functional test did not pass.' })
    }
  }

  const runBulkAudit = async () => {
    setBusy('compat-all')
    setNotice(null)
    const res = await checkAllInstalledSkills()
    setBusy('')
    if (!res.ok) {
      setNotice({ kind: 'err', text: res.error ?? 'Bulk audit failed.' })
      return
    }
    const map: Record<string, CompatReport> = {}
    for (const r of res.reports) map[r.id] = r
    setInstalledReports((prev) => ({ ...prev, ...map }))
    setBulkSummary(res.summary ?? null)
    const count = (s: CompatStatus) => res.reports.filter((r) => r.overall === s).length
    setNotice({
      kind: 'ok',
      text: `Audited ${res.reports.length} skill(s): ${count('fully-compatible')} fully compatible, ${count('partially-compatible')} partial, ${count('needs-review')} need review, ${count('incompatible')} incompatible, ${count('not-verified')} not verified.`,
    })
  }

  const openInstructions = async (rec: SkillRecordUI) => {
    if (instructions) {
      setInstructions(null)
      return
    }
    setBusy(`instructions:${rec.id}`)
    const res = await loadSkillInstructions(rec.id)
    setBusy('')
    setInstructions(res.ok ? { ok: true, text: res.instructions } : { ok: false, text: '', error: res.error })
  }

  const openResource = async (rec: SkillRecordUI, path: string) => {
    setBusy(`resource:${path}`)
    try {
      const res = await fetch(`/api/skills?op=read&id=${encodeURIComponent(rec.id)}&path=${encodeURIComponent(path)}`)
      const json = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null
      if (!json || json.ok !== true) {
        setResource({ path, text: '', error: json?.error ?? `Read failed (HTTP ${res.status})` })
      } else {
        setResource({ path, text: json.text ?? '' })
      }
    } catch (err) {
      setResource({ path, text: '', error: err instanceof Error ? err.message : 'Read failed' })
    } finally {
      setBusy('')
    }
  }

  const counts = payload?.counts ?? { installed: 0, enabled: 0, disabled: 0, attention: 0 }

  return (
    <div className="flex min-h-0 max-h-[65%] flex-col overflow-hidden rounded-lg border bg-card" data-slot="skills-panel">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-[13px] font-semibold">Skills Library</span>
        <span className="hidden text-[10px] text-muted-foreground sm:inline">
          {counts.installed} installed · {counts.enabled} enabled · {counts.disabled} disabled
          {counts.attention ? ` · ${counts.attention} need attention` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void refresh()} disabled={loading} title="Reload the registry and reconcile with disk">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void runBulkAudit()}
            disabled={busy === 'compat-all' || !skills.length}
            title="Statically audit every installed skill against the runtime (no model calls)"
          >
            {busy === 'compat-all' ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />} <span className="hidden sm:inline">Check all</span>
          </Button>
          <Button
            size="sm"
            variant={installOpen ? 'default' : 'outline'}
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              setInstallOpen((o) => !o)
              setInstallResults(null)
            }}
            title="Install a skill from a GitHub repository"
          >
            <Download className="size-3.5" /> Install from GitHub
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={onClose} aria-label="Close the Skills Library">
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="hub-scroll min-h-0 flex-1 overflow-y-auto">
        {notice ? (
          <div className={cn('mx-3 mt-2 rounded border px-2 py-1.5 text-[11px]', notice.kind === 'ok' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300')}>
            {notice.text}
          </div>
        ) : null}
        {payload?.warning ? (
          <div className="mx-3 mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mr-1 inline size-3" /> {payload.warning}
          </div>
        ) : null}

        {/* ── Install from GitHub ─────────────────────────────────────────── */}
        {installOpen ? (
          <div className="border-b px-3 py-2.5">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Install from GitHub</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <label className="block">
                <span className="text-[10px] text-muted-foreground">Repository URL</span>
                <input className={inputClass} value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo (or /tree/<ref>/<path>)" aria-label="GitHub repository URL" />
              </label>
              <label className="block">
                <span className="text-[10px] text-muted-foreground">Branch / tag / commit (optional)</span>
                <input className={inputClass} value={repoRef} onChange={(e) => setRepoRef(e.target.value)} placeholder="main / v1.2.0 / sha" aria-label="Git ref" />
              </label>
              <label className="block">
                <span className="text-[10px] text-muted-foreground">Skill path in repo (optional)</span>
                <input className={inputClass} value={repoSubPath} onChange={(e) => setRepoSubPath(e.target.value)} placeholder="skills" aria-label="Skill subpath" />
              </label>
              <div className="flex items-end">
                <Button size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => void runInspect()} disabled={busy === 'inspect'} title="Inspect the repository without downloading anything">
                  {busy === 'inspect' ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />} Inspect
                </Button>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Inspection lists candidate skills without downloading files. Nothing is installed until you review the source and press Install.
            </p>

            {inspect?.repo && inspect.skills.length > 0 ? (
              <div className="mt-2 rounded border">
                <div className="flex flex-wrap items-center gap-2 border-b bg-secondary/30 px-2 py-1.5 text-[11px]">
                  <FolderGit2 className="size-3.5 text-muted-foreground" />
                  <span className="font-mono">{inspect.repo.repoUrl.replace('https://github.com/', '')}</span>
                  <Badge tone="info">{inspect.repo.refUsed}</Badge>
                  <Badge tone="muted" title="Resolved commit — this exact revision will be installed">commit {shortCommit(inspect.repo.commit)}</Badge>
                  {payload?.trustedSources.includes(inspect.repo.repoUrl) ? <Badge tone="ok">source approved before</Badge> : <Badge tone="warn">new source — review carefully</Badge>}
                </div>
                <div className="divide-y">
                  {inspect.skills.map((s) => (
                    <div key={s.dir || '/'} className="px-2 py-1.5">
                      <label className="flex cursor-pointer items-start gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={picked.has(s.name)}
                          disabled={!s.valid}
                          onChange={(e) => {
                            setPicked((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(s.name)
                              else next.delete(s.name)
                              return next
                            })
                          }}
                          aria-label={`Select ${s.name || s.dir}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{s.name || '(unnamed)'}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{s.dir || '/'}</span>
                            {s.valid ? <Badge tone="ok"><Check className="size-2.5" /> valid</Badge> : <Badge tone="err">invalid</Badge>}
                            {s.license ? <Badge tone="muted">{s.license}</Badge> : null}
                            <Badge tone="muted">{s.fileCount} files · {formatBytes(s.totalBytes)}</Badge>
                            {s.hasScripts ? <Badge tone="warn" title="The skill bundles scripts — they are listed, never executed automatically"><ShieldAlert className="size-2.5" /> scripts</Badge> : null}
                            {s.suspicious.length ? <Badge tone="warn" title={s.suspicious.map((h) => `line ${h.line}: ${h.label}`).join('\n')}>{s.suspicious.length} warning(s)</Badge> : null}
                            {repoReports[s.dir] ? <Badge tone={statusTone(repoReports[s.dir].overall)}>{COMPAT_STATUS_TEXT[repoReports[s.dir].overall]}</Badge> : null}
                          </span>
                          <span className="mt-0.5 block text-muted-foreground">{s.description || '(no description)'}</span>
                          {!s.valid && s.errors.length ? <span className="mt-0.5 block text-red-600 dark:text-red-400">{s.errors.join(' ')}</span> : null}
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 gap-1 px-1.5 text-[10px]"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                void runCompatRepo(s.dir)
                              }}
                              disabled={busy === `compat-repo:${s.dir}`}
                              title="Analyse this skill against the real AgentHub runtime without installing or executing anything"
                            >
                              {busy === `compat-repo:${s.dir}` ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3" />} Check compatibility
                            </Button>
                            <span className="text-[10px] text-muted-foreground">Static only — no scripts are run.</span>
                          </span>
                        </span>
                      </label>
                      {repoReports[s.dir] ? <CompatCard report={repoReports[s.dir]} compact /> : null}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 border-t bg-secondary/30 px-2 py-1.5">
                  <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void runInstall()} disabled={busy === 'install' || picked.size === 0} title="Download, validate and register the selected skills">
                    {busy === 'install' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Install {picked.size} skill{picked.size === 1 ? '' : 's'}
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    Installs the exact commit shown above into <span className="font-mono">.agenthub/skills/</span>. Scripts are never run.
                  </span>
                </div>
              </div>
            ) : null}

            {installResults ? (
              <div className="mt-2 rounded border px-2 py-1.5 text-[11px]">
                {installResults.map((r) => (
                  <div key={r.name} className="flex items-start gap-1.5">
                    {r.ok ? <Check className="mt-0.5 size-3 text-emerald-600 dark:text-emerald-400" /> : <X className="mt-0.5 size-3 text-red-600 dark:text-red-400" />}
                    <span>
                      <span className="font-mono">{r.name}</span> — {r.ok ? 'installed and registered' : r.error ?? 'failed'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Search + filters ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className={cn(inputClass, 'pl-7')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills by name, description, category or source…"
              aria-label="Search skills"
            />
          </div>
          {(['all', 'enabled', 'disabled', 'attention'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'default' : 'outline'}
              className="h-7 px-2 text-[11px] capitalize"
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>

        {loading && !payload ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading skills…
          </div>
        ) : loadError ? (
          <div className="px-3 py-6 text-center text-xs">
            <p className="text-red-600 dark:text-red-400">{loadError}</p>
            <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : selected ? (
          <SkillDetail
            rec={selected}
            busy={busy}
            instructions={instructions}
            resource={resource}
            updateCheck={updateCheck}
            confirming={confirming}
            onBack={() => {
              setSelectedId(null)
              setInstructions(null)
              setResource(null)
              setUpdateCheck(null)
              setConfirming(null)
            }}
            onToggleEnabled={() => void toggleEnabled(selected)}
            onValidate={() => void runValidate(selected)}
            onCheckUpdate={() => void runCheckUpdate(selected)}
            onConfirmUpdate={() => void runConfirmUpdate(selected)}
            onUninstall={() => void runUninstall(selected)}
            setConfirming={setConfirming}
            onOpenInstructions={() => void openInstructions(selected)}
            onOpenResource={(p) => void openResource(selected, p)}
            compatReport={installedReports[selected.id] ?? null}
            functional={functional?.id === selected.id ? functional.result : null}
            onCheckCompat={() => void runCompatInstalled(selected)}
            onTestSkill={() => void runTestSkill(selected)}
          />
        ) : !skills.length ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground" data-slot="skills-empty">
            <BookOpen className="mx-auto mb-2 size-6 opacity-40" />
            <p className="font-medium text-foreground">No skills installed</p>
            <p className="mt-1">Install one from GitHub: press “Install from GitHub”, paste a repository URL and inspect it first.</p>
            {payload?.discovered.length ? <p className="mt-1 text-emerald-600 dark:text-emerald-400">Discovered {payload.discovered.join(', ')} directly in the library.</p> : null}
          </div>
        ) : (
          <>
            {bulkSummary ? (
              <div className="flex flex-wrap items-center gap-1.5 border-b bg-secondary/30 px-3 py-1.5 text-[10px] text-muted-foreground" data-slot="skills-bulk-summary">
                <ListChecks className="size-3" />
                <span className="font-medium text-foreground">Bulk audit</span>
                <span>{bulkSummary.total} skill(s)</span>
                {(Object.keys(COMPAT_STATUS_TEXT) as CompatStatus[])
                  .filter((s) => bulkSummary[s] > 0)
                  .map((s) => (
                    <Badge key={s} tone={statusTone(s)}>
                      {bulkSummary[s]} {COMPAT_STATUS_TEXT[s].toLowerCase()}
                    </Badge>
                  ))}
                <button type="button" className="ml-auto underline decoration-dotted hover:text-foreground" onClick={() => setBulkSummary(null)}>
                  dismiss
                </button>
              </div>
            ) : null}
            <div className="divide-y">
            {filtered.map((rec) => (
              <button
                key={rec.id}
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary/40"
                onClick={() => {
                  setSelectedId(rec.id)
                  setInstructions(null)
                  setResource(null)
                  setUpdateCheck(null)
                  setConfirming(null)
                }}
                aria-label={`Open skill ${rec.id}`}
              >
                <span className={cn('mt-1 size-2 shrink-0 rounded-full', rec.enabled && rec.validation.status === 'valid' ? 'bg-emerald-500' : rec.enabled ? 'bg-amber-500' : 'bg-zinc-500')} title={rec.enabled ? 'enabled' : 'disabled'} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium">{rec.id}</span>
                    {rec.validation.status === 'valid' ? <Badge tone="ok">valid</Badge> : rec.validation.status === 'invalid' ? <Badge tone="err">invalid</Badge> : <Badge tone="muted">unvalidated</Badge>}
                    {!rec.enabled ? <Badge tone="muted">disabled</Badge> : null}
                    {rec.trust === 'unreviewed' ? <Badge tone="warn">unreviewed</Badge> : null}
                    {rec.validation.suspicious.length ? <Badge tone="warn" title="Suspicious patterns were flagged during scanning">{rec.validation.suspicious.length} warning(s)</Badge> : null}
                    {rec.hasScripts ? <Badge tone="muted" title="Contains scripts (never executed automatically)">scripts</Badge> : null}
                    {installedReports[rec.id] ? <Badge tone={statusTone(installedReports[rec.id].overall)}>{COMPAT_STATUS_TEXT[installedReports[rec.id].overall]}</Badge> : null}
                    {rec.category ? <Badge tone="info">{rec.category}</Badge> : null}
                    {rec.metadata.version ? <Badge tone="muted">v{rec.metadata.version}</Badge> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{rec.description || rec.name}</span>
                  <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                    {repoLabel(rec)}
                    {rec.source.commit ? ` @ ${shortCommit(rec.source.commit)}` : ''}
                  </span>
                </span>
                {busy === `enable:${rec.id}` ? <Loader2 className="mt-1 size-3.5 animate-spin text-muted-foreground" /> : null}
              </button>
            ))}
            {!filtered.length ? <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">No skill matches the current search/filter.</div> : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Detail view ──────────────────────────────────────────────────────────────

function SkillDetail({
  rec,
  busy,
  instructions,
  resource,
  updateCheck,
  confirming,
  onBack,
  onToggleEnabled,
  onValidate,
  onCheckUpdate,
  onConfirmUpdate,
  onUninstall,
  setConfirming,
  onOpenInstructions,
  onOpenResource,
  compatReport,
  functional,
  onCheckCompat,
  onTestSkill,
}: {
  rec: SkillRecordUI
  busy: string
  instructions: { ok: boolean; text: string; error?: string } | null
  resource: { path: string; text: string; error?: string } | null
  updateCheck: SkillUpdateCheck | null
  confirming: 'update' | 'uninstall' | null
  onBack: () => void
  onToggleEnabled: () => void
  onValidate: () => void
  onCheckUpdate: () => void
  onConfirmUpdate: () => void
  onUninstall: () => void
  setConfirming: (c: 'update' | 'uninstall' | null) => void
  onOpenInstructions: () => void
  onOpenResource: (path: string) => void
  compatReport: CompatReport | null
  functional: FunctionalTestResult | null
  onCheckCompat: () => void
  onTestSkill: () => void
}) {
  const [tab, setTab] = useState<'instructions' | 'files'>('instructions')
  return (
    <div className="px-3 pb-3">
      <div className="flex flex-wrap items-center gap-2 py-2">
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={onBack} aria-label="Back to the skills list">
          <ArrowLeft className="size-3.5" /> Back
        </Button>
        <span className="font-mono text-sm font-semibold">{rec.id}</span>
        {rec.enabled ? <Badge tone="ok"><Check className="size-2.5" /> enabled</Badge> : <Badge tone="muted">disabled</Badge>}
        {rec.validation.status === 'valid' ? <Badge tone="ok">validated</Badge> : rec.validation.status === 'invalid' ? <Badge tone="err">invalid</Badge> : <Badge tone="muted">unvalidated</Badge>}
        {rec.trust === 'unreviewed' ? <Badge tone="warn">unreviewed source</Badge> : null}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5 border-b pb-2">
        <Button size="sm" variant={rec.enabled ? 'outline' : 'default'} className="h-7 px-2 text-xs" onClick={onToggleEnabled} disabled={busy === `enable:${rec.id}`}>
          {busy === `enable:${rec.id}` ? <Loader2 className="size-3.5 animate-spin" /> : null} {rec.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onValidate} disabled={busy === `validate:${rec.id}`} title="Re-scan SKILL.md, files and suspicious patterns">
          {busy === `validate:${rec.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Validate
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onCheckUpdate} disabled={busy === `update:${rec.id}`} title="Check the pinned source for newer commits">
          {busy === `update:${rec.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Check updates
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onCheckCompat}
          disabled={busy === `compat:${rec.id}`}
          title="Compare this skill's required capabilities, dependencies and scripts with the real AgentHub runtime"
        >
          {busy === `compat:${rec.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Check compatibility
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          onClick={onTestSkill}
          disabled={busy === `test:${rec.id}` || rec.validation.status !== 'valid'}
          title="Run a small representative task through the real skill loader and the configured local model"
        >
          {busy === `test:${rec.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />} Test skill
        </Button>
        {confirming === 'uninstall' ? (
          <>
            <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={onUninstall} disabled={busy === `uninstall:${rec.id}`}>
              {busy === `uninstall:${rec.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Confirm uninstall
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-red-600 dark:text-red-400" onClick={() => setConfirming('uninstall')} title="Delete the skill files and registry entry (requires confirmation)">
            <Trash2 className="size-3.5" /> Uninstall
          </Button>
        )}
      </div>

      {/* Update check result */}
      {updateCheck ? (
        <div className="mt-2 rounded border px-2 py-1.5 text-[11px]">
          {!updateCheck.ok ? (
            <span className="text-red-600 dark:text-red-400">{updateCheck.error}</span>
          ) : updateCheck.supported === false || updateCheck.available === false ? (
            <span className="text-muted-foreground">{updateCheck.reason}</span>
          ) : !updateCheck.behind ? (
            <span>Up to date at {shortCommit(updateCheck.installedCommit)}.</span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Update available: {shortCommit(updateCheck.installedCommit)} → <span className="font-mono">{shortCommit(updateCheck.remoteCommit)}</span> (
                {updateCheck.changes?.addedCount ?? 0} added, {updateCheck.changes?.modifiedCount ?? 0} modified, {updateCheck.changes?.removedCount ?? 0} removed)
              </span>
              {confirming === 'update' ? (
                <>
                  <Button size="sm" className="h-6 px-2 text-[11px]" onClick={onConfirmUpdate} disabled={busy === `confirm-update:${rec.id}`}>
                    {busy === `confirm-update:${rec.id}` ? <Loader2 className="size-3 animate-spin" /> : null} Confirm update
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setConfirming('update')}>
                  Update…
                </Button>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* Metadata */}
      <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2">
        <MetaRow label="Description" value={rec.description || '(none)'} />
        <MetaRow label="Category" value={rec.category || '(none)'} />
        <MetaRow label="License" value={rec.license || '(none)'} />
        <MetaRow label="Compatibility" value={rec.compatibility || '(none)'} />
        <MetaRow label="Trust" value={rec.trust === 'approved' ? 'approved after review' : rec.trust === 'local' ? 'local (added by you)' : 'unreviewed — excluded from automatic selection'} />
        <MetaRow label="Local path" value={rec.localPath} mono />
        <MetaRow label="Source" value={rec.source.kind === 'github' ? `${rec.source.repoUrl}${rec.source.dirInRepo ? ` (${rec.source.dirInRepo}/)` : ''}` : 'local'} mono />
        <MetaRow label="Ref / commit" value={rec.source.kind === 'github' ? `${rec.source.ref ?? 'default'} @ ${shortCommit(rec.source.commit)}${rec.source.subPath ? ` · path ${rec.source.subPath}` : ''}` : '—'} mono />
        <MetaRow label="Installed" value={new Date(rec.installedAt).toLocaleString()} />
        <MetaRow label="Last updated" value={new Date(rec.updatedAt).toLocaleString()} />
        <MetaRow label="Integrity" value={rec.integrity} mono />
        <MetaRow
          label="Contents"
          value={`${rec.files.length} file(s)${rec.hasScripts ? ' · scripts (never auto-executed)' : ''}${rec.hasReferences ? ' · references' : ''}${rec.hasAssets ? ' · assets' : ''}`}
        />
        {rec.allowedTools ? <MetaRow label="allowed-tools (advisory)" value={rec.allowedTools} mono /> : null}
        {Object.entries(rec.metadata).filter(([k]) => k !== 'category' && k !== 'version').length ? (
          <MetaRow label="Metadata" value={Object.entries(rec.metadata).filter(([k]) => k !== 'category' && k !== 'version').map(([k, v]) => `${k}=${v}`).join(', ')} />
        ) : null}
      </div>

      {/* Validation detail */}
      {rec.validation.errors.length || rec.validation.warnings.length || rec.validation.suspicious.length ? (
        <div className="mt-2 space-y-1 rounded border px-2 py-1.5 text-[11px]">
          {rec.validation.errors.map((e, i) => (
            <div key={`e${i}`} className="text-red-600 dark:text-red-400">✗ {e}</div>
          ))}
          {rec.validation.warnings.map((w, i) => (
            <div key={`w${i}`} className="text-amber-600 dark:text-amber-400">⚠ {w}</div>
          ))}
          {rec.validation.suspicious.map((h, i) => (
            <div key={`s${i}`} className="text-amber-600 dark:text-amber-400">
              ⚠ possible {h.label} (line {h.line}): <span className="font-mono">{h.excerpt}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Automated scanning is a warning list, not a safety guarantee — review the source before relying on a skill.</p>
        </div>
      ) : null}

      {/* Compatibility report */}
      {compatReport ? <CompatCard report={compatReport} functional={functional} /> : null}

      {/* Instructions / files */}
      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" variant={tab === 'instructions' ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => setTab('instructions')}>
          <FileText className="size-3" /> SKILL.md
        </Button>
        <Button size="sm" variant={tab === 'files' ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => setTab('files')}>
          Files ({rec.files.length})
        </Button>
        <span className="ml-auto text-[10px] text-muted-foreground">Reading a skill never executes its scripts.</span>
      </div>

      {tab === 'instructions' ? (
        <div className="mt-1.5">
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onOpenInstructions} disabled={busy === `instructions:${rec.id}`}>
            {busy === `instructions:${rec.id}` ? <Loader2 className="size-3 animate-spin" /> : null} {instructions ? 'Hide SKILL.md' : 'View SKILL.md'}
          </Button>
          {instructions ? (
            instructions.ok ? (
              <pre className="mt-1.5 max-h-72 overflow-auto rounded border bg-secondary/30 p-2 text-[10px] leading-relaxed whitespace-pre-wrap">{instructions.text}</pre>
            ) : (
              <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{instructions.error}</p>
            )
          ) : null}
        </div>
      ) : (
        <div className="mt-1.5 divide-y rounded border">
          {rec.files.map((f) => {
            const kind = fileKind(f.path)
            const isText = /\.(md|txt|json|ya?ml|toml|ini|cfg|sh|bash|ps1|py|js|mjs|cjs|ts|rb|pl|html|css)$/i.test(f.path)
            return (
              <div key={f.path} className="flex items-center gap-2 px-2 py-1 text-[11px]">
                <span className="min-w-0 flex-1 truncate font-mono" title={f.path}>{f.path}</span>
                <Badge tone={kind === 'script' ? 'warn' : kind === 'other' ? 'muted' : 'info'}>{kind}</Badge>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(f.size)}</span>
                {isText ? (
                  <Button size="sm" variant="ghost" className="h-5 shrink-0 px-1.5 text-[10px]" onClick={() => onOpenResource(f.path)} disabled={busy === `resource:${f.path}`}>
                    {busy === `resource:${f.path}` ? <Loader2 className="size-3 animate-spin" /> : 'View'}
                  </Button>
                ) : null}
              </div>
            )
          })}
          {resource ? (
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">{resource.path}</span>
                <button type="button" className="text-[10px] text-muted-foreground underline" onClick={() => onOpenResource(resource.path)}>
                  close
                </button>
              </div>
              {resource.error ? <p className="text-[11px] text-red-600 dark:text-red-400">{resource.error}</p> : <pre className="mt-1 max-h-56 overflow-auto rounded bg-secondary/30 p-2 text-[10px] whitespace-pre-wrap">{resource.text}</pre>}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className={cn('min-w-0 break-words', mono && 'font-mono text-[10px]')}>{value}</span>
    </div>
  )
}

// ── Compatibility report card ────────────────────────────────────────────────

const DIMENSIONS = ['format', 'metadata', 'tools', 'dependencies', 'security', 'model', 'functional'] as const

function CompatCard({ report, functional, compact = false }: { report: CompatReport; functional?: FunctionalTestResult | null; compact?: boolean }) {
  const fn = functional ?? report.functional
  const hits = [...report.security.instructionHits, ...report.security.scriptHits]
  return (
    <div className="mt-2 rounded border" data-slot="compat-report">
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-secondary/30 px-2 py-1.5">
        <ShieldCheck className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold">Compatibility</span>
        <Badge tone={statusTone(report.overall)}>{COMPAT_STATUS_TEXT[report.overall]}</Badge>
        <span className="text-[10px] text-muted-foreground">
          {report.capabilities.length} capabilities · {report.dependencies.length} dependencies · {report.scripts.length} scripts
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground" title={`Report revision: ${report.revisionKey} · environment ${report.envFingerprint}`}>
          {report.revisionKey.slice(0, 18)}
        </span>
      </div>

      <div className={cn('space-y-2 px-2 py-1.5 text-[11px]', compact && 'max-h-72 overflow-y-auto')}>
        <div className="flex flex-wrap gap-1">
          {DIMENSIONS.map((k) => (
            <Badge key={k} tone={statusTone(report.statuses[k])}>
              {k}: {COMPAT_STATUS_TEXT[report.statuses[k]]}
            </Badge>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
          <MetaRow label="Skill" value={`${report.name} (${report.dirName || '/'})`} />
          <MetaRow
            label="Source"
            value={report.source.repoUrl ? `${report.source.repoUrl.replace('https://github.com/', '')}${report.source.dirInRepo ? ` / ${report.source.dirInRepo}` : ''}` : 'local'}
            mono
          />
          <MetaRow label="Revision" value={report.source.commit ? `${report.source.refUsed ?? 'pinned'} @ ${report.source.commit.slice(0, 12)}` : report.revisionKey.slice(0, 24)} mono />
          <MetaRow label="License" value={report.metadata.license || '(none declared)'} />
        </div>

        {report.metadata.unsupportedFields.length ? (
          <p className="text-amber-700 dark:text-amber-300">
            Unsupported frontmatter kept as display-only extras: <span className="font-mono">{report.metadata.unsupportedFields.join(', ')}</span>
          </p>
        ) : null}
        {report.metadata.missingReferences.length ? (
          <p className="text-amber-700 dark:text-amber-300">Missing referenced files: <span className="font-mono">{report.metadata.missingReferences.join(', ')}</span></p>
        ) : null}

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Required capability → AgentHub support</div>
          {report.capabilities.length === 0 ? (
            <p className="text-muted-foreground">No specific runtime capability was detected in the instructions.</p>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-[10px]">
                <thead className="bg-secondary/30 text-left">
                  <tr>
                    <th className="px-1.5 py-1">Required capability</th>
                    <th className="px-1.5 py-1">AgentHub support</th>
                    <th className="px-1.5 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.capabilities.map((c) => (
                    <tr key={c.id} className="border-t align-top">
                      <td className="px-1.5 py-1">
                        {c.label}
                        {c.tools.length ? <span className="block font-mono text-[9px] text-muted-foreground">{c.tools.join(', ')}</span> : null}
                        {c.evidence.length ? <span className="block text-[9px] text-muted-foreground">detected: {c.evidence[0]}</span> : null}
                      </td>
                      <td className="px-1.5 py-1">{c.detail}</td>
                      <td className="px-1.5 py-1"><Badge tone={supportTone(c.support)}>{CAPABILITY_SUPPORT_TEXT[c.support]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {report.dependencies.length ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dependencies / environment</div>
            <ul className="space-y-0.5">
              {report.dependencies.slice(0, 24).map((d, i) => (
                <li key={`${d.kind}:${d.name}:${i}`} className="flex min-w-0 flex-wrap items-baseline gap-1">
                  <Badge tone={d.available === false ? 'err' : d.available === true ? 'ok' : 'warn'}>{d.kind}</Badge>
                  <span className="font-mono">{d.name}</span>
                  <span className="text-muted-foreground">
                    {d.available === undefined ? 'unverified' : d.available ? 'available' : 'missing'} — {d.note}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {report.scripts.length ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Script inventory (never executed)</div>
            <div className="space-y-0.5">
              {report.scripts.map((s) => (
                <div key={s.path} className="flex flex-wrap items-center gap-1">
                  <span className="font-mono text-[10px]">{s.path}</span>
                  <Badge tone="muted">{s.kind}</Badge>
                  <span className="text-muted-foreground">
                    {s.bytes} B · {s.inspected ? `${s.suspicious.length} warning(s)` : 'content not inspected'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Local-model suitability</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={statusTone(report.modelSuitability.status)}>{COMPAT_STATUS_TEXT[report.modelSuitability.status]}</Badge>
            <span className="text-muted-foreground">{report.modelSuitability.note}</span>
          </div>
          {report.modelSuitability.issues.length ? (
            <ul className="mt-0.5 list-disc pl-4 text-[10px] text-amber-700 dark:text-amber-300">
              {report.modelSuitability.issues.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          ) : null}
        </div>

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Security (static warnings, not a guarantee)</div>
          {hits.length ? (
            <ul className="space-y-0.5">
              {hits.slice(0, 10).map((h, i) => (
                <li key={i} className="text-amber-700 dark:text-amber-300">
                  ⚠ {h.label} (line {h.line}): <span className="font-mono">{h.excerpt}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No suspicious pattern was flagged.</p>
          )}
        </div>

        {report.findings.length ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Findings</div>
            <ul className="space-y-0.5">
              {report.findings.slice(0, 14).map((f, i) => (
                <li key={i} className={f.level === 'error' ? 'text-red-600 dark:text-red-400' : f.level === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>
                  {f.level === 'error' ? '✗' : f.level === 'warning' ? '⚠' : 'ℹ'} {f.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Functional test</span>
            <Badge tone={fn.status === 'passed' ? 'ok' : fn.status === 'failed' ? 'err' : fn.status === 'blocked' ? 'warn' : 'muted'}>{fn.status}</Badge>
            {fn.model ? <span className="text-muted-foreground">model: <span className="font-mono">{fn.model.id}</span></span> : null}
            {fn.durationMs !== undefined ? <span className="text-muted-foreground">{Math.round(fn.durationMs / 1000)}s</span> : null}
          </div>
          {fn.steps.length ? (
            <ul className="space-y-0.5">
              {fn.steps.map((s, i) => (
                <li key={i} className={s.ok ? '' : 'text-red-600 dark:text-red-400'}>
                  {s.ok ? '✓' : '✗'} {s.step} — <span className="text-muted-foreground">{s.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {fn.error ? <p className="text-red-600 dark:text-red-400">{fn.error}</p> : null}
          {fn.outputExcerpt ? (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-secondary/30 p-1.5 text-[10px] whitespace-pre-wrap">
              {fn.outputExcerpt}
              {fn.outputChars && fn.outputChars > fn.outputExcerpt.length ? '\n…' : ''}
            </pre>
          ) : null}
          {fn.limitations.length ? (
            <ul className="mt-0.5 list-disc pl-4 text-[10px] text-muted-foreground">
              {fn.limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          ) : null}
          {fn.status === 'not-run' ? (
            <p className="text-muted-foreground">Run “Test skill” to confirm the supported workflow with the configured model. Without that test the best status is Partially compatible.</p>
          ) : null}
        </div>

        {report.recommendations.length ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recommended adaptations</div>
            <ul className="list-disc pl-4 text-[10px]">
              {report.recommendations.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        ) : null}

        <p className="text-[10px] text-muted-foreground">Static analysis is evidence, not proof. Nothing from this skill was executed during the scan.</p>
      </div>
    </div>
  )
}
