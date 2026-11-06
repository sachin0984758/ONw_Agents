const active = new Map<string, { paused: boolean; waiters: Set<() => void> }>()
export function isChatControlActive(chatId: string): boolean { return active.has(chatId) }

export function beginChatControl(chatId: string): void {
  active.set(chatId, { paused: false, waiters: new Set() })
}

export function finishChatControl(chatId: string): void {
  const run = active.get(chatId)
  if (!run) return
  run.paused = false
  for (const resume of run.waiters) resume()
  run.waiters.clear()
  active.delete(chatId)
}

export function setChatControlPaused(chatId: string, paused: boolean): boolean {
  const run = active.get(chatId)
  if (!run) return false
  run.paused = paused
  if (!paused) {
    for (const resume of run.waiters) resume()
    run.waiters.clear()
  }
  return true
}

export async function waitForChatControl(chatId: string, signal: AbortSignal): Promise<void> {
  let run = active.get(chatId)
  while (run?.paused) {
    signal.throwIfAborted()
    await new Promise<void>((resolve) => {
      const resume = () => {
        signal.removeEventListener('abort', abort)
        run?.waiters.delete(resume)
        resolve()
      }
      const abort = () => resume()
      run!.waiters.add(resume)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    signal.throwIfAborted()
    run = active.get(chatId)
  }
}
