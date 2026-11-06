'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import {
  Check, Copy, Send, Play, Square, CheckCircle2, XCircle, Loader2, AlertTriangle,
  ShieldCheck, ShieldX, ListChecks, Gauge, Brain, StickyNote, FileCheck, Plus,
  Crown, ChevronDown, ChevronLeft, ChevronRight, UserPlus, Trash2, FolderOpen, MessageSquarePlus,
  Pencil, FolderGit2, Paperclip, CircleDot, Hammer, FileDiff, Wrench, Users, Sparkles, GraduationCap,
  Settings2, History, BookOpen, Maximize2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { initialAgentState } from './session-state'
import { useHub, flattenAgents } from '@/lib/agent-hub/store'
import { TrackedSessionsPanel } from './tracked-sessions'
import { DesignerPanel } from '@/components/design-studio/designer-panel'
import { TeachingPanel } from '@/components/agent-hub/teaching/teaching-panel'
import { SkillsLibraryPanel } from '@/components/agent-hub/skills-view'
import { isDesignRequest } from '@/lib/agent-hub/design-intent'
import { isTeachingRequest } from '@/lib/agent-hub/teaching-intent'
import {
  subscribeAgentSession,
  getAgentSessionState,
  sendCodingMessage,
  cancelAgentSession,
  resolveApproval,
  redactSecrets,
  newCodingSession,
  selectCodingSession,
  renameCodingSession,
  deleteCodingSession,
  getWorkspace,
  setWorkspace,
  refreshWorkspaceInfo,
  listWorkspaceDirs,
  setSmolMode,
  setSmolEffort,
  setSessionMemory,
  clearSessionMemory,
  getContextStats,
  getAgentName,
  registerAgentDefinition,
  removeAgentDefinition,
  setAgentModel,
  setSelectionMode,
  setAgentEnabled,
  smolPlanAdd,
  smolPlanDone,
  smolPlanCheckpoint,
  diffLines,
  highlightCode,
  runSlashCommand,
  MODE_LABELS,
  type AgentSessionState,
  type AgentTask,
  type AgentLogLine,
  type AgentDefinition,
  type AgentSelectionMode,
  type AgentActivityStatus,
  type RunTeamMember,
  type SmolMode,
  type SmolEffort,
  type CodingSession,
  type CodingTurnSummary,
  type ChangedFile,
} from '@/lib/agent-hub/agent-session'

const SLASH_COMMANDS = ['/models', '/mode', '/plan', '/context', '/tasks', '/logs', '/stop', '/skills', '/clear', '/help'] as const
const KNOWN_TOOLS = ['describe_capabilities', 'count_files', 'get_project_structure', 'read_file', 'list_files', 'search_files', 'find_files', 'plan', 'syntax_check', 'write_file', 'edit_file', 'delete_file', 'run_command', 'task', 'call_llm', 'activate_skill']
const BUILT_IN_IDS = ['manager', 'researcher', 'coder', 'runner', 'checker', 'designer', 'teaching-agent']
const RIGHT_TABS = ['Activity', 'Plan', 'Files', 'Terminal', 'Logs'] as const
const CODE_CLASS: Record<string, string> = {
  kw: 'text-violet-600 dark:text-violet-300',
  str: 'text-emerald-700 dark:text-emerald-300',
  com: 'text-zinc-500 dark:text-zinc-500 italic',
  num: 'text-amber-700 dark:text-amber-300',
  fn: 'text-sky-700 dark:text-sky-300',
}

// Precise activity states for the run-team display — never conflated with
// availability. "available" ≠ "selected" ≠ "working".
const STATUS_STYLES: Record<AgentActivityStatus, string> = {
  available: 'bg-secondary text-muted-foreground',
  selected: 'bg-primary/15 text-primary',
  working: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  waiting: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  blocked: 'bg-red-500/15 text-red-700 dark:text-red-300',
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  disabled: 'bg-secondary text-muted-foreground line-through',
}

// The four top-level panels of the Sessions workspace. Collapsed, they render
// as a row of compact dashboard cards; selecting one replaces the grid with
// that panel's detailed controls. Exactly one may be open at a time and ""
// (empty string) is the closed state — the same exclusive single-open model
// the previous accordion used.
const PANEL_WORKSPACE = 'workspace'
const PANEL_CODING_SESSIONS = 'coding-sessions'
const PANEL_TRACKED_SESSIONS = 'tracked-sessions'
const PANEL_CONTROLS_TEAM = 'controls-team'
type SessionsPanel = typeof PANEL_WORKSPACE | typeof PANEL_CODING_SESSIONS | typeof PANEL_TRACKED_SESSIONS | typeof PANEL_CONTROLS_TEAM | ''
type SessionPanelId = Exclude<SessionsPanel, ''>

// Card registry for the four-panel grid. Titles/icons are static; the
// summaries shown on each card are derived from live session state at render.
const PANEL_CARDS: Array<{ id: SessionPanelId; title: string; icon: React.ElementType }> = [
  { id: PANEL_WORKSPACE, title: 'Workspace', icon: FolderOpen },
  { id: PANEL_CODING_SESSIONS, title: 'Coding sessions', icon: FolderGit2 },
  { id: PANEL_TRACKED_SESSIONS, title: 'Tracked sessions', icon: History },
  { id: PANEL_CONTROLS_TEAM, title: 'Controls & team', icon: Settings2 },
]



// ── Markdown with highlighted code + copy ────────────────────────────────────

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const tokens = highlightCode(code, language)
  const lineCount = code.split('\n').length
  const label = language || 'code'

  const copy = () => {
    // Copies the raw source only — never the surrounding UI labels/chrome.
    void navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [expanded])

  const highlight = (
    <code>
      {tokens.map((t, i) => (
        <span key={i} className={t.cls ? CODE_CLASS[t.cls] : undefined}>
          {t.text}
        </span>
      ))}
    </code>
  )

  return (
    <div
      className="group/code relative my-2 overflow-hidden rounded-md border bg-secondary/70 dark:bg-black/40"
      data-testid="sessions-code-block"
      data-code-language={label}
    >
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1">
        <span className="font-mono text-[10px] text-muted-foreground">
          {label}
          <span className="ml-2 opacity-60">{lineCount} lines</span>
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setExpanded(true)}
            data-testid="code-expand"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/code:opacity-100"
          >
            <Maximize2 className="size-3" />
            Full view
          </button>
          <button
            onClick={copy}
            data-testid="code-copy"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/code:opacity-100"
          >
            {copied ? <Check className="size-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {/* Scrolls both ways; a tall block never clips the rest of the message. */}
      <pre className="hub-scroll max-h-[22rem] overflow-auto p-2.5 font-mono text-[11px] leading-relaxed">
        {highlight}
      </pre>

      {expanded && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex flex-col bg-black/60 p-2 sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-label={`Full code view (${label})`}
              data-testid="code-fullview"
              onClick={() => setExpanded(false)}
            >
              <div
                className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border bg-card shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <span className="font-mono text-xs">
                    {label}
                    <span className="ml-2 text-muted-foreground">{lineCount} lines</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={copy}>
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => setExpanded(false)}
                      aria-label="Close full code view"
                      data-testid="code-fullview-close"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
                {/* Full source with vertical AND horizontal scrolling — the
                    entire response can be inspected without clipping. */}
                <pre className="hub-scroll min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
                  {highlight}
                </pre>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function MarkdownCode(props: { className?: string; children?: React.ReactNode }) {
  const { className, children } = props
  const match = /language-([\w+-]+)/.exec(className ?? '')
  const text = String(children ?? '').replace(/\n$/, '')
  const block = Boolean(match) || text.includes('\n')
  if (!block) {
    return <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">{children}</code>
  }
  return <CodeBlock language={match?.[1] ?? ''} code={text} />
}

function MarkdownText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('markdown-body break-words text-xs leading-relaxed [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-primary [&_a]:underline [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_table]:text-[11px]', className)}>
      <ReactMarkdown components={{ code: MarkdownCode }}>{text}</ReactMarkdown>
    </div>
  )
}

