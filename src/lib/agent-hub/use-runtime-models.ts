'use client'
import { useCallback, useSyncExternalStore } from 'react'

export interface RuntimeModel { id: string; providerId: string; providerName: string; arch?: string; type: string }
export type RuntimeStatus = 'loading' | 'ok' | 'offline' | 'unavailable' | 'error'
export interface RuntimeModelsState { loaded: RuntimeModel[]; status: RuntimeStatus; onlineProviders: string[]; checkedAt: string }
const INITIAL: RuntimeModelsState = { loaded: [], status: 'loading', onlineProviders: [], checkedAt: '' }
let snapshot = INITIAL
const listeners = new Map<() => void, number>()
let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let loading = false
const publish = (value: RuntimeModelsState) => { snapshot = value; for (const listener of listeners.keys()) listener() }
async function load() {
  clearTimeout(timer)
  if (loading || !listeners.size || document.visibilityState === 'hidden') return
  loading = true; controller = new AbortController()
  try {
    const response = await fetch('/api/runtime/models', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]) })
    const value = await response.json()
    if (!response.ok || !value.ok) throw new Error('Provider state unavailable')
    if (listeners.size) publish({ loaded: value.loaded ?? [], status: value.status ?? 'unavailable', onlineProviders: value.onlineProviders ?? [], checkedAt: value.checkedAt ?? '' })
  } catch {
    if (!controller.signal.aborted && listeners.size) publish({ ...snapshot, loaded: [], onlineProviders: [], status: 'error' })
  } finally {
    loading = false
    if (listeners.size && (document.visibilityState as string) !== 'hidden') timer = setTimeout(load, Math.min(...listeners.values()))
  }
}
function visibilityChanged() {
  clearTimeout(timer)
  if (document.visibilityState === 'hidden') controller?.abort()
  else void load()
}
function subscribe(listener: () => void, interval: number) {
  const first = listeners.size === 0
  listeners.set(listener, interval)
  if (first) { document.addEventListener('visibilitychange', visibilityChanged); window.addEventListener('focus', visibilityChanged) }
  if (first || interval < Math.min(...[...listeners].filter(([item]) => item !== listener).map(([, value]) => value))) void load()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) { clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibilityChanged); window.removeEventListener('focus', visibilityChanged) }
  }
}
/** One shared visible-only request stream, even with sidebar + Overview consumers. */
export function useRuntimeModels(pollMs = 15000): RuntimeModelsState {
  const register = useCallback((listener: () => void) => subscribe(listener, pollMs), [pollMs])
  return useSyncExternalStore(register, () => snapshot, () => INITIAL)
}
