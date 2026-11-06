'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, ChevronDown, CircleAlert, Gamepad2, Hourglass, MessageSquareText, Pause, Play, Send } from 'lucide-react'
import { MASCOT_ACTIVITY_EVENT, sendMascotChatMessage, setMascotChatPaused, type MascotActivityDisplay, type MascotActivityState } from '@/lib/agent-hub/mascot-activity'

const FINISH_HOLD_MS = 1800
const POSITION_STORAGE_KEY = 'agenthub-mascot-position'
const EDGE_GAP = 8

type MascotPosition = { x: number; y: number }
type DragOrigin = { pointerId: number; x: number; y: number; offsetX: number; offsetY: number; moved: boolean }

function keepOnScreen(position: MascotPosition, width: number, height: number): MascotPosition {
  return {
    x: Math.min(Math.max(EDGE_GAP, position.x), Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP)),
    y: Math.min(Math.max(EDGE_GAP, position.y), Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP)),
  }
}

export function AgentMascot() {
  const [activity, setActivity] = useState<Record<string, MascotActivityState>>({})
  const [activityDisplay, setActivityDisplay] = useState<Record<string, MascotActivityDisplay>>({})
  const [position, setPosition] = useState<MascotPosition | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hello, setHello] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [mascotSize, setMascotSize] = useState(120)
  const mascotRef = useRef<HTMLButtonElement>(null)
  const dragOrigin = useRef<DragOrigin | null>(null)
  const lastDragAt = useRef(0)
  const helloTimer = useRef<number | null>(null)
  const timers = useRef(new Map<string, number>())

  useEffect(() => {
    const node = mascotRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMascotSize(entry.contentRect.height || 120)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(POSITION_STORAGE_KEY)
      if (!saved) return
      const parsed = JSON.parse(saved) as Partial<MascotPosition>
      if (typeof parsed.x === 'number' && Number.isFinite(parsed.x) && typeof parsed.y === 'number' && Number.isFinite(parsed.y)) {
        const rect = mascotRef.current?.getBoundingClientRect()
        setPosition(keepOnScreen(parsed as MascotPosition, rect?.width ?? 120, rect?.height ?? 120))
      }
    } catch {
      // Keep the default corner position when storage is unavailable or invalid.
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => {
        if (!current) return current
        const rect = mascotRef.current?.getBoundingClientRect()
        const next = keepOnScreen(current, rect?.width ?? 120, rect?.height ?? 120)
        try { window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next)) } catch { /* Ignore unavailable storage. */ }
        return next
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const activeTimers = timers.current
    const onActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: unknown; state?: unknown; display?: MascotActivityDisplay }>).detail
      if (typeof detail?.source !== 'string') return
      const next = detail.state
      if (next !== 'working' && next !== 'game' && next !== 'waiting' && next !== 'paused' && next !== 'done' && next !== 'error' && next !== 'idle') return

      const timer = timers.current.get(detail.source)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timers.current.delete(detail.source)
      }
      setActivity((current) => {
        if (next === 'idle') {
          const { [detail.source as string]: _removed, ...rest } = current
          return rest
        }
        return { ...current, [detail.source as string]: next }
      })
      if (next === 'idle') {
        setActivityDisplay((current) => {
          const { [detail.source as string]: _removed, ...rest } = current
          return rest
        })
      } else if (detail.display) {
        setActivityDisplay((current) => ({ ...current, [detail.source as string]: detail.display! }))
      }

      if (next === 'done' || next === 'error') {
        const id = window.setTimeout(() => {
          timers.current.delete(detail.source as string)
          setActivity((current) => {
            if (current[detail.source as string] !== next) return current
            const { [detail.source as string]: _removed, ...rest } = current
            return rest
          })
          setActivityDisplay((current) => {
            const { [detail.source as string]: _removed, ...rest } = current
            return rest
          })
        }, FINISH_HOLD_MS)
        timers.current.set(detail.source, id)
      }
    }
    window.addEventListener(MASCOT_ACTIVITY_EVENT, onActivity)
    return () => {
      window.removeEventListener(MASCOT_ACTIVITY_EVENT, onActivity)
      for (const timer of activeTimers.values()) window.clearTimeout(timer)
      activeTimers.clear()
      if (helloTimer.current !== null) window.clearTimeout(helloTimer.current)
    }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    dragOrigin.current = {
      pointerId: event.pointerId,
      x: rect.left,
      y: rect.top,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = dragOrigin.current
    if (!origin || origin.pointerId !== event.pointerId) return
    const x = event.clientX - origin.offsetX
    const y = event.clientY - origin.offsetY
    if (!origin.moved && Math.hypot(x - origin.x, y - origin.y) < 5) return
    origin.moved = true
    setIsDragging(true)
    const rect = mascotRef.current?.getBoundingClientRect()
    setPosition(keepOnScreen({ x, y }, rect?.width ?? 120, rect?.height ?? 120))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = dragOrigin.current
    if (!origin || origin.pointerId !== event.pointerId) return
    dragOrigin.current = null
    setIsDragging(false)
    if (!origin.moved) return
    lastDragAt.current = performance.now()
    setPosition((current) => {
      if (!current) return current
      try { window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(current)) } catch { /* Ignore unavailable storage. */ }
      return current
    })
  }

  const onClick = () => {
    if (performance.now() - lastDragAt.current < 250) return
    setHello(true)
    if (helloTimer.current !== null) window.clearTimeout(helloTimer.current)
    helloTimer.current = window.setTimeout(() => setHello(false), 1200)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Home') {
      event.preventDefault()
      resetPosition()
      return
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -12], ArrowDown: [0, 12], ArrowLeft: [-12, 0], ArrowRight: [12, 0],
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const next = keepOnScreen({ x: (position?.x ?? rect.left) + move[0], y: (position?.y ?? rect.top) + move[1] }, rect.width, rect.height)
    setPosition(next)
    try { window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next)) } catch { /* Ignore unavailable storage. */ }
  }

  const resetPosition = useCallback(() => {
    try { window.localStorage.removeItem(POSITION_STORAGE_KEY) } catch { /* Ignore unavailable storage. */ }
    setPosition(null)
  }, [])

  const states = Object.values(activity)
  const state: MascotActivityState = states.includes('game')
    ? 'game'
    : states.includes('working')
      ? 'working'
    : states.includes('waiting')
      ? 'waiting'
    : states.includes('paused')
      ? 'paused'
      : states.includes('error')
        ? 'error'
        : states.includes('done')
          ? 'done'
          : 'idle'
  const activeSource = (['game', 'working', 'waiting', 'paused', 'error', 'done'] as const)
    .map((candidate) => Object.keys(activity).find((source) => activity[source] === candidate))
    .find((source): source is string => !!source)
  const display = activeSource ? activityDisplay[activeSource] : undefined
  const active = state !== 'idle'
  const stateLabel = display?.phase ?? (
    state === 'working' && activeSource === 'agent-session' ? 'Modifying…' : ({
      working: 'Thinking…', game: 'Building…', waiting: 'Waiting for approval', paused: 'Paused',
      done: 'Done', error: 'Needs attention', idle: 'Ready',
    } satisfies Record<MascotActivityState, string>)[state]
  )
  const upright = state === 'working' || state === 'waiting' || state === 'paused'
  const sessionState = activity['agent-session']
  const chatSource = Object.keys(activity).find((source) => source.startsWith('chat:') && ['working', 'game', 'paused'].includes(activity[source]))
  const chatControlSource = sessionState === 'working' || sessionState === 'game' || sessionState === 'waiting' || sessionState === 'paused' ? 'agent-session' : chatSource
  const sessionBusy = Boolean(chatControlSource)
  const sessionPaused = chatControlSource ? activity[chatControlSource] === 'paused' : false
  const panelPlacement = (() => {
    if (typeof window === 'undefined') return 'above'
    const top = position?.y ?? window.innerHeight - 20 - mascotSize
    return window.innerHeight - (top + mascotSize) >= (detailsOpen ? 380 : 240) ? 'below' : 'above'
  })()
  const panelEdge = !position || position.x > (typeof window === 'undefined' ? 0 : window.innerWidth / 2) ? 'right' : 'left'

  return (
    <div
      className="agent-mascot-anchor fixed bottom-5 right-4 z-20 size-[104px] sm:right-6 sm:size-[120px]"
      style={position ? ({ left: position.x, top: position.y, right: 'auto', bottom: 'auto' } as CSSProperties) : undefined}
      data-active={active ? 'true' : 'false'}
      data-panel-placement={panelPlacement}
      data-panel-edge={panelEdge}
    >
    <button
      ref={mascotRef}
      type="button"
      className={`agent-mascot relative size-full select-none ${isDragging ? 'is-dragging' : ''} ${hello ? 'is-reacting' : ''}`}
      data-state={state}
      data-dragging={isDragging ? 'true' : 'false'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onDoubleClick={resetPosition}
      aria-label={
        state === 'working' ? 'Doraemon working at a laptop' :
        state === 'game' ? 'Doraemon building a game' :
        state === 'waiting' ? 'Doraemon waiting for approval' :
        state === 'done' ? 'Doraemon task complete' :
        state === 'error' ? 'Doraemon task needs attention' :
        'Doraemon resting. Drag to move, use arrow keys to move, Home or double click to return to the corner.'
      }
      title="Drag to move · Click to interact · Arrow keys to move · Home or double-click to reset"
      data-testid="agent-mascot"
    >
      <Image
        src={state === 'game' ? '/agent-mascot/doraemon-game-cutout-v1.png' : upright ? '/agent-mascot/doraemon-working-cutout-v1.png' : '/agent-mascot/doraemon-idle-cutout-v1.png'}
        alt=""
        fill
        sizes="120px"
        className="mascot-art object-contain"
        draggable={false}
        priority={false}
      />
      {state === 'working' ? <span className="mascot-status mascot-working-dots" aria-hidden="true"><i /><i /><i /></span> : null}
      {state === 'game' ? <span className="mascot-status mascot-game"><Gamepad2 className="size-3" /> Building</span> : null}
      {state === 'waiting' ? <span className="mascot-status mascot-waiting"><Hourglass className="size-3" /> Waiting</span> : null}
      {state === 'paused' ? <span className="mascot-status mascot-paused"><Pause className="size-3" /> Paused</span> : null}
      {state === 'done' ? <span className="mascot-badge mascot-done"><Check className="size-3.5" /></span> : null}
      {state === 'error' ? <span className="mascot-badge mascot-error"><CircleAlert className="size-3.5" /></span> : null}
      {hello ? <span className="mascot-hello" aria-hidden="true">Hi!</span> : null}
    </button>
    <div className="mascot-companion" role="region" aria-label="Agent activity and quick chat" aria-live="polite" data-state={state}>
      <div className="mascot-widget-card">
        <button type="button" className="mascot-widget-header" aria-expanded={detailsOpen} aria-label={detailsOpen ? 'Hide agent activity details' : 'Show agent activity details'} onClick={() => setDetailsOpen((open) => !open)}>
          <span className="mascot-state-dot" />
          <strong className="mascot-task-phase">{stateLabel}</strong>
          <ChevronDown className={`mascot-details-chevron size-3 shrink-0 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <div className="mascot-task-line">
          <MessageSquareText className="size-3 shrink-0" aria-hidden="true" />
          <span>{display?.task ?? (active ? 'Working on your request' : 'Ready for your next message')}</span>
        </div>
        {detailsOpen ? (
          <div className="mascot-widget-details">
            {display?.operation ? <div><span className="mascot-detail-label">Action</span><span>{display.operation}</span></div> : null}
            {display?.files?.length ? <div><span className="mascot-detail-label">Files</span><span>{display.files.slice(0, 4).join(', ')}{display.files.length > 4 ? ` +${display.files.length - 4}` : ''}</span></div> : null}
            {display?.output ? <pre>{display.output}</pre> : <span className="mascot-detail-empty">Live tool output and file changes appear here while the agent works.</span>}
          </div>
        ) : null}
        <form className="mascot-chat-form" onSubmit={(event) => { event.preventDefault(); const message = chatDraft.trim(); if (!message) return; sendMascotChatMessage(message, chatControlSource); setChatDraft('') }}>
          <textarea value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} rows={2} maxLength={16000} aria-label="Message the active chat" placeholder="Type a message…" className="mascot-chat-input" />
          <div className="mascot-chat-actions">
            {sessionBusy ? <button type="button" className="mascot-chat-button mascot-chat-pause" aria-label={sessionPaused ? 'Resume chat' : 'Pause chat'} onClick={() => setMascotChatPaused(!sessionPaused, chatControlSource)}>{sessionPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{sessionPaused ? 'Resume' : 'Pause'}</button> : <span className="mascot-chat-hint">Quick chat</span>}
            <button type="submit" className="mascot-chat-button mascot-chat-send" disabled={!chatDraft.trim()}><Send className="size-3.5" />{sessionBusy ? 'Queue' : 'Send'}</button>
          </div>
        </form>
      </div>
    </div>
    </div>
  )
}
