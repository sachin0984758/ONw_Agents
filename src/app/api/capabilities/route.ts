import { NextRequest, NextResponse } from 'next/server'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { readCapabilityPacks, updateCapabilityPack } from '@/lib/agent-hub/capabilities/registry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const errorResponse = (error: unknown, status = 400) => NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Capability operation failed.' }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function GET(request: NextRequest) {
  if (isCrossOrigin(request)) return errorResponse(new Error('Cross-origin requests are not allowed.'), 403)
  try { return NextResponse.json({ ok: true, packs: await readCapabilityPacks() }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return errorResponse(error, 500) }
}

export async function POST(request: NextRequest) {
  if (isCrossOrigin(request)) return errorResponse(new Error('Cross-origin requests are not allowed.'), 403)
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (contentLength > 256_000) throw new Error('Request exceeds 256 KB.')
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 256_000) throw new Error('Request exceeds 256 KB.')
    const body = JSON.parse(raw) as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Provide a capability action object.')
    const action = body.action
    if (!['install', 'enable', 'disable', 'assign', 'uninstall', 'import'].includes(String(action))) throw new Error('Choose install, enable, disable, assign, uninstall or import.')
    const packs = await updateCapabilityPack(action as 'install' | 'enable' | 'disable' | 'assign' | 'uninstall' | 'import', body)
    return NextResponse.json({ ok: true, packs }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