// ── Activity timeline from real log lines ────────────────────────────────────

interface Activity {
  key: number
  time: string
  kind: 'start' | 'plan' | 'tool' | 'ok' | 'fail' | 'approval' | 'verify' | 'repair' | 'info' | 'stats' | 'cancel'
  text: string
}

function logToActivity(log: AgentLogLine, i: number): Activity {
  const c = log.content
  let kind: Activity['kind'] = log.type === 'error' ? 'fail' : log.type === 'approval' ? 'approval' : log.type === 'tool' ? 'tool' : log.type === 'result' ? 'ok' : 'info'
  if (/\[stats\]/.test(c)) kind = 'stats'
  else if (/^Starting agent session/.test(c)) kind = 'start'
  else if (/planning|Plan created|Checklist/i.test(c)) kind = 'plan'
  else if (/Approval (granted|denied|timed out)/.test(c)) kind = c.includes('denied') || c.includes('timed out') ? 'fail' : 'approval'
  else if (/Verific|Baseline|checks passed/i.test(c)) kind = 'verify'
  else if (/Repair|fix proposed/i.test(c)) kind = 'repair'
  else if (/cancel/i.test(c)) kind = 'cancel'
  else if (/Executing/.test(c)) kind = 'tool'
  return { key: i, time: log.time, kind, text: c.length > 320 ? `${c.slice(0, 320)}…` : c }
}

function ActivityIcon({ kind }: { kind: Activity['kind'] }) {
  switch (kind) {
    case 'start':
      return <Play className="size-3 text-blue-400" />
    case 'plan':
      return <ListChecks className="size-3 text-violet-600 dark:text-violet-300" />
    case 'tool':
      return <Wrench className="size-3 text-blue-300" />
    case 'ok':
      return <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
    case 'fail':
      return <XCircle className="size-3 text-red-600 dark:text-red-400" />
    case 'approval':
      return <ShieldCheck className="size-3 text-amber-700 dark:text-amber-300" />
    case 'verify':
      return <FileCheck className="size-3 text-violet-600 dark:text-violet-300" />
    case 'repair':
      return <Hammer className="size-3 text-amber-700 dark:text-amber-300" />
    case 'cancel':
      return <AlertTriangle className="size-3 text-amber-600 dark:text-amber-400" />
    case 'stats':
      return <Gauge className="size-3 text-zinc-500" />
    default:
      return <CircleDot className="size-3 text-zinc-500" />
  }
}

// ── Main view ────────────────────────────────────────────────────────────────

