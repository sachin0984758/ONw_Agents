'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, LoaderCircle, Monitor, Smartphone, Tablet } from 'lucide-react'
import { marketplaceRequest } from './client'
import styles from '../ui-components-view.module.css'

export function GitHubComponentPreview({ templateRef, file, compact = false }: { templateRef: string; file: string; compact?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [visible, setVisible] = useState(!compact)
  const [preview, setPreview] = useState<{ document: string; notes: string[] }>()
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [width, setWidth] = useState(320)
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!host.current) return
    const resize = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    resize.observe(host.current)
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect() } }, { rootMargin: '200px' })
    observer.observe(host.current)
    return () => { observer.disconnect(); resize.disconnect() }
  }, [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    void marketplaceRequest<{ preview: { document: string; notes: string[] } }>({ action: 'github-component-preview', ref: templateRef, file }, controller.signal)
      .then((result) => setPreview(result.preview)).catch((reason) => { if (!controller.signal.aborted) setError(reason.message) })
    return () => controller.abort()
  }, [visible, templateRef, file, attempt])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'agenthub-preview') return
      if (typeof event.data.error === 'string') { setError(event.data.error.slice(0, 500)); setReady(false) }
      else if (event.data.ready === true) setReady(true)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  useEffect(() => {
    if (!visible || ready || error) return
    const timer = window.setTimeout(() => setError('The component did not finish rendering. Retry the preview or inspect its saved source.'), 30_000)
    return () => window.clearTimeout(timer)
  }, [visible, ready, error, attempt, preview])
  return <div ref={host} className={compact ? styles.downloadedMini : styles.previewPanel}>
    {!compact ? <div className={styles.previewToolbar}><span>Saved source · Browser preview</span><div className={styles.segmented} aria-label="Component preview width">{([{ id: 'desktop', Icon: Monitor }, { id: 'tablet', Icon: Tablet }, { id: 'mobile', Icon: Smartphone }] as const).map(({ id, Icon }) => <button key={id} type="button" aria-label={`${id} component preview`} aria-pressed={viewport === id} onClick={() => setViewport(id)}><Icon size={16} /></button>)}</div></div> : null}
    {error ? <div role="alert" className={styles.downloadedPreviewError}><AlertCircle size={22} /><strong>Preview could not render</strong><p>{error}</p><button type="button" onClick={() => { setError(''); setPreview(undefined); setReady(false); setAttempt((value) => value + 1) }}>Retry preview</button></div> : <>
      {!ready ? <div className={styles.previewLoading} role="status"><LoaderCircle size={18} /><span>{preview ? 'Rendering component…' : 'Preparing component preview…'}</span></div> : null}
      {preview ? <div className={styles.browserPreviewStage} data-viewport={viewport} style={compact ? undefined : { width: viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : '100%' }}><iframe ref={frame} title={`${file} ${compact ? 'thumbnail' : 'interactive component preview'}`} srcDoc={preview.document} sandbox="allow-scripts" referrerPolicy="no-referrer" tabIndex={compact ? -1 : 0} style={compact ? { width: 960, height: 650, transform: `scale(${width / 960})`, transformOrigin: 'top left' } : undefined} /></div> : null}
    </>}
    {!compact && preview ? <div className={styles.previewNote}>{preview.notes.map((note) => <p key={note}>{note}</p>)}</div> : null}
  </div>
}
