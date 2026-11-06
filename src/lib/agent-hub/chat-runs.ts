'use client'

import type { ChatMessage } from './chat-types'
import type { ThinkingEffort } from './chat-settings'
import type { AttachmentKind } from './attachments'
import type { TokenUsageLedger } from './types'
import { isGameBuildRequest, setMascotActivity } from './mascot-activity'
import { syncUsage } from './usage-sync'

export type LocalChatMessage = ChatMessage & { attachments?: { name: string; kind: AttachmentKind }[] }
type ThinkingInfo = { mode: 'off' | 'native' | 'prompt'; effort: ThinkingEffort }
export interface ChatRunSnapshot {
  queued: { id: string; content: string }[]
  pending: boolean
  paused: boolean
  thinking: boolean
  text: string
  messages: LocalChatMessage[]
  error: string | null
  retryText: string | null
  model: string
  thinkingInfo: ThinkingInfo | null
  visionWarning: string | null
}
const EMPTY: ChatRunSnapshot = { queued: [], pending: false, paused: false, thinking: false, text: '', messages: [], error: null, retryText: null, model: '', thinkingInfo: null, visionWarning: null }
interface Run { snapshot: ChatRunSnapshot; controller: AbortController | null; completion?: Promise<void>; paused: boolean; resumeWaiters: Set<() => void>; source: string; mode: 'working' | 'game'; task: string; phase: string }
const runs = new Map<string, Run>()
const queue = new Map<string, Parameters<typeof startChatRun>[0][]>()
const listeners = new Map<string, Set<() => void>>()

export function getChatRun(chatId: string): ChatRunSnapshot { return runs.get(chatId)?.snapshot ?? EMPTY }
export function getServerChatRun(): ChatRunSnapshot { return EMPTY }
export function subscribeChatRun(chatId: string, listener: () => void): () => void {
  const group = listeners.get(chatId) ?? new Set()
  group.add(listener); listeners.set(chatId, group)
  return () => { group.delete(listener); if (!group.size) listeners.delete(chatId) }
}
function update(chatId: string, run: Run, patch: Partial<ChatRunSnapshot>) {
  run.snapshot = { ...run.snapshot, ...patch }
  for (const listener of listeners.get(chatId) ?? []) listener()
}

/** Merge at render time so an old history poll cannot remove an optimistic turn. */
export function mergeChatMessages<T extends ChatMessage>(history: T[], local: LocalChatMessage[]): Array<T | LocalChatMessage> {
  const ids = new Set(history.map((message) => message.id))
  return [...history, ...local.filter((message) => !ids.has(message.id))].sort((a, b) => a.time.localeCompare(b.time))
}

export function acknowledgeChatMessages(chatId: string, history: ChatMessage[]): void {
  const run = runs.get(chatId)
  if (!run) return
  const ids = new Set(history.map((message) => message.id))
  const messages = run.snapshot.messages.filter((message) => !ids.has(message.id))
  if (messages.length !== run.snapshot.messages.length) update(chatId, run, { messages })
}
function releasePausedRun(run: Run) {
  run.paused = false
  for (const resume of run.resumeWaiters) resume()
  run.resumeWaiters.clear()
}

async function waitUntilResumed(run: Run, signal: AbortSignal) {
  while (run.paused) {
    signal.throwIfAborted()
    await new Promise<void>((resolve) => {
      const resume = () => { signal.removeEventListener('abort', abort); run.resumeWaiters.delete(resume); resolve() }
      const abort = () => resume()
      run.resumeWaiters.add(resume)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    signal.throwIfAborted()
  }
}

export function stopChatRun(chatId: string): void {
  const run = runs.get(chatId)
  if (!run) return
  queue.delete(chatId)
  releasePausedRun(run)
  update(chatId, run, { paused: false, queued: [] })
  run.controller?.abort()
}

export async function setChatRunPaused(chatId: string, paused: boolean): Promise<void> {
  const run = runs.get(chatId)
  if (!run?.snapshot.pending) throw new Error('This chat is not running.')
  const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: paused ? 'pause' : 'resume', chatId }) })
  const data = await response.json().catch(() => ({})) as { ok?: boolean; paused?: boolean; error?: string }
  if (!response.ok || !data.ok) throw new Error(data.error || 'Could not change the chat state.')
  run.paused = data.paused === true
  if (!run.paused) releasePausedRun(run)
  if (run.paused) setMascotActivity(run.source, 'paused', { task: run.task, phase: 'Paused' })
  else setMascotActivity(run.source, run.mode, { task: run.task, phase: run.phase })
  update(chatId, run, { paused: run.paused })
}
export function discardChatRun(chatId: string): void {
  const run = runs.get(chatId)
  if (run?.snapshot.pending) throw new Error('Stop this chat before clearing or deleting it.')
  queue.delete(chatId)
  runs.delete(chatId)
  for (const listener of listeners.get(chatId) ?? []) listener()
}

type StreamEvent = {
  type?: string; text?: string; reply?: string; error?: string; time?: string; model?: string
  tokenUsage?: TokenUsageLedger; thinking?: ThinkingInfo; visionWarning?: string
}

