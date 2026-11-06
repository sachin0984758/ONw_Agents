'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AssistantMark } from '@/components/agent-hub/assistant-mark'
import { SessionQuestionCard } from './session-question-card'
import { Bot, Brain, Blocks, BookOpen, Check, ChevronDown, CircleDot, Clipboard, ClipboardList, ExternalLink, FileCode2, FilePlus2, Folder, FolderOpen, Gamepad2, Globe, Laptop, ListChecks, ListTodo, Loader2, MessageSquarePlus, Microscope, PanelLeft, Pause, Play, Plus, Puzzle, Search, Send, ShieldAlert, Sparkles, Square, Terminal, Trash2, Undo2, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HubSelect, HubSelectItem } from '@/components/agent-hub/hub-select'
import { cn } from '@/lib/utils'
import { CodeBlock } from '@/components/agent-hub/code-block'
import { SkillsLibraryPanel } from '@/components/agent-hub/skills-view'
import type { Approval, CodingConversation, SessionEvent, SessionSummary, SessionTurn } from '@/lib/agent-hub/session/types'
import { SESSION_AGENTS } from '@/lib/agent-hub/session/agents'
import { rememberCodingSession } from '@/lib/agent-hub/session/navigation'
import { useHub } from '@/lib/agent-hub/store'
import type { ConversationAppearance } from './conversation-profile'
import { isGameBuildRequest, MASCOT_CHAT_PAUSE_EVENT, MASCOT_CHAT_SEND_EVENT, setMascotActivity, type MascotActivityState } from '@/lib/agent-hub/mascot-activity'
import { validateAttachment, MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES } from '@/lib/agent-hub/attachments'
import conversationStyles from './conversation-profile.module.css'

type ModelOption = { id: string; label: string; provider: string; loaded: boolean; available: boolean }
type WorkspaceInfo = { id?: string; root: string; projectName: string }
type DirectorySnapshot = { folder: string; directories: string[]; files: string[]; truncated: boolean }
type ComposerAction = {
  id: string
  category: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  disabled?: boolean
  unavailable?: boolean
  run?: () => void
}

const EFFORT_CHOICES = [
  { id: 'off', name: 'Off', description: 'Skip the reasoning-effort setting for quicker, straightforward replies.' },
  { id: 'low', name: 'Low', description: 'A light pass for simple questions and small edits.' },
  { id: 'medium', name: 'Medium', description: 'Balanced effort for everyday project work.' },
  { id: 'high', name: 'High', description: 'More effort for complex tasks; responses may take longer.' },
] as const

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const element = document.createElement('textarea')
      element.value = value; element.setAttribute('readonly', ''); element.style.position = 'fixed'; element.style.top = '-9999px'
      document.body.appendChild(element); element.select()
      const copied = document.execCommand('copy'); document.body.removeChild(element)
      return copied
    } catch { return false }
  }
}

