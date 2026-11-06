import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { deepMerge, normalizeState } from '@/lib/agent-hub/normalize'
import { readState, serialize, STATE_FILE, writeState } from '@/lib/agent-hub/state-file'
import type { HubState } from '@/lib/agent-hub/types'

// ─── Agent API ───────────────────────────────────────────────────────────────
// Machine-readable interface so the AI agent on your laptop can read and
// update the whole dashboard state programmatically:
//   GET    /api/agent        → full HubState JSON
//   POST   /api/agent        → replace/merge state (accepts partial HubState)
//   DELETE /api/agent        → reset to seed state
// ─────────────────────────────────────────────────────────────────────────────

// Same-origin guard as /api/chat: local agents (curl, no Origin header) are
// unaffected, but a website open in the user's browser must not be able to
// silently rewrite or reset the dashboard state from cross-site.


export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  const state = await readState()
  return NextResponse.json({
    ok: true,
    endpoint: 'GET /api/agent',
    description: 'Full AgentHub dashboard state. Safe for machine consumption.',
    state,
  })
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  let body: Partial<HubState>
  try {
    body = (await req.json()) as Partial<HubState>
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body. Send a full or partial HubState object.' },
      { status: 400 }
    )
  }
  try {
    // The UI POSTs the full state once per change, so bursts arrive
    // concurrently (Pause All fires nine patches at once). Serializing keeps
    // every read-merge-write cycle consistent instead of racing on the file.
    const next = await serialize(async () => {
      const current = await readState()
      // deepMerge: partial bodies merge into nested objects instead of wiping
      // siblings (e.g. {"plan":{"autoRun":false}} keeps plan.steps intact).
      const merged: HubState = normalizeState({
        ...deepMerge(current, body),
        version: body.version ?? current.version,
        updatedAt: new Date().toISOString(),
      })
      // The token ledger is SERVER-OWNED (only recordServerUsage writes it).
      // Every client POST carries its own possibly-stale copy, so ignore it:
      // the server's current ledger always wins, which is what makes the
      // server the sole writer and double counting structurally impossible.
      merged.tokenUsage = current.tokenUsage
      await writeState(merged)
      return merged
    })
    return NextResponse.json({ ok: true, updated: next.updatedAt })
  } catch {
    return NextResponse.json({ ok: false, error: 'Failed to persist state.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  await serialize(async () => {
    try {
      await fs.rm(STATE_FILE, { force: true })
    } catch {
      // ignore
    }
  })
  return NextResponse.json({ ok: true, reset: true })
}
