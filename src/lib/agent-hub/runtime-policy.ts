import { promises as fs } from 'fs'
import path from 'path'
import { DB_DIR } from './db-path'

// ── Runtime capability policy ───────────────────────────────────────────────
// The Settings → Capabilities switches previously changed the dashboard state
// but were never consulted by anything at runtime. This reads the persisted
// hub state (written by the UI through /api/agent) so server routes can honour
// the two hard switches:
//
//   codeExecution  gates command execution (agent-session exec) and file
//                  creation/editing/deletion (agent-session files).
//   networkEgress  is a recorded preference only — there is no OS sandbox, so
//                  it is surfaced in the UI as advisory and not enforced here.
//
// A missing/unreadable state file (fresh install, or the very first request
// before the UI has persisted anything) falls back to the seed defaults so the
// coding agent keeps working exactly as before.

const STATE_FILE = path.join(DB_DIR, 'agent-hub-state.json')

export interface RuntimePolicy {
  /** When false, command execution and file mutation must be refused. */
  codeExecution: boolean
  /** Recorded preference; no runtime enforcement (advisory). */
  networkEgress: boolean
}

export async function readRuntimePolicy(): Promise<RuntimePolicy> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as { settings?: { codeExecution?: unknown; networkEgress?: unknown } }
    const settings = parsed?.settings ?? {}
    return {
      codeExecution: settings.codeExecution !== false,
      networkEgress: settings.networkEgress !== false,
    }
  } catch {
    return { codeExecution: true, networkEgress: true }
  }
}
