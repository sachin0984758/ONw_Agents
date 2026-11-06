// ─── Server-owned hub state file ─────────────────────────────────────────────
// Single source of truth for db/agent-hub-state.json on the server. Both
// /api/agent (the dashboard's read/write API) and the token-usage recorder in
// the model routes go through here, so every read-merge-write cycle on the file
// is serialized on ONE queue.
//
// The queue lives on globalThis on purpose: Next compiles each route handler as
// its own bundle, so a module-level singleton could be duplicated per route and
// stop serializing anything. A process-global handle keeps a single queue in
// dev and standalone production alike.

import { promises as fs } from 'fs'
import path from 'path'
import { DB_DIR } from './db-path'
import { seedState } from './seed'
import { normalizeState } from './normalize'
import { createSerializer, writeJsonAtomic } from './fs-atomic'
import { appendUsageRecord, type UsageSample } from './token-usage'
import type { HubState, TokenUsageLedger } from './types'
import { publishUsage } from './usage-events'

export const STATE_FILE = path.join(DB_DIR, 'agent-hub-state.json')

const globalRef = globalThis as unknown as { __agentHubStateSerialize?: ReturnType<typeof createSerializer> }
if (!globalRef.__agentHubStateSerialize) globalRef.__agentHubStateSerialize = createSerializer()
/** One in-process queue for every read-merge-write cycle on the state file. */
export const serialize = globalRef.__agentHubStateSerialize

export async function readState(): Promise<HubState> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8')
    // normalizeState heals partial/corrupted files (fills missing nested
    // fields from seed defaults) so a bad past write can never crash the UI.
    return normalizeState(JSON.parse(raw))
  } catch {
    return seedState
  }
}

// atomic write: a crash mid-write can never leave a truncated JSON file
// (unique temp + rename, see fs-atomic.ts)
export async function writeState(state: HubState): Promise<void> {
  await writeJsonAtomic(STATE_FILE, state)
}

/**
 * Append one real model call to the persisted token ledger and return the
 * updated ledger. The server is the SOLE writer of `tokenUsage` (client POSTs
 * ignore it — see /api/agent), so there is exactly one writer and no double
 * counting. Serialized against every other state write, so concurrent calls
 * never lose a record. A zero-token sample is a no-op that returns the current
 * ledger unchanged.
 */
export async function recordServerUsage(sample: UsageSample): Promise<TokenUsageLedger> {
  return serialize(async () => {
    const state = await readState()
    const next = appendUsageRecord(state.tokenUsage, sample, Date.now())
    if (next === state.tokenUsage) return state.tokenUsage
    await writeState({ ...state, tokenUsage: next, updatedAt: new Date().toISOString() })
    publishUsage(next)
    return next
  })
}
