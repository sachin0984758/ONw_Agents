import { NextRequest, NextResponse } from 'next/server'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { readWorkspaceFiles, mutateWorkspaceFile } from '@/lib/agent-hub/workspace-files'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const result = await readWorkspaceFiles(req.nextUrl.searchParams, req.signal)
  return NextResponse.json(result.body, { status: result.status })
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 }) }
  const result = await mutateWorkspaceFile(body)
  return NextResponse.json(result.body, { status: result.status })
}
