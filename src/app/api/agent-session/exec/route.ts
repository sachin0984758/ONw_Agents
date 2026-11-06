import { NextRequest, NextResponse } from 'next/server'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { readWorkspaceCommands, executeWorkspaceCommand } from '@/lib/agent-hub/workspace-exec'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const result = await readWorkspaceCommands(req.nextUrl.searchParams)
  return NextResponse.json(result.body, { status: result.status })
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 }) }
  const result = await executeWorkspaceCommand(body)
  return NextResponse.json(result.body, { status: result.status })
}
