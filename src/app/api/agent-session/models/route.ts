import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { NextRequest, NextResponse } from 'next/server'
import { LOCAL_PROVIDERS } from '@/lib/agent-hub/chat-settings'
import { readCustomModels } from '@/lib/agent-hub/custom-models'

// ─── Agent Session · Models API ──────────────────────────────────────────────
// Session-exclusive model inventory for the Agent Session coding agent:
// live local-provider status plus cloud custom models with secrets removed.
// Nothing outside Agent Session calls this endpoint.
//
//   GET  → { ok, local: [{id,name,available,models}], cloud: [{id,name,modelId,endpoint,keyConfigured}] }
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs'



export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  const local = await Promise.all(
    LOCAL_PROVIDERS.map(async (p) => {
      try {
        const res = await fetch(`${p.endpoint}/models`, { signal: AbortSignal.timeout(2000) })
        if (!res.ok) return { id: p.id, name: p.name, available: false, models: [] as string[] }
        const json = await res.json().catch(() => null)
        const models = Array.isArray((json as { data?: unknown })?.data)
          ? ((json as { data: Array<{ id?: unknown }> }).data.map((m) => m.id).filter((id): id is string => typeof id === 'string'))
          : []
        return { id: p.id, name: p.name, available: true, models }
      } catch {
        return { id: p.id, name: p.name, available: false, models: [] as string[] }
      }
    }),
  )
  let cloud: Array<{ id: string; name: string; modelId: string; endpoint: string; keyConfigured: boolean }> = []
  try {
    const models = await readCustomModels()
    // Secrets never leave the server: drop apiKey, report only its presence.
    cloud = models.map((m) => ({
      id: m.id,
      name: m.name,
      modelId: m.modelId,
      endpoint: m.endpoint,
      keyConfigured: m.apiKey.length > 0,
    }))
  } catch {
    cloud = []
  }
  return NextResponse.json({ ok: true, local, cloud })
}