export function parseDirectorySnapshot(output: string): DirectorySnapshot | null {
  try {
    const value = JSON.parse(output) as { path?: unknown; entries?: Array<{ name?: unknown; type?: unknown; hidden?: unknown }>; truncated?: unknown }
    if (Array.isArray(value.entries)) return {
      folder: String(value.path ?? '.'),
      directories: value.entries.filter((entry) => entry.type === 'dir').map((entry) => `${String(entry.name)}${entry.hidden ? ' (hidden)' : ''}`),
      files: value.entries.filter((entry) => entry.type === 'file').map((entry) => `${String(entry.name)}${entry.hidden ? ' (hidden)' : ''}`),
      truncated: value.truncated === true,
    }
  } catch { /* Accept the concise text format for new turns too. */ }
  const lines = output.split(/\r?\n/)
  const folder = /^Folder:\s*(.*)$/.exec(lines[0] ?? '')?.[1]
  if (folder === undefined) return null
  const directories: string[] = []; const files: string[] = []
  let current: string[] | null = null
  for (const line of lines.slice(1)) {
    if (/^Directories \(/.test(line)) current = directories
    else if (/^Files \(/.test(line)) current = files
    else if (/^Listing is truncated/.test(line)) return { folder, directories, files, truncated: true }
    else if (current && line.startsWith('  ') && line.trim() !== '(none)') current.push(line.trim())
  }
  return { folder, directories, files, truncated: lines.includes('Listing is truncated at the folder entry limit.') }
}

function MarkdownCode({ className, children }: { className?: string; children?: React.ReactNode }) {
  const raw = String(children ?? '')
  const language = /language-([\w-]+)/.exec(className ?? '')?.[1] ?? ''
  const isBlock = Boolean(language) || raw.includes('\n')
  if (!isBlock) return <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>
  return <CodeBlock language={language} code={raw.replace(/\n$/, '')} />
}

export function AssistantAnswer({ content, agentName }: { content: string; agentName?: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => { if (await copyText(content)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600) } }
  return <div className="group/answer min-w-0 rounded-2xl border border-border/70 bg-card px-4 py-3.5 shadow-sm sm:px-5">
    <div className="mb-2.5 flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="flex size-6 items-center justify-center rounded-lg bg-primary/10 text-primary"><AssistantMark className="size-3.5" /></span><span className="flex-1">{agentName ? `AgentHub · ${agentName}` : 'AgentHub'}</span><button type="button" onClick={() => void onCopy()} aria-label="Copy answer" title="Copy answer" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] opacity-70 transition hover:bg-muted hover:text-foreground group-hover/answer:opacity-100 focus:opacity-100">{copied ? <Check className="size-3.5 text-emerald-500" /> : <Clipboard className="size-3.5" />}{copied ? 'Copied' : 'Copy'}</button></div>
    <div className="markdown-body break-words text-sm leading-7 [&_a]:text-primary [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_table]:min-w-full [&_td]:border [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-border/60 [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: ({ children }) => <>{children}</>, code: MarkdownCode, table: ({ children }) => <div className="my-4 overflow-x-auto rounded-xl border"><table className="w-full border-collapse text-left text-sm">{children}</table></div> }}>{content}</ReactMarkdown>
    </div>
  </div>
}

export function DirectoryAnswer({ snapshot, agentName }: { snapshot: DirectorySnapshot; agentName?: string }) {
  const [open, setOpen] = useState(false)
  const text = [`Folder: ${snapshot.folder}`, `Directories (${snapshot.directories.length}):`, ...snapshot.directories.map((name) => `  ${name}`), `Files (${snapshot.files.length}):`, ...snapshot.files.map((name) => `  ${name}`), ...(snapshot.truncated ? ['Listing is truncated.'] : [])].join('\n')
  return <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="flex items-center gap-2 border-b bg-muted/20 px-4 py-2 text-[11px] font-medium text-muted-foreground sm:px-5"><span className="flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary"><AssistantMark className="size-3" /></span>{agentName ? `AgentHub · ${agentName}` : 'AgentHub'}</div>
    <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5"><span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Folder className="size-4" /></span><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">Folder listing</div><div className="truncate text-xs text-muted-foreground">{snapshot.folder} · {snapshot.directories.length} {snapshot.directories.length === 1 ? 'folder' : 'folders'} · {snapshot.files.length} {snapshot.files.length === 1 ? 'file' : 'files'}{snapshot.truncated ? ' · partial' : ''}</div></div><button type="button" onClick={() => void copyText(text)} title="Copy folder listing" aria-label="Copy folder listing" className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"><Clipboard className="size-4" /></button></div>
    <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex w-full items-center justify-between border-t px-4 py-2.5 text-left text-xs font-medium text-muted-foreground transition hover:bg-muted/50 sm:px-5"><span>{open ? 'Hide items' : 'Show folder and file names'}</span><ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} /></button>
    {open ? <div className="grid gap-4 border-t p-4 sm:grid-cols-2 sm:p-5"><div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Folders</h3><ul className="max-h-64 space-y-1 overflow-y-auto text-xs">{snapshot.directories.map((name) => <li key={name} className="truncate rounded-md bg-muted/50 px-2.5 py-1.5 font-mono">{name}</li>)}</ul>{!snapshot.directories.length ? <p className="text-xs text-muted-foreground">No folders</p> : null}</div><div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</h3><ul className="max-h-64 space-y-1 overflow-y-auto text-xs">{snapshot.files.map((name) => <li key={name} className="truncate rounded-md bg-muted/50 px-2.5 py-1.5 font-mono">{name}</li>)}</ul>{!snapshot.files.length ? <p className="text-xs text-muted-foreground">No files</p> : null}</div></div> : null}
  </section>
}

export function ThinkingEffortControl({ value, disabled, appearance = 'day', onChange }: { value: CodingConversation['effort']; disabled: boolean; appearance?: ConversationAppearance; onChange: (effort: CodingConversation['effort']) => void }) {
  const [open, setOpen] = useState(false)
  const selected = EFFORT_CHOICES.find((choice) => choice.id === value) ?? EFFORT_CHOICES[2]
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} className="rounded-xl"><Brain className="mr-1.5 size-3.5" />{value === 'off' ? 'Thinking off' : `Thinking · ${selected.name}`}<ChevronDown className="ml-1 size-3.5" /></Button></PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} aria-label="Reasoning effort settings" data-conversation-theme={appearance} className={cn(conversationStyles.theme, 'w-[min(21rem,calc(100vw-2rem))] rounded-2xl p-3')}>
      <div className="flex items-start gap-2.5 border-b pb-3"><span className="mt-0.5 flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Brain className="size-4" /></span><div><h2 className="text-sm font-semibold">Reasoning effort</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Sets how much effort the selected model uses. It does not show private chain-of-thought.</p></div></div>
      <div role="radiogroup" aria-label="Reasoning effort" className="mt-2 space-y-1">{EFFORT_CHOICES.map((choice) => <button key={choice.id} type="button" role="radio" aria-checked={value === choice.id} onClick={() => { onChange(choice.id); setOpen(false) }} className={cn('flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition', value === choice.id ? 'bg-primary/10' : 'hover:bg-muted')}><span className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', value === choice.id ? 'border-primary' : 'border-muted-foreground/50')}>{value === choice.id ? <span className="size-2 rounded-full bg-primary" /> : null}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium">{choice.name}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{choice.description}</span></span></button>)}</div>
    </PopoverContent>
  </Popover>
}

function relativeTime(value: string): string {
  const age = Math.max(0, Date.now() - new Date(value).getTime())
  if (age < 60_000) return 'just now'
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`
  return new Date(value).toLocaleDateString()
}

function formatToolOutput(item: SessionTurn['items'][number]): string {
  if (!item.output) return ''
  try {
    const value = JSON.parse(item.output) as { path?: unknown; entries?: Array<{ name?: unknown; type?: unknown; hidden?: unknown }>; truncated?: unknown }
    if (item.name === 'list_files' && Array.isArray(value.entries)) {
      const dirs = value.entries.filter((entry) => entry.type === 'dir').map((entry) => `  ${String(entry.name)}${entry.hidden ? ' (hidden)' : ''}`)
      const files = value.entries.filter((entry) => entry.type === 'file').map((entry) => `  ${String(entry.name)}${entry.hidden ? ' (hidden)' : ''}`)
      return [`Folder: ${String(value.path ?? '.')}`, `Directories (${dirs.length}):`, ...(dirs.length ? dirs : ['  (none)']), `Files (${files.length}):`, ...(files.length ? files : ['  (none)']), value.truncated ? 'Listing is truncated.' : ''].filter(Boolean).join('\n')
    }
    return JSON.stringify(value, null, 2)
  } catch { return item.output }
}

function ToolRow({ item }: { item: SessionTurn['items'][number] }) {
  const Icon = item.name === 'run_command' ? Terminal : item.name === 'plan' ? ClipboardList : item.name?.includes('file') || item.name === 'search' ? FileCode2 : CircleDot
  const args = item.args ?? {}
  const detail = String(args.command ?? args.path ?? args.pattern ?? item.output ?? '').slice(0, 180)
  const state = item.status === 'waiting' ? 'Approval needed' : item.status === 'running' ? 'Running' : item.status === 'failed' ? 'Failed' : 'Done'
  const output = formatToolOutput(item)
  return (
    <details className="group overflow-hidden rounded-xl border bg-card/80 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 marker:hidden">
        {item.status === 'running' ? <Loader2 className="size-4 animate-spin text-primary" /> : item.status === 'waiting' ? <ShieldAlert className="size-4 text-amber-500" /> : item.status === 'failed' ? <X className="size-4 text-destructive" /> : <Icon className="size-4 text-muted-foreground" />}
        <span className="font-mono text-xs">{item.name}</span><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{detail}</span>
        <span className={cn('text-[11px]', item.status === 'failed' ? 'text-destructive' : item.status === 'waiting' ? 'text-amber-600' : 'text-muted-foreground')}>{state}</span>
        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      {output ? <pre className="max-h-72 overflow-auto border-t bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{output}</pre> : null}
    </details>
  )
}

function ChangeCard({ turn }: { turn: SessionTurn }) {
  const [open, setOpen] = useState(false)
  if (!turn.changes.length) return null
  return <section className="overflow-hidden rounded-2xl border bg-card">
    <button className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm" onClick={() => setOpen((value) => !value)}>
      <FileCode2 className="size-4 text-primary" /><span className="flex-1">Edited {turn.changes.length} {turn.changes.length === 1 ? 'file' : 'files'}</span><span className="text-xs text-muted-foreground">{open ? 'Hide changes' : 'View changes'}</span><ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
    </button>
    {open ? <div className="border-t">{turn.changes.map((change) => <div key={change.path} className="border-b last:border-b-0">
      <div className="px-4 py-2 font-mono text-xs text-muted-foreground">{change.path}{change.truncated ? ' · preview limited' : ''}</div>
      {change.before !== null ? <pre className="max-h-44 overflow-auto border-t bg-destructive/5 p-3 font-mono text-[11px] text-destructive/80 whitespace-pre-wrap">{change.before.split('\n').map((line) => `- ${line}`).join('\n')}</pre> : null}
      {change.after ? <pre className="max-h-44 overflow-auto border-t bg-emerald-500/5 p-3 font-mono text-[11px] text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap">{change.after.split('\n').map((line) => `+ ${line}`).join('\n')}</pre> : null}
      {!change.after && change.before !== null ? <div className="px-4 py-2 text-xs text-muted-foreground">File removed</div> : null}
    </div>)}</div> : null}
  </section>
}

export function TurnView({ turn, onAnswer, questionsDisabled = true, answered = false }: { turn: SessionTurn; onAnswer?: (answer: string) => void; questionsDisabled?: boolean; answered?: boolean }) {
  const duration = turn.endedAt ? Math.max(1, Math.round((new Date(turn.endedAt).getTime() - new Date(turn.startedAt).getTime()) / 1000)) : 0
  const isDirectoryRequest = /^(?:(?:please\s+)?(?:list|show)(?:\s+me)?\s+(?:the\s+)?files?(?:\s+(?:here|in (?:this )?(?:folder|workspace|project)))?|what files are (?:here|in (?:this )?(?:folder|workspace|project)))[?.!\s]*$/i.test(turn.request)
  const directoryOutput = isDirectoryRequest ? turn.items.find((item) => item.kind === 'tool' && item.name === 'list_files')?.output : undefined
  const directorySnapshot = directoryOutput ? parseDirectorySnapshot(directoryOutput) : null
  return <article className="mx-auto w-full max-w-4xl space-y-5 pb-8">
    <div className="flex justify-end"><div className="max-w-[88%] rounded-3xl rounded-br-lg bg-secondary px-5 py-3 text-sm leading-6" data-chat-surface="user-message"><ReactMarkdown>{turn.request}</ReactMarkdown></div></div>
    <div className="space-y-3 px-1">
      {turn.items.map((item) => item.kind === 'question' && item.question ? <SessionQuestionCard key={item.id} question={item.question} disabled={questionsDisabled} answered={answered} onAnswer={onAnswer} /> : item.kind === 'tool' ? <ToolRow key={item.id} item={item} /> : item.kind === 'notice' ? <div key={item.id} className={cn('rounded-xl border px-4 py-3 text-sm', turn.status === 'failed' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-primary/20 bg-primary/5')}>{item.text}</div> : item.text ? isDirectoryRequest && directorySnapshot ? <DirectoryAnswer key={item.id} snapshot={directorySnapshot} agentName={turn.agent?.name} /> : <AssistantAnswer key={item.id} content={item.text} agentName={turn.agent?.name} /> : turn.status === 'running' ? <div key={item.id} className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Thinking…</div> : null)}
      {turn.status === 'running' ? <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Working…</div> : <div className="text-[11px] text-muted-foreground">Worked for {duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m ${duration % 60}s`}</div>}
      <ChangeCard turn={turn} />
    </div>
  </article>
}

