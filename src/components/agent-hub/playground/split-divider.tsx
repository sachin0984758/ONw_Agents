'use client'

// ── Playground split divider ─────────────────────────────────────────────────
// The hit-area between the editor and the AI-response pane. It can be:
//
//   · dragged (pointer capture + rAF-throttled share updates),
//   · moved with the keyboard (ArrowLeft / ArrowRight step, Home restores),
//   · double-clicked to restore the recommended default split.
//
// New share values are reported to the workspace, which applies them to the
// grid template and persists them via saveResponseShare; the panes never
// shrink below their pixel floors because those live in the grid template.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { cn } from '@/lib/utils'
import {
  DEFAULT_RESPONSE_SHARE,
  DIVIDER_COLUMN_PX,
  MAX_RESPONSE_SHARE,
  MIN_RESPONSE_SHARE,
  SHARE_STEP,
  clampResponseShare,
  stepResponseShare,
} from './split-layout'

interface SplitDividerProps {
  /** Current response share (0..1) — used for the aria value semantics. */
  share: number
  /** Ref to the workspace element the two panes live in (drag coordinate source). */
  workspaceRef: RefObject<HTMLDivElement | null>
  onShareChange: (next: number) => void
  /** Persist — called with the final share after a drag / step / reset. */
  onCommit: (share: number) => void
  /** Toggled while dragging so the workspace can suppress text selection. */
  onDragChange: (dragging: boolean) => void
}

export function SplitDivider({
  share,
  workspaceRef,
  onShareChange,
  onCommit,
  onDragChange,
}: SplitDividerProps) {
  const [dragging, setDragging] = useState(false)
  const rectRef = useRef<DOMRect | null>(null)
  const rafRef = useRef<number | null>(null)
  const latestXRef = useRef(0)
  const lastShareRef = useRef(share)
  const draggingRef = useRef(false)
  const commitOnEndRef = useRef(true)

  useEffect(() => {
    lastShareRef.current = share
  }, [share])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  function applyMove(clientX: number) {
    const rect = rectRef.current
    if (!rect || rect.width <= DIVIDER_COLUMN_PX) return
    const usable = rect.width - DIVIDER_COLUMN_PX
    const responsePx = rect.right - clientX - DIVIDER_COLUMN_PX / 2
    const next = clampResponseShare(responsePx / usable)
    lastShareRef.current = next
    onShareChange(next)
  }

  function scheduleMove(clientX: number) {
    latestXRef.current = clientX
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      applyMove(latestXRef.current)
    })
  }

  function endDrag() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      applyMove(latestXRef.current) // flush the last pending frame first
    }
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    onDragChange(false)
    if (commitOnEndRef.current) onCommit(lastShareRef.current)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || e.button !== 0) return
    const el = workspaceRef.current
    rectRef.current = el ? el.getBoundingClientRect() : null
    if (!rectRef.current) return
    // Synthetic events (tests) may carry an inactive pointer id; capture is an
    // optimisation for real drags, never a requirement.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* continue without capture */
    }
    draggingRef.current = true
    commitOnEndRef.current = true
    setDragging(true)
    onDragChange(true)
    // Prevent the native text-selection drag, but keep keyboard focus so the
    // arrow keys work immediately after a mouse drag.
    e.preventDefault()
    e.currentTarget.focus({ preventScroll: true })
    scheduleMove(e.clientX)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    scheduleMove(e.clientX)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    endDrag()
  }

  function handleLostPointerCapture() {
    // The browser may steal capture mid-drag (element reorder etc.) — settle.
    if (draggingRef.current) endDrag()
  }

  function setShare(next: number) {
    lastShareRef.current = next
    onShareChange(next)
    onCommit(next)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setShare(stepResponseShare(lastShareRef.current, SHARE_STEP))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setShare(stepResponseShare(lastShareRef.current, -SHARE_STEP))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setShare(DEFAULT_RESPONSE_SHARE)
    }
  }

  function handleDoubleClick() {
    setShare(DEFAULT_RESPONSE_SHARE)
  }

  return (
    <div
      role="slider"
      aria-orientation="vertical"
      aria-label="Adjust editor and AI response split"
      aria-valuemin={Math.round(MIN_RESPONSE_SHARE * 100)}
      aria-valuemax={Math.round(MAX_RESPONSE_SHARE * 100)}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={`${Math.round((1 - share) * 100)}% editor, ${Math.round(share * 100)}% AI response`}
      tabIndex={0}
      data-testid="split-divider"
      data-dragging={dragging || undefined}
      className={cn(
        'flex touch-none cursor-col-resize items-center justify-center rounded-sm outline-none',
        'hover:bg-secondary/60 focus-visible:bg-secondary/80 focus-visible:ring-1 focus-visible:ring-ring',
        dragging && 'bg-secondary/80',
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
    >
      <span
        aria-hidden="true"
        data-testid="split-divider-line"
        className={cn('h-9 w-[3px] rounded-full', dragging ? 'bg-ring' : 'bg-border/90')}
      />
    </div>
  )
}
