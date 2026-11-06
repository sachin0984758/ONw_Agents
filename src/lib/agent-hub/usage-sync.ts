// ─── Client-side usage display sync ──────────────────────────────────────────
// Token usage is recorded SERVER-SIDE: every model call goes through a server
// route (/api/chat, /api/explain, /api/playground), which appends one
// timestamped record to the persisted ledger and returns the updated ledger in
// its response. This module carries that authoritative snapshot from the call
// site to the UI so the Overview widgets update immediately, without the client
// ever writing (or racing) the ledger itself.
//
// Deliberately standalone and dependency-free so the Agent Session runtime can
// sync usage without importing the store (it stays decoupled). With no listener
// attached (server render, unit tests) syncing is a harmless no-op, and a
// failing listener can never break a model call.

import type { TokenUsageLedger } from './types'

type UsageSyncListener = (ledger: TokenUsageLedger) => void

let listener: UsageSyncListener | null = null

/** Attach the sink that applies ledger snapshots (the hub store does this at init). */
export function setUsageSyncListener(fn: UsageSyncListener | null): void {
  listener = fn
}

/**
 * Apply the server-recorded ledger snapshot to the UI. Display only — the
 * server owns the ledger, so this never persists and can never double-count.
 * Never throws.
 */
export function syncUsage(ledger: TokenUsageLedger | undefined | null): void {
  if (!listener || !ledger) return
  try {
    listener(ledger)
  } catch {
    // Usage display must never surface as a model-call failure.
  }
}
