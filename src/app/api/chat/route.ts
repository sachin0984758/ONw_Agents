import { splitInteractiveQuizzes } from '@/lib/agent-hub/quiz-parser'
import { advancedStep, labelAdvancedLesson, ADVANCED_STEPS } from '@/lib/agent-hub/advanced-lesson'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { beginChatControl, finishChatControl, isChatControlActive, setChatControlPaused, waitForChatControl } from '@/lib/agent-hub/chat-control'
import { NextRequest, NextResponse } from 'next/server'
import { compactMcqHistory, establishedMcqTopic, mcqResponseContract, requestedMcqCount, topicFromChatTitle, topicFromUserMessage } from '@/lib/agent-hub/chat-quiz'
import { clearHistory, readHistory, readThread, serializeChat as serialize, validChatId, writeHistory, type StoredChatMessage as ChatMessage } from '@/lib/agent-hub/chat-store'
export type { StoredChatMessage as ChatMessage } from '@/lib/agent-hub/chat-store'
import { readCustomModels } from '@/lib/agent-hub/custom-models'
import {
  chatTurnsText,
  estimateUsage,
  callLLM as collectLLM,
  streamLLM,
  type ChatContentPart,
  type ChatTurn,
  type LLMUsage,
} from '@/lib/agent-hub/llm'
import { readState } from '@/lib/agent-hub/state-file'
import { resolveModelTarget } from '@/lib/agent-hub/model-routing'
import { TASK_GUIDANCE } from '@/lib/agent-hub/task-guidance'
import { newMessageId, normalizeHistory } from '@/lib/agent-hub/chat-types'
import {
  DEFAULT_SYSTEM_PROMPT,
  LOCAL_PROVIDERS,
  MAX_SYSTEM_PROMPT_CHARS,
  RESPONSE_DEPTHS,
  MODEL_ID_PATTERN,
  THINKING_EFFORTS,
  responseDepthPromptSuffix,
  type ResponseDepth,
  type ThinkingEffort,
} from '@/lib/agent-hub/chat-settings'
import {
  attachmentKind,
  dataUrlFor,
  modelLooksVision,
  reasoningBody,
  thinkingModeFor,
  thinkingPromptSuffix,
  validateAttachment,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  type ChatAttachmentPayload,
} from '@/lib/agent-hub/attachments'
import { extractDocumentText } from '@/lib/agent-hub/document-extract'
import { ADVANCED_TEACH_SYSTEM_PROMPT, AI_AGENTS_GUIDE_REFERENCE, TEACH_SYSTEM_PROMPT } from '@/lib/agent-hub/teach-prompt'

// ─── Chat API ────────────────────────────────────────────────────────────────
// A simple chat interface for the dashboard. History is persisted server-side
// in db/chat-history.json so conversations survive page reloads.
//
// Model routing:
//   1. If a custom model ID is selected → route to that custom API endpoint
//   2. If a local provider ID is selected (lmstudio/ollama) → auto-connect
//   3. If no model selected → auto-detect: try LM Studio, then Ollama, then custom models
//
//   GET    /api/chat  → { ok, messages }
//   POST   /api/chat  → { message } → { ok, reply }   (LLM-powered)
//   DELETE /api/chat  → clear history
//
// POST body:
//   { message, settings?, history?, stateless? }
//   - default          → reads + writes db/chat-history.json (the Chat page
//                        and the machine API)
//   - stateless: true  → a pure model call for the Agent Session runtime: the
//                        shared Chat history is neither read nor written, so a
//                        Session and the Chat never share messages. An optional
//                        `history` array provides isolated per-call context.
// ─────────────────────────────────────────────────────────────────────────────

// Cap both what we hand to the provider and what we persist on disk.
const MAX_MESSAGE_CHARS = 16000
// Context window sent to the model: the last N *messages* (not exchanges).
const CONTEXT_MESSAGES = 20
const EMPTY_REPLY = '(empty reply — try again)'

// ── request settings (model + system prompt + thinking) ─────────────────────
interface ParsedSettings {
  model: string
  systemPrompt: string
  teachMode: boolean
  advancedTeachMode: boolean
  thinking: boolean
  effort: ThinkingEffort
  responseDepth: ResponseDepth
}

