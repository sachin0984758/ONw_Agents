import { NextRequest, NextResponse } from 'next/server'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { createChatConversation, deleteChatConversation, listChatConversations, renameChatConversation } from '@/lib/agent-hub/chat-store'

export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  return NextResponse.json({ ok: true, conversations: await listChatConversations() })
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const thread = await createChatConversation()
  return NextResponse.json({ ok: true, conversation: { id: thread.id, title: thread.title, updatedAt: thread.updatedAt, messageCount: 0 } }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const body = await req.json().catch(() => null) as { id?: unknown; title?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 80) : ''
  if (!title) return NextResponse.json({ ok: false, error: 'Title is required.' }, { status: 400 })
  if (!(await renameChatConversation(id, title))) return NextResponse.json({ ok: false, error: 'Chat conversation not found.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!(await deleteChatConversation(id))) return NextResponse.json({ ok: false, error: 'Chat conversation not found.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
