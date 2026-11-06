'use client'
import { useEffect, useState } from 'react'
import type { ObsidianStatus, VaultGraph } from '@/lib/agent-hub/obsidian/types'
export async function obsidianRequest(query = '', body?: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch('/api/obsidian' + query, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal } : { cache: 'no-store', signal })
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error(data.error || 'Could not access Obsidian.')
  return data
}
export function useObsidianNetwork(enabled: boolean, revision: number) {
  const [status, setStatus] = useState<ObsidianStatus | null>(null), [graph, setGraph] = useState<VaultGraph | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); let pending = false; let loadedId = ''; let loadedAt = 0; let loadedCount = -1
    const load = async () => {
      if (pending) return
      pending = true
      try {
        const current: ObsidianStatus = (await obsidianRequest('', undefined, controller.signal)).status
        setStatus(current)
        if (!enabled || !current.available) { setGraph(null); loadedId = '' }
        else if (loadedId !== current.connection?.id || loadedCount !== current.noteCount || Date.now() - loadedAt > 60_000) {
          setLoading(true); setError('')
          const result = await obsidianRequest('?op=graph', undefined, controller.signal)
          if (!controller.signal.aborted) { setGraph(result.graph); loadedId = result.graph.connectionId; loadedCount = result.graph.notes.length; loadedAt = Date.now() }
        }
      } catch (e) { if (!controller.signal.aborted) { setGraph(null); setError(e instanceof Error ? e.message : 'Could not read vault graph.') } }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false) }
    }
    void load(); const timer = window.setInterval(() => void load(), 15_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [enabled, revision])
  return { status, graph, loading, error }
}