function parseSettings(raw: unknown): { ok: true; value: ParsedSettings } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: { model: '', systemPrompt: DEFAULT_SYSTEM_PROMPT, teachMode: false, advancedTeachMode: false, thinking: false, effort: 'medium', responseDepth: 'standard' } }
  }
  if (typeof raw !== 'object') return { ok: false, error: 'settings must be an object.' }
  const s = raw as { model?: unknown; systemPrompt?: unknown; teachMode?: unknown; advancedTeachMode?: unknown; thinking?: unknown; effort?: unknown; responseDepth?: unknown }
  let model = ''
  if (s.model !== undefined) {
    if (typeof s.model !== 'string') return { ok: false, error: 'settings.model must be a string.' }
    model = s.model.trim()
    if (model && !MODEL_ID_PATTERN.test(model) && !LOCAL_PROVIDERS.some((p) => p.id === model)) {
      return { ok: false, error: 'settings.model is not a valid model id (max 128 chars, letters/digits/._:/-).' }
    }
  }
  let systemPrompt = DEFAULT_SYSTEM_PROMPT
  if (s.systemPrompt !== undefined) {
    if (typeof s.systemPrompt !== 'string') return { ok: false, error: 'settings.systemPrompt must be a string.' }
    systemPrompt = s.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT
    if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
      return { ok: false, error: `settings.systemPrompt is too long (max ${MAX_SYSTEM_PROMPT_CHARS} characters).` }
    }
  }
  // Teach mode: use the built-in teaching preset instead of the user's prompt
  // (the preset is longer than MAX_SYSTEM_PROMPT_CHARS by design).
  const teachMode = s.teachMode === true
  const advancedTeachMode = s.advancedTeachMode === true
  // Thinking: a boolean plus a validated effort level. Never trust an unknown
  // effort string — fall back to 'medium'.
  const thinking = s.thinking === true
  const effort: ThinkingEffort = THINKING_EFFORTS.includes(s.effort as ThinkingEffort)
    ? (s.effort as ThinkingEffort)
    : 'medium'
  const responseDepth: ResponseDepth = RESPONSE_DEPTHS.includes(s.responseDepth as ResponseDepth)
    ? (s.responseDepth as ResponseDepth)
    : 'standard'
  return { ok: true, value: { model, systemPrompt, teachMode, advancedTeachMode, thinking, effort, responseDepth } }
}

// ── origin check (CSRF hardening) ────────────────────────────────────────────


// ── Provider detection ──────────────────────────────────────────────────────
// ── LLM call ────────────────────────────────────────────────────────────────
async function callLLM(
  endpoint: string,
  apiKey: string,
  modelId: string,
  context: ChatTurn[],
  extraBody?: Record<string, unknown>,
  signal?: AbortSignal,
  maxTokens?: number,
): Promise<{ reply: string; servedModel: string; usage: LLMUsage | null }> {
  let usage: LLMUsage | null = null
  const reply = await collectLLM({ endpoint, apiKey, modelId, label: modelId }, context, {
    extraBody, signal, maxTokens, onUsage: (value) => { usage = value },
  })
  return { reply: reply || EMPTY_REPLY, servedModel: modelId, usage }
}

