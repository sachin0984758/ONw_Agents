'use client'
import { useEffect } from 'react'

/** Serial, visible-only refreshes. Hidden tabs neither poll nor keep a request open. */
export function useLivePoll(load: (signal: AbortSignal) => Promise<void>, intervalMs: number) {
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let running = false
    const poll = async () => {
      clearTimeout(timer)
      if (disposed || running || document.visibilityState === 'hidden') return
      running = true; controller = new AbortController()
      try { await load(controller.signal) } catch { /* the caller owns the error state */ }
      finally {
        running = false
        if (!disposed && (document.visibilityState as string) !== 'hidden') timer = setTimeout(poll, intervalMs)
      }
    }
    const changed = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'hidden') controller?.abort()
      else void poll()
    }
    void poll()
    document.addEventListener('visibilitychange', changed); window.addEventListener('focus', changed)
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', changed); window.removeEventListener('focus', changed) }
  }, [load, intervalMs])
}
