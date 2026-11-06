import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { DB_DIR } from '@/lib/agent-hub/db-path'
import { readCustomModels } from '@/lib/agent-hub/custom-models'
import { writeJsonAtomic } from '@/lib/agent-hub/fs-atomic'
import {
  MAX_SYSTEM_PROMPT_CHARS,
  MODEL_ID_PATTERN,
  LOCAL_PROVIDERS,
} from '@/lib/agent-hub/chat-settings'
import { resolveTarget, streamLLM, describeTarget, estimateUsage, type LLMUsage } from '@/lib/agent-hub/llm'
import { readState } from '@/lib/agent-hub/state-file'
import { buildExplainSystemPrompt, detectIntent } from '@/lib/agent-hub/explain-prompt'
import { newMessageId } from '@/lib/agent-hub/chat-types'
import {
  blocksToPlainText,
  parseExplainResponse,
  type ExplainBlock,
} from '@/lib/agent-hub/explain-protocol'

// ─── Explain API (streaming) ─────────────────────────────────────────────
// POST /api/explain { message, history?, settings? }
// Streams Server-Sent Events:
//   data: {"type":"delta","text":"..."}     — progressive text
//   data: {"type":"blocks","blocks":[...]}  — final validated blocks
//   data: {"type":"done","reply":"...","model":"..."}
//   data: {"type":"error","error":"..."}
//
// The model generates explanation content as JSON blocks; this route
// validates them and never executes model output. Persists the reply as
// plain text into the shared chat history so Chat history stays complete.

const HISTORY_FILE = path.join(DB_DIR, 'chat-history.json')
const MAX_MESSAGE_CHARS = 16000
const MAX_STORED_MESSAGES = 200
const CONTEXT_MESSAGES = 20

interface HistoryMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  time: string
  kind?: 'chat' | 'tool_activity' | 'system_event' | 'error'
  activity?: unknown
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}



async function readHistory(): Promise<HistoryMessage[]> {
  try {
    const raw = await fs.readFile(HISTORY_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((m: unknown) => m && typeof (m as HistoryMessage).content === 'string') : []
  } catch {
    return []
  }
}

async function writeHistory(messages: HistoryMessage[]) {
  await writeJsonAtomic(HISTORY_FILE, messages.slice(-MAX_STORED_MESSAGES))
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return jsonError(403, 'Cross-origin requests are not allowed.')

  let body: { message?: unknown; history?: unknown; settings?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Request body must be valid JSON.')
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return jsonError(400, 'Message is required.')
  if (message.length > MAX_MESSAGE_CHARS) return jsonError(413, `Message is too long (max ${MAX_MESSAGE_CHARS}).`)

  let model = ''
  let systemPrompt = ''
  if (body.settings && typeof body.settings === 'object') {
    const s = body.settings as { model?: unknown; systemPrompt?: unknown }
    if (typeof s.model === 'string') {
      model = s.model.trim()
      if (model && !MODEL_ID_PATTERN.test(model) && !LOCAL_PROVIDERS.some((p) => p.id === model)) {
        return jsonError(400, 'settings.model is not a valid model id.')
      }
    }
    if (typeof s.systemPrompt === 'string') {
      systemPrompt = s.systemPrompt.trim()
      if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) return jsonError(400, 'settings.systemPrompt is too long.')
    }
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      try {
        const customModels = await readCustomModels()
        const target = await resolveTarget(model, customModels)

        // conversation context: client history (if sent) else persisted history
        const priorHistory = Array.isArray(body.history)
          ? (body.history as Array<{ role?: unknown; content?: unknown }>)
              .filter((m) => typeof m?.content === 'string')
              .slice(-CONTEXT_MESSAGES)
              .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
          : (await readHistory()).slice(-CONTEXT_MESSAGES).map((m) => ({ role: m.role, content: m.content }))

        const { memoryPromptContext } = await import('@/lib/agent-hub/obsidian/context')
        const memory = await memoryPromptContext('teaching', message, target)
        const explainPrompt =
          buildExplainSystemPrompt(systemPrompt || undefined) +
          `\n\nRuntime fact (authoritative — do not contradict it): the model answering this conversation is "${describeTarget(target)}". ` +
          'If the user asks which model or AI you are, state exactly this runtime fact. Never claim a model identity that this fact does not confirm.'
        const intent = detectIntent(message)
        const context = [
          { role: 'system', content: explainPrompt + (memory ? '\n\n' + memory : '') },
          ...priorHistory,
          { role: 'user', content: `${message}\n\n(intent hint: ${intent})` },
        ]

        let full = ''
        let usage: LLMUsage | null = null
        for await (const chunk of streamLLM(target, context, { json: true })) {
          if (chunk.type === 'delta') {
            full += chunk.text
            await send({ type: 'delta', text: chunk.text })
          } else if (chunk.type === 'usage') {
            usage = chunk.usage
          }
        }

        const blocks: ExplainBlock[] = parseExplainResponse(full, true).blocks
        const reply = blocksToPlainText(blocks)

        const finalUsage = usage ?? estimateUsage(context.map((m) => m.content).join('\n'), reply)
        const estimated = usage === null
        const tokenUsage = (await readState()).tokenUsage

        await send({ type: 'blocks', blocks })

        // persist (best-effort) — shared chat history stays complete
        try {
          const history = await readHistory()
          const now = new Date().toISOString()
          await writeHistory([
            ...history,
            { id: newMessageId(), role: 'user', content: message, time: now, kind: 'chat' },
            { id: newMessageId(), role: 'assistant', content: reply, time: now, kind: 'chat' },
          ])
        } catch {
          // persistence is best-effort; never fail the stream over it
        }

        await send({
          type: 'done',
          reply,
          model: target.label,
          usage: finalUsage,
          estimated,
          tokenUsage,
        })
        controller.close()
      } catch (err) {
        await send({ type: 'error', error: err instanceof Error ? err.message : 'The assistant could not be reached.' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

