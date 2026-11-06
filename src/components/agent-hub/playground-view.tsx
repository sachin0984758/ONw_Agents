'use client'

// ── Playground view ──────────────────────────────────────────────────────────
// A dedicated multi-language AI practice space. The LOCAL model analyses the
// user's code / queries / formulas and NEVER executes anything: there is no
// run button, no compiler, no interpreter, no database and no spreadsheet
// engine anywhere in this feature. Predictions are labelled AI estimates.
//
// The editor and guidance stay visible in a resizable split workspace.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  AlertTriangle,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  FolderOpen,
  Lightbulb,
  ListChecks,
  Loader2,
  Map,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Table2,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { syncUsage } from '@/lib/agent-hub/usage-sync'
import { PRACTICE_LEVELS } from '@/lib/agent-hub/playground-types'
import type {
  ExcelSheet,
  FeedbackEntry,
  PlaygroundModelOption,
  PracticeLevel,
  PracticeSession,
} from '@/lib/agent-hub/playground-types'
import {
  PLAYGROUND_ACTIONS,
  actionsForMode,
  languagesByGroup,
  playgroundLanguage,
  SQL_DIALECTS,
} from '@/lib/agent-hub/playground-languages'
import type { PlaygroundActionSpec, SqlDialectId } from '@/lib/agent-hub/playground-languages'
import type { RoadmapGraph, RoadmapSummary } from '@/lib/agent-hub/roadmap-library'
import {
  SAMPLE_WORKBOOKS,
  SQL_SAMPLE_SCHEMA,
  firstStarter,
  schemaDdlText,
  schemaTableDump,
  sheetDump,
  starterById,
  workbookById,
} from '@/lib/agent-hub/playground-starters'
import { InteractiveBackground } from './playground/interactive-background'
import { CodeEditor } from './playground/code-editor'
import type { CodeEditorHandle } from './playground/code-editor'
import { ExcelGrid } from './playground/excel-grid'
import { FeedbackPanel } from './playground/feedback-panel'
import { RoadmapTutorPanel } from './playground/roadmap-tutor-panel'
import type { RoadmapTutorMessage } from './playground/roadmap-tutor-panel'
import { extractCodeSuggestion, extractFormulaSuggestion } from './playground/playground-extract'
import { isStaleResult, prependFeedback } from '@/lib/agent-hub/playground-feedback'
import { SplitDivider } from './playground/split-divider'
import {
  getResponseShare,
  getServerResponseShare,
  isSideBySideWidth,
  saveResponseShare,
  setResponseShare,
  splitGridTemplate,
  subscribeResponseShare,
} from './playground/split-layout'
import { HubSelect, HubSelectGroup, HubSelectItem, HubSelectLabel } from './hub-select'

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function cloneSheet(sheet: ExcelSheet): ExcelSheet {
  return { ...sheet, cells: { ...sheet.cells } }
}

function emptySheet(name = 'Sheet'): ExcelSheet {
  return { name, columns: 12, rows: 30, cells: {} }
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  explain: <Eye className="size-3.5" />,
  review: <ListChecks className="size-3.5" />,
  'find-bugs': <Bug className="size-3.5" />,
  hint: <Lightbulb className="size-3.5" />,
  improve: <Wand2 className="size-3.5" />,
  roadmap: <ListChecks className="size-3.5" />,
  'predict-output': <Sparkles className="size-3.5" />,
  'predict-result': <Sparkles className="size-3.5" />,
  'explain-formula': <Eye className="size-3.5" />,
  'find-errors': <AlertTriangle className="size-3.5" />,
  'suggest-correction': <Wand2 className="size-3.5" />,
  'explain-dataset': <Table2 className="size-3.5" />,
  'generate-questions': <ListChecks className="size-3.5" />,
}

type PendingConfirm =
  | { kind: 'language'; languageId: string }
  | { kind: 'workbook'; workbookId: string }
  | { kind: 'reset' }
  | { kind: 'new' }
  | { kind: 'delete'; sessionId: string; name: string }

