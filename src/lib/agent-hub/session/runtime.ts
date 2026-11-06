import type { Approval, CodingConversation, SessionEvent } from './types'

interface ActiveRun {
  controller: AbortController
  pending: Map<string, (approved: boolean) => void>
  approval: Approval | null
  conversation: CodingConversation
  publish: (event: SessionEvent) => void
  paused: boolean
  resumeWaiters: Set<() => void>
}
const active = new Map<string, ActiveRun>()

export function beginRun(conversation: CodingConversation, publish: ActiveRun['publish']): ActiveRun {
  const previous = active.get(conversation.id)
  if (previous) throw new Error('This session is already running.')
  const run: ActiveRun = { controller: new AbortController(), pending: new Map(), approval: null, conversation, publish, paused: false, resumeWaiters: new Set() }
  active.set(conversation.id, run)
  return run
}

export function finishRun(id: string): void { active.delete(id) }
export function currentApproval(id: string): Approval | null { return active.get(id)?.approval ?? null }
export function runningIds(): Set<string> { return new Set(active.keys()) }
export function isRunPaused(id: string): boolean { return active.get(id)?.paused ?? false }

export function pauseRun(id: string): boolean {
  const run = active.get(id)
  if (!run) return false
  if (!run.paused) {
    run.paused = true
    run.publish({ type: 'paused', paused: true })
  }
  return true
}

export function resumeRun(id: string): boolean {
  const run = active.get(id)
  if (!run) return false
  if (run.paused) {
    run.paused = false
    for (const resume of run.resumeWaiters) resume()
    run.resumeWaiters.clear()
    run.publish({ type: 'paused', paused: false })
  }
  return true
}

export async function waitUntilResumed(id: string, signal: AbortSignal): Promise<void> {
  let run = active.get(id)
  while (run?.paused) {
    signal.throwIfAborted()
    await new Promise<void>((resolve) => {
      const resume = () => {
        signal.removeEventListener('abort', abort)
        run?.resumeWaiters.delete(resume)
        resolve()
      }
      const abort = () => resume()
      run!.resumeWaiters.add(resume)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    signal.throwIfAborted()
    run = active.get(id)
  }
}

export async function approveAction(conversationId: string, approvalId: string, approved: boolean): Promise<boolean> {
  const run = active.get(conversationId)
  if (!run || !run.approval || run.approval.id !== approvalId) return false
  const settle = run.pending.get(approvalId)
  if (!settle) return false
  run.pending.delete(approvalId)
  run.approval = null
  run.publish({ type: 'approval', approval: null })
  settle(approved)
  return true
}

export async function requestApproval(conversationId: string, approval: Omit<Approval, 'id'>, signal: AbortSignal, publish: ActiveRun['publish']): Promise<boolean> {
  const run = active.get(conversationId)
  if (!run) throw new Error('The session stopped before approval was requested.')
  const full: Approval = { ...approval, id: crypto.randomUUID() }
  run.approval = full
  publish({ type: 'approval', approval: full })
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const done = (value: boolean) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      run.pending.delete(full.id)
      resolve(value)
    }
    const abort = () => done(false)
    run.pending.set(full.id, done)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

export async function stopRun(id: string): Promise<boolean> {
  const run = active.get(id)
  if (!run) return false
  run.paused = false
  for (const resume of run.resumeWaiters) resume()
  run.resumeWaiters.clear()
  for (const settle of run.pending.values()) settle(false)
  run.pending.clear()
  run.approval = null
  run.publish({ type: 'approval', approval: null })
  run.controller.abort()
  return true
}
