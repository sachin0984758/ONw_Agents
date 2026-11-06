'use client'

import { Monitor, Moon, ShieldCheck, Smartphone, Sun, Tablet } from 'lucide-react'
import type { MarketplaceComponent, StylingPreset } from '@/lib/agent-hub/marketplace/types'
import { buildPreviewDocument } from './preview-document'
import styles from '../ui-components-view.module.css'

export function ComponentPreview({ component, style, size, onSize, onTheme, compact = false, title }: {
  component: MarketplaceComponent; style: StylingPreset; size: 'desktop' | 'tablet' | 'mobile';
  onSize?: (size: 'desktop' | 'tablet' | 'mobile') => void; onTheme?: () => void; compact?: boolean; title?: string
}) {
  const document = component.preview.kind === 'builtin' ? buildPreviewDocument(component.preview.key, style, title) : null
  return <div className={compact ? styles.miniPreview : styles.previewPanel}>
    {!compact ? <div className={styles.previewToolbar}>
      <span><ShieldCheck size={13} /> Isolated preview</span>
      <div className={styles.segmented} aria-label="Preview width">{([{ id: 'desktop', Icon: Monitor }, { id: 'tablet', Icon: Tablet }, { id: 'mobile', Icon: Smartphone }] as const).map(({ id, Icon }) => <button key={id} type="button" aria-label={`${id} preview`} aria-pressed={size === id} onClick={() => onSize?.(id)}><Icon size={15} /></button>)}<button type="button" onClick={onTheme} aria-label={`Use ${style.theme === 'dark' ? 'light' : 'dark'} preview theme`}>{style.theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}</button></div>
    </div> : null}
    {document ? <div className={styles.previewStage} data-size={size}>
      <iframe title={`${component.name} ${compact ? 'thumbnail' : 'interactive preview'}`} srcDoc={document} sandbox="allow-scripts" referrerPolicy="no-referrer" loading={compact ? 'lazy' : 'eager'} tabIndex={compact ? -1 : 0} className={styles.previewFrame} />
    </div> : <div className={styles.previewUnavailable}><ShieldCheck size={24} /><strong>Source available. Preview isolated.</strong><p>{component.preview.reason || 'This component has no trusted demonstration. Downloaded React code is never executed inside AgentHub.'}</p></div>}
    {!compact ? <p className={styles.previewNote}>{document ? 'Original AgentHub demonstration in a sandbox with no network, app API, or file access. Styling here does not change your app.' : 'Inspect the source and dependencies before installation. No downloaded scripts have been executed.'}</p> : null}
  </div>
}