export function SessionChatView({ conversationLayout, conversationAppearance }: { conversationLayout: 'unified' | 'separate'; conversationAppearance: ConversationAppearance }) {
  const setView = useHub((state) => state.setView)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [conversation, setConversation] = useState<CodingConversation | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [preferredLocalModel, setPreferredLocalModel] = useState('')
  const [composer, setComposer] = useState('')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [approval, setApproval] = useState<Approval | null>(null)
  const [error, setError] = useState('')
  const [workspaceInput, setWorkspaceInput] = useState('.')
  const [workspaceId, setWorkspaceId] = useState<string | undefined>()
  const [pickingFolder, setPickingFolder] = useState(false)
  const [folderPath, setFolderPath] = useState('')
  const [folderPathOpen, setFolderPathOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [deletedSession, setDeletedSession] = useState<{ id: string; title: string } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionCategory, setActionCategory] = useState('All')
  const [actionSearch, setActionSearch] = useState('')
  const [skillsOpen, setSkillsOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const runningRef = useRef(false)
  const queuedMascotMessages = useRef<string[]>([])
  const mascotTaskMode = useRef<'working' | 'game'>('working')
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => {})
  const actionSearchRef = useRef<HTMLInputElement>(null)
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const attachmentRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const selectedLocalModel = models.some((model) => model.id === conversation?.model && model.available)
    ? conversation!.model
    : models.some((model) => model.id === preferredLocalModel && model.available)
      ? preferredLocalModel
      : models.find((model) => model.available && model.loaded)?.id ?? ''
  const localModelReady = models.some((model) => model.available && model.loaded)

  const refreshIndex = useCallback(async () => {
    const response = await fetch('/api/agent-session/conversations?models=true', { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not open Sessions.')
    setSessions(data.sessions)
    const localModels = (data.models.local ?? []) as ModelOption[]
    setModels(localModels)
    setPreferredLocalModel((current) => current || localModels.find((model) => model.available && model.loaded)?.id || '')
    setWorkspace((current) => current ?? data.workspace ?? null)
    return data.sessions as SessionSummary[]
  }, [])

  const loadConversation = useCallback(async (id: string) => {
    const response = await fetch(`/api/agent-session/conversations?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not open this session.')
    setConversation(data.conversation)
    const draftKey = `agenthub-session-draft:${id}`
    const pendingDraft = sessionStorage.getItem(draftKey)
    if (pendingDraft) { setComposer(pendingDraft); sessionStorage.removeItem(draftKey) }
    setWorkspaceInput(data.conversation.workspace)
    setWorkspaceId(data.conversation.workspaceId)
    setWorkspace(data.workspace ?? null)
    if (data.workspaceError) setError(data.workspaceError)
    setSidebarOpen(false)
    setRunning(data.running)
    runningRef.current = data.running
    setPaused(data.paused === true)
    setMascotActivity('agent-session', data.paused ? 'paused' : data.approval ? 'waiting' : data.running ? 'working' : 'idle')
    setApproval(data.approval)
    rememberCodingSession(id)
  }, [])

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      void refreshIndex().then(async (index) => {
        if (!alive) return
        const requested = new URLSearchParams(window.location.search).get('session') || localStorage.getItem('agenthub-active-coding-session')
        const chosen = index.find((entry) => entry.id === requested) ?? index[0]
        if (chosen) await loadConversation(chosen.id)
      }).catch((reason) => alive && setError(reason instanceof Error ? reason.message : 'Sessions could not load.')).finally(() => alive && setLoading(false))
    }, 0)
    return () => { alive = false; window.clearTimeout(timer); abortRef.current?.abort() }
  }, [loadConversation, refreshIndex])

  useEffect(() => {
    const select = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail
      if (typeof id !== 'string') return
      if (running) {
        if (conversation) rememberCodingSession(conversation.id)
        setError('Stop the current response before switching sessions.')
        return
      }
      void loadConversation(id).then(() => refreshIndex()).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not open session.'))
    }
    window.addEventListener('agenthub-select-coding-session', select)
    return () => window.removeEventListener('agenthub-select-coding-session', select)
  }, [loadConversation, refreshIndex, running, conversation])

  const activeSessionId = conversation?.id
  useEffect(() => {
    const onDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: unknown; title?: unknown; nextId?: unknown }>).detail
      if (typeof detail?.id !== 'string') return
      setSessions((current) => current.filter((entry) => entry.id !== detail.id))
      setDeletedSession({ id: detail.id, title: typeof detail.title === 'string' ? detail.title : 'session' })
      if (activeSessionId === detail.id) {
        setConversation(null); setApproval(null)
        const nextId = typeof detail.nextId === 'string' ? detail.nextId : undefined
        rememberCodingSession(nextId)
        if (nextId) void loadConversation(nextId).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not open session.'))
      }
    }
    const onRestored = (event: Event) => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id
      if (typeof id !== 'string') return
      setDeletedSession((current) => current?.id === id ? null : current)
      void refreshIndex().then(() => { if (!activeSessionId) return loadConversation(id) }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not refresh sessions.'))
    }
    window.addEventListener('agenthub-coding-session-deleted', onDeleted)
    window.addEventListener('agenthub-coding-session-restored', onRestored)
    return () => {
      window.removeEventListener('agenthub-coding-session-deleted', onDeleted)
      window.removeEventListener('agenthub-coding-session-restored', onRestored)
    }
  }, [activeSessionId, loadConversation, refreshIndex])

  const latestActivity = conversation?.turns.at(-1)?.items.map((item) => `${item.text}\n${item.output ?? ''}`).join('\n') ?? ''
  useEffect(() => { if (scrollRef.current && stickToBottom.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [conversation?.turns.length, latestActivity])

  const create = useCallback(async (selected?: WorkspaceInfo) => {
    if (running) throw new Error('Stop the current response before starting a new session.')
    if (pickingFolder && !selected) throw new Error('Finish selecting a project folder first.')
    setError('')
    const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', workspace: '.', workspaceId: selected?.id, mode: 'ro', model: selectedLocalModel, effort: 'medium', localOnly: true }) })
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not create a session.')
    setConversation(data.conversation); setApproval(null); setRunning(false); runningRef.current = false; setPaused(false); queuedMascotMessages.current = []; setMascotActivity('agent-session', 'idle')
    setWorkspace(data.workspace); setWorkspaceId(data.conversation.workspaceId); setWorkspaceInput(data.conversation.workspace); setSidebarOpen(false)
    rememberCodingSession(data.conversation.id)
    await refreshIndex()
    return data.conversation as CodingConversation
  }, [pickingFolder, refreshIndex, running, selectedLocalModel])

  const chooseFolder = async (action: 'pick' | 'select') => {
    if (running || pickingFolder) return
    setPickingFolder(true); setError('')
    try {
      const response = await fetch('/api/agent-session/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, workspaceId, ...(action === 'select' ? { path: folderPath.trim() } : {}) }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not select this folder.')
      if (data.cancelled) return
      const selected = data.workspace as WorkspaceInfo
      if (conversation && !conversation.turns.length) {
        const update = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings', id: conversation.id, workspaceId: selected.id, workspace: '.' }) })
        const result = await update.json()
        if (!update.ok || !result.ok) throw new Error(result.error || 'Could not change the project folder.')
        await loadConversation(conversation.id); await refreshIndex()
      } else await create(selected)
      setFolderPathOpen(false); setFolderPath('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not open the folder.') }
    finally { setPickingFolder(false) }
  }

  const deleteSession = async (entry: SessionSummary) => {
    setDeletingId(entry.id); setError('')
    try {
      const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: entry.id }) })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not delete this session.')
      setDeletedSession({ id: entry.id, title: entry.title })
      const remaining = sessions.filter((session) => session.id !== entry.id)
      setSessions(remaining)
      if (conversation?.id === entry.id) {
        setConversation(null); setApproval(null); rememberCodingSession()
        if (remaining[0]) await loadConversation(remaining[0].id)
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this session.') }
    finally { setDeletingId(null) }
  }

  const undoDelete = async () => {
    if (!deletedSession) return
    try {
      const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore', id: deletedSession.id }) })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not restore this session.')
      await refreshIndex(); await loadConversation(deletedSession.id); setDeletedSession(null)
      window.dispatchEvent(new CustomEvent('agenthub-coding-session-restored', { detail: { id: deletedSession.id } }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore this session.') }
  }

  const updateSetting = async (patch: Partial<Pick<CodingConversation, 'mode' | 'model' | 'effort' | 'workspaceAccess'>>) => {
    if (!conversation) return
    const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings', id: conversation.id, ...patch }) })
    const data = await response.json()
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not update session settings.')
    setConversation(data.conversation)
    await refreshIndex()
  }

  const changeChatPaused = useCallback(async (nextPaused: boolean) => {
    if (!conversation || !runningRef.current) return
    try {
      const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: nextPaused ? 'pause' : 'resume', id: conversation.id }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not change the chat state.')
      setPaused(data.paused === true)
      setMascotActivity('agent-session', data.paused ? 'paused' : mascotTaskMode.current)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change the chat state.') }
  }, [conversation])

  const send = useCallback(async (text = composer) => {
    const message = text.trim() || (attachedFiles.length ? 'Read and explain the attached files.' : '')
    if (!message || runningRef.current || !localModelReady) return
    setError(''); setComposer('')
    let active = conversation
    try { if (!active) active = await create() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create a session.'); return }
    setRunning(true)
    runningRef.current = true
    setPaused(false)
    let mascotOutcome: MascotActivityState = 'done'
    mascotTaskMode.current = isGameBuildRequest(message) ? 'game' : 'working'
    setMascotActivity('agent-session', mascotTaskMode.current)
    const controller = new AbortController(); abortRef.current = controller
    try {
      const files = attachedFiles
      const attachments = await Promise.all(files.map(async (file) => {
        const buffer = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (let offset = 0; offset < buffer.length; offset += 32768) binary += String.fromCharCode(...buffer.subarray(offset, offset + 32768))
        return { name: file.name, mime: file.type, size: file.size, dataBase64: btoa(binary) }
      }))
      const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', id: active.id, text: message, attachments }), signal: controller.signal })
      if (response.ok) setAttachedFiles([])
      if (!response.ok || !response.body) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Request failed (${response.status}).`) }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
      while (true) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const line = block.split(/\r?\n/).find((part) => part.startsWith('data:'))
          if (!line) continue
          const event = JSON.parse(line.slice(5).trim()) as SessionEvent
          if (event.type === 'approval') {
            setApproval(event.approval)
            mascotOutcome = event.approval ? 'waiting' : 'done'
            setMascotActivity('agent-session', event.approval ? 'waiting' : mascotTaskMode.current)
          } else if (event.type === 'paused') {
            setPaused(event.paused)
            setMascotActivity('agent-session', event.paused ? 'paused' : mascotTaskMode.current)
          } else if (event.type === 'turn') setConversation((previous) => {
            if (!previous || previous.id !== active!.id) return previous
            const turns = [...previous.turns]; const index = turns.findIndex((turn) => turn.id === event.turn.id)
            if (index < 0) turns.push(event.turn); else turns[index] = event.turn
            return { ...previous, turns, updatedAt: event.turn.endedAt ?? previous.updatedAt }
          })
          else if (event.type === 'delta') setConversation((previous) => {
            if (!previous || previous.id !== active!.id) return previous
            return { ...previous, turns: previous.turns.map((turn) => turn.id !== event.turnId ? turn : { ...turn, items: turn.items.map((item) => item.id === event.itemId ? { ...item, text: item.text + event.text } : item) }) }
          })
        }
        if (chunk.done) break
      }
      await refreshIndex()
    } catch (reason) {
      mascotOutcome = controller.signal.aborted ? 'idle' : 'error'
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The agent session failed.')
    } finally {
      abortRef.current = null
      runningRef.current = false
      setRunning(false)
      setPaused(false)
      setMascotActivity('agent-session', mascotOutcome)
      setApproval(null)
      if (controller.signal.aborted) queuedMascotMessages.current = []
      const queued = controller.signal.aborted ? undefined : queuedMascotMessages.current.shift()
      if (queued) window.setTimeout(() => { void sendRef.current(queued) }, 0)
    }
  }, [composer, conversation, create, localModelReady, refreshIndex, attachedFiles])

  useEffect(() => {
    sendRef.current = send
  }, [send])

  useEffect(() => {
    const onMascotSend = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: unknown; source?: unknown }>).detail
      const text = detail?.text
      if (typeof text !== 'string' || !text.trim()) return
      if (typeof detail.source === 'string' && detail.source !== 'agent-session') return
      if (runningRef.current) {
        if (queuedMascotMessages.current.length >= 5) { setError('The pet chat queue is full. Wait for a message to finish before adding another.'); return }
        queuedMascotMessages.current.push(text.trim())
      } else void sendRef.current(text)
    }
    const onMascotPause = (event: Event) => {
      const detail = (event as CustomEvent<{ paused?: unknown; source?: unknown }>).detail
      if (typeof detail?.source === 'string' && detail.source !== 'agent-session') return
      const requested = detail?.paused
      if (typeof requested === 'boolean') void changeChatPaused(requested)
    }
    window.addEventListener(MASCOT_CHAT_SEND_EVENT, onMascotSend)
    window.addEventListener(MASCOT_CHAT_PAUSE_EVENT, onMascotPause)
    return () => {
      window.removeEventListener(MASCOT_CHAT_SEND_EVENT, onMascotSend)
      window.removeEventListener(MASCOT_CHAT_PAUSE_EVENT, onMascotPause)
    }
  }, [changeChatPaused, conversation, running, paused])

  const approve = async (approved: boolean) => {
    if (!conversation || !approval) return
    const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', id: conversation.id, approvalId: approval.id, approved }) })
    const data = await response.json()
    if (!response.ok || !data.ok) setError(data.error || 'That approval has expired.')
    else setMascotActivity('agent-session', approved ? mascotTaskMode.current : 'idle')
    setApproval(null)
  }

  const stop = async () => {
    if (!conversation) return
    queuedMascotMessages.current = []
    abortRef.current?.abort()
    await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop', id: conversation.id }) }).catch(() => {})
  }

  const submit = (event: React.FormEvent) => { event.preventDefault(); void send() }
  const slashMatch = composer.match(/^\/([^\s]*)$/)
  const slashQuery = slashMatch?.[1]?.toLowerCase() ?? null
  const slashAgents = slashQuery === null ? [] : SESSION_AGENTS.filter((agent) => `${agent.command} ${agent.name} ${agent.description}`.toLowerCase().includes(slashQuery))
  const slashIcons = [Globe, Gamepad2, Microscope, Bot]
  const chooseAgent = (command: string) => { setComposer(`${command} `); setSlashIndex(0); requestAnimationFrame(() => composerRef.current?.focus()) }
  const commandOnly = /^\/(?:website|game|research|other)\s*$/i.test(composer)
  const workspaceAccess = conversation?.workspaceAccess ?? 'none'
  const selectedWorkspace = Boolean(workspaceId)
  const effectiveMode = workspaceAccess === 'write' && conversation?.mode === 'edit' ? 'edit' : 'ro'
  const preparePrompt = (prompt: string) => {
    const current = composer.trim()
    setComposer(`${prompt}${current ? ` ${current}` : ''}`)
    setActionsOpen(false)
    requestAnimationFrame(() => composerRef.current?.focus())
  }
  const prepareAgent = (command: string) => {
    const current = composer.trim().replace(/^\/(?:website|game|research|other)\s*/, '')
    setComposer(`${command} ${current}`.trimEnd() + ' ')
    setSlashIndex(0)
    setActionsOpen(false)
    requestAnimationFrame(() => composerRef.current?.focus())
  }
  const attachTextFile = async (file: File) => {
    const invalid = validateAttachment(file.name, file.type, file.size)
    if (invalid) { setError(invalid); return }
    if (attachedFiles.length >= MAX_ATTACHMENTS || attachedFiles.reduce((sum, entry) => sum + entry.size, 0) + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
      setError('Attach at most 8 files and 16 MB in total.'); return
    }
    setAttachedFiles((previous) => [...previous, file])
    setError('')
  }

  const actionCategories = ['All', 'Goals & planning', 'Web & research', 'Files & workspace', 'Apps & plugins', 'Agents & skills'] as const
  const actions: ComposerAction[] = [
    { id: 'draft-plan', category: 'Goals & planning', label: 'Draft a plan', description: 'Add a step-by-step plan request to the composer.', icon: ListChecks },
    { id: 'break-task', category: 'Goals & planning', label: 'Break down a task', description: 'Turn a task into small steps you can review.', icon: ListTodo },
    { id: 'view-tasks', category: 'Goals & planning', label: 'View tasks', description: 'Open the existing AgentHub task board.', icon: ClipboardList },
    { id: 'project-research', category: 'Web & research', label: 'Research this project', description: 'Use the local project research agent and selected workspace.', icon: Microscope },
    { id: 'web-search', category: 'Web & research', label: 'Web search', description: 'No external web-search tool is configured for Sessions.', icon: Globe, unavailable: true },
    { id: 'open-url', category: 'Web & research', label: 'Open or analyze a URL', description: 'Sessions cannot browse external pages in this setup.', icon: ExternalLink, unavailable: true },
    { id: 'attach-file', category: 'Files & workspace', label: 'Attach a text file', description: 'Adds text to the draft; it goes to the selected model only when you send (128 KB max).', icon: FilePlus2 },
    { id: 'browse-workspace', category: 'Files & workspace', label: 'Choose project folder', description: 'Select a folder; access remains off until you grant it.', icon: FolderOpen },
    { id: 'open-file', category: 'Files & workspace', label: 'Read a project file', description: selectedWorkspace && workspaceAccess !== 'none' ? 'Reads only the file you name inside the selected project.' : 'Select a project folder and allow reading first.', icon: FileCode2, disabled: !selectedWorkspace || workspaceAccess === 'none' },
    { id: 'use-context', category: 'Files & workspace', label: 'Use project context', description: 'Ask about files in the selected workspace.', icon: FileCode2 },
    { id: 'components', category: 'Apps & plugins', label: 'Browse UI Components', description: 'Open the local component catalog; proposals need review.', icon: Blocks },
    { id: 'models', category: 'Apps & plugins', label: 'Manage model providers', description: 'Check the local model providers available to Agent Sessions.', icon: Puzzle },
    { id: 'connectors', category: 'Apps & plugins', label: 'Third-party app connections', description: 'No Microsoft, Google, GitHub, or productivity connectors are installed.', icon: Puzzle, unavailable: true },
    ...SESSION_AGENTS.map((agent, index): ComposerAction => ({ id: `agent-${agent.id}`, category: 'Agents & skills', label: agent.name, description: agent.description, icon: slashIcons[index] ?? Bot })),
    { id: 'skills', category: 'Agents & skills', label: 'Browse installed skills', description: 'Open the existing Skills Library.', icon: BookOpen },
    { id: 'tools', category: 'Agents & skills', label: 'Ask about available tools', description: 'Prepare a request listing tools and their permission requirements.', icon: Wrench },
    { id: 'computer', category: 'Computer & dev', label: 'Open Auto computer control', description: 'Use the separate supervised computer workflow.', icon: Laptop },
    { id: 'browser-control', category: 'Computer & dev', label: 'Browser automation', description: 'No browser-control tool is available in Sessions.', icon: Globe, unavailable: true },
  ]
  const visibleActions = actions.filter((action) => (actionCategory === 'All' || action.category === actionCategory) && `${action.label} ${action.description} ${action.category}`.toLowerCase().includes(actionSearch.trim().toLowerCase()))
  const runComposerAction = (id: string) => {
    if (id.startsWith('agent-')) {
      const agent = SESSION_AGENTS.find((entry) => `agent-${entry.id}` === id)
      if (agent) prepareAgent(agent.command)
      return
    }
    switch (id) {
      case 'draft-plan': preparePrompt('Create a concise, verifiable plan for:'); break
      case 'break-task': preparePrompt('Break this task into small, verifiable steps:'); break
      case 'view-tasks': setActionsOpen(false); setView('tasks'); break
      case 'project-research': prepareAgent('/research'); break
      case 'attach-file': setActionsOpen(false); attachmentRef.current?.click(); break
      case 'browse-workspace': setActionsOpen(false); setSidebarOpen(true); break
      case 'open-file': preparePrompt('Read this file from the selected project and summarize it:'); break
      case 'use-context': preparePrompt('Use the selected project context to help me with:'); break
      case 'components': setActionsOpen(false); setView('ui-components'); break
      case 'models': setActionsOpen(false); setView('models'); break
      case 'skills': setActionsOpen(false); setSkillsOpen(true); break
      case 'tools': preparePrompt('List the tools available in this session and explain their permission requirements.'); break
      case 'terminal': preparePrompt('Run this command in the selected project after showing me the exact command:'); break
      case 'build-test': preparePrompt('Inspect the project instructions, identify the relevant build or test command, ask before running it, and report the actual exit code.'); break
      case 'computer': setActionsOpen(false); setView('auto'); break
    }
  }
  const rootLabel = workspace?.root ?? conversation?.workspaceLabel ?? ''
  const folderLabel = workspaceInput === '.' ? rootLabel : `${rootLabel.replace(/[\\/]$/, '')}/${workspaceInput}`

  return <div className={cn('relative flex h-full min-h-0 bg-background text-foreground', conversationLayout === 'unified' && conversationStyles.unified)} data-chat-surface="workspace">
    {sidebarOpen ? <button className="absolute inset-0 z-20 bg-black/30 md:hidden" aria-label="Close sessions sidebar" onClick={() => setSidebarOpen(false)} /> : null}
    <aside className={cn('absolute inset-y-0 left-0 z-30 w-[min(290px,85vw)] shrink-0 flex-col border-r bg-sidebar md:static md:z-auto md:flex md:w-[270px]', sidebarOpen ? 'flex' : 'hidden')} data-chat-surface="sidebar">
      <div className="flex items-center gap-2 border-b px-4 py-4"><span className="font-semibold">Agent Session</span><Button variant="ghost" size="icon" disabled={running || pickingFolder} className="ml-auto size-8" aria-label="New session" onClick={() => { void create().catch((e) => setError(e.message)) }}><MessageSquarePlus className="size-4" /></Button></div>
      <div className="space-y-2.5 border-b p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Folder className="size-3.5" />PROJECT FOLDER</div>
        <div title={folderLabel} className="line-clamp-2 break-all rounded-xl border bg-background px-3 py-2 font-mono text-[10px] leading-4 text-foreground/80" data-testid="session-project-folder">{folderLabel || 'Select a project folder'}</div>
        <div className="flex gap-1.5"><Button type="button" variant="outline" size="sm" className="h-8 flex-1 rounded-lg text-xs" disabled={running || pickingFolder} onClick={() => void chooseFolder('pick')}>{pickingFolder ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <FolderOpen className="mr-1.5 size-3.5" />}Browse folders</Button>
          <Popover open={folderPathOpen} onOpenChange={setFolderPathOpen}><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" disabled={running || pickingFolder} className="text-[11px]">Paste path</Button></PopoverTrigger><PopoverContent align="start" data-conversation-theme={conversationAppearance} className={cn(conversationStyles.theme, 'w-[min(340px,calc(100vw-2rem))] rounded-xl')}><form onSubmit={(event) => { event.preventDefault(); void chooseFolder('select') }}><label htmlFor="session-folder-path" className="text-sm font-medium">Open a project folder</label><input id="session-folder-path" autoFocus value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="Full folder path on this computer" className="mt-2 w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs" /><Button type="submit" size="sm" disabled={!folderPath.trim() || pickingFolder} className="mt-3 w-full">Use folder</Button></form></PopoverContent></Popover>
        </div><p className="text-[10px] leading-4 text-muted-foreground">Selecting a folder does not grant access.</p>
        <label className="block text-[11px] font-medium text-muted-foreground">WORKSPACE ACCESS
          <HubSelect ariaLabel="Workspace permission" contentTheme={conversationAppearance} contentClassName={conversationStyles.theme} className="mt-1 w-full rounded-lg border bg-background p-2 text-xs text-foreground" value={conversation?.workspaceAccess ?? 'none'} disabled={!conversation || !workspaceId} onValueChange={(value) => { const access = value as CodingConversation['workspaceAccess']; void updateSetting({ workspaceAccess: access, ...(access === 'write' ? { mode: 'edit' as const } : { mode: 'ro' as const }) }).catch((e) => setError(e.message)) }}>
            <HubSelectItem value="none">No access</HubSelectItem><HubSelectItem value="read" disabled={running}>Allow reading</HubSelectItem><HubSelectItem value="write" disabled={running}>Allow approved file changes</HubSelectItem>
          </HubSelect>
        </label>
        <p className="text-[10px] leading-4 text-muted-foreground">File changes require approval and stay inside this selected folder.</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2"><div className="flex items-center px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sessions <button className="ml-auto rounded p-1 hover:bg-accent" aria-label="New session" onClick={() => { void create().catch((e) => setError(e.message)) }}><Plus className="size-3.5" /></button></div>
        {sessions.map((entry) => <div key={entry.id} className={cn('group/session mb-0.5 flex items-center rounded-xl transition-colors hover:bg-accent/70', conversation?.id === entry.id && 'bg-accent')}><button disabled={running || pickingFolder} onClick={() => { void loadConversation(entry.id).catch((e) => setError(e.message)) }} className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="block truncate text-sm">{entry.title}</span><span title={entry.workspaceLabel ?? entry.workspace} className="mt-1 block truncate text-[10px] text-muted-foreground">{entry.workspaceLabel?.split(/[\\/]/).pop() || entry.workspace} · {entry.turnCount} {entry.turnCount === 1 ? 'message' : 'messages'} · {relativeTime(entry.updatedAt)}</span></button><button type="button" aria-label={`Delete session ${entry.title}`} title="Delete session" disabled={deletingId !== null || (running && conversation?.id === entry.id)} onClick={() => void deleteSession(entry)} className="mr-1.5 shrink-0 rounded-lg p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 sm:opacity-0 sm:group-hover/session:opacity-100">{deletingId === entry.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</button></div>)}
        {!sessions.length && !loading ? <p className="px-3 py-5 text-xs text-muted-foreground">Your conversations will appear here.</p> : null}
      </div>
      <div className="border-t p-3 text-[10px] leading-4 text-muted-foreground"><span className="font-medium text-foreground/80">{workspace?.projectName || 'Local project'}</span><br />Session tools use this project.</div>
    </aside>
    <main className="flex min-w-0 flex-1 flex-col" data-chat-surface="canvas">
      <header className="flex min-h-16 flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2.5 md:px-6" data-chat-surface="header">
        <Button variant="ghost" size="icon" className="size-8 md:hidden" aria-label="Open sessions and folders" onClick={() => setSidebarOpen(true)}><PanelLeft className="size-4" /></Button>
        <div className="min-w-[140px] flex-1"><div className="truncate text-sm font-semibold">{conversation?.title ?? 'New session'}</div><div title={folderLabel} className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Folder className="size-3 shrink-0" /><span className="max-w-[260px] truncate">{workspace?.projectName ?? conversation?.workspace ?? workspaceInput}</span><span aria-hidden="true">·</span>{effectiveMode === 'edit' ? 'Edit · approval required' : workspaceAccess === 'none' ? 'No access' : 'Read only'}</div></div>
        <HubSelect ariaLabel="Select local model" contentTheme={conversationAppearance} contentClassName={conversationStyles.theme} value={selectedLocalModel} disabled={running || models.length === 0} onValueChange={(value) => { setPreferredLocalModel(value); if (conversation) void updateSetting({ model: value }).catch((e) => setError(e.message)) }} className="h-9 max-w-[240px] rounded-xl bg-card px-3 text-xs shadow-sm">{models.length === 0 ? <HubSelectItem value="">No local model available</HubSelectItem> : models.map((model) => <HubSelectItem key={`${model.provider}:${model.id}`} value={model.id}>{model.label}{model.loaded ? ' · loaded' : ''}</HubSelectItem>)}</HubSelect>
        <ThinkingEffortControl value={conversation?.effort ?? 'medium'} disabled={running || !conversation} appearance={conversationAppearance} onChange={(effort) => { void updateSetting({ effort }).catch((e) => setError(e.message)) }} />
        <Button variant={effectiveMode === 'edit' ? 'default' : 'outline'} className="rounded-xl" size="sm" disabled={running || conversation?.workspaceAccess !== 'write'} onClick={() => { void updateSetting({ mode: effectiveMode === 'edit' ? 'ro' : 'edit' }).catch((e) => setError(e.message)) }}>{conversation?.workspaceAccess === 'none' || !conversation?.workspaceAccess ? 'No workspace access' : effectiveMode === 'edit' ? 'Edit · approvals on' : 'Read only'}</Button>
        <Button variant="outline" size="sm" className="md:hidden" onClick={() => { void create().catch((e) => setError(e.message)) }}><Plus className="mr-1 size-3.5" />New</Button>
      </header>
      <div ref={scrollRef} onScroll={(event) => { const element = event.currentTarget; stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120 }} className="hub-scroll min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8" data-chat-surface="feed">
        {loading ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />Opening sessions…</div> : null}
        {!loading && !conversation ? <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center"><div className="mb-4 rounded-2xl border bg-card p-4"><Bot className="size-8 text-primary" /></div><h1 className="text-xl font-semibold">Work with your project</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Ask a question, inspect files, or describe a change. The agent shows each action and its result as it works.</p><Button className="mt-5" onClick={() => { void create().catch((e) => setError(e.message)) }}><Plus className="mr-2 size-4" />New session</Button></div> : null}
        {conversation?.turns.map((turn, index) => <TurnView key={turn.id} turn={turn} onAnswer={(answer) => { void send(answer) }} questionsDisabled={running || !localModelReady} answered={index < conversation.turns.length - 1} />)}
        {conversation && conversation.turns.length === 0 ? <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4 text-center"><div className="mb-4 flex size-12 items-center justify-center rounded-2xl border bg-card shadow-sm"><Bot className="size-6 text-primary" /></div><h1 className="text-2xl font-semibold tracking-tight">What should we work on?</h1><p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">Ask about your project or choose a focused agent with a slash command. Agent selection stays off unless you activate one.</p><div className="mt-5 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">{SESSION_AGENTS.map((agent, index) => { const Icon = slashIcons[index]; return <button key={agent.id} className="group flex items-start gap-3 rounded-2xl border bg-card p-3 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm" onClick={() => chooseAgent(agent.command)}><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4" /></span><span className="min-w-0"><span className="block text-sm font-medium">{agent.name}<code className="ml-2 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{agent.command}</code></span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{agent.description}</span></span></button> })}</div><div className="mt-5 flex flex-wrap justify-center gap-2">{['Read the project instructions', 'Explain the project structure', 'How many files are here?'].map((suggestion) => <button key={suggestion} className="rounded-full border bg-card px-3 py-2 text-xs transition hover:border-primary/30 hover:bg-accent" onClick={() => void send(suggestion)}>{suggestion}</button>)}</div></div> : null}
        {conversation?.turns.at(-1)?.status === 'running' && !running ? <div className="mx-auto mb-5 flex max-w-4xl items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Reconnecting to the running session…</div> : null}
      </div>
      <div className="border-t bg-background px-3 py-3 md:px-6 md:py-4" data-chat-surface="composer-area">
        {deletedSession ? <div role="status" className="mx-auto mb-3 flex max-w-4xl items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs"><Trash2 className="size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">Deleted “{deletedSession.title}”</span><Button type="button" variant="ghost" size="sm" disabled={running} className="h-7 text-xs" onClick={() => void undoDelete()}><Undo2 className="mr-1 size-3.5" />Undo</Button><button type="button" aria-label="Dismiss deletion notice" onClick={() => setDeletedSession(null)}><X className="size-3.5" /></button></div> : null}
        {approval && running ? <div className="mx-auto mb-3 max-w-4xl rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4"><div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" /><div className="min-w-0 flex-1"><div className="font-medium">Allow {approval.name.replaceAll('_', ' ')}?</div><p className="mt-1 text-xs text-muted-foreground">The agent is asking to act in this project. Review the exact request before allowing it.</p><pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-background p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(approval.args, null, 2)}</pre><div className="mt-3 flex gap-2"><Button size="sm" onClick={() => void approve(true)}><Check className="mr-1.5 size-3.5" />Allow once</Button><Button size="sm" variant="outline" onClick={() => void approve(false)}>Decline</Button></div></div></div></div> : null}
        {!localModelReady ? <div role="status" className="mx-auto mb-2 max-w-4xl rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">Load a chat model in LM Studio or Ollama to use Agent Sessions.</div> : null}
        {error ? <div className="mx-auto mb-2 flex max-w-4xl items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"><span className="flex-1">{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X className="size-3.5" /></button></div> : null}
        <form onSubmit={submit} className="relative mx-auto max-w-4xl rounded-2xl border bg-card shadow-sm transition focus-within:border-primary/50 focus-within:shadow-md" data-chat-surface="composer">
          {attachedFiles.length ? <div className="flex flex-wrap gap-2 p-2" aria-label="Session attachments">{attachedFiles.map((file, index) => <span key={index} className="rounded border px-2 py-1 text-xs">{file.name}<button type="button" aria-label={`Remove ${file.name}`} disabled={running} onClick={() => setAttachedFiles((previous) => previous.filter((_, position) => position !== index))}> ×</button></span>)}</div> : null}
          <input ref={attachmentRef} type="file" accept=".pdf,.docx,.zip,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,text/plain,application/pdf,image/png,image/jpeg,image/webp,application/zip" className="hidden" aria-label="Attach PDF, image, ZIP or text file" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void attachTextFile(file) }} />
          <Popover open={actionsOpen} onOpenChange={(open) => { setActionsOpen(open); if (!open) { setActionSearch(''); setActionCategory('All') } }}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="icon" disabled={running || loading} aria-label="Open session actions" aria-haspopup="dialog" aria-expanded={actionsOpen} title="More actions" className="absolute bottom-3 left-3 z-10 size-9 rounded-xl bg-background">
                <Plus className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" sideOffset={10} collisionPadding={12} aria-label="Session actions" data-conversation-theme={conversationAppearance} onOpenAutoFocus={(event) => { event.preventDefault(); actionSearchRef.current?.focus() }} className={cn(conversationStyles.theme, 'w-[min(27rem,calc(100vw-1.5rem))] rounded-2xl p-0 shadow-xl')}>
              <div className="border-b p-3">
                <div className="mb-2 flex items-center gap-2 px-1"><div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-3.5" /></div><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Add to this session</h2><p className="text-[11px] text-muted-foreground">Tools and actions available in AgentHub</p></div></div>
                <div className="flex items-center gap-2 rounded-xl border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring"><Search aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><input ref={actionSearchRef} type="search" value={actionSearch} onChange={(event) => setActionSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown' && visibleActions.length) { event.preventDefault(); actionRefs.current[0]?.focus() } }} placeholder="Search actions" aria-label="Search session actions" className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /><kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">Esc</kbd></div>
              </div>
              <div role="tablist" aria-label="Session action categories" className="hub-scroll flex gap-1.5 overflow-x-auto border-b px-3 py-2">
                {actionCategories.map((category) => <button key={category} type="button" role="tab" aria-selected={actionCategory === category} onClick={() => setActionCategory(category)} className={cn('shrink-0 rounded-full px-2.5 py-1.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', actionCategory === category ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground')}>{category}</button>)}
              </div>
              <div className="hub-scroll max-h-[min(48vh,22rem)] min-h-24 overflow-y-auto p-2" aria-label="Available actions">
                {visibleActions.length ? <div className="space-y-1">
                  {visibleActions.map((action, index) => {
                    const Icon = action.icon
                    const status = action.unavailable ? 'Unavailable' : action.disabled ? 'Needs access' : null
                    const content = <><span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-xs font-medium">{action.label}{status ? <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{status}</span> : null}</span><span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">{action.description}</span></span></>
                    return <div key={action.id}>
                      {(actionCategory === 'All' && (index === 0 || visibleActions[index - 1]?.category !== action.category)) ? <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{action.category}</div> : null}
                      {action.unavailable ? <div aria-disabled="true" className="flex cursor-not-allowed items-center gap-2.5 rounded-xl px-2.5 py-2 opacity-65">{content}</div> : <button ref={(element) => { actionRefs.current[index] = element }} type="button" disabled={action.disabled} onClick={() => runComposerAction(action.id)} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const direction = event.key === 'ArrowDown' ? 1 : -1; const next = (index + direction + visibleActions.length) % visibleActions.length; actionRefs.current[next]?.focus() } }} title={action.disabled ? action.description : undefined} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">{content}</button>}
                    </div>
                  })}
                </div> : <div className="flex min-h-20 items-center justify-center px-4 text-center text-xs text-muted-foreground">No matching actions. Try another search.</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2.5"><span className="min-w-0 flex-1 text-[10px] text-muted-foreground">Project access: {selectedWorkspace ? workspaceAccess === 'none' ? 'off' : workspaceAccess === 'write' ? 'approved edits' : 'read only' : 'no folder selected'}</span><Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[10px]" onClick={() => { setActionsOpen(false); setSidebarOpen(true) }}>Review access</Button></div>
            </PopoverContent>
          </Popover>
          {slashQuery !== null && slashAgents.length > 0 ? <div role="listbox" aria-label="Choose an agent" className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md overflow-hidden rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-xl">{slashAgents.map((agent, optionIndex) => { const index = SESSION_AGENTS.findIndex((entry) => entry.id === agent.id); const Icon = slashIcons[index]; const selected = optionIndex === slashIndex; return <button key={agent.id} type="button" role="option" aria-selected={selected} onMouseEnter={() => setSlashIndex(optionIndex)} onClick={() => chooseAgent(agent.command)} className={cn('flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors', selected ? 'bg-accent' : 'hover:bg-accent/60')}><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-medium"><code>{agent.command}</code><span>{agent.name}</span></span><span className="mt-0.5 block text-xs text-muted-foreground">{agent.description}</span></span><Search className="size-3.5 text-muted-foreground" /></button> })}<div className="border-t px-3 py-2 text-[10px] text-muted-foreground">Search agents by typing after / · ↑↓ to navigate · Enter to select</div></div> : null}
          <textarea ref={composerRef} value={composer} onChange={(event) => { setComposer(event.target.value); setSlashIndex(0) }} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); return }; if (slashQuery !== null && slashAgents.length > 0) { if (event.key === 'ArrowDown') { event.preventDefault(); setSlashIndex((current) => (current + 1) % slashAgents.length); return }; if (event.key === 'ArrowUp') { event.preventDefault(); setSlashIndex((current) => (current - 1 + slashAgents.length) % slashAgents.length); return }; if (event.key === 'Escape') { event.preventDefault(); setComposer(''); return }; if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); chooseAgent(slashAgents[slashIndex % slashAgents.length].command); return } }; if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} disabled={running} rows={Math.min(6, Math.max(2, composer.split('\n').length))} placeholder={conversation ? 'Message your coding agent… (type / to choose an agent)' : 'Message your agent… (type / to choose an agent)'} className="max-h-48 min-h-16 w-full resize-none bg-transparent px-4 py-4 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60" />
          <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-3 pl-3">
            {running ? <><Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void changeChatPaused(!paused)}>{paused ? <Play className="mr-1.5 size-3.5" /> : <Pause className="mr-1.5 size-3.5" />}{paused ? 'Resume' : 'Pause'}</Button><Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void stop()}><Square className="mr-1.5 size-3.5 fill-current" />Stop</Button></> : <Button type="submit" size="sm" className="rounded-xl px-4" disabled={(!composer.trim() && !attachedFiles.length) || commandOnly || !localModelReady}><Send className="mr-1.5 size-3.5" />Send</Button>}
          </div>
        </form>
      </div>
      {skillsOpen ? <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Skills Library" onKeyDown={(event) => { if (event.key === 'Escape') setSkillsOpen(false) }} onClick={(event) => { if (event.target === event.currentTarget) setSkillsOpen(false) }}><div className="flex h-[min(42rem,calc(100vh-1.5rem))] w-full max-w-5xl flex-col rounded-2xl border bg-background p-3 shadow-2xl sm:p-5"><SkillsLibraryPanel onClose={() => setSkillsOpen(false)} /></div></div> : null}
    </main>
  </div>
}
