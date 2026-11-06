import { NextRequest, NextResponse } from 'next/server'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { disableHarness2, harness2Status, testHarness2Demo } from '@/lib/agent-hub/harness2'

export const runtime = 'nodejs'
export async function GET(request: NextRequest) {
  if (isCrossOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 })
  try { return NextResponse.json({ ok: true, status: await harness2Status() }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch { return NextResponse.json({ ok: false, error: 'Could not read optimization status.' }, { status: 400 }) }
}
export async function POST(request: NextRequest) {
  if (isCrossOrigin(request)) return NextResponse.json({ ok: false }, { status: 403 })
  try {
    const body = await request.json()
    if (body.action === 'test' && body.approved === true) return NextResponse.json({ ok: true, status: await testHarness2Demo() })
    if (body.action === 'disable' || body.action === 'rollback') return NextResponse.json({ ok: true, status: await disableHarness2() })
    throw new Error('Optimization enablement and adoption are unavailable until an AgentHub adapter and verified improvements exist.')
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Optimization request failed.' }, { status: 400 }) }
}
