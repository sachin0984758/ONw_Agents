// ── Playground split-layout helpers ──────────────────────────────────────────
// Split mode lays the editor and the AI response side by side on a CSS grid
// whose tracks are fr proportions with PIXEL FLOORS, so that:
//
//   · the editor can always shrink below its content's min-content width —
//     CodeMirror lines are `white-space: pre`, and without a floor + min-w-0
//     a single long line would widen the editor until the response pane is
//     pushed out of the shell's clipped viewport (the "narrow AI Response"
//     bug); the horizontal scroll stays inside the editor where it belongs;
//   · the split is adjustable: the divider maps pointer position to a
//     response-share fraction (0..1) that is clamped, persisted in
//     localStorage and re-applied on the next visit;
//   · the side-by-side grid applies only when the MEASURED workspace is wide
//     enough — narrower panels (laptop split windows, tablets, the sidebar
//     eating a fixed share of the viewport) get a stacked presentation
//     instead of two cramped columns.

export const SPLIT_STORAGE_KEY = 'agenthub.playground.split'

/** AI-response share of the split space (the editor gets the remainder). */
export const DEFAULT_RESPONSE_SHARE = 0.42
export const MIN_RESPONSE_SHARE = 0.25
export const MAX_RESPONSE_SHARE = 0.62

/** Divider / keyboard adjust step (4% of the split space). */
export const SHARE_STEP = 0.04

/** Below this MEASURED workspace width the panes stack instead of sharing columns. */
export const SPLIT_SIDE_BY_SIDE_MIN = 820

/** Pixel floors: neither pane may be squeezed below this while side by side. */
export const MIN_EDITOR_PANE_PX = 340
export const MIN_RESPONSE_PANE_PX = 360

/** The grid's middle track hosts the draggable divider hit-area. */
export const DIVIDER_COLUMN_PX = 12

export function clampResponseShare(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RESPONSE_SHARE
  return Math.min(MAX_RESPONSE_SHARE, Math.max(MIN_RESPONSE_SHARE, value))
}

/** Keyboard / double-click step, rounded to whole percents so it is exact. */
export function stepResponseShare(share: number, delta: number): number {
  const next = Math.round((clampResponseShare(share) + delta) * 100) / 100
  return clampResponseShare(next)
}

export function isSideBySideWidth(width: number): boolean {
  return width >= SPLIT_SIDE_BY_SIDE_MIN
}

/** grid-template-columns for the two panes plus the divider hit-area column. */
export function splitGridTemplate(share: number): string {
  const responseFr = Math.round(clampResponseShare(share) * 100)
  const editorFr = 100 - responseFr
  return [
    `minmax(${MIN_EDITOR_PANE_PX}px, ${editorFr}fr)`,
    `${DIVIDER_COLUMN_PX}px`,
    `minmax(${MIN_RESPONSE_PANE_PX}px, ${responseFr}fr)`,
  ].join(' ')
}

/** Read the persisted share; every failure falls back to the default. */
export function loadResponseShare(): number {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_RESPONSE_SHARE
    const raw = window.localStorage.getItem(SPLIT_STORAGE_KEY)
    if (!raw) return DEFAULT_RESPONSE_SHARE
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return DEFAULT_RESPONSE_SHARE
    return clampResponseShare(parsed)
  } catch {
    // Storage unavailable (privacy mode / disabled) — use the default split.
    return DEFAULT_RESPONSE_SHARE
  }
}

export function saveResponseShare(share: number): void {
  const next = clampResponseShare(share)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SPLIT_STORAGE_KEY, String(next))
    }
  } catch {
    // Storage full or blocked — the split still works, it just won't persist.
  }
  storeShare(next)
}

// ── Runtime store (React 18 external-store contract) ─────────────────────────
// The share lives outside React state so drag frames, keyboard steps and the
// persisted value all flow through one source of truth, and so the first
// (server) render stays deterministic via getServerSnapshot — React re-reads
// the real value right after hydration, without a hydration mismatch.

let cachedShare = DEFAULT_RESPONSE_SHARE
let cacheInitialised = false
const listeners = new Set<() => void>()

function storeShare(share: number): void {
  cachedShare = clampResponseShare(share)
  cacheInitialised = true
  for (const listener of listeners) listener()
}

/** Subscribe for share changes (drag frames / keyboard steps / persistence). */
export function subscribeResponseShare(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Client snapshot — reads the persisted value on first use, then stays cached. */
export function getResponseShare(): number {
  if (!cacheInitialised) {
    cachedShare = loadResponseShare()
    cacheInitialised = true
  }
  return cachedShare
}

/** Server snapshot — the default split, so hydration output is deterministic. */
export function getServerResponseShare(): number {
  return DEFAULT_RESPONSE_SHARE
}

/** Live update: `persist: false` while dragging, `true` on commit / step. */
export function setResponseShare(share: number, persist: boolean): void {
  if (persist) saveResponseShare(share)
  else storeShare(share)
}
