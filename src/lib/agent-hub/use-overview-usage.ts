'use client'
import { useEffect, useState } from 'react'
import { useHub } from './store'
import type { ModelActivity, UsageUpdate } from './usage-events'

export function useOverviewUsage() {
  const [live, setLive] = useState<{ status: 'connecting' | 'live' | 'paused' | 'error'; active: ModelActivity[]; checkedAt: string }>({ status: 'connecting', active: [], checkedAt: '' })
  useEffect(() => {
    let source: EventSource | undefined
    let disposed = false
    const connect = () => {
      source?.close(); source = undefined
      if (document.visibilityState === 'hidden') { setLive((value) => ({ ...value, status: 'paused' })); return }
      source = new EventSource('/api/usage')
      source.onmessage = (event) => {
        if (disposed) return
        try {
          const update = JSON.parse(event.data) as UsageUpdate
          if (update.ledger && Array.isArray(update.ledger.records) && Array.isArray(update.ledger.days)) useHub.getState().applyTokenUsage(update.ledger)
          setLive({ status: 'live', active: Array.isArray(update.active) ? update.active : [], checkedAt: update.checkedAt })
        } catch { setLive((value) => ({ ...value, status: 'error' })) }
      }
      source.onerror = () => { if (!disposed) setLive((value) => ({ ...value, status: 'error', active: [] })) }
    }
    connect()
    document.addEventListener('visibilitychange', connect)
    return () => { disposed = true; source?.close(); document.removeEventListener('visibilitychange', connect) }
  }, [])
  return live
}
