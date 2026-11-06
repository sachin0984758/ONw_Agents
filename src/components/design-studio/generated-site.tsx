'use client'

// Client wrapper for the generated route: owns the light/dark toggle so the
// generated site is interactive, while the persisted design comes from
// site-config.ts (the only file Apply Design rewrites).

import { useState } from 'react'
import type { DesignConfig } from '@/lib/agent-hub/design-engine'
import { SiteRenderer } from './site-renderer'

export function GeneratedSite({ config }: { config: DesignConfig }) {
  const [theme, setTheme] = useState(config.theme)
  return (
    <SiteRenderer
      config={{ ...config, theme }}
      onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
    />
  )
}
