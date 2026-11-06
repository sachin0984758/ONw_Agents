'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, Plus, Trash2, Undo2 } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useHub } from '@/lib/agent-hub/store'
import type { ViewId } from '@/lib/agent-hub/types'
import type { SessionSummary } from '@/lib/agent-hub/session/types'
import { rememberCodingSession } from '@/lib/agent-hub/session/navigation'
import { AUTO_DELETION_EVENT, readAutoSelection, rememberAutoTask } from '@/lib/agent-hub/computer/navigation'
import type { AutoTask } from '@/lib/agent-hub/computer/protocol'
import { discardChatRun, getChatRun } from '@/lib/agent-hub/chat-runs'

const deleteButtonClass = 'mr-1 shrink-0 rounded-lg p-2 text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:opacity-0 group-hover/conversation:opacity-100 group-focus-within/conversation:opacity-100 disabled:cursor-not-allowed disabled:opacity-40'

export function SidebarHoverMenu({ viewId, label, children }: { viewId: ViewId; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState<Array<{ id: string; title: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletedSession, setDeletedSession] = useState<SessionSummary | null>(null)
  const [autoTasks, setAutoTasks] = useState<Pick<AutoTask, 'id' | 'title' | 'phase'>[]>([])
  const [autoActiveId, setAutoActiveId] = useState<string | null>(null)
  const setView = useHub((s) => s.setView)

  useEffect(() => {
    if (viewId !== 'auto') return
    const onDeleted = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail
      if (typeof id !== 'string') return
      setAutoTasks((current) => current.filter((entry) => entry.id !== id))
      if (readAutoSelection() === id) rememberAutoTask('')
    }
    window.addEventListener(AUTO_DELETION_EVENT, onDeleted)
    return () => window.removeEventListener(AUTO_DELETION_EVENT, onDeleted)
  }, [viewId])

  useEffect(() => {
    if (viewId !== 'sessions') return
    const onRestored = (event: Event) => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id
      if (typeof id !== 'string') return
      setDeletedSession((current) => current?.id === id ? null : current)
      void fetch('/api/agent-session/conversations', { cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error('Could not refresh sessions.')
        const data = await response.json()
        setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      }).catch(() => setError('Could not refresh sessions.'))
    }
    window.addEventListener('agenthub-coding-session-restored', onRestored)
    return () => window.removeEventListener('agenthub-coding-session-restored', onRestored)
  }, [viewId])

  const openSession = (id: string) => {
    rememberCodingSession(id)
    setView('sessions')
    window.dispatchEvent(new CustomEvent('agenthub-select-coding-session', { detail: id }))
    setOpen(false)
  }

  const openChat = (id: string) => {
    window.localStorage.setItem('agenthub-active-chat', id)
    setView('chat')
    window.dispatchEvent(new CustomEvent('agenthub-select-chat', { detail: id }))
    setOpen(false)
  }

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (!next || !['chat', 'sessions', 'auto'].includes(viewId)) return
    setLoading(true)
    setError('')
    fetch(viewId === 'auto' ? '/api/computer' : viewId === 'chat' ? '/api/chat/conversations' : '/api/agent-session/conversations', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load chats.')
        const json = await res.json()
        if (viewId === 'chat') setChats(Array.isArray(json.conversations) ? json.conversations : [])
        else if (viewId === 'auto') {
          setAutoTasks(Array.isArray(json.tasks) ? json.tasks : [])
          setAutoActiveId(typeof json.activeId === 'string' ? json.activeId : null)
        }
        else setSessions(Array.isArray(json.sessions) ? json.sessions : [])
      })
      .catch(() => setError(`Could not load ${label.toLowerCase()}. Click ${label} to try again.`))
      .finally(() => setLoading(false))
  }

  const deleteChat = async (chat: { id: string; title: string }) => {
    if (deletingId || chat.id === 'legacy') return
    if (getChatRun(chat.id).pending) { setError('Stop this chat before deleting it.'); return }
    if (!window.confirm(`Delete “${chat.title}” and its messages?`)) return
    setDeletingId(chat.id); setError('')
    try {
      const response = await fetch(`/api/chat/conversations?id=${encodeURIComponent(chat.id)}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not delete this chat.')
      discardChatRun(chat.id)
      const remaining = chats.filter((entry) => entry.id !== chat.id)
      const nextId = remaining[0]?.id || 'legacy'
      setChats(remaining)
      if (localStorage.getItem('agenthub-active-chat') === chat.id) localStorage.setItem('agenthub-active-chat', nextId)
      window.dispatchEvent(new CustomEvent('agenthub-chat-deleted', { detail: { id: chat.id, nextId } }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this chat.') }
    finally { setDeletingId(null) }
  }

  const deleteAuto = async (task: Pick<AutoTask, 'id' | 'title'>) => {
    if (deletingId) return
    if (autoActiveId === task.id) { setError('Stop this Auto task before deleting it.'); return }
    if (!window.confirm(`Delete “${task.title}” and its Auto history?`)) return
    setDeletingId(task.id); setError('')
    try {
      const response = await fetch('/api/computer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: task.id }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not delete this Auto task.')
      setAutoTasks((current) => current.filter((entry) => entry.id !== task.id))
      setAutoActiveId(typeof data.activeId === 'string' ? data.activeId : null)
      if (readAutoSelection() === task.id) rememberAutoTask('')
      window.dispatchEvent(new CustomEvent(AUTO_DELETION_EVENT, { detail: task.id }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this Auto task.') }
    finally { setDeletingId(null) }
  }

  const deleteSession = async (session: SessionSummary) => {
    if (deletingId) return
    setDeletingId(session.id); setError('')
    try {
      const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: session.id }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not delete this session.')
      const remaining = sessions.filter((entry) => entry.id !== session.id)
      const nextId = remaining[0]?.id
      setSessions(remaining); setDeletedSession(session)
      if (localStorage.getItem('agenthub-active-coding-session') === session.id || new URL(window.location.href).searchParams.get('session') === session.id) rememberCodingSession(nextId)
      window.dispatchEvent(new CustomEvent('agenthub-coding-session-deleted', { detail: { id: session.id, title: session.title, nextId } }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete this session.') }
    finally { setDeletingId(null) }
  }

  const undoSessionDelete = async () => {
    if (!deletedSession || deletingId) return
    setDeletingId(deletedSession.id); setError('')
    try {
      const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore', id: deletedSession.id }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not restore this session.')
      setSessions((current) => [deletedSession, ...current.filter((entry) => entry.id !== deletedSession.id)])
      window.dispatchEvent(new CustomEvent('agenthub-coding-session-restored', { detail: { id: deletedSession.id } }))
      setDeletedSession(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore this session.') }
    finally { setDeletingId(null) }
  }

  if (!['chat', 'sessions', 'auto'].includes(viewId)) {
    return (
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={12} className="rounded-xl">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <HoverCard open={open} onOpenChange={changeOpen} openDelay={150} closeDelay={180}>
      <HoverCardTrigger asChild onFocus={() => changeOpen(true)}>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={12} collisionPadding={12} aria-label={`${label} conversations`} className="w-72 max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-hover-card-content-available-height)] overflow-y-auto rounded-2xl p-3 shadow-xl duration-200" onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }}>
        <div className="mb-2 px-2 text-sm font-semibold">{label}</div>
        {viewId === 'auto' ? (
          <>
            <p className="mb-2 px-2 text-xs text-muted-foreground">Recent Auto sessions</p>
            {error ? <p role="alert" className="px-2 py-2 text-xs text-red-600">{error}</p> : null}
            <div className="hub-scroll max-h-80 space-y-1 overflow-y-auto">
              {loading ? <p className="px-2 py-2 text-xs text-muted-foreground">Loading sessions…</p> : autoTasks.map((task) => (
                <div key={task.id} className="group/conversation flex items-center rounded-xl hover:bg-secondary focus-within:bg-secondary">
                <button type="button" onClick={() => { rememberAutoTask(task.id); setView('auto'); setOpen(false) }} title={task.title} className="min-w-0 flex-1 rounded-xl px-2 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block truncate">{task.title}</span>
                  <span className="mt-0.5 block text-[10px] capitalize text-muted-foreground">{task.phase}</span>
                </button>
                <button type="button" onClick={() => void deleteAuto(task)} disabled={deletingId !== null || task.id === autoActiveId} aria-label={`Delete Auto task ${task.title}`} title={task.id === autoActiveId ? 'Stop the active task before deleting it' : 'Delete Auto task'} className={deleteButtonClass}>{deletingId === task.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</button>
                </div>
              ))}
              {!loading && !error && autoTasks.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">No Auto sessions yet. Open Auto to start a task.</p> : null}
            </div>
          </>
        ) : viewId === 'chat' ? (
          <>
            <button type="button" className="mb-2 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs hover:bg-secondary" onClick={async () => {
              try {
                const res = await fetch('/api/chat/conversations', { method: 'POST' })
                const json = await res.json()
                if (!res.ok || !json.conversation?.id) throw new Error('Could not create chat.')
                openChat(json.conversation.id)
              } catch { setError('Could not create chat. Please try again.') }
            }}><Plus className="size-4" /> New chat</button>
            {error ? <p role="alert" className="px-2 py-2 text-xs text-red-600">{error}</p> : null}
            <div className="hub-scroll max-h-80 space-y-1 overflow-y-auto">
              {loading ? <p className="px-2 py-2 text-xs text-muted-foreground">Loading chats…</p> : chats.map((chat) => (
                <div key={chat.id} className="group/conversation flex items-center rounded-xl hover:bg-secondary focus-within:bg-secondary">
                  <button type="button" onClick={() => openChat(chat.id)} className="min-w-0 flex-1 truncate rounded-xl px-2 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title={chat.title}>{chat.title}</button>
                  {chat.id !== 'legacy' ? <button type="button" onClick={() => void deleteChat(chat)} disabled={deletingId !== null || getChatRun(chat.id).pending} aria-label={`Delete chat ${chat.title}`} title="Delete chat" className={deleteButtonClass}>{deletingId === chat.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</button> : null}
                </div>
              ))}
              {!loading && !error && chats.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">No conversations yet.</p> : null}
            </div>
          </>
        ) : (
          <>
          <button type="button" className="mb-2 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-xs hover:bg-secondary" onClick={async () => {
            try {
              const activeId = localStorage.getItem('agenthub-active-coding-session')
              const active = sessions.find((session) => session.id === activeId)
              const res = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', workspace: active?.workspace ?? '.', workspaceId: active?.workspaceId, mode: 'ro' }) })
              const json = await res.json()
              if (!res.ok || !json.conversation?.id) throw new Error('Could not create session.')
              openSession(json.conversation.id)
            } catch { setError('Could not create a session. Please try again.') }
          }}><Plus className="size-4" />New session</button>
          {error ? <p role="alert" className="px-2 py-2 text-xs text-red-600">{error}</p> : null}
          <div className="hub-scroll max-h-80 space-y-1 overflow-y-auto">
            {loading ? <p className="px-2 py-2 text-xs text-muted-foreground">Loading sessions…</p> : sessions.map((session) => (
              <div key={session.id} className="group/conversation flex items-center rounded-xl hover:bg-secondary focus-within:bg-secondary">
                <button type="button" onClick={() => openSession(session.id)} title={session.workspaceLabel ?? session.workspace} className="min-w-0 flex-1 rounded-xl px-2 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="block truncate">{session.title}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{session.workspaceLabel?.split(/[\\/]/).pop() || session.workspace} · {session.turnCount} {session.turnCount === 1 ? 'message' : 'messages'}</span></button>
                <button type="button" onClick={() => void deleteSession(session)} disabled={deletingId !== null} aria-label={`Delete session ${session.title}`} title="Delete session" className={deleteButtonClass}>{deletingId === session.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</button>
              </div>
            ))}
            {!loading && !error && sessions.length === 0 ? <p className="px-2 py-2 text-xs text-muted-foreground">No sessions yet.</p> : null}
          </div>
          {deletedSession ? <div role="status" className="mt-2 flex items-center gap-2 border-t px-2 pt-2 text-xs"><span className="min-w-0 flex-1 truncate">Deleted “{deletedSession.title}”</span><button type="button" onClick={() => void undoSessionDelete()} disabled={deletingId !== null} className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"><Undo2 className="size-3.5" />Undo</button></div> : null}
          </>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
