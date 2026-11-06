'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { DEFAULT_MODEL_PREFERENCE, normalizeModelPreference, type ModelPreference } from './model-preference'

const INITIAL = { preference: DEFAULT_MODEL_PREFERENCE, ready: false, saving: false, error: '' }
let snapshot = INITIAL
let loading: Promise<void> | undefined
let revision = 0
const listeners = new Set<() => void>()
const publish = (next: typeof INITIAL) => { snapshot = next; for (const listener of listeners) listener() }
async function load() {
  if (loading || snapshot.saving) return loading
  const expected = revision
  loading = (async () => {
    try {
      const response = await fetch('/api/model-preference', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      const value = await response.json()
      if (!response.ok || !value.ok) throw new Error(value.error || 'Could not read the shared model preference.')
      if (expected === revision) publish({ preference: normalizeModelPreference(value.preference), ready: true, saving: false, error: '' })
    } catch (error) { if (expected === revision) publish({ ...snapshot, ready: true, error: (error as Error).message }) }
    finally { loading = undefined }
  })()
  return loading
}
export async function updateModelPreference(patch: Partial<Pick<ModelPreference, 'model' | 'allowRemote'>>) {
  if (snapshot.saving) throw new Error('Wait for the current model preference to save.')
  revision++
  const previous = snapshot.preference
  publish({ ...snapshot, preference: { ...previous, ...patch }, saving: true, error: '' })
  try {
    const response = await fetch('/api/model-preference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    const value = await response.json()
    if (!response.ok || !value.ok) throw new Error(value.error || 'Could not save the shared model preference.')
    publish({ preference: normalizeModelPreference(value.preference), ready: true, saving: false, error: '' })
    try { localStorage.setItem('agenthub-model-preference-updated', String(Date.now())) } catch { /* preference is already saved on the server */ }
  } catch (error) { publish({ preference: previous, ready: true, saving: false, error: (error as Error).message }); throw error }
}
export function useModelPreference() {
  const state = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => snapshot, () => INITIAL)
  useEffect(() => {
    void load()
    const changed = () => { if (document.visibilityState !== 'hidden') void load() }
    window.addEventListener('focus', changed); window.addEventListener('storage', changed)
    return () => { window.removeEventListener('focus', changed); window.removeEventListener('storage', changed) }
  }, [])
  return { ...state, setModel: (model: string) => updateModelPreference({ model }), update: updateModelPreference, reload: load }
}
