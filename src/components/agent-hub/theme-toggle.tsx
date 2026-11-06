'use client'

import { useSyncExternalStore } from 'react'
import { Laptop, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

// ── Theme toggle (light / dark / system) ────────────────────────────────────
// Uses next-themes (attribute="class" on <html>, defaultTheme="system").
// Persists in localStorage, no reload, no competing theme system.

const MODES = [
  { id: 'light', label: 'Light mode', icon: Sun },
  { id: 'dark', label: 'Dark mode', icon: Moon },
  { id: 'system', label: 'System mode', icon: Laptop },
] as const

type ModeId = (typeof MODES)[number]['id']

const emptySubscribe = () => () => {}

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  // `mounted`: false during SSR and the hydration render, true afterwards —
  // same behavior as the previous setState-in-effect flag, without the
  // cascading re-render (react-hooks/set-state-in-effect).
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  const active: ModeId = (theme as ModeId) ?? 'system'
  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-full border border-border bg-secondary/60 p-0.5"
    >
      {MODES.map((m) => {
        const Icon = m.icon
        const selected = mounted && active === m.id
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setTheme(m.id)}
            aria-label={m.label}
            title={m.label}
            aria-pressed={selected}
            className={cn(
              'rounded-full p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              selected
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </button>
        )
      })}
      <span className="sr-only">Current: {mounted ? (active === 'system' ? `system (${resolvedTheme ?? '…'})` : active) : '…'}</span>
    </div>
  )
}