export function SessionsView() {
  const [agentState, setAgentState] = useState<AgentSessionState>(initialAgentState)
  const [composer, setComposer] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [rightTab, setRightTab] = useState<(typeof RIGHT_TABS)[number]>('Activity')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [slashOpen, setSlashOpen] = useState(false)
  const [wsInput, setWsInput] = useState('')
  const [wsDirs, setWsDirs] = useState<string[] | null>(null)
  const [wsError, setWsError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentRole, setNewAgentRole] = useState('')
  const [newAgentModel, setNewAgentModel] = useState('')
  const [newAgentTools, setNewAgentTools] = useState<string[]>(['call_llm'])
  const [memoryDraft, setMemoryDraft] = useState('')
  const [planAddText, setPlanAddText] = useState('')
  const [checkpointText, setCheckpointText] = useState('')
  const [terminalReply, setTerminalReply] = useState<string | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [designOpen, setDesignOpen] = useState(false)
  const [designSeed, setDesignSeed] = useState('')
  const [teachingOpen, setTeachingOpen] = useState(false)
  const [teachingSeed, setTeachingSeed] = useState('')
  const [skillsOpen, setSkillsOpen] = useState(false)
  // Exclusive accordion: exactly one panel id or '' (all collapsed).
  const [activePanel, setActivePanel] = useState<SessionsPanel>('')
  const logRef = useRef<HTMLDivElement>(null)
  const convoRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Auto-scroll only sticks to the newest activity while the user is already
  // at (or near) the bottom — reviewing earlier messages is never yanked.
  const stickToBottom = useRef(true)
  // Tracked-session ownership registry (shared store) — read-only summary.
  const hubSessions = useHub((s) => s.state.sessions)
  const hubAgents = flattenAgents(useHub((s) => s.state.agents))

  useEffect(() => {
    // Kick the first read off in a microtask so the initial setState is not
    // synchronous inside the effect body (react-hooks/set-state-in-effect).
    let cancelled = false
    const kick = () => {
      void Promise.resolve().then(() => {
        if (!cancelled) setAgentState(getAgentSessionState())
      })
    }
    kick()
    const unsub = subscribeAgentSession(setAgentState)
    refreshWorkspaceInfo().catch(() => {})
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [agentState.task?.logs])

  useEffect(() => {
    if (convoRef.current && stickToBottom.current) convoRef.current.scrollTop = convoRef.current.scrollHeight
  }, [agentState.codingSessions, agentState.task?.status, agentState.task?.logs?.length])

  const task = agentState.task
  const sessions = agentState.codingSessions
  const activeSession: CodingSession | null =
    sessions.find((s) => s.id === agentState.activeCodingSessionId) ?? sessions[0] ?? null
  const taskForSession = task && (!task.codingSessionId || task.codingSessionId === activeSession?.id) ? task : null
  const taskAlreadyInConversation = Boolean(
    taskForSession && activeSession?.turns.some((turn) => turn.request === taskForSession.request && turn.startedAt === taskForSession.startedAt),
  )
  const liveTask = taskAlreadyInConversation ? null : taskForSession
  const stats = getContextStats()
  const unassignedTracked = hubSessions.filter((s) => !s.agentId || !hubAgents.some((a) => a.id === s.agentId)).length

  const handleSend = async (text?: string) => {
    const msg = (text ?? composer).trim()
    if (!msg || agentState.isRunning) return
    setSendError(null)
    setSlashOpen(false)
    setComposer('')
    // A natural-language design request opens the Design Studio instead of the
    // generic pipeline: the app owns the registry/preview/validation, and the
    // model only proposes ops there. Slash commands and ordinary requests are
    // unaffected.
    if (!msg.startsWith('/') && isDesignRequest(msg)) {
      setDesignSeed(msg)
      setDesignOpen(true)
      return
    }
    // A genuine educational request opens the Teaching Agent: the app owns the
    // lesson framework and the assessment, and the model only enriches it.
    if (!msg.startsWith('/') && isTeachingRequest(msg)) {
      setTeachingSeed(msg)
      setTeachingOpen(true)
      return
    }
    try {
      stickToBottom.current = true
      if (convoRef.current) convoRef.current.scrollTop = convoRef.current.scrollHeight
      await sendCodingMessage(msg)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Failed to send')
    }
  }

  const handleAttach = async (file: File) => {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    const textExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.css', '.html', '.py', '.yml', '.yaml', '.sh', '.sql', '.prisma', '.xml', '.toml', '.ini', '.cfg']
    if (!textExts.includes(ext)) {
      setSendError(`"${file.name}" is an image/binary file — the current model interface accepts text only. Paste the content as text instead.`)
      return
    }
    if (file.size > 32 * 1024) {
      setSendError(`"${file.name}" is too large to attach (max 32 KiB).`)
      return
    }
    setAttaching(true)
    try {
      const content = await file.text()
      setComposer((c) => `${c}${c && !c.endsWith('\n') ? '\n' : ''}\nAttached file ${file.name}:\n\`\`\`${ext.slice(1)}\n${content}\n\`\`\`\n`)
    } catch {
      setSendError(`Could not read "${file.name}".`)
    } finally {
      setAttaching(false)
    }
  }

  const refreshTerminal = async (cmd: string) => {
    setTerminalReply('Loading…')
    try {
      const r = await runSlashCommand(cmd)
      setTerminalReply(r.reply)
    } catch (e) {
      setTerminalReply(e instanceof Error ? e.message : 'Failed')
    }
  }

  const slashMatches = SLASH_COMMANDS.filter((c) => c.startsWith(composer.trim().toLowerCase()))
  const activities = (task?.logs ?? []).map(logToActivity)
  const termLines = (task?.logs ?? []).filter((l) => /exit code:|Task t\d|--- stdout|--- stderr|Early output|TIMED OUT/.test(l.content))
  const projectName = agentState.workspaceInfo?.projectName ?? 'Coding workspace'

  // Compact summaries shown on the collapsed headers (actual state only).
  const headerSummaries = {
    [PANEL_WORKSPACE]: `${projectName} · /${getWorkspace()}`,
    [PANEL_CODING_SESSIONS]: activeSession
      ? `${activeSession.name} · ${activeSession.turns.length} turn${activeSession.turns.length === 1 ? '' : 's'}${sessions.length > 1 ? ` · ${sessions.length} sessions` : ''}`
      : `No session yet · ${sessions.length} total`,
    [PANEL_TRACKED_SESSIONS]: `${hubSessions.length} tracked · ${unassignedTracked} unassigned`,
    [PANEL_CONTROLS_TEAM]: `${MODE_LABELS[agentState.mode]} · ${agentState.effort ?? 'default effort'} · ${agentState.selectionMode.toUpperCase()} · ${agentState.agents.length} agents`,
  } as Record<SessionPanelId, string>
  // The card whose detailed controls are open (null ⇒ four-card grid).
  const activeCard = PANEL_CARDS.find((c) => c.id === activePanel) ?? null
  const ActiveIcon = activeCard ? activeCard.icon : null

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header: workspace + model + task state */}
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-lg font-semibold">Agent Session</h1>
          <p className="text-xs text-muted-foreground">
            {agentState.workspaceInfo ? `${agentState.workspaceInfo.projectName} · ${agentState.workspaceInfo.root}` : 'Coding workspace'}
            {getWorkspace() !== '.' ? ` · /${getWorkspace()}` : ''}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
          <Button
            size="sm"
            variant={designOpen ? 'default' : 'outline'}
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setDesignOpen((o) => !o)}
            title="Open the Design Studio"
          >
            <Sparkles className="size-3.5" /> Design Studio
          </Button>
          <Button
            size="sm"
            variant={teachingOpen ? 'default' : 'outline'}
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setTeachingOpen((o) => !o)}
            title="Open the Teaching Agent"
          >
            <GraduationCap className="size-3.5" /> Teaching
          </Button>
          <Button
            size="sm"
            variant={skillsOpen ? 'default' : 'outline'}
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setSkillsOpen((o) => !o)}
            title="Open the Skills Library — installed skills, GitHub installs, updates"
          >
            <BookOpen className="size-3.5" /> Skills
            {agentState.skillStats && agentState.skillStats.installed > 0 ? (
              <span className="font-mono text-[10px] text-muted-foreground">
                {agentState.skillStats.enabled}/{agentState.skillStats.installed}
              </span>
            ) : null}
          </Button>
          <span className="rounded-md border bg-secondary/40 px-2 py-1 font-mono text-muted-foreground" title="Model serving the last reply">
            model: {agentState.lastModel ?? 'auto'}
          </span>
          <span
            className={cn(
              'rounded-md border px-2 py-1',
              task && ['planning', 'executing', 'awaiting-approval', 'verifying'].includes(task.status)
                ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
                : 'border-border bg-secondary/40 text-muted-foreground'
            )}
          >
            {!task ? 'idle' : task.status === 'awaiting-approval' ? 'waiting for approval' : task.status}
          </span>
          {task?.fileScope && task.fileScope.allowed.length > 0 ? (
            <span
              className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 font-mono text-sky-700 dark:text-sky-300"
              title="Files this run is allowed to modify"
            >
              scope: {task.fileScope.allowed.join(', ')}
            </span>
          ) : null}
        </div>
      </div>

      {designOpen ? <DesignerPanel seed={designSeed} onClose={() => setDesignOpen(false)} /> : null}
      {teachingOpen ? <TeachingPanel seed={teachingSeed} onClose={() => setTeachingOpen(false)} /> : null}
      {skillsOpen ? <SkillsLibraryPanel onClose={() => setSkillsOpen(false)} /> : null}

      {/* ── Panel area: four compact dashboard cards ⇄ one open panel ────────
          Collapsed: the four cards share one responsive row (4-up desktop,
          2-up tablet, 1-up mobile). Selecting a card replaces the grid with
          that card's detailed controls — the other three are not rendered at
          all, so two panels can never be open at once. Back restores the
          grid. activePanel is the single source of truth for both modes. */}
      {activeCard ? (
        <div className="flex min-h-0 max-h-[65%] flex-col overflow-hidden rounded-none border bg-card" data-slot="panel-expanded">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            {ActiveIcon ? <ActiveIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
            <span className="shrink-0 text-[13px] font-semibold">{activeCard.title}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{headerSummaries[activeCard.id]}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1 px-2 text-xs"
              onClick={() => setActivePanel('')}
              aria-label="Back to the four panels"
            >
              <ChevronLeft className="size-3.5" /> Back
            </Button>
          </div>
          <div className="hub-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
            {activeCard.id === PANEL_WORKSPACE ? (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <input
                value={wsInput}
                onChange={(e) => {
                  setWsInput(e.target.value)
                  setWsError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    try {
                      setWorkspace(wsInput.trim() || '.')
                      setWsInput('')
                      setWsError(null)
                    } catch (err) {
                      setWsError(err instanceof Error ? err.message : 'Invalid workspace')
                    }
                  }
                }}
                aria-label="Workspace root or subfolder"
                placeholder={getWorkspace() === '.' ? 'project root (type a subfolder…)' : getWorkspace()}
                className="h-8 min-w-0 flex-1 rounded-none border border-input bg-secondary/50 px-2.5 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 text-xs"
                onClick={async () => {
                  try {
                    const dirs = await listWorkspaceDirs()
                    setWsDirs(dirs)
                    setWsError(null)
                  } catch (err) {
                    setWsError(err instanceof Error ? err.message : 'Could not list folders')
                  }
                }}
              >
                Browse
              </Button>
            </div>
            {wsDirs ? (
              <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                <button
                  onClick={() => {
                    setWorkspace('.')
                    setWsInput('')
                  }}
                  className={cn(
                    'rounded-none px-2 py-1 font-mono text-[11px]',
                    getWorkspace() === '.' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'
                  )}
                >
                  . (root)
                </button>
                {wsDirs.map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setWorkspace(d)
                      setWsInput('')
                    }}
                    className={cn(
                      'rounded-none px-2 py-1 font-mono text-[11px]',
                      getWorkspace() === d ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            ) : null}
            {wsError ? <div className="text-[11px] text-red-600 dark:text-red-400">{wsError}</div> : null}
            <div className="truncate font-mono text-[10px] text-muted-foreground" title={agentState.workspaceInfo?.root ?? ''}>
              /{getWorkspace()} — the agent reads, edits and runs commands here
            </div>
          </div>
            ) : activeCard.id === PANEL_CODING_SESSIONS ? (
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => newCodingSession()}
              title="New coding session"
            >
              <MessageSquarePlus className="size-3.5" /> New session
            </Button>
            {sessions.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No sessions yet — send a message to start one.</div>
            ) : (
              <div className="hub-scroll max-h-56 space-y-1 overflow-y-auto">
                {sessions.map((s) => {
                  const active = s.id === (agentState.activeCodingSessionId ?? activeSession?.id)
                  const renaming = renamingId === s.id
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        'group rounded-none border px-2 py-1.5',
                        active ? 'border-primary/50 bg-primary/10' : 'border-transparent hover:border-border hover:bg-secondary/30'
                      )}
                    >
                      <button className="flex w-full items-center gap-2 text-left" onClick={() => selectCodingSession(s.id)}>
                        <span className={cn('size-1.5 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-muted-foreground/40')} />
                        {renaming ? (
                          <input
                            autoFocus
                            value={renameText}
                            onChange={(e) => setRenameText(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Enter' && renameText.trim()) {
                                try {
                                  renameCodingSession(s.id, renameText.trim())
                                } catch {
                                  /* keep old name */
                                }
                                setRenamingId(null)
                              }
                              if (e.key === 'Escape') setRenamingId(null)
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="h-6 min-w-0 flex-1 rounded-none border border-input bg-background px-1.5 text-xs outline-none"
                          />
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.name}</span>
                        )}
                        <span className="shrink-0 text-[10px] text-muted-foreground">{s.turns.length}</span>
                      </button>
                      <div className="mt-0.5 flex items-center gap-1 pl-3.5">
                        <span className="truncate font-mono text-[10px] text-muted-foreground">/{s.workspace}</span>
                        <span className="ml-auto hidden gap-1 group-hover:flex">
                          <button
                            title="Rename"
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setRenamingId(s.id)
                              setRenameText(s.name)
                            }}
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            title="Delete session"
                            className="rounded p-0.5 text-muted-foreground hover:text-red-600 dark:text-red-400"
                            onClick={() => {
                              deleteCodingSession(s.id)
                              if (renamingId === s.id) setRenamingId(null)
                            }}
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
            ) : activeCard.id === PANEL_TRACKED_SESSIONS ? (
          <TrackedSessionsPanel />
        ) : (
          <div className="space-y-3">
            {/* Session controls */}
            <div className="space-y-2">
              <div className="flex items-center gap-1 rounded-none border bg-secondary/30 p-1">
                <ShieldCheck className="ml-1 size-3.5 text-muted-foreground" />
                {(['ro', 'edit'] as SmolMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSmolMode(m)}
                    disabled={agentState.isRunning}
                    title={m === 'ro' ? 'Read-only: inspect and search only' : 'Edit: modify files, run approved commands, asks first'}
                    className={cn(
                      'rounded-none px-2 py-1 text-[11px] transition-colors disabled:opacity-50',
                      agentState.mode === m ? 'bg-primary/20 font-medium text-primary' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 rounded-none border bg-secondary/30 p-1">
                <Brain className="ml-1 size-3.5 text-muted-foreground" />
                {([null, 'off', 'low', 'medium', 'high'] as Array<SmolEffort | null>).map((e) => (
                  <button
                    key={e ?? 'default'}
                    onClick={() => setSmolEffort(e)}
                    disabled={agentState.isRunning}
                    className={cn(
                      'rounded-none px-2 py-1 text-[11px] capitalize transition-colors disabled:opacity-50',
                      agentState.effort === e ? 'bg-primary/20 font-medium text-primary' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {e ?? 'Default'}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <div className="flex flex-1 items-center gap-1.5">
                  <StickyNote className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={memoryDraft}
                    onChange={(e) => setMemoryDraft(e.target.value)}
                    placeholder={agentState.memoryNote ? 'Memory saved — type to replace…' : 'Memory (conventions, commands)…'}
                    className="h-8 min-w-0 flex-1 rounded-none border border-input bg-secondary/50 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 text-xs"
                  disabled={!memoryDraft.trim()}
                  onClick={() => {
                    setSessionMemory(memoryDraft)
                    setMemoryDraft('')
                  }}
                >
                  Save
                </Button>
                {agentState.memoryNote ? (
                  <Button size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-xs" onClick={() => clearSessionMemory()}>
                    Clear
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 rounded-none border bg-secondary/30 px-2 py-1.5" title="Estimated context usage (~4 chars/token)">
                <Gauge className="size-3.5 shrink-0 text-muted-foreground" />
                <ContextMeter />
              </div>
            </div>

            {/* Agent team */}
            <div className="space-y-2 rounded-none border bg-secondary/20 p-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Crown className="size-3.5 text-amber-600 dark:text-amber-400" />
                Delegation · {agentState.agents[0]?.name ?? 'Project Manager'} + {Math.max(0, agentState.agents.length - 1)}
              </div>
              {/* Global agent selection policy — AUTO (PM decides) / MANUAL (you decide).
                  Changes take effect on real planning/execution, not just the UI. */}
              <div
                className="flex items-center gap-1 rounded-none border bg-secondary/30 p-1"
                title="AUTO: the Project Manager activates only the specialists a task needs. MANUAL: only the specialists you enable may receive work."
              >
                <Users className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
                <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Agent selection</span>
                {(['auto', 'manual'] as AgentSelectionMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSelectionMode(m)}
                    className={cn(
                      'rounded-none px-2 py-1 text-[11px] uppercase transition-colors',
                      agentState.selectionMode === m
                        ? 'bg-primary/20 font-medium text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <TeamPanel
                agents={agentState.agents}
                expandedAgent={expandedAgent}
                setExpandedAgent={setExpandedAgent}
                teamError={teamError}
                setTeamError={setTeamError}
                newAgentName={newAgentName}
                setNewAgentName={setNewAgentName}
                newAgentRole={newAgentRole}
                setNewAgentRole={setNewAgentRole}
                newAgentModel={newAgentModel}
                setNewAgentModel={setNewAgentModel}
                newAgentTools={newAgentTools}
                setNewAgentTools={setNewAgentTools}
                isRunning={agentState.isRunning}
                selectionMode={agentState.selectionMode}
                agentEnabled={agentState.agentEnabled}
                runTeam={task?.team ?? agentState.runTeam}
              />
            </div>
          </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-slot="panel-grid">
          {PANEL_CARDS.map((c) => {
            const Icon = c.icon
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActivePanel(c.id)}
                data-slot="panel-card"
                aria-label={`Open ${c.title} controls — ${headerSummaries[c.id]}`}
                className="group flex min-w-0 flex-col gap-1.5 rounded-none border bg-card/60 p-3 text-left transition-colors hover:border-primary/50 hover:bg-secondary/30 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold group-hover:text-primary">{c.title}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <span className="w-full truncate text-[11px] text-muted-foreground">{headerSummaries[c.id]}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Dedicated chat for the coding agent ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
        {/* Conversation */}
        <div
          ref={convoRef}
          onScroll={handleConvoScroll}
          className="hub-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4"
        >
          <div className="w-full space-y-4">
            {!activeSession || (activeSession.turns.length === 0 && !task) ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <div className="text-sm font-medium">Start coding in /{getWorkspace()}</div>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  Ask to inspect code, fix a bug, or add a feature. The team plans the work, reads real files,
                  applies targeted edits, runs your project checks, and reports what actually happened.
                  Type <code className="font-mono text-foreground">/help</code> for commands.
                </p>
              </div>
            ) : null}
            {activeSession?.turns.map((turn) => (
              <ConversationTurn
                key={turn.id}
                turn={turn}
                onViewFiles={() => {
                  setRightTab('Files')
                  setDetailsOpen(true)
                }}
              />
            ))}
            {liveTask ? <LiveTurn task={liveTask} onViewFiles={() => { setRightTab('Files'); setDetailsOpen(true) }} /> : null}
            {agentState.isRunning ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Working…
              </div>
            ) : null}
          </div>

          {agentState.pendingApproval ? (
            <div className="w-full rounded-lg border border-amber-500/35 bg-amber-500/10 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                <ShieldCheck className="size-3.5" /> {agentState.pendingApproval.agentName ?? 'Agent'} asks for approval
              </div>
              <div className="mb-2 text-xs text-amber-200/90">
                <span className="font-mono">{agentState.pendingApproval.tool}</span> — {agentState.pendingApproval.description}
              </div>
              {Object.keys(agentState.pendingApproval.params).length > 0 ? (
                <pre className="hub-scroll mb-2 max-h-24 overflow-auto rounded bg-secondary p-2 font-mono text-[10px] text-amber-800 dark:bg-black/30 dark:text-amber-100/80">
                  {JSON.stringify(agentState.pendingApproval.params, null, 2)}
                </pre>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => resolveApproval(true)}>
                  <ShieldCheck className="size-3.5" /> Approve
                </Button>
                <Button size="sm" variant="destructive" className="h-7 gap-1.5 text-xs" onClick={() => resolveApproval(false)}>
                  <ShieldX className="size-3.5" /> Deny
                </Button>
              </div>
            </div>
          ) : null}

          {sendError ? (
            <div className="w-full rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300">{sendError}</div>
          ) : null}
        </div>

        {/* Inspection drawer — Activity/Plan/Files/Terminal/Logs preserved from
            the previous layout as a pinned strip: plans, tool output, diffs
            and verification stay one click away, fixed here so opening it
            shrinks the conversation instead of pushing the composer away.
            Expanding the conversation while it is closed: a slim always-on
            toggle keeps everything reachable without crowding the chat. */}
        <div className="border-t px-3 py-1.5">
          {detailsOpen ? (
            <div className="w-full rounded-lg border bg-background/60">
              <div className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
                {RIGHT_TABS.map((t) => {
                  // The Plan tab is only meaningful while a task is actually
                  // running or has run — never show it for an idle session.
                  if (t === 'Plan' && !task) return null
                  return (
                    <button
                      key={t}
                      aria-pressed={rightTab === t}
                      onClick={() => {
                        setRightTab(t)
                        if (t === 'Terminal' && terminalReply === null) void refreshTerminal('/tasks')
                      }}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs transition-colors',
                        rightTab === t ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {t}
                    </button>
                  )
                })}
                <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-[10px]" onClick={() => setDetailsOpen(false)}>
                  Hide details
                </Button>
              </div>
              <div className="max-h-[min(38vh,22rem)] overflow-y-auto">
                <DetailsBody
                  rightTab={rightTab}
                  task={task}
                  activities={activities}
                  termLines={termLines}
                  terminalReply={terminalReply}
                  agentState={agentState}
                  logRef={logRef}
                  refreshTerminal={refreshTerminal}
                  planAddText={planAddText}
                  setPlanAddText={setPlanAddText}
                  checkpointText={checkpointText}
                  setCheckpointText={setCheckpointText}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={() => setDetailsOpen(true)}
              className="flex w-full items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Wrench className="size-3" /> Activity &amp; verification
              {task?.logs.length ? <span className="font-mono">{task.logs.length} log lines</span> : null}
            </button>
          )}
        </div>

        {/* Composer — persistent, always visible (border-t separates it from
            the scrolling conversation; the card reserves its full height). */}
        <div className="border-t bg-card p-3">
          <div className="w-full space-y-1.5">
            {slashOpen && slashMatches.length > 0 ? (
              <div className="overflow-hidden rounded-md border">
                {slashMatches.map((c) => (
                  <button
                    key={c}
                    className="block w-full px-2.5 py-1.5 text-left font-mono text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    onClick={() => void handleSend(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex gap-2">
              <textarea
                value={composer}
                onChange={(e) => {
                  setComposer(e.target.value)
                  setSlashOpen(e.target.value.trimStart().startsWith('/'))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (slashOpen && slashMatches.length > 0 && composer.trim().startsWith('/')) {
                      void handleSend(slashMatches[0])
                    } else {
                      void handleSend()
                    }
                  }
                  if (e.key === 'Escape') setSlashOpen(false)
                }}
                placeholder="Message your coding agent… (Enter to send, Shift+Enter for newline, / for commands)"
                rows={2}
                disabled={agentState.isRunning}
                aria-label="Message your coding agent"
                className="hub-scroll min-w-0 flex-1 resize-y rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-60"
              />
              <div className="flex shrink-0 flex-col gap-1.5">
                {agentState.isRunning ? (
                  <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => cancelAgentSession()}>
                    <Square className="size-3.5" /> Stop
                  </Button>
                ) : (
                  <Button size="sm" className="gap-1.5" disabled={!composer.trim() || attaching} onClick={() => void handleSend()}>
                    <Send className="size-3.5" /> Send
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  title="Attach a text file into the message"
                  disabled={agentState.isRunning || attaching}
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip className="size-3.5" />
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void handleAttach(f)
                  }}
                />
              </div>
            </div>
            {/* Status bar */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <span className="font-mono" title="Model serving the last reply">model: {agentState.lastModel ?? 'auto'}</span>
              <span className="font-mono" title="Active workspace">ws: /{getWorkspace()}</span>
              <span title="Permission mode">mode: {agentState.mode}</span>
              <span title="Reasoning effort">effort: {agentState.effort ?? 'default'}</span>
              <span title="Estimated context usage">ctx: ~{stats.estimatedTokens.toLocaleString('en-US')} tok{stats.evicted > 0 ? ` (${stats.evicted} evicted)` : ''}</span>
              <span className="ml-auto">{!task ? 'idle' : task.status}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  function handleConvoScroll() {
    const el = convoRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
}

// ── Inspection drawer body (previous right-rail tabs, relocated verbatim) ────

function DetailsBody(props: {
  rightTab: (typeof RIGHT_TABS)[number]
  task: AgentTask | null
  activities: Activity[]
  termLines: AgentLogLine[]
  terminalReply: string | null
  agentState: AgentSessionState
  logRef: React.RefObject<HTMLDivElement | null>
  refreshTerminal: (cmd: string) => Promise<void>
  planAddText: string
  setPlanAddText: (s: string) => void
  checkpointText: string
  setCheckpointText: (s: string) => void
}) {
  const { rightTab, task, activities, termLines, terminalReply, agentState, logRef } = props
  return (
    <div className="p-2.5">
      {rightTab === 'Activity' ? (
        <div ref={logRef} className="hub-scroll max-h-52 space-y-1 overflow-y-auto">
          {activities.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">No activity yet — every real tool call lands here.</div>
          ) : (
            activities.map((a) => (
              <div key={a.key} className="flex gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-secondary/30" title={a.text}>
                <span className="mt-0.5 shrink-0">
                  <ActivityIcon kind={a.kind} />
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{a.time}</span>
                <span className="min-w-0 flex-1 break-words leading-snug">{a.text}</span>
              </div>
            ))
          )}
          {agentState.isRunning ? (
            <div className="flex items-center gap-1.5 px-1.5 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Running…
            </div>
          ) : null}
        </div>
      ) : null}

      {rightTab === 'Plan' ? (
        <div className="max-h-52 space-y-2 overflow-y-auto">
          {task?.team && task.team.length > 0 ? (
            <div className="mb-1 space-y-1 rounded-md border bg-secondary/40 p-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Users className="size-3" /> Run team · {(task.selectionMode ?? 'auto').toUpperCase()}
              </div>
              <div className="space-y-1">
                {task.team.map((m) => (
                  <div key={m.agentId} className="flex items-start gap-2 text-[11px]">
                    <span className={cn('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize', STATUS_STYLES[m.status])}>{m.status}</span>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{m.name}</span>
                      <span className="text-muted-foreground"> — {m.reason}</span>
                    </div>
                  </div>
                ))}
              </div>
              {task.missingCapabilities && task.missingCapabilities.length > 0 ? (
                <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-700 dark:text-red-300">
                  Missing capability: {Array.from(new Set(task.missingCapabilities)).join(', ')} — enable the owner or switch to AUTO.
                </div>
              ) : null}
            </div>
          ) : null}
          {task && task.plan.length > 0 ? (
            <div className="space-y-1.5">
              {task.plan.map((step, i) => (
                <StepRow key={step.id} step={step} index={i} isCurrent={i === task.currentStepIndex && task.status === 'executing'} />
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No active plan.</div>
          )}
          <div className="border-t pt-2">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Team checklist</div>
            {agentState.smolPlan.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">Empty — seeded from the next run&apos;s plan.</div>
            ) : (
              <div className="space-y-1">
                {agentState.smolPlan.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <button
                      onClick={() => smolPlanDone(i + 1)}
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                        s.done ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'border-muted-foreground/40 text-transparent hover:text-muted-foreground'
                      )}
                    >
                      <Check className="size-3" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <span className={cn(s.done && 'text-muted-foreground line-through')}>
                        {i + 1}. {s.text}
                      </span>
                      {s.note ? (
                        <div className="mt-0.5 break-words rounded bg-secondary p-1.5 font-mono text-[10px] text-amber-800 dark:bg-black/30 dark:text-amber-100/80">{s.note}</div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex gap-1.5">
              <input
                value={props.planAddText}
                onChange={(e) => props.setPlanAddText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && props.planAddText.trim()) {
                    smolPlanAdd(props.planAddText.trim())
                    props.setPlanAddText('')
                  }
                }}
                placeholder="Add a step…"
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-secondary/50 px-2 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
              />
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!props.planAddText.trim()} onClick={() => { smolPlanAdd(props.planAddText.trim()); props.setPlanAddText('') }}>
                <Plus className="size-3" />
              </Button>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <input
                value={props.checkpointText}
                onChange={(e) => props.setCheckpointText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && props.checkpointText.trim()) {
                    smolPlanCheckpoint(props.checkpointText.trim())
                    props.setCheckpointText('')
                  }
                }}
                placeholder="Checkpoint APIs / error / next edit…"
                className="h-7 min-w-0 flex-1 rounded-md border border-input bg-secondary/50 px-2 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
              />
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!props.checkpointText.trim()} onClick={() => { smolPlanCheckpoint(props.checkpointText.trim()); props.setCheckpointText('') }}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {rightTab === 'Files' ? (
        <div className="max-h-52 space-y-2 overflow-y-auto">
          {task?.fileScope && task.fileScope.allowed.length > 0 ? (
            <div className="rounded-md border border-sky-500/25 bg-sky-500/5 p-2.5 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-sky-700 dark:text-sky-300">
                <ShieldCheck className="size-3.5" /> File scope lock
              </div>
              <div className="text-[11px] text-sky-800 dark:text-sky-200/80">
                This run may only modify:{' '}
                {task.fileScope.allowed.map((p) => (
                  <code key={p} className="mr-1 rounded bg-secondary px-1 py-0.5 font-mono text-[10px] dark:bg-black/30">
                    {p}
                  </code>
                ))}
              </div>
            </div>
          ) : task?.fileScope && task.fileScope.allowed.length === 0 ? (
            <div className="rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs text-amber-200/80">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                <ShieldCheck className="size-3.5" /> File scope lock
              </div>
              {task.fileScope.reason}
            </div>
          ) : null}
          {task?.verification ? (
            <div
              className={cn(
                'rounded-md border p-2.5 text-xs',
                task.verification.passed ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-red-500/25 bg-red-500/5'
              )}
            >
              <div className="flex items-center gap-1.5 font-medium">
                {task.verification.passed ? <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <XCircle className="size-3.5 text-red-600 dark:text-red-400" />}
                {task.verification.command || 'No check command'}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {task.verification.passed
                  ? `Passed in ${task.verification.attempts} attempt(s).`
                  : `${task.verification.note}${task.verification.preExisting ? ' (pre-existing)' : ''}`}
                {task.verification.baselineFailed && !task.verification.preExisting ? ' Baseline also failed.' : ''}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">No verification yet — runs automatically after file changes.</div>
          )}
          {!task?.changedFiles || task.changedFiles.length === 0 ? (
            <div className="text-xs text-muted-foreground">No files changed in this run.</div>
          ) : (
            task.changedFiles.map((c) => (
              <div key={c.path} className="overflow-hidden rounded-md border">
                <div className="flex items-center gap-2 bg-secondary/40 px-2.5 py-1.5">
                  <FileDiff className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{c.path}</span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px]',
                      c.status === 'added'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : c.status === 'deleted'
                          ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    )}
                  >
                    {c.status}
                  </span>
                </div>
                <pre className="hub-scroll max-h-56 overflow-auto p-2.5 font-mono text-[10px] leading-relaxed">
                  {c.status === 'deleted' ? (
                    <code className="text-red-700 dark:text-red-300/90">[file deleted]{c.before ? `\n${c.before.slice(0, 3000)}` : ''}</code>
                  ) : c.before === null ? (
                    <code className="text-emerald-700 dark:text-emerald-300/90">{c.after.slice(0, 3000)}</code>
                  ) : (
                    <code>
                      {diffLines(c.before, c.after).split('\n').map((line, i) => (
                        <span
                          key={i}
                          className={cn(
                            'block',
                            line.startsWith('+ ') ? 'bg-emerald-500/10 text-emerald-200' : line.startsWith('- ') ? 'bg-red-500/10 text-red-200' : 'text-muted-foreground'
                          )}
                        >
                          {line}
                        </span>
                      ))}
                    </code>
                  )}
                </pre>
              </div>
            ))
          )}
        </div>
      ) : null}

      {rightTab === 'Terminal' ? (
        <div className="max-h-56 space-y-2 overflow-y-auto">
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void props.refreshTerminal('/tasks')}>
              Refresh tasks
            </Button>
            <span className="self-center text-[10px] text-muted-foreground">Uses /tasks · /logs · /stop</span>
          </div>
          <div className="hub-scroll max-h-40 overflow-y-auto rounded-md border bg-card p-2.5 font-mono text-[11px] leading-relaxed">
            {termLines.length === 0 ? (
              <span className="text-muted-foreground">No command output in this run yet.</span>
            ) : (
              termLines.map((l, i) => (
                <div key={i} className={cn(l.type === 'error' ? 'text-red-700 dark:text-red-300' : 'text-zinc-600 dark:text-zinc-300')}>
                  {l.content}
                </div>
              ))
            )}
          </div>
          <div className="hub-scroll max-h-48 overflow-y-auto rounded-md border bg-card p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {terminalReply === null ? (
              <span className="text-muted-foreground">Task manager idle.</span>
            ) : (
              <span className="text-zinc-600 dark:text-zinc-300">{terminalReply}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['/tasks', '/logs ', '/stop '].map((c) => (
              <button
                key={c}
                onClick={() => void props.refreshTerminal(c.trim() === '/logs' || c.trim() === '/stop' ? `${c.trim()} t1` : c)}
                className="rounded bg-secondary px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                title={c.trim() === '/tasks' ? 'List background tasks' : 'Example — edit the id first'}
              >
                {c.trim() === '/tasks' ? '/tasks' : `${c.trim()} <id>`}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {rightTab === 'Logs' ? (
        <div ref={logRef} className="hub-scroll max-h-56 overflow-y-auto font-mono text-[11px] leading-relaxed">
          {!task || task.logs.length === 0 ? (
            <span className="text-muted-foreground">No logs yet.</span>
          ) : (
            task.logs.map((log, i) => (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">{log.time}</span>
                <span
                  className={cn(
                    log.type === 'error' && 'text-red-600 dark:text-red-400',
                    log.type === 'tool' && 'text-violet-600 dark:text-violet-300',
                    log.type === 'result' && 'text-emerald-700 dark:text-emerald-300',
                    log.type === 'approval' && 'text-amber-700 dark:text-amber-300',
                    log.type === 'info' && 'text-zinc-600 dark:text-zinc-300'
                  )}
                >
                  {log.content}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

// ── Shared full-hight helpers (existing components, unchanged bodies) ────────

function ContextMeter() {
  const stats = getContextStats()
  const pct = Math.min(100, Math.round((stats.logLines / Math.max(1, stats.cap)) * 100))
  return (
    <div className="flex flex-1 items-center gap-1.5">
      <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn('h-full rounded-full transition-all', pct > 85 ? 'bg-red-400' : pct > 60 ? 'bg-amber-400' : 'bg-emerald-400')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        ~{stats.estimatedTokens.toLocaleString('en-US')} tok{stats.evicted > 0 ? ` · ${stats.evicted} evicted` : ''}
      </span>
    </div>
  )
}

function formatWorkedTime(startedAt: string, endedAt?: string): string {
  const start = Date.parse(startedAt)
  const end = endedAt ? Date.parse(endedAt) : Date.now()
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function WorkDisclosure({
  startedAt,
  endedAt,
  logs,
  running = false,
  progress,
}: {
  startedAt: string
  endedAt?: string
  logs: AgentLogLine[]
  running?: boolean
  progress?: string
}) {
  const recent = logs.slice(-8)
  return (
    <details className="group mb-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 border-b pb-2 text-xs text-muted-foreground marker:hidden hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        {running ? <Loader2 className="size-3 animate-spin" /> : null}
        <span>{running ? progress ?? 'Working…' : `Worked for ${formatWorkedTime(startedAt, endedAt)}`}</span>
      </summary>
      <div className="ml-2 mt-2 space-y-1 border-l pl-3 text-[11px] text-muted-foreground">
        {recent.length ? recent.map((log, i) => (
          <div key={`${log.time}-${i}`} className="flex gap-2 leading-snug">
            <span className="shrink-0 font-mono">{log.time}</span>
            <span className="min-w-0 break-words">{logToActivity(log, i).text}</span>
          </div>
        )) : <span>Task activity will appear here.</span>}
      </div>
    </details>
  )
}

function ConversationTurn({ turn, onViewFiles }: { turn: CodingTurnSummary; onViewFiles: () => void }) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm">
          <MarkdownText text={turn.request} />
        </div>
      </div>
      <div className="space-y-3 px-1 py-1">
        <WorkDisclosure startedAt={turn.startedAt} endedAt={turn.endedAt} logs={turn.logs ?? []} />
        {turn.result ? <MarkdownText text={redactSecrets(turn.result)} className="text-[15px] leading-7 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_table]:text-sm" /> : null}
        {turn.status === 'failed' && turn.error ? (
          <div className="rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">{turn.error}</div>
        ) : null}
        {turn.status === 'partial' ? <div className="text-sm text-amber-700 dark:text-amber-300">Part of this task could not be completed.</div> : null}
        {turn.changedFiles?.length ? <EditedFilesCard files={turn.changedFiles} totalFiles={turn.filesChanged} onViewFiles={onViewFiles} /> : null}
      </div>
    </div>
  )
}

function EditedFilesCard({ files, totalFiles, onViewFiles }: { files: ChangedFile[]; totalFiles: number; onViewFiles: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const visibleFiles = showAll ? files : files.slice(0, 3)
  const counts = files.reduce((acc, file) => {
    const diff = file.status === 'added' ? file.after.split('\n').map((line) => `+ ${line}`).join('\n') : file.status === 'deleted' ? (file.before ?? '').split('\n').map((line) => `- ${line}`).join('\n') : diffLines(file.before ?? '', file.after)
    for (const line of diff.split('\n')) {
      if (line.startsWith('+ ')) acc.added += 1
      if (line.startsWith('- ')) acc.removed += 1
    }
    return acc
  }, { added: 0, removed: 0 })

  return (
    <section className="overflow-hidden rounded-2xl border bg-card" aria-label="Edited files">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary"><FileDiff className="size-4 text-muted-foreground" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Edited {totalFiles} {totalFiles === 1 ? 'file' : 'files'}</div>
          <div className="mt-0.5 flex gap-2 font-mono text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400">+{counts.added}</span>
            <span className="text-red-600 dark:text-red-400">-{counts.removed}</span>
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={() => { setShowDiff((value) => !value); onViewFiles() }}>
          {showDiff ? 'Hide changes' : 'View changes'}
        </Button>
      </div>
      <div className="border-t">
        {visibleFiles.map((file) => (
          <div key={file.path} className="border-b last:border-b-0">
            <div className="flex items-center gap-2 px-4 py-2.5 text-xs">
              <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
              <span className={cn('rounded px-1.5 py-0.5 text-[10px]', file.status === 'added' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : file.status === 'deleted' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-secondary text-muted-foreground')}>
                {file.status}
              </span>
            </div>
            {showDiff ? (
              <pre className="hub-scroll max-h-64 overflow-auto border-t bg-secondary/30 p-3 font-mono text-[11px] leading-relaxed">
                {(file.status === 'added' ? file.after.split('\n').map((line) => `+ ${line}`).join('\n') : file.status === 'deleted' ? (file.before ?? '').split('\n').map((line) => `- ${line}`).join('\n') : diffLines(file.before ?? '', file.after)).split('\n').map((line, index) => (
                  <span key={index} className={cn('block', line.startsWith('+ ') ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : line.startsWith('- ') ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'text-muted-foreground')}>{line}</span>
                ))}
              </pre>
            ) : null}
          </div>
        ))}
        {files.length > 3 && !showAll ? (
          <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs text-muted-foreground hover:bg-secondary/40 hover:text-foreground" onClick={() => setShowAll(true)}>
            Show {Math.min(files.length - 3, totalFiles - 3)} more files <ChevronDown className="size-3.5" />
          </button>
        ) : null}
        {totalFiles > files.length ? <div className="px-4 py-2 text-[11px] text-muted-foreground">Showing {files.length} of {totalFiles} changed files. Open the Files panel for the full diff.</div> : null}
      </div>
    </section>
  )
}

function LiveTurn({ task, onViewFiles }: { task: AgentTask; onViewFiles: () => void }) {
  const progress = task.status === 'executing' ? `Working · step ${task.currentStepIndex + 1} of ${task.plan.length}` : task.status === 'awaiting-approval' ? 'Waiting for your approval' : task.status === 'verifying' ? 'Checking the changes' : 'Working…'
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm"><MarkdownText text={task.request} /></div>
      </div>
      <div className="space-y-3 px-1 py-1">
        <WorkDisclosure startedAt={task.startedAt} logs={task.logs} running progress={progress} />
        {task.result ? <MarkdownText text={redactSecrets(task.result)} className="text-[15px] leading-7 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_table]:text-sm" /> : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{progress}</div>}
        {task.status === 'failed' && task.error ? <div className="rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">{task.error}</div> : null}
        {task.changedFiles?.length ? <EditedFilesCard files={task.changedFiles} totalFiles={task.changedFiles.length} onViewFiles={onViewFiles} /> : null}
      </div>
    </div>
  )
}

function StepRow({ step, index, isCurrent }: { step: AgentTask['plan'][number]; index: number; isCurrent: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
        isCurrent && 'bg-primary/10',
        step.status === 'completed' && 'text-muted-foreground',
        step.status === 'failed' && 'text-red-600 dark:text-red-400'
      )}
    >
      <StepStatusIcon status={step.status} />
      <span className="w-4 shrink-0 text-right text-[10px] text-muted-foreground">{index + 1}.</span>
      <span className="min-w-0 flex-1 truncate" title={step.description}>
        {step.description}
      </span>
      {step.blocked ? (
        <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] text-red-700 dark:text-red-300" title={step.blocked}>blocked</span>
      ) : (
        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">{getAgentName(step.agentId)}</span>
      )}
      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{step.tool}</span>
      {step.attempts && step.attempts > 1 ? <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">{step.attempts} tries</span> : null}
      {step.error ? (
        <span
          className="min-w-0 max-w-[45%] break-words text-[10px] text-red-600 dark:text-red-400"
          title={step.error}
        >
          {step.error}
        </span>
      ) : null}
    </div>
  )
}

function StepStatusIcon({ status }: { status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' }) {
  switch (status) {
    case 'pending':
      return <div className="size-3 rounded-full border border-muted-foreground/30" />
    case 'running':
      return <Loader2 className="size-3 animate-spin text-blue-400" />
    case 'completed':
      return <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
    case 'failed':
      return <XCircle className="size-3 text-red-600 dark:text-red-400" />
    case 'skipped':
      return <AlertTriangle className="size-3 text-amber-600 dark:text-amber-400" />
  }
}

function TeamPanel(props: {
  agents: AgentDefinition[]
  expandedAgent: string | null
  setExpandedAgent: (id: string | null) => void
  teamError: string | null
  setTeamError: (e: string | null) => void
  newAgentName: string
  setNewAgentName: (s: string) => void
  newAgentRole: string
  setNewAgentRole: (s: string) => void
  newAgentModel: string
  setNewAgentModel: (s: string) => void
  newAgentTools: string[]
  setNewAgentTools: React.Dispatch<React.SetStateAction<string[]>>
  isRunning: boolean
  selectionMode: AgentSelectionMode
  agentEnabled: Record<string, boolean>
  runTeam: RunTeamMember[]
}) {
  const {
    agents, expandedAgent, setExpandedAgent, teamError, setTeamError,
    newAgentName, setNewAgentName, newAgentRole, setNewAgentRole, newAgentModel, setNewAgentModel,
    newAgentTools, setNewAgentTools,
  } = props
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">
        {props.selectionMode === 'auto'
          ? 'AUTO — the Project Manager activates only the specialists a task needs. Each switch allows or denies automatic selection. Blank model = automatic (local first, then cloud APIs).'
          : 'MANUAL — only the specialists you switch on may receive work; the Project Manager stays on as orchestrator. Blank model = automatic (local first, then cloud APIs).'}
      </p>
      {agents.map((a, i) => {
        const isManager = a.id === 'manager'
        const expanded = expandedAgent === a.id
        const isCustom = !BUILT_IN_IDS.includes(a.id)
        const enabled = isManager || props.agentEnabled[a.id] !== false
        const member = props.runTeam.find((m) => m.agentId === a.id)
        const status: AgentActivityStatus = member ? member.status : enabled ? 'available' : 'disabled'
        return (
          <div key={a.id} className={cn(isManager ? '' : 'ml-4 border-l-2 border-primary/20 pl-2')}>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setExpandedAgent(expanded ? null : a.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-none px-2 py-1.5 text-left text-xs transition-colors hover:bg-secondary/40"
              >
                {expanded ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                {isManager ? <Crown className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" /> : null}
                <span className="truncate font-medium">
                  {i === 0 ? a.name : `↳ ${a.name}`}
                </span>
                <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">{a.role}</span>
                <span className="ml-auto shrink-0 rounded-none bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {a.model || 'auto'}
                </span>
              </button>
              <span
                className={cn('shrink-0 rounded-none px-1.5 py-0.5 text-[10px] font-medium capitalize', STATUS_STYLES[status])}
                title={member?.reason ?? (enabled ? 'Enabled — not selected for a run yet' : 'Disabled by user')}
              >
                {status}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={isManager}
                title={
                  isManager
                    ? 'The Project Manager is the orchestrator and cannot be disabled'
                    : props.selectionMode === 'auto'
                      ? enabled
                        ? 'Allowed for automatic selection'
                        : 'Excluded from automatic selection'
                      : enabled
                        ? 'Included in the manual team'
                        : 'Excluded from the manual team'
                }
                onClick={() => {
                  try {
                    setAgentEnabled(a.id, !enabled)
                    setTeamError(null)
                  } catch (err) {
                    setTeamError(err instanceof Error ? err.message : 'Could not change agent')
                  }
                }}
                className={cn(
                  'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  enabled ? 'bg-emerald-500/80' : 'bg-zinc-400/60 dark:bg-zinc-600'
                )}
              >
                <span className={cn('inline-block size-3 transform rounded-full bg-white shadow transition-transform', enabled ? 'translate-x-3.5' : 'translate-x-0.5')} />
              </button>
            </div>
            {expanded ? (
              <div className="ml-7 space-y-2 rounded-none border bg-secondary/60 p-2.5 text-xs dark:bg-black/20">
                <p className="text-[11px] leading-relaxed text-muted-foreground">{a.description}</p>
                <div className="flex flex-wrap gap-1">
                  {a.tools.map((t) => (
                    <span key={t} className="rounded-none bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
                {member ? (
                  <div className="space-y-1 rounded-none border bg-background/40 px-2 py-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn('rounded-none px-1.5 py-0.5 text-[10px] font-medium capitalize', STATUS_STYLES[member.status])}>{member.status}</span>
                      <span className="text-muted-foreground">
                        {member.selected ? 'In this run' : member.status === 'disabled' ? 'Excluded' : 'Available'}
                        {member.steps.length ? ` · steps: ${member.steps.join(', ')}` : ''}
                      </span>
                    </div>
                    <p className="text-muted-foreground">{member.reason}</p>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <input
                    defaultValue={a.model}
                    key={`${a.id}-${a.model}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        try {
                          setAgentModel(a.id, (e.target as HTMLInputElement).value)
                          setTeamError(null)
                        } catch (err) {
                          setTeamError(err instanceof Error ? err.message : 'Could not set model')
                        }
                      }
                    }}
                    aria-label={`Model for ${a.name}`}
                    placeholder="auto, lmstudio, ollama, or cloud model id"
                    title="Model for this member — Enter to apply"
                    className="h-8 min-w-0 flex-1 rounded-none border border-input bg-secondary/50 px-2.5 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 text-xs"
                    onClick={(e) => {
                      const input = e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null
                      try {
                        setAgentModel(a.id, input?.value ?? '')
                        setTeamError(null)
                      } catch (err) {
                        setTeamError(err instanceof Error ? err.message : 'Could not set model')
                      }
                    }}
                  >
                    Apply
                  </Button>
                  {isCustom ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 shrink-0 gap-1 text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-300"
                      onClick={() => {
                        try {
                          removeAgentDefinition(a.id)
                          setTeamError(null)
                          if (expandedAgent === a.id) setExpandedAgent(null)
                        } catch (err) {
                          setTeamError(err instanceof Error ? err.message : 'Could not remove agent')
                        }
                      }}
                    >
                      <Trash2 className="size-3" /> Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}
      {teamError ? (
        <div className="rounded-none border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300">{teamError}</div>
      ) : null}
      <div className="space-y-2 rounded-none border border-dashed p-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <UserPlus className="size-3.5" /> Add a team member
        </div>
        <div className="flex flex-col gap-2">
          <input
            value={newAgentName}
            onChange={(e) => setNewAgentName(e.target.value)}
            placeholder="Name, e.g. Tester"
            className="h-8 rounded-none border border-input bg-secondary/50 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          <input
            value={newAgentRole}
            onChange={(e) => setNewAgentRole(e.target.value)}
            placeholder="Role, e.g. Writes regression checks"
            className="h-8 rounded-none border border-input bg-secondary/50 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          <input
            value={newAgentModel}
            onChange={(e) => setNewAgentModel(e.target.value)}
            placeholder="Model (blank = auto)"
            className="h-8 rounded-none border border-input bg-secondary/50 px-2.5 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {KNOWN_TOOLS.map((t) => (
            <button
              key={t}
              onClick={() => setNewAgentTools((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
              className={cn(
                'rounded-none px-2 py-1 font-mono text-[10px] transition-colors',
                newAgentTools.includes(t) ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'
              )}
            >
              {t}
            </button>
          ))}
          <Button
            size="sm"
            className="ml-auto h-7 gap-1 text-xs"
            disabled={!newAgentName.trim() || newAgentTools.length === 0}
            onClick={() => {
              try {
                const id = newAgentName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
                registerAgentDefinition({
                  id,
                  name: newAgentName.trim().slice(0, 48),
                  role: newAgentRole.trim().slice(0, 80) || 'Specialist',
                  description: `${newAgentName.trim()} supports the Project Manager as a ${newAgentRole.trim() || 'specialist'}.`,
                  tools: newAgentTools,
                  model: newAgentModel.trim(),
                  systemPrompt: `You are ${newAgentName.trim()}, ${newAgentRole.trim() || 'a specialist'} on an agent team led by a Project Manager. Report exact findings; never invent results.`,
                })
                setNewAgentName('')
                setNewAgentRole('')
                setNewAgentModel('')
                setNewAgentTools(['call_llm'])
                setTeamError(null)
              } catch (err) {
                setTeamError(err instanceof Error ? err.message : 'Could not add agent')
              }
            }}
          >
            <Plus className="size-3" /> Add
          </Button>
        </div>
      </div>
    </div>
  )
}
