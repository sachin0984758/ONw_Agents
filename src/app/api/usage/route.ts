import { NextRequest } from 'next/server'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { readState } from '@/lib/agent-hub/state-file'
import { modelActivity, subscribeUsage, type UsageUpdate } from '@/lib/agent-hub/usage-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
  if (isCrossOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Cross-origin requests are not allowed.', { status: 403 })
  let cleanup = () => {}
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const send = (value: UsageUpdate) => { if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)) }
      const unsubscribe = subscribeUsage(send)
      const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n')) }, 25000)
      cleanup = () => {
        if (closed) return
        closed = true; unsubscribe(); clearInterval(heartbeat)
        request.signal.removeEventListener('abort', cleanup)
        try { controller.close() } catch { /* stream already cancelled */ }
      }
      request.signal.addEventListener('abort', cleanup, { once: true })
      void readState().then((state) => send({ ledger: state.tokenUsage, active: modelActivity(), checkedAt: new Date().toISOString() })).catch(() => {
        if (!closed) { controller.error(new Error('Usage is unavailable.')); cleanup() }
      })
      if (request.signal.aborted) cleanup()
    },
    cancel() { cleanup() },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } })
}
