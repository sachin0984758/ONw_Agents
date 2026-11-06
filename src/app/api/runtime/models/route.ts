import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { NextRequest, NextResponse } from 'next/server'
import { detectRuntimeModels } from '@/lib/agent-hub/llm'

// ─── Runtime models API ──────────────────────────────────────────────────────
// Reports ONLY models that a configured local provider confirms are currently
// loaded/running. Downloaded, installed, configured or merely available models
// are never reported as running, and no seeded/demo data is involved.
//
//   GET → { ok, loaded: [{id,providerId,providerName,arch,type}],
//           onlineProviders, status: 'ok'|'offline'|'unavailable', checkedAt }
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'



export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  try {
    const report = await detectRuntimeModels()
    return NextResponse.json({ ok: true, ...report })
  } catch {
    return NextResponse.json({
      ok: true,
      loaded: [],
      onlineProviders: [],
      status: 'unavailable',
      checkedAt: new Date().toISOString(),
    })
  }
}
