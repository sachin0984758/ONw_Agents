'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { HubSelect, HubSelectItem, HubSelectGroup, HubSelectLabel } from '../hub-select'
import type { GitHubTemplate } from '@/lib/agent-hub/marketplace/github-templates'
import type { reviewGitHubComponent } from '@/lib/agent-hub/marketplace/github-components'
import type { validateTemplateProject, templateBuildLog } from '@/lib/agent-hub/marketplace/github-runtime'
import { marketplaceRequest, type MarketplaceWorkspace } from './client'
import styles from '../ui-components-view.module.css'

interface Listing {
  ref: string; name: string; owner: string; url: string; description: string; framework: string
  license: string; warning: string; eligible: boolean; stars: number; size: number; preview?: string
}
interface Queue {
  paused: boolean; downloaded: number; sourceBytes: number; templates: GitHubTemplate[]
  jobs: { ref: string; status: 'queued' | 'saved' | 'failed' | 'cancelled'; error?: string }[]
}
interface Snapshot { id: string; results: Listing[]; synchronizedAt: string; pages: number; total: number; incomplete: boolean }

export function GitHubTemplatesPanel({ onSaved }: { onSaved: () => Promise<void> }) {
  const [source, setSource] = useState('react')
  const [query, setQuery] = useState('')
  const [framework, setFramework] = useState('')
  const [license, setLicense] = useState('')
  const [results, setResults] = useState<Listing[]>([])
  const [page, setPage] = useState(1)
  const [next, setNext] = useState(false)
  const [total, setTotal] = useState<number>()
  const [selected, setSelected] = useState<string[]>([])
  const [review, setReview] = useState<Listing[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [maxKb, setMaxKb] = useState(25000)
  const [queue, setQueue] = useState<Queue>()
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const processing = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    void marketplaceRequest<{ queue: Queue }>({ action: 'github-queue' }, controller.signal)
      .then((result) => setQueue(result.queue))
      .catch((reason) => { if (!controller.signal.aborted) setError(reason.message) })
    return () => { controller.abort(); processing.current = false }
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'GitHub request failed.') }
    finally { setBusy(false) }
  }
  async function search(number: number) {
    const result = await marketplaceRequest<{ results: Listing[]; next: boolean; total?: number }>({ action: 'github-search', source, query, page: number })
    setResults(result.results)
    setPage(number)
    setNext(result.next)
    setTotal(result.total)
    setSelected([])
    setReview([])
    setSnapshot(undefined)
  }
  async function reviewCatalog(saved: boolean) {
    const result = await marketplaceRequest<{ snapshot: Snapshot | null }>({ action: saved ? 'github-catalog' : 'github-catalog-sync', query, framework, license, maxKb })
    if (!result.snapshot) throw new Error('Synchronize the GitHub collection first.')
    setSnapshot(result.snapshot)
    setSource('topic')
    setFramework('')
    setLicense('')
    setResults(result.snapshot.results)
    setSelected([])
    setReview([])
    setNext(false)
    setPage(1)
    setTotal(result.snapshot.total)
  }
  async function update(operation: string, refs?: string[]) {
    const { queue: nextQueue } = await marketplaceRequest<{ queue: Queue }>({ action: 'github-queue-update', operation, refs, approved: operation === 'enqueue', snapshotId: operation === 'enqueue' ? snapshot?.id : undefined })
    setQueue(nextQueue)
    return nextQueue
  }
  async function processQueue(operation: 'enqueue' | 'resume' | 'retry', refs?: string[]) {
    processing.current = true
    setDownloading(true)
    try {
      let current = await update(operation, refs)
      while (processing.current && !current.paused && current.jobs.some((job) => job.status === 'queued')) current = await update('step')
      await onSaved()
    } finally { processing.current = false; setDownloading(false) }
  }
  const visible = results.filter((row) => (!framework || row.framework === framework) && (!license || row.license === license))
  const eligible = visible.filter((row) => row.eligible && !queue?.templates.some((template) => template.ref === row.ref))
  return <section className={styles.section} aria-label="GitHub templates">
    <h3>GitHub templates</h3>
    <form className={styles.actionRow} onSubmit={(event) => { event.preventDefault(); if (!busy) void run(() => search(1)) }}>
      <HubSelect ariaLabel="GitHub source" value={source} disabled={busy} onValueChange={(value) => { setSource(value); setResults([]); setPage(1); setNext(false); setTotal(undefined); setReview([]); setSelected([]); setFramework(''); setLicense(''); setSnapshot(undefined) }}>
        <HubSelectItem value="react">Open React Template</HubSelectItem><HubSelectItem value="tailwind">Tailwind Landing Page</HubSelectItem><HubSelectItem value="topic">GitHub Landing Page Collection</HubSelectItem>
      </HubSelect>
      <input aria-label="Search GitHub templates" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates" />
      <Button size="sm" disabled={busy}>Search GitHub</Button>
    </form>
    <div className={styles.actionRow}>
      <label>Max repository KB <input type="number" min={1} max={25000} value={maxKb} onChange={(event) => setMaxKb(Number(event.target.value))} /></label>
      <Button type="button" size="sm" disabled={busy} onClick={() => void run(() => reviewCatalog(false))}>Review and Download Eligible Templates</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => reviewCatalog(true))}>Open saved catalog</Button>
    </div>
    {snapshot ? <p>{snapshot.results.length} discovered · {snapshot.results.filter((row) => row.eligible).length} eligible · {snapshot.results.filter((row) => !row.eligible).length} excluded · {snapshot.pages} pages · Last sync {new Date(snapshot.synchronizedAt).toLocaleString()}{snapshot.incomplete ? ' · GitHub reported partial coverage' : ''}</p> : null}
    <div className={styles.actionRow}>
      <HubSelect ariaLabel="Filter GitHub framework" value={framework} onValueChange={setFramework}><HubSelectItem value="">All frameworks</HubSelectItem>{[...new Set(results.map((row) => row.framework))].map((value) => <HubSelectItem key={value} value={value}>{value}</HubSelectItem>)}</HubSelect>
      <HubSelect ariaLabel="Filter GitHub license" value={license} onValueChange={setLicense}><HubSelectItem value="">All licenses</HubSelectItem>{[...new Set(results.map((row) => row.license))].map((value) => <HubSelectItem key={value} value={value}>{value}</HubSelectItem>)}</HubSelect>
      {total !== undefined && !snapshot ? <span>{total} GitHub matches · Page {page}</span> : null}
      <Button size="sm" type="button" variant="outline" disabled={busy || page === 1} onClick={() => void run(() => search(page - 1))}>Previous</Button>
      <Button size="sm" type="button" variant="outline" disabled={busy || !next} onClick={() => void run(() => search(page + 1))}>Next</Button>
    </div>
    <div className={styles.grid}>{visible.map((row) => <article key={row.ref} className={styles.componentCard}>
      {row.preview ? <Image src={row.preview} alt="" unoptimized width={640} height={360} referrerPolicy="no-referrer" style={{ width: '100%', height: 'auto' }} /> : null}
      <div className={styles.cardBody}><h4>{row.name}</h4><p>{row.description}</p><p>{row.owner} · {row.framework} · {row.stars} stars · {row.license}</p><p>{row.warning}</p>
        <a href={row.url} target="_blank" rel="noreferrer">Repository and source</a>
        {queue?.templates.some((item) => item.ref === row.ref) ? <p>Downloaded · Offline</p> : row.eligible ? <>
          <label><input type="checkbox" checked={selected.includes(row.ref)} onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, row.ref] : previous.filter((ref) => ref !== row.ref))} /> Select</label>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setReview([row])}>Download</Button>
        </> : null}
      </div>
    </article>)}</div>
    <div className={styles.actionRow}>
      <Button type="button" size="sm" disabled={busy || !eligible.some((row) => selected.includes(row.ref))} onClick={() => setReview(eligible.filter((row) => selected.includes(row.ref)))}>Download selected</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || !eligible.length} onClick={() => setReview(eligible)}>{snapshot ? 'Download all eligible in catalog' : 'Download all eligible shown'}</Button>
      <Button type="button" size="sm" variant="outline" disabled={!downloading} onClick={() => { processing.current = false; setDownloading(false); void update('pause').catch((reason) => setError(reason.message)) }}>Pause after current</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || !queue?.jobs.some((job) => job.status === 'queued')} onClick={() => void run(() => processQueue('resume'))}>Resume</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || !queue?.jobs.some((job) => job.status === 'failed')} onClick={() => void run(() => processQueue('retry'))}>Retry failed</Button>
      <Button type="button" size="sm" variant="outline" disabled={!queue?.jobs.some((job) => job.status === 'queued')} onClick={() => { processing.current = false; setDownloading(false); void update('cancel').catch((reason) => setError(reason.message)) }}>Cancel pending</Button>
    </div>
    {review.length ? <div className={styles.section}><h4>Review {review.length} repositories · Estimated {review.reduce((sum, row) => sum + row.size, 0)} KB</h4>
      <ul>{review.map((row) => <li key={row.ref}>{row.ref} · {row.license} · {row.warning}</li>)}</ul>
      <Button type="button" size="sm" disabled={busy} onClick={() => { setReview([]); void run(() => processQueue('enqueue', review.map((row) => row.ref))) }}>Approve local downloads</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setReview([])}>Cancel</Button>
    </div> : null}
    {queue ? <p role="status">{queue.downloaded} templates saved · {(queue.sourceBytes / 1024).toFixed(1)} KB source · {queue.jobs.filter((job) => job.status === 'queued').length} queued · {queue.jobs.filter((job) => job.status === 'failed').length} failed</p> : null}
    {queue?.jobs.length ? <details><summary>Download history</summary><ul>{queue.jobs.map((job, index) => <li key={`${job.ref}:${index}`}>{job.ref} · {job.status}{job.error ? ` · ${job.error}` : ''}</li>)}</ul></details> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </section>
}

