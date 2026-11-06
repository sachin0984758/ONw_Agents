import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { readModelPreference, saveModelPreference } from '@/lib/agent-hub/model-preference-server'

export const runtime = 'nodejs'
export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  try { return NextResponse.json({ ok: true, preference: await readModelPreference() }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 }) }
}
export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  try {
    const patch = z.object({ model: z.string().trim().max(300).optional(), allowRemote: z.boolean().optional() }).strict().parse(await req.json())
    return NextResponse.json({ ok: true, preference: await saveModelPreference(patch) })
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof z.ZodError ? 'Choose a valid model preference.' : (error as Error).message }, { status: 400 }) }
}
