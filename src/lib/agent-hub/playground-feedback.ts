// ── Playground feedback selection (pure) ─────────────────────────────────────
// The rule that a Playground practice always shows exactly ONE current result —
// the response to the most recently completed analysis request — lives here so
// it can be unit-tested without a DOM. The view keeps the full history array
// (newest first, for the optional history menu) and tracks which entry is
// active; a stale request (superseded by a newer one) is never adopted.

import { PLAYGROUND_MAX_FEEDBACK } from './playground-types'
import type { FeedbackEntry } from './playground-types'

/**
 * True when a completed request has been superseded by a newer one and its
 * result must be discarded (never shown as the latest answer).
 */
export function isStaleResult(seq: number, latestSeq: number): boolean {
  return seq !== latestSeq
}

/**
 * Record a newly completed result at the head of the history, keeping at most
 * `max` entries. Returns a new array; the input is not mutated.
 */
export function prependFeedback(
  entries: FeedbackEntry[],
  entry: FeedbackEntry,
  max: number = PLAYGROUND_MAX_FEEDBACK,
): FeedbackEntry[] {
  return [entry, ...entries].slice(0, max)
}

/**
 * The entry the panel should render: the explicitly selected one, else the
 * newest, else null. Never returns more than one entry — callers must not stack
 * multiple results in the current result view.
 */
export function activeFeedback(entries: FeedbackEntry[], activeId: string | null): FeedbackEntry | null {
  if (entries.length === 0) return null
  const selected = activeId ? entries.find((e) => e.id === activeId) : undefined
  return selected ?? entries[0] ?? null
}