export function LocalTemplates({ templates, query, workspaces = [], favorites = [], onRefresh, initialRef = '', initialFile = '', componentOnly = false }: { templates: GitHubTemplate[]; query: string; workspaces?: MarketplaceWorkspace[]; favorites?: string[]; onRefresh: () => Promise<void>; initialRef?: string; initialFile?: string; componentOnly?: boolean }) {
  const [ref, setRef] = useState(initialRef)
  const [workspaceId, setWorkspaceId] = useState('')
  const [file, setFile] = useState(initialFile)
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')
  const [review, setReview] = useState(false)
  const [componentReview, setComponentReview] = useState<Awaited<ReturnType<typeof reviewGitHubComponent>>>()
  const [componentReceipt, setComponentReceipt] = useState('')
  const [confirmRollback, setConfirmRollback] = useState(false)
  const [validation, setValidation] = useState<Awaited<ReturnType<typeof validateTemplateProject>>>()
  const [buildLog, setBuildLog] = useState<Awaited<ReturnType<typeof templateBuildLog>> | null>()
  const [viewport, setViewport] = useState('desktop')
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!initialRef || !initialFile) return
    const controller = new AbortController()
    void marketplaceRequest<{ source: string }>({ action: 'github-source', ref: initialRef, file: initialFile }, controller.signal)
      .then((result) => setContent(result.source)).catch((reason) => { if (!controller.signal.aborted) setMessage(reason.message) })
    return () => controller.abort()
  }, [initialRef, initialFile])
  const chosen = templates.find((item) => item.ref === ref)
  const matching = templates.filter((item) => [item.ref, item.description, item.framework, ...item.components].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const report = (error: unknown) => setMessage(error instanceof Error ? error.message : 'Template operation failed.')
  if (!matching.length && !chosen) return null
  return <section className={styles.section} aria-label={componentOnly ? 'Component installation' : 'Saved GitHub templates'}>{!componentOnly ? <><h3>Saved templates</h3>
    <div className={styles.actionRow}>{matching.map((item) => <Button key={item.ref} type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setRef(item.ref); setContent(''); setFile(''); setReview(false); setComponentReview(undefined); setValidation(undefined); setBuildLog(undefined); setMessage(''); setPreviewUrl(''); void marketplaceRequest<{ preview: { url: string } | null }>({ action: 'github-preview-status', ref: item.ref }).then((result) => setPreviewUrl(result.preview?.url ?? '')).catch(report) }}>{item.name} · Offline</Button>)}</div></> : null}
    {chosen ? <div className={styles.section}>
      {!componentOnly ? <><h4>{chosen.name}</h4><p>{chosen.description}</p><p>{chosen.owner} · {chosen.framework} · {chosen.license} · {chosen.commit.slice(0, 12)}</p>
      <Button type="button" size="sm" variant="outline" aria-pressed={favorites.includes(`github:${ref}`)} onClick={() => void marketplaceRequest({ action: 'favorite', id: `github:${ref}`, value: !favorites.includes(`github:${ref}`) }).then(onRefresh).catch(report)}>{favorites.includes(`github:${ref}`) ? 'Remove favorite' : 'Add to favorites'}</Button>
      {chosen.files.some((name) => /(?:^|\/)(?:preview|screenshot)\.(?:png|jpe?g|webp)$/i.test(name)) ? <div>
        <label>Screenshot width <HubSelect ariaLabel="Screenshot width" value={viewport} onValueChange={setViewport}><HubSelectItem value="desktop">Desktop</HubSelectItem><HubSelectItem value="tablet">Tablet</HubSelectItem><HubSelectItem value="mobile">Mobile</HubSelectItem></HubSelect></label>
        <Image src={`/api/ui-components?templatePreview=${encodeURIComponent(ref)}`} alt={`${chosen.name} screenshot`} unoptimized width={960} height={540} style={{ width: viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : 960, maxWidth: '100%', height: 'auto' }} />
      </div> : <p>No repository screenshot is saved for this template.</p>}
      <p>{chosen.warning}</p><p>{chosen.files.length} files · {chosen.components.length} indexed component files. Interactive preview unavailable for untrusted repository source.</p>
      <details><summary>Dependencies</summary><pre>{JSON.stringify(chosen.dependencies, null, 2)}</pre></details>
      <div className={styles.actionRow}>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
          setBusy(true); setMessage('')
          void marketplaceRequest<{ validation: NonNullable<typeof validation> }>({ action: 'github-template-validate', ref }).then((result) => setValidation(result.validation)).catch(report).finally(() => setBusy(false))
        }}>Validate project</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
          void marketplaceRequest<{ build: NonNullable<typeof buildLog> | null }>({ action: 'github-template-build-log', ref }).then((result) => setBuildLog(result.build)).catch(report)
        }}>View build logs</Button>
        {validation ? <Button type="button" size="sm" disabled={busy || validation.blockers.length > 0} onClick={() => {
          setBusy(true); setMessage('')
          void marketplaceRequest<{ build: NonNullable<typeof buildLog> }>({ action: 'github-template-build', ref, commit: validation.commit, approved: true }).then((result) => setBuildLog(result.build)).catch(report).finally(() => setBusy(false))
        }}>Approve isolated build</Button> : null}
      </div>
      <div className={styles.actionRow}>
        <label>Preview viewport <HubSelect ariaLabel="Preview viewport" value={viewport} onValueChange={setViewport}><HubSelectItem value="desktop">Desktop</HubSelectItem><HubSelectItem value="tablet">Tablet</HubSelectItem><HubSelectItem value="mobile">Mobile</HubSelectItem></HubSelect></label>
        <Button type="button" size="sm" disabled={busy || !validation || validation.blockers.length > 0} onClick={() => {
          setBusy(true); setMessage(''); setPreviewUrl('')
          void marketplaceRequest<{ build: NonNullable<typeof buildLog> & { previewUrl?: string } }>({ action: 'github-preview-start', ref, commit: chosen.commit, approved: true })
            .then(({ build }) => { setBuildLog(build); setPreviewUrl(build.previewUrl ?? '') }).catch(report).finally(() => setBusy(false))
        }}>Approve build and run preview</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || !previewUrl} onClick={() => {
          void marketplaceRequest({ action: 'github-preview-stop', ref }).then(() => setPreviewUrl('')).catch(report)
        }}>Stop preview</Button>
      </div>
      {previewUrl ? <iframe title={`${chosen.name} isolated preview`} src={previewUrl} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" style={{ width: viewport === 'mobile' ? 390 : viewport === 'tablet' ? 768 : 1280, maxWidth: '100%', height: 720, resize: 'both', overflow: 'auto', border: '1px solid #444' }} /> : null}
      {validation ? <div><p>{validation.framework} · {Object.keys(validation.dependencies).length} declared packages</p>
        {validation.externalFont ? <p>This template requests Google fonts at build time. An offline build may need local font files.</p> : null}
        {validation.blockers.map((blocker) => <p key={blocker} className={styles.error}>{blocker}</p>)}
      </div> : null}
      {buildLog === null ? <p>No build has been recorded.</p> : buildLog ? <div><p>Build {buildLog.status} · {buildLog.commit.slice(0, 12)}</p><pre style={{ maxHeight: 320, overflow: 'auto' }}>{buildLog.output}</pre></div> : null}</> : <><h3>Install this component</h3><p className={styles.muted}>Choose a project to review the component, its imports, assets, and dependencies before approving changes.</p><p className={styles.muted}>{file}</p><p className={styles.muted}>{chosen.warning}</p></>}
      {!componentOnly ? <><HubSelect ariaLabel="Inspect saved source" value={file} onValueChange={(selectedFile) => {
        setFile(selectedFile); setContent(''); setComponentReview(undefined)
        if (selectedFile) void marketplaceRequest<{ source: string }>({ action: 'github-source', ref, file: selectedFile }).then((result) => setContent(result.source)).catch(report)
      }}>
        <HubSelectItem value="">Inspect source or README</HubSelectItem>
        <HubSelectGroup><HubSelectLabel>Indexed components</HubSelectLabel>{chosen.components.map((name) => <HubSelectItem key={name} value={name}>{name}</HubSelectItem>)}</HubSelectGroup>
        <HubSelectGroup><HubSelectLabel>Other text files</HubSelectLabel>{chosen.files.filter((name) => !chosen.components.includes(name) && /\.(?:tsx?|jsx?|mjs|cjs|css|html|json|md|txt)$/i.test(name)).map((name) => <HubSelectItem key={name} value={name}>{name}</HubSelectItem>)}</HubSelectGroup>
      </HubSelect>
      {content ? <pre style={{ maxHeight: 320, overflow: 'auto' }}>{content}</pre> : null}</> : null}
      <div className={styles.actionRow}><HubSelect ariaLabel="Template installation workspace" disabled={busy} value={workspaceId} onValueChange={(value) => { setWorkspaceId(value); setReview(false); setComponentReview(undefined) }}><HubSelectItem value="">Choose a registered workspace</HubSelectItem>{workspaces.map((entry) => <HubSelectItem key={entry.id} value={entry.id}>{entry.projectName}</HubSelectItem>)}</HubSelect>
      {!componentOnly ? <Button type="button" size="sm" disabled={!workspaceId || busy} onClick={() => setReview(true)}>Review template installation</Button> : null}
      {chosen.components.includes(file) ? <Button type="button" size="sm" disabled={!workspaceId || busy} onClick={() => {
        setBusy(true); setComponentReview(undefined); setMessage('')
        void marketplaceRequest<{ review: Awaited<ReturnType<typeof reviewGitHubComponent>> }>({ action: 'github-component-review', ref, file, workspaceId })
          .then((result) => setComponentReview(result.review)).catch(report).finally(() => setBusy(false))
      }}>Install Component</Button> : null}</div>
      {componentReview ? <div className={styles.section}>
        <h4>Review component files</h4><p>{componentReview.entry} · {componentReview.license} · {componentReview.attribution}</p>
        <p>Destination: {componentReview.root}</p>
        <ul>{componentReview.changes.map((change) => <li key={change.file}>{change.status} · {change.file} · {change.bytes} bytes</li>)}</ul>
        <p>Required packages: {Object.entries(componentReview.dependencies).map(([name, version]) => `${name} ${version}`).join(', ')}</p>
        {componentReview.styles.length ? <p>Style entry points: {componentReview.styles.join(', ')}. Import the applicable stylesheet from your project layout.</p> : null}
        {componentReview.blockers.map((blocker) => <p key={blocker} className={styles.error}>{blocker}</p>)}
        {componentReview.blockers.length || componentReview.changes.some((change) => change.status === 'conflict') ? <p>Resolve these issues or use the complete template.</p> : null}
        <Button type="button" size="sm" disabled={busy || componentReview.blockers.length > 0 || componentReview.changes.some((change) => change.status === 'conflict')} onClick={() => {
          setBusy(true)
          void marketplaceRequest<{ installation: { id: string; created: number; verified: number } }>({ action: 'github-component-install', ref, file, workspaceId, review: componentReview.review, approved: true })
            .then(({ installation }) => { setMessage(`Created ${installation.created} files and verified ${installation.verified} source and asset files.`); setComponentReview(undefined); setComponentReceipt(installation.id); setConfirmRollback(false) }).catch(report).finally(() => setBusy(false))
        }}>Approve component installation</Button>
      </div> : null}
      {componentReceipt ? <div className={styles.actionRow}>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRollback(!confirmRollback)}>Roll back last component install</Button>
        {confirmRollback ? <Button type="button" size="sm" disabled={busy} onClick={() => {
          setBusy(true)
          void marketplaceRequest<{ removed: number }>({ action: 'github-component-rollback', id: componentReceipt, approved: true })
            .then(({ removed }) => { setMessage(`Removed ${removed} unchanged files created by the installation.`); setComponentReceipt(''); setConfirmRollback(false) }).catch(report).finally(() => setBusy(false))
        }}>Approve rollback</Button> : null}
      </div> : null}
      {review ? <div><p>Copy all {chosen.files.length} files into a new folder inside {workspaces.find((entry) => entry.id === workspaceId)?.root}. Follow the saved README for setup.</p><Button type="button" size="sm" disabled={busy} onClick={() => {
        setBusy(true)
        void marketplaceRequest<{ installation: { folder: string; files: number } }>({ action: 'github-install', ref, workspaceId, commit: chosen.commit, approved: true })
          .then(({ installation }) => { setMessage(`Installed ${installation.files} files in ${installation.folder}.`); setReview(false) }).catch(report).finally(() => setBusy(false))
      }}>Approve installation</Button></div> : null}
      {message ? <p role="status">{message}</p> : null}
    </div> : null}
  </section>
}