/** Own the fetch independently of React mounts. Unsubscribing never cancels it. */
export function startChatRun(options: {
  chatId: string
  user: LocalChatMessage
  assistantId: string
  prepareBody: () => Promise<Record<string, unknown>>
  thinking: boolean
  queueIfBusy?: boolean
}): Promise<void> {
  const { chatId, user, assistantId } = options
  const previous = runs.get(chatId)
  if (previous?.snapshot.pending) {
    if (!options.queueIfBusy) return previous.completion ?? Promise.resolve()
    const items = queue.get(chatId) ?? []
    if (items.length >= 10) throw new Error('The message queue is full. Wait for a reply or remove a queued message.')
    items.push(options)
    queue.set(chatId, items)
    update(chatId, previous, { queued: items.map((item) => ({ id: item.user.id, content: item.user.content })) })
    return Promise.resolve()
  }
  const controller = new AbortController()
  const source = `chat:${chatId}`
  const mode = isGameBuildRequest(user.content) ? 'game' : 'working'
  const task = user.content.replace(/\s+/g, ' ').trim().slice(0, 96)
  const run: Run = {
    controller,
    paused: false,
    resumeWaiters: new Set(),
    source,
    mode,
    task,
    phase: options.thinking ? 'Thinking…' : 'Writing…',
    snapshot: { ...EMPTY, queued: (queue.get(chatId) ?? []).map((item) => ({ id: item.user.id, content: item.user.content })), messages: [...(previous?.snapshot.messages ?? []), user], pending: true, thinking: options.thinking },
  }
  runs.set(chatId, run)
  let phase = mode === 'game' ? 'Building…' : options.thinking ? 'Thinking…' : 'Writing…'
  const activity = (next: string) => { phase = next; run.phase = next; setMascotActivity(source, mode, { task, phase }) }
  activity(phase)
  update(chatId, run, {})
  run.completion = (async () => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let accumulated = ''
    let finished = false
    let outcome: 'done' | 'idle' | 'error' = 'done'
    const retainPartial = () => {
      if (!accumulated.trim() || finished) return
      update(chatId, run, { messages: [...run.snapshot.messages, { id: assistantId, role: 'assistant', content: accumulated.trim(), time: new Date().toISOString(), kind: 'chat' }] })
    }
    try {
      // The lock and user bubble exist before asynchronous file reads begin.
      const body = await options.prepareBody()
      controller.signal.throwIfAborted()
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `Request failed (${response.status}).`)
      }
      reader = response.body?.getReader()
      if (!reader) throw new Error('Response body is missing.')
      const consume = async (frame: string) => {
        await waitUntilResumed(run, controller.signal)
        if (finished) return
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
        if (!data || data === '[DONE]') return
        let event: StreamEvent
        try { event = JSON.parse(data) } catch { return }
        if (event.type === 'error') throw new Error(event.error || 'The model request failed.')
        if (event.type === 'thinking') {
          update(chatId, run, { thinking: true })
          if (mode !== 'game' && phase !== 'Thinking…') activity('Thinking…')
        } else if (event.type === 'replace' && typeof event.text === 'string') {
          accumulated = event.text
          update(chatId, run, { text: accumulated, thinking: false })
        } else if (event.type === 'delta' && event.text) {
          accumulated += event.text
          update(chatId, run, { text: accumulated, thinking: false })
          if (mode !== 'game' && phase !== 'Writing…') activity('Writing…')
        } else if (event.type === 'done') {
          const reply = event.reply?.trim() || accumulated.trim()
          if (!reply) throw new Error('The model returned no visible answer. Retry or choose another model.')
          finished = true
          update(chatId, run, {
            text: '', thinking: false,
            messages: [...run.snapshot.messages, { id: assistantId, role: 'assistant', content: reply, time: event.time || new Date().toISOString(), kind: 'chat' }],
            model: event.model ?? '', thinkingInfo: event.thinking && event.thinking.mode !== 'off' ? event.thinking : null, visionWarning: event.visionWarning ?? null,
          })
          syncUsage(event.tokenUsage)
        }
      }
      const decoder = new TextDecoder()
      let buffer = ''
      while (!finished) {
        await waitUntilResumed(run, controller.signal)
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ''
        for (const frame of frames) await consume(frame)
        if (chunk.done) { if (buffer.trim()) await consume(buffer); break }
      }
      if (!finished) throw new Error('The response ended before it finished. Your message and any partial answer are kept; retry or choose another model.')
    } catch (error) {
      retainPartial()
      const attached = Boolean(user.attachments?.length)
      if (controller.signal.aborted) {
        outcome = 'idle'
        update(chatId, run, { error: 'Response stopped. Your message and any partial answer are kept.', retryText: attached ? null : user.content })
      } else {
        outcome = 'error'
        const reason = error instanceof Error ? error.message : 'The assistant could not be reached.'
        update(chatId, run, { error: attached ? `${reason} Attach the files again to retry.` : reason, retryText: attached ? null : user.content })
      }
    } finally {
      await reader?.cancel().catch(() => {})
      reader?.releaseLock()
      run.controller = null
      releasePausedRun(run)
      update(chatId, run, { pending: false, paused: false, thinking: false, text: '' })
      setMascotActivity(source, outcome, { task, phase: outcome === 'done' ? 'Done' : outcome === 'error' ? 'Needs attention' : 'Stopped' })
      if (outcome === 'done') sendNextQueuedMessage(chatId)
    }
  })()
  return run.completion
}

export function removeQueuedMessage(chatId: string, id: string): void {
  const items = (queue.get(chatId) ?? []).filter((item) => item.user.id !== id)
  queue.set(chatId, items)
  const run = runs.get(chatId)
  if (run) update(chatId, run, { queued: items.map((item) => ({ id: item.user.id, content: item.user.content })) })
}
export function sendNextQueuedMessage(chatId: string): void {
  if (getChatRun(chatId).pending) return
  const items = queue.get(chatId) ?? []
  const next = items.shift()
  queue.set(chatId, items)
  if (next) void startChatRun({ ...next, user: { ...next.user, time: new Date().toISOString() } })
}