export function PlaygroundView() {
  const initialStarter = useMemo(() => firstStarter('python'), [])

  const [languageId, setLanguageId] = useState('python')
  const [level, setLevel] = useState<PracticeLevel>('beginner')
  const [problemStatement, setProblemStatement] = useState(initialStarter?.problem ?? '')
  const [code, setCode] = useState(initialStarter?.code ?? '')
  const [sheet, setSheet] = useState<ExcelSheet | null>(null)
  const [selectedCell, setSelectedCell] = useState('A1')
  const [sqlDialect, setSqlDialect] = useState<SqlDialectId>('sqlite')
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [modelId, setModelId] = useState('')
  const [models, setModels] = useState<PlaygroundModelOption[]>([])
  const [roadmaps, setRoadmaps] = useState<RoadmapSummary[]>([])
  const [roadmapSlug, setRoadmapSlug] = useState('')
  const [roadmapConversationSlug, setRoadmapConversationSlug] = useState('')
  const [roadmapEnabled, setRoadmapEnabled] = useState(false)
  const [roadmapCurrentTopicId, setRoadmapCurrentTopicId] = useState('')
  const [roadmapCurrentTopicLabel, setRoadmapCurrentTopicLabel] = useState('')
  const [roadmapCompletedTopics, setRoadmapCompletedTopics] = useState<Record<string, string[]>>({})
  const [roadmapVisualGraph, setRoadmapVisualGraph] = useState<RoadmapGraph | null>(null)
  const [roadmapVisualLoading, setRoadmapVisualLoading] = useState(false)
  const [sessions, setSessions] = useState<PracticeSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState('')
  const [currentSessionId, setCurrentSessionId] = useState(() => newId())
  const [createdAt, setCreatedAt] = useState(() => new Date().toISOString())
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([])
  const [activeFeedbackId, setActiveFeedbackId] = useState<string | null>(null)
  const [roadmapOpen, setRoadmapOpen] = useState(false)
  const [roadmapConversation, setRoadmapConversation] = useState<RoadmapTutorMessage[]>([])
  const [busyActionId, setBusyActionId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  // The normal background is the default on every visit.
  const [interactiveBackground, setInteractiveBackground] = useState(false)
  // Adjustable split: the AI-response share of the two-pane space, persisted
  // per browser. It lives in an external store (not React state) so drag
  // frames, keyboard steps and the persisted value share one source of truth,
  // the first (server) render stays deterministic, and hydration re-reads the
  // real value without a style mismatch.
  const splitShare = useSyncExternalStore(subscribeResponseShare, getResponseShare, getServerResponseShare)
  const [dividerDragging, setDividerDragging] = useState(false)
  // The sidebar is a fixed cost, so viewport media queries lie about how much
  // room the Playground really has — measure the workspace itself instead.
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
  const workspaceRef = useRef<HTMLDivElement | null>(null)

  // Keep tracking the measured workspace width (ResizeObserver — not window
  // width) for the layout mode decision.
  useEffect(() => {
    const el = workspaceRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) setWorkspaceWidth(Math.round(entry.contentRect.width))
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [starterId, setStarterId] = useState(initialStarter?.id ?? '')
  const [starterCode, setStarterCode] = useState(initialStarter?.code ?? '')
  const [starterSheet, setStarterSheet] = useState<ExcelSheet | null>(null)

  const editorRef = useRef<CodeEditorHandle | null>(null)
  const gridUndoRef = useRef<Array<{ addr: string; prev: string; next: string }>>([])
  const [gridUndoCount, setGridUndoCount] = useState(0)
  // Monotonic request id + abort handle: a newer analysis supersedes an older
  // one, so a stale response can never overwrite the latest result.
  const requestSeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const lang = useMemo(() => playgroundLanguage(languageId), [languageId])
  const mode = lang.mode
  const actions = useMemo(() => actionsForMode(mode), [mode])
  const busySpec = useMemo(
    () => (busyActionId ? (PLAYGROUND_ACTIONS.find((a) => a.id === busyActionId) ?? null) : null),
    [busyActionId],
  )

  const sqlSchemaText = useMemo(() => {
    const dumps = SQL_SAMPLE_SCHEMA.tables.map((t) => `-- ${t.name}\n${schemaTableDump(t)}`).join('\n\n')
    return `${SQL_SAMPLE_SCHEMA.note}\n\n${schemaDdlText()}\n\n${dumps}`
  }, [])

  // ── Initial load (deferred so the effect never setStates synchronously) ────
  const refresh = useCallback(async () => {
    try {
      const [sessionsRes, modelsRes, roadmapsRes] = await Promise.all([
        fetch('/api/playground?resource=sessions').then((r) => r.json()),
        fetch('/api/playground?resource=models').then((r) => r.json()),
        fetch('/api/playground?resource=roadmaps').then((r) => r.json()),
      ])
      if (sessionsRes?.ok && Array.isArray(sessionsRes.sessions)) {
        setSessions(sessionsRes.sessions as PracticeSession[])
        if (typeof sessionsRes.warning === 'string') setNotice({ kind: 'error', text: sessionsRes.warning })
      }
      if (modelsRes?.ok && Array.isArray(modelsRes.models)) {
        setModels(modelsRes.models as PlaygroundModelOption[])
      }
      if (roadmapsRes?.ok && Array.isArray(roadmapsRes.roadmaps)) {
        setRoadmaps(roadmapsRes.roadmaps as RoadmapSummary[])
      }
    } catch {
      setNotice({ kind: 'error', text: 'Could not load playground sessions. Saving will retry.' })
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh()
    }, 0)
    return () => clearTimeout(timer)
  }, [refresh])

  // ── Workspace configuration ────────────────────────────────────────────────
  // Abort any in-flight analysis and invalidate its result before the workspace
  // changes underneath it, so a late response cannot be applied to new content.
  function cancelInFlight() {
    requestSeqRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setBusyActionId(null)
  }

  function applyLanguage(nextId: string) {
    cancelInFlight()
    setRoadmapOpen(false)
    setRoadmapConversation([])
    setRoadmapConversationSlug('')
    setRoadmapCurrentTopicId('')
    setRoadmapCurrentTopicLabel('')
    setRoadmapCompletedTopics({})
    setRoadmapVisualGraph(null)
    const nextLang = playgroundLanguage(nextId)
    const starter = firstStarter(nextId)
    setLanguageId(nextId)
    setLevel('beginner')
    setFeedback([])
    setActiveFeedbackId(null)
    setRoadmapCompletedTopics({})
    setActiveSessionId(null)
    setCurrentSessionId(newId())
    setCreatedAt(new Date().toISOString())
    setSessionName('')
    gridUndoRef.current = []
    setGridUndoCount(0)
    if (nextLang.mode === 'excel') {
      const workbook = SAMPLE_WORKBOOKS[0]
      setSheet(cloneSheet(workbook.sheet))
      setStarterSheet(cloneSheet(workbook.sheet))
      setStarterId(workbook.id)
      setStarterCode('')
      setProblemStatement(workbook.problem)
      setSelectedCell('A1')
      setCode('')
    } else {
      setSheet(null)
      setStarterSheet(null)
      setStarterId(starter?.id ?? '')
      setStarterCode(starter?.code ?? '')
      setProblemStatement(starter?.problem ?? '')
      setCode(starter?.code ?? '')
      editorRef.current?.setValue(starter?.code ?? '', { history: false })
    }
    setDirty(false)
  }

  function requestLanguage(nextId: string) {
    if (nextId === languageId) return
    if (dirty) {
      setPendingConfirm({ kind: 'language', languageId: nextId })
      return
    }
    applyLanguage(nextId)
  }

  function applyWorkbook(id: string) {
    const workbook = workbookById(id)
    if (!workbook) return
    cancelInFlight()
    setSheet(cloneSheet(workbook.sheet))
    setStarterSheet(cloneSheet(workbook.sheet))
    setStarterId(workbook.id)
    setProblemStatement(workbook.problem)
    setSelectedCell('A1')
    setFeedback([])
    setActiveFeedbackId(null)
    setActiveSessionId(null)
    setCurrentSessionId(newId())
    setCreatedAt(new Date().toISOString())
    setSessionName('')
    gridUndoRef.current = []
    setGridUndoCount(0)
    setDirty(false)
  }

  function requestWorkbook(id: string) {
    if (id === starterId) return
    if (dirty) {
      setPendingConfirm({ kind: 'workbook', workbookId: id })
      return
    }
    applyWorkbook(id)
  }

  function resetToStarter() {
    cancelInFlight()
    if (mode === 'excel') {
      const workbook = workbookById(starterId) ?? SAMPLE_WORKBOOKS[0]
      setSheet(cloneSheet(workbook.sheet))
      setProblemStatement(workbook.problem)
      setSelectedCell('A1')
    } else {
      setCode(starterCode)
      editorRef.current?.setValue(starterCode, { history: false })
      const starter = starterById(starterId)
      if (starter) setProblemStatement(starter.problem)
    }
    gridUndoRef.current = []
    setGridUndoCount(0)
    setFeedback([])
    setActiveFeedbackId(null)
    setDirty(true)
    setNotice({ kind: 'ok', text: 'Reset to the starter content.' })
  }

  function startNewPractice() {
    applyLanguage(languageId)
    setFeedback([])
    setNotice(null)
  }

  function requestNew() {
    if (dirty) {
      setPendingConfirm({ kind: 'new' })
      return
    }
    startNewPractice()
  }

  function confirmPending() {
    if (!pendingConfirm) return
    const pending = pendingConfirm
    setPendingConfirm(null)
    if (pending.kind === 'language') applyLanguage(pending.languageId)
    else if (pending.kind === 'workbook') applyWorkbook(pending.workbookId)
    else if (pending.kind === 'reset') resetToStarter()
    else if (pending.kind === 'new') startNewPractice()
    else if (pending.kind === 'delete') void deleteSession(pending.sessionId, pending.name)
  }

  function confirmText(pending: PendingConfirm): string {
    switch (pending.kind) {
      case 'language':
        return `Switch to ${playgroundLanguage(pending.languageId).label}? Current editor content will be replaced by its starter.`
      case 'workbook':
        return `Load "${workbookById(pending.workbookId)?.label ?? 'workbook'}"? The current sheet will be replaced.`
      case 'reset':
        return 'Reset to the starter content? Current edits will be replaced (saved sessions are not affected).'
      case 'new':
        return 'Start a new practice? Unsaved changes will be replaced.'
      case 'delete':
        return `Delete "${pending.name}"? This removes the saved practice.`
    }
  }

  // ── Session persistence ────────────────────────────────────────────────────
  async function saveSession() {
    if (saving) return
    setSaving(true)
    setNotice(null)
    const name = sessionName.trim() || `${lang.label} practice`
    const session: PracticeSession = {
      id: currentSessionId,
      name,
      mode,
      languageId,
      level,
      problemStatement,
      code: mode === 'excel' ? '' : code,
      sheet: mode === 'excel' && sheet ? sheet : null,
      modelPreference: modelId,
      starterId,
      starterCode: mode === 'excel' ? '' : starterCode,
      starterSheet: mode === 'excel' ? starterSheet : null,
      feedback,
      ...((roadmapConversation.length || Object.keys(roadmapCompletedTopics).length) ? {
        roadmapProgress: {
          selectedSlug: roadmapSlug,
          conversationSlug: roadmapConversationSlug,
          currentTopicId: roadmapCurrentTopicId,
          currentTopicLabel: roadmapCurrentTopicLabel,
          completedTopics: roadmapCompletedTopics,
          conversation: roadmapConversation,
        },
      } : {}),
      createdAt,
      updatedAt: new Date().toISOString(),
    }
    try {
      const res = await fetch('/api/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', session }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok || !json.session) {
        setNotice({ kind: 'error', text: json?.error ?? 'Could not save the practice.' })
        return
      }
      const saved = json.session as PracticeSession
      setSessions((list) => [saved, ...list.filter((s) => s.id !== saved.id)])
      setActiveSessionId(saved.id)
      setSessionName(saved.name)
      setDirty(false)
      setNotice({ kind: 'ok', text: `Saved "${saved.name}".` })
    } catch {
      setNotice({ kind: 'error', text: 'Could not reach the playground API. Your work is unchanged.' })
    } finally {
      setSaving(false)
    }
  }

  function loadSession(session: PracticeSession) {
    cancelInFlight()
    const roadmapProgress = session.roadmapProgress
    const hasRoadmapProgress = Boolean(roadmapProgress?.conversation.length)
    setRoadmapConversation(roadmapProgress?.conversation ?? [])
    setRoadmapSlug(roadmapProgress?.selectedSlug ?? '')
    setRoadmapConversationSlug(roadmapProgress?.conversationSlug ?? '')
    setRoadmapCurrentTopicId(roadmapProgress?.currentTopicId ?? '')
    setRoadmapCurrentTopicLabel(roadmapProgress?.currentTopicLabel ?? '')
    setRoadmapCompletedTopics(roadmapProgress?.completedTopics ?? {})
    setRoadmapEnabled(hasRoadmapProgress)
    setRoadmapOpen(hasRoadmapProgress)
    setRoadmapVisualGraph(null)
    const sessionLang = playgroundLanguage(session.languageId)
    setLanguageId(session.languageId)
    setLevel(session.level)
    setProblemStatement(session.problemStatement)
    setModelId(session.modelPreference)
    setStarterId(session.starterId)
    setStarterCode(session.starterCode)
    setStarterSheet(session.starterSheet ? cloneSheet(session.starterSheet) : null)
    setFeedback(session.feedback)
    setActiveFeedbackId(session.feedback[0]?.id ?? null)
    gridUndoRef.current = []
    setGridUndoCount(0)
    if (sessionLang.mode === 'excel') {
      setSheet(session.sheet ? cloneSheet(session.sheet) : emptySheet())
      setSelectedCell('A1')
      setCode('')
    } else {
      setSheet(null)
      setCode(session.code)
      editorRef.current?.setValue(session.code, { history: false })
    }
    setCurrentSessionId(session.id)
    setCreatedAt(session.createdAt)
    setActiveSessionId(session.id)
    setSessionName(session.name)
    setDirty(false)
    setSessionsOpen(false)
    setRenamingId(null)
    setNotice({ kind: 'ok', text: `Loaded "${session.name}".` })
  }

  async function deleteSession(id: string, name: string) {
    try {
      const res = await fetch('/api/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setNotice({ kind: 'error', text: json?.error ?? 'Could not delete the practice.' })
        return
      }
      setSessions((list) => list.filter((s) => s.id !== id))
      if (activeSessionId === id) setActiveSessionId(null)
      if (renamingId === id) setRenamingId(null)
      setNotice({ kind: 'ok', text: `Deleted "${name}".` })
    } catch {
      setNotice({ kind: 'error', text: 'Could not reach the playground API. Nothing was deleted.' })
    }
  }

  async function renameSession(id: string, name: string) {
    const clean = name.trim()
    if (!clean) return
    try {
      const res = await fetch('/api/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', id, name: clean }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok || !json.session) {
        setNotice({ kind: 'error', text: json?.error ?? 'Could not rename the practice.' })
        return
      }
      const renamed = json.session as PracticeSession
      setSessions((list) => list.map((s) => (s.id === id ? renamed : s)))
      if (activeSessionId === id) setSessionName(renamed.name)
      setRenamingId(null)
    } catch {
      setNotice({ kind: 'error', text: 'Could not reach the playground API. The name is unchanged.' })
    }
  }

  // ── Analysis ───────────────────────────────────────────────────────────────
  // One action → one current result. Each call gets a monotonic sequence id and
  // aborts the previous fetch, so a newer action always supersedes an older one
  // and a late/stale response can never be shown as the latest result.
  async function runAction(
    spec: PlaygroundActionSpec,
    roadmapTurn?: { history: RoadmapTutorMessage[]; reply: string; slug?: string },
  ) {
    if (spec.id === 'roadmap' && !roadmapEnabled) {
      setNotice({ kind: 'error', text: 'Turn Roadmap on before starting or continuing a roadmap lesson.' })
      return
    }
    if (spec.id === 'roadmap') setRoadmapOpen(true)
    else setRoadmapOpen(false)
    if (spec.id === 'roadmap') setRoadmapVisualGraph(null)
    if (spec.id !== 'roadmap' && mode !== 'excel' && !code.trim()) {
      setNotice({ kind: 'error', text: 'Write some code first — there is nothing to analyse yet.' })
      return
    }
    const seq = requestSeqRef.current + 1
    requestSeqRef.current = seq
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setBusyActionId(spec.id)
    setNotice(null)
    const payload: Record<string, unknown> = {
      action: 'analyze',
      mode,
      languageId,
      actionId: spec.id,
      level,
      problemStatement,
      model: modelId,
      ...(spec.id === 'roadmap' ? {
        roadmapEnabled: true,
        ...((roadmapTurn?.slug ?? roadmapConversationSlug ?? roadmapSlug) ? { roadmapSlug: roadmapTurn?.slug ?? roadmapConversationSlug ?? roadmapSlug } : {}),
        roadmapHistory: roadmapTurn?.history ?? [],
        roadmapReply: roadmapTurn?.reply ?? '',
        roadmapCurrentTopicId,
      } : {}),
    }
    if (mode === 'excel') {
      payload.sheetDump = sheet ? sheetDump(sheet) : ''
      payload.selectionAddress = selectedCell
      payload.selectionValue = sheet?.cells[selectedCell] ?? ''
    } else {
      payload.code = code
      if (mode === 'sql') {
        payload.sqlDialect = sqlDialect
        payload.schemaText = sqlSchemaText
      }
    }
    // Adopt a completed result only if this request is still the newest one.
    const adopt = (entry: FeedbackEntry) => {
      if (isStaleResult(seq, requestSeqRef.current)) return
      setFeedback((list) => prependFeedback(list, entry))
      setActiveFeedbackId(entry.id)
    }
    try {
      const res = await fetch('/api/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const json = await res.json().catch(() => null)
      if (seq !== requestSeqRef.current) return
      if (!res.ok || !json?.ok) {
        const entry: FeedbackEntry = {
          id: newId(),
          actionId: spec.id,
          actionLabel: spec.label,
          at: new Date().toISOString(),
          status: 'error',
          text: json?.error ?? 'The analysis request failed. Nothing was generated.',
          estimated: Boolean(spec.estimated),
        }
        adopt(entry)
        if (spec.id === 'roadmap') setRoadmapConversation((turns) => [...turns, { role: 'assistant', content: entry.text }])
        return
      }
      if (spec.id === 'roadmap') {
        if (typeof json.roadmapSlug === 'string') setRoadmapConversationSlug(json.roadmapSlug)
        if (typeof json.roadmapTopicId === 'string') setRoadmapCurrentTopicId(json.roadmapTopicId)
        if (typeof json.roadmapTopicLabel === 'string') setRoadmapCurrentTopicLabel(json.roadmapTopicLabel)
      }
      const text = String(json.text ?? '')
      if (spec.id === 'roadmap') setDirty(true)
      if (json.tokenUsage) {
        // Server recorded the call; apply the returned ledger for an immediate,
        // accurate Overview reading.
        syncUsage(json.tokenUsage)
      }
      let suggestion: string | undefined
      let suggestionKind: 'code' | 'formula' | undefined
      if (spec.suggests) {
        if (mode === 'excel') {
          const formula = extractFormulaSuggestion(text)
          if (formula) {
            suggestion = formula
            suggestionKind = 'formula'
          }
        } else {
          const replacement = extractCodeSuggestion(text)
          if (replacement) {
            suggestion = replacement
            suggestionKind = 'code'
          }
        }
      }
      const entry: FeedbackEntry = {
        id: newId(),
        actionId: spec.id,
        actionLabel: spec.label,
        at: new Date().toISOString(),
        status: 'ok',
        text,
        model: typeof json.model === 'string' ? json.model : undefined,
        estimated: json.estimated === true || Boolean(spec.estimated),
        suggestion,
        suggestionKind,
      }
      adopt(entry)
      if (spec.id === 'roadmap') setRoadmapConversation((turns) => [...turns, { role: 'assistant', content: text }])
    } catch (err) {
      // A superseded/aborted request must not surface an error for the new one.
      if (seq !== requestSeqRef.current) return
      if ((err as { name?: string } | null)?.name === 'AbortError') return
      const entry: FeedbackEntry = {
        id: newId(),
        actionId: spec.id,
        actionLabel: spec.label,
        at: new Date().toISOString(),
        status: 'error',
        text: 'Could not reach the playground API. Your work is preserved — try again.',
        estimated: Boolean(spec.estimated),
      }
      adopt(entry)
      if (spec.id === 'roadmap') setRoadmapConversation((turns) => [...turns, { role: 'assistant', content: entry.text }])
    } finally {
      if (seq === requestSeqRef.current) setBusyActionId(null)
    }
  }

  const roadmapAction = PLAYGROUND_ACTIONS.find((action) => action.id === 'roadmap')

  function startRoadmap(restart = false) {
    if (!roadmapAction || !roadmapEnabled) return
    if (!restart && roadmapConversation.length > 0 && roadmapCurrentTopicId) {
      setRoadmapOpen(true)
      setRoadmapVisualGraph(null)
      return
    }
    setRoadmapConversation([])
    setDirty(true)
    setRoadmapConversationSlug(roadmapSlug)
    setRoadmapCurrentTopicId('')
    setRoadmapCurrentTopicLabel('')
    setRoadmapVisualGraph(null)
    setRoadmapOpen(true)
    void runAction(roadmapAction, { history: [], reply: '', slug: roadmapSlug })
  }

  function replyToRoadmap(reply: string) {
    if (!roadmapEnabled || !roadmapAction || !reply.trim() || busyActionId === 'roadmap') return
    const history = roadmapConversation
    setRoadmapConversation([...history, { role: 'user', content: reply.trim() }])
    setDirty(true)
    void runAction(roadmapAction, { history, reply: reply.trim(), slug: roadmapConversationSlug || roadmapSlug })
  }

  async function completeAndVisualizeRoadmapTopic() {
    if (!roadmapEnabled || !roadmapCurrentTopicId || !roadmapConversationSlug || roadmapVisualLoading) return
    setRoadmapVisualLoading(true)
    try {
      const params = new URLSearchParams({ resource: 'roadmap', slug: roadmapConversationSlug, enabled: 'true' })
      const response = await fetch(`/api/playground?${params.toString()}`)
      const json = await response.json().catch(() => null)
      if (!response.ok || json?.ok !== true || !json.roadmap) {
        setNotice({ kind: 'error', text: json?.error ?? 'The roadmap visual could not be loaded.' })
        return
      }
      const graph = json.roadmap as RoadmapGraph
      setRoadmapVisualGraph(graph)
      setRoadmapCompletedTopics((previous) => ({
        ...previous,
        [graph.slug]: [...new Set([...(previous[graph.slug] ?? []), roadmapCurrentTopicId])],
      }))
      setDirty(true)
      setNotice(null)
    } catch {
      setNotice({ kind: 'error', text: 'Could not load the roadmap visual. Your lesson is still saved in this session.' })
    } finally {
      setRoadmapVisualLoading(false)
    }
  }

  function toggleRoadmap() {
    if (roadmapEnabled) {
      cancelInFlight()
      setRoadmapEnabled(false)
      setRoadmapOpen(false)
      setRoadmapVisualGraph(null)
      return
    }
    setRoadmapEnabled(true)
  }

  function continueRoadmap() {
    setRoadmapVisualGraph(null)
    replyToRoadmap('Continue to the next topic.')
  }

  function applySuggestion(entry: FeedbackEntry) {
    if (!entry.suggestion) return
    if (entry.suggestionKind === 'formula') {
      const addr = selectedCell
      const prev = sheet?.cells[addr] ?? ''
      draftCell(addr, entry.suggestion)
      commitCell(addr, prev, entry.suggestion)
      setNotice({ kind: 'ok', text: `Formula applied to ${addr} — Undo (or Ctrl+Z) reverts it.` })
    } else {
      setCode(entry.suggestion)
      editorRef.current?.setValue(entry.suggestion, { history: true })
      setDirty(true)
      setNotice({ kind: 'ok', text: 'Suggestion applied to the editor — Undo (Ctrl+Z) reverts it.' })
    }
    setFeedback((list) => list.map((e) => (e.id === entry.id ? { ...e, applied: true } : e)))
  }

  // ── Excel grid state ───────────────────────────────────────────────────────
  function draftCell(addr: string, value: string) {
    setSheet((current) => {
      if (!current) return current
      const cells = { ...current.cells }
      if (value === '') delete cells[addr]
      else cells[addr] = value
      return { ...current, cells }
    })
    setDirty(true)
  }

  function commitCell(addr: string, prev: string, next: string) {
    gridUndoRef.current.push({ addr, prev, next })
    if (gridUndoRef.current.length > 50) gridUndoRef.current.shift()
    setGridUndoCount(gridUndoRef.current.length)
    setDirty(true)
  }

  function undoCell() {
    const step = gridUndoRef.current.pop()
    if (!step) return
    setSheet((current) => {
      if (!current) return current
      const cells = { ...current.cells }
      if (step.prev === '') delete cells[step.addr]
      else cells[step.addr] = step.prev
      return { ...current, cells }
    })
    setGridUndoCount(gridUndoRef.current.length)
    setDirty(true)
    setNotice({ kind: 'ok', text: `Reverted ${step.addr}.` })
  }

  // Side-by-side split applies only when the WORKSPACE is measured wide
  // enough; narrower canvases (laptop split windows, tablets, mobile) stack.
  const sideBySide = isSideBySideWidth(workspaceWidth)
  const noProvider = !loadingSessions && models.length === 0
  const workbookOptions = SAMPLE_WORKBOOKS
  const activeWorkbookId = mode === 'excel' && workbookById(starterId) ? starterId : SAMPLE_WORKBOOKS[0].id

  return (
    <InteractiveBackground enabled={interactiveBackground}>
      <div className="relative flex h-full min-h-0 flex-col gap-2.5" data-testid="playground-view">
        {/* ── Toolbar (region A) ── */}
        <div className="flex flex-wrap items-center gap-2" data-testid="playground-toolbar">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <h1 className="text-sm font-semibold">Playground</h1>
          <Button variant="outline" size="sm" aria-pressed={interactiveBackground} onClick={() => setInteractiveBackground((enabled) => !enabled)}>
            <Sparkles className="size-3.5" />
            Background: {interactiveBackground ? 'Interactive' : 'Normal'}
          </Button>
          <span className="hidden rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground sm:inline">
            AI practice · no code execution
          </span>
          <input
            value={sessionName}
            onChange={(e) => {
              setSessionName(e.target.value)
              setDirty(true)
            }}
            placeholder={`${lang.label} practice`}
            aria-label="Practice name"
            data-testid="session-name"
            className="h-8 w-40 rounded-md border border-input bg-secondary/50 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring sm:w-48"
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {noProvider ? (
              <span
                className="hidden items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300 md:flex"
                data-testid="provider-offline-chip"
                title="Start LM Studio or Ollama (or add a custom model) to get AI feedback. Everything else keeps working."
              >
                No local provider detected — feedback unavailable
              </span>
            ) : null}
            <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={requestNew} data-testid="new-button">
              <Plus className="size-3.5" />
              New
            </Button>
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => setSessionsOpen((open) => !open)}
                data-testid="sessions-button"
              >
                <FolderOpen className="size-3.5" />
                Sessions
                {sessions.length > 0 ? (
                  <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{sessions.length}</span>
                ) : null}
                <ChevronDown className="size-3.5" />
              </Button>
              {sessionsOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => {
                      setSessionsOpen(false)
                      setRenamingId(null)
                    }}
                  />
                  <div
                    className="absolute right-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-md border bg-popover shadow-lg"
                    data-testid="sessions-menu"
                  >
                    <div className="hub-scroll max-h-80 overflow-y-auto p-1">
                      {loadingSessions ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>
                      ) : sessions.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground">
                          No saved practices yet. Use Save under the editor to keep one.
                        </div>
                      ) : (
                        sessions.map((s) => (
                          <div
                            key={s.id}
                            className={cn(
                              'flex items-center gap-1 rounded px-2 py-1.5',
                              activeSessionId === s.id && 'bg-secondary/70',
                            )}
                          >
                            {renamingId === s.id ? (
                              <>
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void renameSession(s.id, renameValue)
                                    if (e.key === 'Escape') setRenamingId(null)
                                  }}
                                  aria-label="New practice name"
                                  data-testid="rename-input"
                                  className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none"
                                />
                                <button
                                  className="rounded p-1 hover:bg-secondary"
                                  onClick={() => void renameSession(s.id, renameValue)}
                                  aria-label="Confirm rename"
                                >
                                  <Check className="size-3.5" />
                                </button>
                                <button
                                  className="rounded p-1 hover:bg-secondary"
                                  onClick={() => setRenamingId(null)}
                                  aria-label="Cancel rename"
                                >
                                  <X className="size-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="min-w-0 flex-1 text-left"
                                  onClick={() => loadSession(s)}
                                  data-load-session={s.id}
                                >
                                  <span className="block truncate text-xs font-medium">
                                    {s.name}
                                    {activeSessionId === s.id && !dirty ? ' ·' : ''}
                                  </span>
                                  <span className="block truncate text-[10px] text-muted-foreground">
                                    {playgroundLanguage(s.languageId).label} ·{' '}
                                    {new Date(s.updatedAt).toLocaleString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                </button>
                                <button
                                  onClick={() => {
                                    setRenamingId(s.id)
                                    setRenameValue(s.name)
                                  }}
                                  aria-label={`Rename ${s.name}`}
                                  className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setSessionsOpen(false)
                                    setPendingConfirm({ kind: 'delete', sessionId: s.id, name: s.name })
                                  }}
                                  aria-label={`Delete ${s.name}`}
                                  className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-red-500"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {/* Row 2 — practice configuration (own line so long model names / titles
              can never squeeze the identity row or the editor below it). */}
          <div className="flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2" data-testid="playground-config">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <label htmlFor="playground-language">Language</label>
              <HubSelect
                id="playground-language"
                ariaLabel="Language"
                value={languageId}
                onValueChange={requestLanguage}
                data-testid="language-select"
                className="min-w-[9.5rem]"
              >
                {languagesByGroup().map((group) => (
                  <HubSelectGroup key={group.group}>
                    <HubSelectLabel>{group.group}</HubSelectLabel>
                    {group.languages.map((l) => (
                      <HubSelectItem key={l.id} value={l.id}>
                        {l.label}
                      </HubSelectItem>
                    ))}
                  </HubSelectGroup>
                ))}
              </HubSelect>
            </span>
            <Button
              type="button"
              size="sm"
              variant={roadmapEnabled ? 'default' : 'outline'}
              aria-pressed={roadmapEnabled}
              title={roadmapEnabled ? 'Roadmap tutor is on. Click to pause it.' : 'Turn on before starting a roadmap lesson.'}
              onClick={toggleRoadmap}
              data-testid="roadmap-enabled-toggle"
              className="h-8 px-2 text-[11px]"
            >
              <Map className="size-3.5" /> Roadmap {roadmapEnabled ? 'On' : 'Off'}
            </Button>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <label htmlFor="playground-roadmap">Roadmap</label>
              <HubSelect
                id="playground-roadmap"
                ariaLabel="Learning roadmap"
                value={roadmapSlug}
                onValueChange={(next) => {
                  setRoadmapSlug(next)
                  if (roadmapOpen || roadmapConversation.length > 0) {
                    cancelInFlight()
                    setRoadmapOpen(false)
                    setRoadmapConversation([])
                    setRoadmapConversationSlug('')
                    setRoadmapCurrentTopicId('')
                    setRoadmapCurrentTopicLabel('')
                    setRoadmapVisualGraph(null)
                    setDirty(true)
                  }
                }}
                data-testid="roadmap-select"
                className="max-w-[13rem]"
              >
                <HubSelectItem value="">Auto match</HubSelectItem>
                {roadmaps.map((roadmap) => (
                  <HubSelectItem key={roadmap.slug} value={roadmap.slug} title={roadmap.description}>
                    {roadmap.title}
                  </HubSelectItem>
                ))}
              </HubSelect>
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <label htmlFor="playground-level">Level</label>
              <HubSelect
                id="playground-level"
                ariaLabel="Practice level"
                value={level}
                onValueChange={(next) => setLevel(next as PracticeLevel)}
                data-testid="level-select"
              >
                {PRACTICE_LEVELS.map((l) => (
                  <HubSelectItem key={l} value={l}>
                    {l.charAt(0).toUpperCase() + l.slice(1)}
                  </HubSelectItem>
                ))}
              </HubSelect>
            </span>
            <span className="flex w-full min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground sm:w-auto">
              <label htmlFor="playground-model">Model</label>
              <HubSelect
                id="playground-model"
                ariaLabel="Local model"
                value={modelId}
                onValueChange={setModelId}
                data-testid="model-select"
                className="w-full min-w-0 sm:w-[16rem]"
              >
                <HubSelectItem value="">Auto (first available local model)</HubSelectItem>
                {modelId && !models.some((m) => m.id === modelId) ? (
                  <HubSelectItem value={modelId}>{modelId} (saved preference)</HubSelectItem>
                ) : null}
                {models.filter((m) => m.chatCompatible).length > 0 ? (
                  <HubSelectGroup>
                    <HubSelectLabel>Local models</HubSelectLabel>
                    {models
                      .filter((m) => m.chatCompatible)
                      .map((m) => (
                        <HubSelectItem key={m.id} value={m.id} title={m.label}>
                          {m.label}
                          {m.loaded ? '' : ' — not loaded'}
                        </HubSelectItem>
                      ))}
                  </HubSelectGroup>
                ) : null}
                {models.filter((m) => !m.chatCompatible).length > 0 ? (
                  <HubSelectGroup>
                    <HubSelectLabel>Not chat-capable</HubSelectLabel>
                    {models
                      .filter((m) => !m.chatCompatible)
                      .map((m) => (
                        <HubSelectItem key={`x-${m.id}`} value={m.id} disabled>
                          {m.label} — not chat-capable
                        </HubSelectItem>
                      ))}
                  </HubSelectGroup>
                ) : null}
              </HubSelect>
            </span>
          </div>
        </div>

        {/* Confirmation banner + notices */}
        {pendingConfirm ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs"
            data-testid="confirm-banner"
          >
            <span className="font-medium">{confirmText(pendingConfirm)}</span>
            <Button size="sm" className="h-7 px-2 text-[11px]" onClick={confirmPending} data-testid="confirm-button">
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => setPendingConfirm(null)}
              data-testid="cancel-button"
            >
              Cancel
            </Button>
          </div>
        ) : null}
        {notice ? (
          <div
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-[11px]',
              notice.kind === 'error'
                ? 'border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400'
                : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
            )}
            data-testid="playground-notice"
          >
            {notice.text}
          </div>
        ) : null}

        {/* ── Workspace: editor + feedback ──
            Side-by-side split is a measured-width CSS grid with pixel floors
            (minmax(px, Nfr)) and a draggable divider — never a fixed-width
            column; below the measured threshold the panes stack. */}
        <div
          ref={workspaceRef}
          className={cn(
            'min-h-0 flex-1',
            sideBySide ? 'grid' : 'flex flex-col',
            !sideBySide && 'gap-3',
            dividerDragging && 'select-none',
          )}
          style={
            sideBySide
              ? {
                  display: 'grid',
                  gridTemplateColumns: splitGridTemplate(splitShare),
                  gridTemplateRows: 'minmax(0, 1fr)',
                }
              : undefined
          }
          data-testid="playground-workspace"
          data-workspace-mode="split"
          data-split-layout={sideBySide ? 'columns' : 'stacked'}
        >
          {/* Editor column (regions B + C) */}
          <div
            className={cn(
              'min-h-0 min-w-0 flex-col gap-2',
              'flex flex-1',
            )}
          >
            {mode === 'sql' ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-muted-foreground" htmlFor="playground-dialect">
                  Dialect
                </label>
                <HubSelect
                  id="playground-dialect"
                  ariaLabel="SQL dialect"
                  value={sqlDialect}
                  onValueChange={(next) => setSqlDialect(next as SqlDialectId)}
                  data-testid="dialect-select"
                >
                  {SQL_DIALECTS.map((d) => (
                    <HubSelectItem key={d.id} value={d.id}>
                      {d.label}
                    </HubSelectItem>
                  ))}
                </HubSelect>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setSchemaOpen((open) => !open)}
                  aria-expanded={schemaOpen}
                  data-testid="schema-toggle"
                >
                  <Database className="size-3.5" />
                  Sample schema
                  {schemaOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </Button>
              </div>
            ) : null}

            {mode === 'sql' && schemaOpen ? (
              <div className="hub-scroll max-h-52 shrink-0 overflow-y-auto rounded-md border bg-card p-2.5" data-testid="schema-panel">
                <p className="text-[11px] leading-snug text-muted-foreground">{SQL_SAMPLE_SCHEMA.note}</p>
                <div className="mt-2 space-y-3">
                  {SQL_SAMPLE_SCHEMA.tables.map((table) => (
                    <div key={table.name}>
                      <div className="font-mono text-[11px] font-semibold">{table.name}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {table.columns.map((c) => `${c.name} ${c.type}`).join(' · ')}
                      </div>
                      <table className="mt-1 w-full border-collapse text-[10.5px]">
                        <thead>
                          <tr>
                            {table.columns.map((c) => (
                              <th
                                key={c.name}
                                className="border border-border/60 bg-secondary/50 px-1.5 py-0.5 text-left font-medium"
                              >
                                {c.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {table.rows.slice(0, 4).map((row, i) => (
                            <tr key={i}>
                              {row.map((v, j) => (
                                <td key={j} className="border border-border/60 px-1.5 py-0.5 font-mono">
                                  {String(v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {mode === 'excel' ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-muted-foreground" htmlFor="playground-workbook">
                  Sample workbook
                </label>
                <HubSelect
                  id="playground-workbook"
                  ariaLabel="Sample workbook"
                  value={activeWorkbookId}
                  onValueChange={requestWorkbook}
                  data-testid="workbook-select"
                >
                  {workbookOptions.map((w) => (
                    <HubSelectItem key={w.id} value={w.id}>
                      {w.label}
                    </HubSelectItem>
                  ))}
                </HubSelect>
              </div>
            ) : null}

            {mode === 'excel' ? (
              <div className="min-h-0 flex-1" data-testid="excel-workspace">
                <ExcelGrid
                  sheet={sheet ?? emptySheet()}
                  selected={selectedCell}
                  onSelect={setSelectedCell}
                  onDraft={draftCell}
                  onCommit={commitCell}
                  onUndo={undoCell}
                  canUndo={gridUndoCount > 0}
                />
              </div>
            ) : (
              <div className={cn(
                'min-h-0 flex-1 overflow-hidden rounded-md border',
                interactiveBackground ? 'bg-card/50' : 'bg-card',
              )}>
                <CodeEditor
                  ref={editorRef}
                  value={code}
                  cmKey={lang.cm}
                  sqlDialect={mode === 'sql' ? sqlDialect : undefined}
                  onChange={(next) => {
                    setCode(next)
                    setDirty(true)
                  }}
                  ariaLabel={`${lang.label} practice editor — code is not executed`}
                />
              </div>
            )}

            {/* Problem statement */}
            <textarea
              value={problemStatement}
              onChange={(e) => {
                setProblemStatement(e.target.value)
                setDirty(true)
              }}
              rows={2}
              placeholder="Practice task / problem statement — sent with every analysis request"
              aria-label="Practice task or problem statement"
              data-testid="problem-input"
              className="hub-scroll w-full resize-y rounded-md border border-input bg-secondary/40 px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
            />

            {/* Action toolbar (region C) */}
            <div className="flex flex-wrap items-center gap-1.5" data-testid="action-toolbar">
              {actions.map((spec) => (
                <Button
                  key={spec.id}
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  title={spec.hint}
                  disabled={busyActionId === spec.id || (spec.id === 'roadmap' && !roadmapEnabled)}
                  onClick={() => spec.id === 'roadmap' ? startRoadmap() : void runAction(spec)}
                  data-action={spec.id}
                >
                  {busyActionId === spec.id ? <Loader2 className="size-3.5 animate-spin" /> : ACTION_ICONS[spec.id]}
                  {spec.label}
                </Button>
              ))}
              {mode !== 'excel' ? (
                <span className="text-[10px] text-muted-foreground" data-testid="formatter-note">
                  Type for suggestions · Tab to accept · Ctrl+Space for more · Esc then Tab to leave editor
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => void saveSession()}
                  disabled={saving}
                  data-testid="save-button"
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save{dirty ? ' •' : ''}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setPendingConfirm({ kind: 'reset' })}
                  data-testid="reset-button"
                >
                  <RotateCcw className="size-3.5" />
                  Reset
                </Button>
              </div>
            </div>
          </div>

          {/* Divider — rendered only in the side-by-side split (the grid's
              12px middle track); stacked mode has nothing to divide. */}
          {sideBySide ? (
            <SplitDivider
              share={splitShare}
              workspaceRef={workspaceRef}
              onShareChange={(next) => setResponseShare(next, false)}
              onCommit={(share) => saveResponseShare(share)}
              onDragChange={setDividerDragging}
            />
          ) : null}

          {/* Guidance stays alongside the editor, or below it on narrow screens. */}
          {roadmapOpen ? (
            <RoadmapTutorPanel
              title={roadmaps.find((roadmap) => roadmap.slug === (roadmapConversationSlug || roadmapSlug))?.title ?? ((roadmapConversationSlug || roadmapSlug) || 'Auto-matched roadmap')}
              currentTopicId={roadmapCurrentTopicId}
              currentTopicLabel={roadmapCurrentTopicLabel}
              messages={roadmapConversation}
              busy={busyActionId === 'roadmap'}
              visualLoading={roadmapVisualLoading}
              visualGraph={roadmapVisualGraph}
              completedTopicIds={roadmapCompletedTopics[roadmapConversationSlug] ?? []}
              onReply={replyToRoadmap}
              onRestart={() => startRoadmap(true)}
              onCompleteTopic={() => void completeAndVisualizeRoadmapTopic()}
              onContinue={continueRoadmap}
              onBackFromVisual={() => setRoadmapVisualGraph(null)}
              className={cn('min-w-0', 'flex flex-1')}
            />
          ) : (
          <FeedbackPanel
            mode={mode}
            entries={feedback}
            activeId={activeFeedbackId}
            busy={busySpec}
            onApplySuggestion={applySuggestion}
            onClear={() => {
              cancelInFlight()
              setFeedback([])
              setActiveFeedbackId(null)
              setRoadmapOpen(false)
              setRoadmapConversation([])
              setRoadmapConversationSlug('')
              setRoadmapCurrentTopicId('')
              setRoadmapCurrentTopicLabel('')
              setRoadmapVisualGraph(null)
            }}
            onSelectEntry={setActiveFeedbackId}
            className={cn(
              'min-w-0',
              'flex flex-1',
            )}
          />
          )}
        </div>
      </div>
    </InteractiveBackground>
  )
}