export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  // Real connection state for the Chat header: probe the configured provider
  // (and the loaded model) rather than trusting a stored label.
  if (req.nextUrl.searchParams.get('resource') === 'status') {
    const model = (req.nextUrl.searchParams.get('model') ?? '').trim()
    try {
      const customModels = await readCustomModels()
      const target = await resolveModelTarget(model, customModels)
      let connected = target.isChatCompatible !== false
      let warning = target.warning
      // resolveTarget returns a custom model's stored config without dialing
      // the endpoint — a stopped provider still "resolves". For custom
      // endpoints verify reachability so this header reflects reality: any
      // HTTP response counts as reachable; a network failure does not.
      // (Local providers are already probed inside resolveTarget.)
      if (customModels.some((cm) => cm.endpoint.replace(/\/+$/, '') === target.endpoint.replace(/\/+$/, ''))) {
        try {
          await fetch(`${target.endpoint.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(2500) })
        } catch (err) {
          connected = false
          const reason =
            err instanceof Error && err.cause
              ? String((err.cause as { code?: string }).code ?? err.cause).slice(0, 80)
              : err instanceof Error
                ? err.message.slice(0, 80)
                : 'error'
          warning = `Provider endpoint ${target.endpoint} is not reachable (${reason}). Start the provider or pick another model.`
        }
      }
      return NextResponse.json({
        ok: true,
        connected,
        provider: target.label,
        modelId: target.modelId,
        endpoint: target.endpoint,
        loaded: target.loaded ?? true,
        isChatCompatible: target.isChatCompatible ?? true,
        warning,
        availableModels: target.availableModels ?? [],
        customModels: customModels.length,
      })
    } catch (err) {
      let customModels = 0
      try {
        customModels = (await readCustomModels()).length
      } catch {
        /* ignore */
      }
      return NextResponse.json({
        ok: true,
        connected: false,
        error: err instanceof Error ? err.message : 'No LLM provider available.',
        customModels,
      })
    }
  }
  const chatId = req.nextUrl.searchParams.get('chatId') ?? 'legacy'
  if (!validChatId(chatId)) return NextResponse.json({ ok: false, error: 'Invalid chat id.' }, { status: 400 })
  if (chatId !== 'legacy' && !(await readThread(chatId))) {
    return NextResponse.json({ ok: false, error: 'Chat conversation not found.' }, { status: 404 })
  }
  const messages = await readHistory(chatId)
  // Normalize to typed, render-ready messages (never mutates the stored file).
  return NextResponse.json({ ok: true, messages: normalizeHistory(messages) })
}

export async function PATCH(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  try {
    const body = await req.json()
    if (!validChatId(body.chatId) || typeof body.messageId !== 'string' || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 32000) throw new Error('Choose a saved message and enter 1–32,000 characters.')
    return await serialize(async () => {
      if (isChatControlActive(body.chatId)) throw new Error('Stop the current response before editing a message.')
      const history = await readHistory(body.chatId)
      const index = history.findIndex((message) => message.id === body.messageId && message.role === 'user')
      if (index < 0) throw new Error('Saved message not found. Refresh the conversation.')
      const { writeJsonAtomic } = await import('@/lib/agent-hub/fs-atomic')
      const { DB_DIR } = await import('@/lib/agent-hub/db-path')
      const { default: path } = await import('node:path')
      await writeJsonAtomic(path.join(DB_DIR, 'chat-edit-history', `${crypto.randomUUID()}.json`), { chatId: body.chatId, editedAt: new Date().toISOString(), messages: history })
      // Editing starts a new continuation. Preserve the previous branch in the
      // edit backup and let the normal send path persist the replacement turn.
      const messages = history.slice(0, index)
      await writeHistory(messages, body.chatId)
      return NextResponse.json({ ok: true, messages: normalizeHistory(messages) })
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Could not edit the message.' }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }

  let body: {
    action?: unknown
    message?: unknown
    settings?: unknown
    stateless?: unknown
    history?: unknown
    stream?: unknown
    userMsgId?: unknown
    assistantMsgId?: unknown
    attachments?: unknown
    chatId?: unknown
    chatTitle?: unknown
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 })
  }
  if (body.action === 'pause' || body.action === 'resume') {
    const chatId = typeof body.chatId === 'string' ? body.chatId : ''
    if (!validChatId(chatId)) return NextResponse.json({ ok: false, error: 'Invalid chat id.' }, { status: 400 })
    const paused = body.action === 'pause'
    const ok = setChatControlPaused(chatId, paused)
    return NextResponse.json({ ok, paused: ok && paused, error: ok ? undefined : 'This chat is not running.' }, { status: ok ? 200 : 409 })
  }
  // Internal callers (the Agent Session runtime, delegated sub-agents) set
  // `stateless: true`. They get a pure model call: the shared Chat history is
  // neither read for context nor written to. This keeps the Session and the
  // Chat as two separate conversations — a message in one never appears in the
  // other. The Chat page and the machine API keep the persistent default.
  const stateless = body.stateless === true
  const chatId = typeof body.chatId === 'string' ? body.chatId : 'legacy'
  if (!stateless && !validChatId(chatId)) {
    return NextResponse.json({ ok: false, error: 'Invalid chat id.' }, { status: 400 })
  }
  if (!stateless && chatId !== 'legacy' && !(await readThread(chatId))) {
    return NextResponse.json({ ok: false, error: 'Chat conversation not found.' }, { status: 404 })
  }
  const isStream = body.stream === true || req.headers.get('accept')?.includes('text/event-stream') === true
  const clientHistoryRaw = body.history
  const rawAttachments: unknown[] = Array.isArray(body.attachments) ? body.attachments : []
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message && rawAttachments.length === 0) {
    return NextResponse.json({ ok: false, error: 'Message is required.' }, { status: 400 })
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { ok: false, error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` },
      { status: 413 },
    )
  }
  const parsedSettings = parseSettings(body.settings)
  if (!parsedSettings.ok) {
    return NextResponse.json({ ok: false, error: parsedSettings.error }, { status: 400 })
  }
  const { model, systemPrompt: userSystemPrompt, teachMode, advancedTeachMode, thinking, effort, responseDepth } = parsedSettings.value
  const systemPrompt = advancedTeachMode
    ? ADVANCED_TEACH_SYSTEM_PROMPT
    : teachMode
      ? TEACH_SYSTEM_PROMPT
      : `${userSystemPrompt}\n\n${TASK_GUIDANCE}`

  const userMsgId = typeof body.userMsgId === 'string' && body.userMsgId.trim() ? body.userMsgId.trim() : newMessageId()
  const assistantMsgId =
    typeof body.assistantMsgId === 'string' && body.assistantMsgId.trim() ? body.assistantMsgId.trim() : newMessageId()
  const sendTime = new Date().toISOString()

  try {
    const customModels = await readCustomModels()
    let target = await resolveModelTarget(model, customModels)

    // Check chat compatibility
    if (target.isChatCompatible === false) {
      return NextResponse.json(
        {
          ok: false,
          error:
            target.warning ||
            `Model "${target.modelId}" is incompatible with text chat. Please select a text chat model.`,
        },
        { status: 400 },
      )
    }

    // NOTE: we deliberately do NOT block models that are merely "not loaded".
    // LM Studio loads a requested model on demand (just-in-time), and the
    // requirement is to auto-detect AND load the model. If the provider cannot
    // serve it, the real provider error is surfaced below. `target.warning`
    // stays informational in the header/settings UI.

    const persisted = stateless ? [] : await readHistory(chatId)
    const clientHistory = Array.isArray(clientHistoryRaw)
      ? (clientHistoryRaw as Array<{ role?: unknown; content?: unknown }>)
          .filter((m) => typeof m?.content === 'string')
          .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }))
      : []
    const contextHistory = (stateless ? clientHistory : persisted).slice(-CONTEXT_MESSAGES)
    const mcqCount = requestedMcqCount(message)
    const explicitMcqTopic = mcqCount === null ? null : topicFromUserMessage(message)
    const chatTitleTopic = mcqCount === null ? null : topicFromChatTitle(body.chatTitle)
    const stableMcqTopic = explicitMcqTopic || chatTitleTopic
    const mcqTopic = mcqCount === null ? null : stableMcqTopic || establishedMcqTopic(contextHistory)
    const mcqLevel = /\bbeginner\b/i.test(message) ? 'Beginner' : /\bintermediate\b/i.test(message) ? 'Intermediate' : advancedTeachMode || /\badvanced\b/i.test(message) ? 'Advanced' : 'Beginner'
    const advancedStart = advancedTeachMode ? contextHistory.findLastIndex((turn) => turn.role === 'assistant' && /(?:^|\n)\s*#{0,6}\s*(?:\*\*)?Step\s*1\s*:\s*The Simplified Concept/i.test(turn.content)) : -1
    const lessonStep = advancedStep(contextHistory, message)
    const hasCompleteQuiz = (text: string) => {
      if (mcqCount === null) return true
      const quizzes = splitInteractiveQuizzes(text).flatMap((part) => part.type === 'quiz' ? [part.quiz] : [])
      return quizzes.length === mcqCount && new Set(quizzes.map((quiz) => quiz.number)).size === mcqCount && quizzes.every((quiz) => quiz.options.length === 4 && quiz.correctLetter && quiz.explanation)
    }
    const quizRepairTurn = (draft: string): ChatTurn => ({
      role: 'user',
      content: `Your previous draft did not meet the interactive quiz format. Repair it into exactly ${mcqCount} complete questions using the required heading, four A-D choices, and one answer block with a correct letter and short explanation for every question. Return only the corrected complete quiz.\n\nPrevious draft:\n${draft.slice(0, 10000)}`,
    })
    const formatReply = (text: string) => {
      if (!text.trim()) return text
      if (mcqCount !== null) {
        if (!hasCompleteQuiz(text)) throw new Error(`The model returned an incomplete quiz after one format-repair attempt. Expected ${mcqCount} questions with four choices, answers and explanations. No incomplete quiz was saved.`)
      }
      return advancedTeachMode && mcqCount === null ? labelAdvancedLesson(text, lessonStep) : text
    }
    const advancedHistory = advancedStart >= 0 ? contextHistory.slice(Math.max(0, advancedStart - 1)) : contextHistory
    // When the request/title already establishes a topic, older quiz cards and
    // lessons can mislead small local models into switching subjects. The
    // topic contract carries the needed context, so omit that stale history.
    const modelHistory = advancedTeachMode
      ? mcqCount === null ? advancedHistory : compactMcqHistory(advancedHistory)
      : mcqCount === null ? contextHistory : stableMcqTopic ? [] : compactMcqHistory(contextHistory)

    // ── Attachments ──────────────────────────────────────────────────────────
    // Images are forwarded as real multimodal content; documents are extracted
    // locally to text. Every failure is reported — no attachment is silently
    // dropped. Consequences are honest about what the selected model can do.
    if (rawAttachments.length > MAX_ATTACHMENTS) {
      return NextResponse.json({ ok: false, error: `Too many attachments (max ${MAX_ATTACHMENTS}).` }, { status: 400 })
    }
    const documentBlocks: string[] = []
    const imageParts: ChatContentPart[] = []
    const attachedNames: string[] = []
    let totalAttachmentBytes = 0
    for (const raw of rawAttachments) {
      if (!raw || typeof raw !== 'object') {
        return NextResponse.json({ ok: false, error: 'Each attachment must be an object.' }, { status: 400 })
      }
      const a = raw as Partial<ChatAttachmentPayload>
      const name = typeof a.name === 'string' ? a.name : ''
      const mime = typeof a.mime === 'string' ? a.mime : ''
      const dataBase64 = typeof a.dataBase64 === 'string' ? a.dataBase64.replace(/\s/g, '') : ''
      const buf = Buffer.from(dataBase64, 'base64')
      const invalid = validateAttachment(name, mime, buf.length)
      if (invalid) return NextResponse.json({ ok: false, error: invalid }, { status: 400 })
      totalAttachmentBytes += buf.length
      if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        return NextResponse.json(
          { ok: false, error: `Attachments are too large in total (max ${MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024)} MB).` },
          { status: 413 },
        )
      }
      const kind = attachmentKind(name, mime)
      if (kind === 'image') {
        imageParts.push({ type: 'image_url', image_url: { url: dataUrlFor(mime, dataBase64, name) } })
      } else {
        const extracted = extractDocumentText(name, mime, buf)
        if (!extracted.ok) return NextResponse.json({ ok: false, error: extracted.error }, { status: 400 })
        const label = extracted.method === 'pdf' ? 'PDF' : extracted.method === 'docx' ? 'DOCX' : extracted.method === 'zip' ? 'ZIP text/source' : 'text'
        documentBlocks.push(
          `Attached document “${name}” (${label}${extracted.truncated ? ', truncated to context limit' : ''}):\n\n${extracted.text}`,
        )
      }
      attachedNames.push(name)
    }

    // Vision: never pretend a text-only model saw an image. When the provider
    // reports the model as non-vision, stop and offer an available vision model.
    let visionWarning: string | undefined
    if (imageParts.length > 0) {
      target = await resolveModelTarget(model, customModels, { vision: true })
      const available = target.availableModels ?? []
      const meta = available.find((m) => m.id === target.modelId)
      const knownVision = meta ? modelLooksVision(meta.id, meta.type) : undefined
      if (knownVision === false) {
        const visionModels = available
          .filter((m) => m.isChatCompatible && modelLooksVision(m.id, m.type))
          .map((m) => m.id)
        return NextResponse.json(
          {
            ok: false,
            error:
              `The selected model (${target.modelId || target.label}) is text-only and cannot see images. ` +
              (visionModels.length
                ? `Choose a locally available vision model, e.g. ${visionModels.slice(0, 3).join(', ')}.`
                : 'No locally available vision model was detected — load one in your provider first.'),
          },
          { status: 400 },
        )
      }
      if (meta === undefined) {
        visionWarning =
          `Could not verify that “${target.modelId || target.label}” supports images; the image was sent anyway. ` +
          'If the reply ignores it, select a vision model.'
      }
    }

    // ── Thinking / answer effort ─────────────────────────────────────────────
    // Native reasoning params are only sent for models that support them;
    // otherwise a clearly-labelled prompt-guided instruction is used, and the
    // response reports which mode was actually applied.
    const thinkingInfo: { requested: boolean; effort: ThinkingEffort; mode: 'off' | 'native' | 'prompt' } = {
      requested: thinking,
      effort,
      mode: 'off',
    }
    let extraBody: Record<string, unknown> = {}
    let effectiveSystemPrompt = `${systemPrompt}${responseDepthPromptSuffix(responseDepth)}`
    if (thinking) {
      const mode = thinkingModeFor(target.modelId)
      thinkingInfo.mode = mode
      if (mode === 'native') extraBody = reasoningBody(target.modelId, effort)
      else effectiveSystemPrompt = `${effectiveSystemPrompt}${thinkingPromptSuffix(effort)}`
    }

    // Provide truthful model identity context so the assistant answers accurately when asked
    const { memoryPromptContext } = await import('@/lib/agent-hub/obsidian/context')
    const memoryContext = await memoryPromptContext(teachMode || advancedTeachMode ? 'teaching' : 'chat', message, target)
    const systemContext = [
      memoryContext,
      effectiveSystemPrompt,
      (teachMode || advancedTeachMode) && !(advancedTeachMode && advancedStart >= 0 && mcqCount !== null) && /\b(?:ai|artificial intelligence|llm)[ -]+agents?\b/i.test(mcqTopic || message) ? AI_AGENTS_GUIDE_REFERENCE : '',
      advancedTeachMode && advancedStart >= 0 && mcqCount !== null ? 'This is a practice-only turn within the current Advanced lesson. Use the concepts actually explained in the active lesson history. If the user says "so far" or "covered", do not introduce later or unrelated topics. Generate the requested quiz without advancing or restarting the five-step framework.' : '',
      mcqCount === null ? '' : mcqResponseContract(mcqCount, mcqTopic, mcqLevel),
      `Runtime environment: You are running via ${target.label} (model: ${target.modelId || target.label}). If the user asks which model or AI you are, identify yourself accurately as ${target.modelId || target.label}.`,
    ].filter(Boolean).join('\n\n')

    const finalUserContent: string | ChatContentPart[] =
      documentBlocks.length || imageParts.length
        ? [
            ...(message ? [{ type: 'text' as const, text: message }] : []),
            ...documentBlocks.map((text) => ({ type: 'text' as const, text })),
            ...imageParts,
          ]
        : message

    const context: ChatTurn[] = [
      { role: 'system', content: systemContext + (advancedTeachMode && mcqCount === null ? `\nApplication lesson state: Step ${lessonStep}: ${ADVANCED_STEPS[lessonStep - 1]}. Teach only this step. Do not advance without confirmation. If the topic needs clarification, ask before teaching.` : '') },
      ...modelHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: finalUserContent },
    ]

    // What we persist in the shared transcript: the user's text plus a compact
    // note of the attachment names. Attachment CONTENTS are never stored.
    const persistedUserContent = attachedNames.length
      ? `${message}${message ? '\n\n' : ''}[Attached: ${attachedNames.join(', ')}]`
      : message
    const outputBudget = mcqCount !== null
      ? Math.min(3600, Math.max(800, mcqCount * 600))
      : advancedTeachMode ? 3000 : undefined

    // ── Streaming SSE response ───────────────────────────────────────────────
    if (isStream) {
      const encoder = new TextEncoder()
      const upstream = new AbortController()
      const signal = AbortSignal.any([req.signal, upstream.signal])
      if (!stateless) beginChatControl(chatId)
      let cancelled = false
      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) => { if (!cancelled && !signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)) }
          let fullReply = ''
          // Provider-reported usage arrives as a final stream chunk; when a
          // provider omits it we estimate and label the result as estimated.
          let usage: LLMUsage | null = null

          try {
            const readReply = async (messages: ChatTurn[], publishDeltas = true) => {
              if (!stateless) await waitForChatControl(chatId, signal)
              for await (const chunk of streamLLM(target, messages, { extraBody, signal, maxTokens: outputBudget })) {
                if (!stateless) await waitForChatControl(chatId, signal)
                if (chunk.type === 'thinking') {
                  // Keep the UI activity state without exposing the provider's
                  // private reasoning channel to the transcript or browser.
                  await send({ type: 'thinking' })
                } else if (chunk.type === 'delta') {
                  fullReply += chunk.text
                  if (publishDeltas) await send({ type: 'delta', text: chunk.text })
                } else if (chunk.type === 'usage') {
                  usage = chunk.usage
                }
              }
            }
            await readReply(context)
            if (!stateless) await waitForChatControl(chatId, signal)
            if (!fullReply.trim()) {
              const retryContext = context.slice()
              retryContext[0] = {
                role: 'system',
                content: `${systemContext}\n\nThe previous attempt returned no user-visible answer. Generate a complete, direct response now; never finish with empty text.`,
              }
              await readReply(retryContext)
              if (!stateless) await waitForChatControl(chatId, signal)
            }

            if (mcqCount !== null && !hasCompleteQuiz(fullReply.trim())) {
              const incompleteDraft = fullReply.trim()
              fullReply = ''
              await readReply([...context, { role: 'assistant', content: incompleteDraft }, quizRepairTurn(incompleteDraft)], false)
              if (!hasCompleteQuiz(fullReply.trim())) throw new Error(`The model could not repair the quiz into ${mcqCount} complete questions. No incomplete quiz was saved.`)
              await send({ type: 'replace', text: fullReply.trim() })
            }

            const cleanReply = formatReply(fullReply.trim())
            signal.throwIfAborted()
            if (!cleanReply) throw new Error('The model returned no visible answer after a retry. Your message is still available; try again or choose another model.')
            const finalUsage = usage ?? estimateUsage(chatTurnsText(context), cleanReply)
            const estimated = usage === null
            // The shared model client records each attempt exactly once.
            const tokenUsage = (await readState()).tokenUsage
            const userMsg: ChatMessage = {
              id: userMsgId,
              role: 'user',
              content: persistedUserContent,
              time: sendTime,
              kind: 'chat',
            }
            const assistantMsg: ChatMessage = {
              id: assistantMsgId,
              role: 'assistant',
              content: cleanReply,
              time: new Date().toISOString(),
              kind: 'chat',
            }

            if (!stateless) {
              await serialize(async () => {
                const currentHistory = await readHistory(chatId)
                // Avoid duplicating userMsg if already present
                const filtered = currentHistory.filter((m) => m.id !== userMsgId && m.id !== assistantMsgId)
                await writeHistory([...filtered, userMsg, assistantMsg], chatId)
              })
            }

            await send({
              type: 'done',
              reply: cleanReply,
              model: target.label,
              usage: finalUsage,
              estimated,
              tokenUsage,
              thinking: thinkingInfo,
              visionWarning,
              userMsgId,
              assistantMsgId,
              time: assistantMsg.time,
            })
            if (!cancelled) controller.close()
          } catch (err) {
            if (!cancelled) {
              if (!signal.aborted) await send({ type: 'error', error: err instanceof Error ? err.message : 'The assistant could not be reached.' })
              controller.close()
            }
          } finally {
            if (!stateless) finishChatControl(chatId)
          }
        },
        cancel() { cancelled = true; upstream.abort(); if (!stateless) finishChatControl(chatId) },
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

    // ── Non-streaming response ───────────────────────────────────────────────
    const run = async () => {

      // Try calling LLM using target endpoint
      let result: Awaited<ReturnType<typeof callLLM>>
      try {
        result = await callLLM(target.endpoint, target.apiKey, target.modelId, context, extraBody, req.signal, outputBudget)
        if (!result.reply.trim() || result.reply === EMPTY_REPLY) {
          const retryContext = context.slice()
          retryContext[0] = {
            role: 'system',
            content: `${systemContext}\n\nThe previous attempt returned no user-visible answer. Generate a complete, direct response now; never finish with empty text.`,
          }
          result = await callLLM(target.endpoint, target.apiKey, target.modelId, retryContext, extraBody, req.signal, outputBudget)
          if (!result.reply.trim() || result.reply === EMPTY_REPLY) throw new Error('The model returned no visible answer after a retry. Try again or choose another model.')
        }
      } catch (error) {
        if (target.loaded === false && error instanceof Error && /\(HTTP (400|404)\)/.test(error.message)) {
          return NextResponse.json({
            ok: false, retryable: false, code: 'MODEL_NOT_READY',
            error: `The provider could not serve "${target.modelId}" while it was not loaded. Load a chat model in LM Studio or Ollama, or select another model under Models, then retry. File counting and capability help work without a model.`,
          }, { status: 503 })
        }
        throw error
      }
      if (mcqCount !== null && !hasCompleteQuiz(result.reply)) {
        result = await callLLM(target.endpoint, target.apiKey, target.modelId, [...context, { role: 'assistant', content: result.reply }, quizRepairTurn(result.reply)], extraBody, req.signal, outputBudget)
      }
      const reply = formatReply(result.reply)
      const servedModel = target.label
      const usage = result.usage

      const userMsg: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: persistedUserContent,
        time: sendTime,
        kind: 'chat',
      }
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: reply,
        time: new Date().toISOString(),
        kind: 'chat',
      }

      if (!stateless) {
        // `persisted` was read for the LLM context, before entering the write
        // queue. A concurrent request may have persisted its turns since, so
        // re-read here — otherwise last-writer-wins drops earlier exchanges.
        const currentHistory = await readHistory(chatId)
        const filtered = currentHistory.filter((m) => m.id !== userMsgId && m.id !== assistantMsgId)
        await writeHistory([...filtered, userMsg, assistantMsg], chatId)
      }

      const finalUsage = usage ?? estimateUsage(chatTurnsText(context), reply)
      const estimated = usage === null
      const tokenUsage = (await readState()).tokenUsage

      return NextResponse.json({
        ok: true,
        reply,
        model: servedModel,
        usage: finalUsage,
        estimated,
        tokenUsage,
        thinking: thinkingInfo,
        visionWarning,
        stateless,
        persisted: !stateless,
        messages: [userMsg, assistantMsg],
      })
    }

    return stateless ? await run() : await serialize(run)
  } catch (err) {
    console.error('[api/chat] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'The assistant could not be reached.' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  const chatId = req.nextUrl.searchParams.get('chatId') ?? 'legacy'
  if (!validChatId(chatId)) return NextResponse.json({ ok: false, error: 'Invalid chat id.' }, { status: 400 })
  await serialize(() => clearHistory(chatId))
  return NextResponse.json({ ok: true, reset: true })
}
