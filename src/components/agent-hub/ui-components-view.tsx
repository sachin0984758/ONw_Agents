'use client'

import { HubSelect, HubSelectItem } from './hub-select'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, Blocks, Check, ChevronRight, Clock3, Code2, FolderOpen, Globe2, Heart, Layers3, Loader2, PackageCheck, Plus, RefreshCw, Search, ShieldCheck, Upload, X } from 'lucide-react'
import type { MarketplaceComponent } from '@/lib/agent-hub/marketplace/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ComponentPreview } from './marketplace/component-preview'
import { DEFAULT_PREVIEW_STYLE } from './marketplace/preview-document'
import { marketplaceRequest, type MarketplaceCatalog } from './marketplace/client'
import { ComponentDetails } from './marketplace/component-details'
import { LocalComponents, localComponentCategory } from './marketplace/local-components'
import { GitHubTemplatesPanel, LocalTemplates } from './marketplace/github-templates-panel'
import styles from './ui-components-view.module.css'

type Collection = 'all' | 'favorites' | 'installed' | 'recent'
const collections: Array<{ id: Collection; label: string; Icon: typeof Blocks }> = [
  { id: 'all', label: 'My Local Library', Icon: Blocks }, { id: 'favorites', label: 'Favorites', Icon: Heart },
  { id: 'installed', label: 'Installed', Icon: PackageCheck }, { id: 'recent', label: 'Recently viewed', Icon: Clock3 },
]

function ImportPanel({ catalog, onClose, onRefresh }: { catalog: MarketplaceCatalog; onClose: () => void; onRefresh: () => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'local' | 'registry'>('local')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [registryUrl, setRegistryUrl] = useState('')
  const [registryName, setRegistryName] = useState('')
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { dialogRef.current?.showModal() }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await action(); await onRefresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Import failed.') } finally { setBusy(false) }
  }
  const readFolder = async (files: FileList | null) => {
    if (!files?.length) return
    setError('')
    try {
      const sources = Array.from(files).filter((file) => /\.(?:tsx?|jsx?|css)$/i.test(file.name) && !file.webkitRelativePath.split('/').some((part) => part.startsWith('.') || /^(?:node_modules|dist|build|coverage|vendor)$/i.test(part)) && !/(?:secret|credential|token|password|private[-_]key)/i.test(file.name))
      if (!sources.length) throw new Error('No supported TSX, TypeScript, JSX, JavaScript or CSS sources were found. Hidden and generated folders are excluded.')
      if (sources.length > 40 || sources.reduce((total, file) => total + file.size, 0) > 2_000_000 || sources.some((file) => file.size > 512_000)) throw new Error('Select a component folder with up to 40 source files, 512 KB per file and 2 MB total.')
      const name = (sources[0].webkitRelativePath.split('/')[0] || 'local-component').toLowerCase().replace(/[^a-z\d-]+/g, '-').slice(0, 60)
      const entries = await Promise.all(sources.map(async (file) => ({ path: file.webkitRelativePath.split('/').slice(1).join('/') || file.name, type: file.name.endsWith('.css') ? 'registry:style' : 'registry:component', content: await file.text() })))
      setText(JSON.stringify({ $schema: 'https://ui.shadcn.com/schema/registry-item.json', name, type: 'registry:ui', description: `Local component imported from ${name}. Review its source and declare required dependencies before installation.`, files: entries }, null, 2))
      setNotice(`${entries.length} source files loaded for review. Check the JSON and add package dependencies before importing.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The component folder could not be read.') }
  }
  return <dialog ref={dialogRef} className={cn(styles.dialog, styles.importDialog)} onCancel={onClose} onClose={onClose} aria-labelledby="component-import-title">
    <div className={styles.dialogHeader}><div><span className={styles.eyebrow}>EXPAND YOUR LIBRARY</span><h2 id="component-import-title">Add components</h2></div><button type="button" onClick={onClose} aria-label="Close import" className={styles.iconButton}><X size={18} /></button></div>
    <div className={styles.tabs} role="tablist" aria-label="Component import source"><button role="tab" aria-selected={tab === 'local'} onClick={() => setTab('local')}>Local registry JSON</button><button role="tab" aria-selected={tab === 'registry'} onClick={() => setTab('registry')}>Trusted registry</button></div>
    <div className={styles.importBody}>
      {tab === 'local' ? <><p className={styles.muted}>Import a shadcn registry item or select a component source folder. Components stay available offline. Importing saves source; it does not install or execute it.</p><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) { if (file.size > 2_000_000) { setError('Choose a registry JSON file smaller than 2 MB.'); return }; void file.text().then(setText).catch(() => setError('The file could not be read.')) } }} /><input ref={folderRef} type="file" hidden multiple {...{ webkitdirectory: '', directory: '' }} onChange={(event) => void readFolder(event.target.files)} /><div className={styles.actionRow}><Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload size={14} />Choose JSON file</Button><Button type="button" variant="outline" size="sm" onClick={() => folderRef.current?.click()}><FolderOpen size={14} />Choose source folder</Button></div><label className={styles.field}>Registry item JSON<textarea aria-label="Local component JSON" rows={14} value={text} onChange={(event) => setText(event.target.value)} placeholder={'{"name":"my-card","type":"registry:ui","files":[…]}'} spellCheck={false} /></label><Button disabled={busy || !text.trim()} onClick={() => void run(async () => { const item = JSON.parse(text); await marketplaceRequest({ action: 'import', item }); setNotice('Component source saved in the local library. Review it before installation.'); setText('') })}>{busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}Import source</Button></> : <>
        <p className={styles.muted}>Remote requests happen only after you approve a registry and fetch a specific item URL. Public shadcn registry JSON is supported.</p>
        <section className={styles.section}><h3>Trusted sources</h3>{catalog.registries.length ? <ul className={styles.registryList}>{catalog.registries.map((registry) => <li key={registry.id}><ShieldCheck size={14} /><div><strong>{registry.name}</strong><code>{registry.url}</code></div></li>)}</ul> : <p className={styles.muted}>No external registry has been trusted.</p>}
          <label className={styles.field}>Registry name<input value={registryName} onChange={(event) => setRegistryName(event.target.value)} placeholder="My component registry" /></label><label className={styles.field}>HTTPS registry base URL<input type="url" value={registryUrl} onChange={(event) => setRegistryUrl(event.target.value)} placeholder="https://ui.example.com/r/" /></label><label className={styles.checkboxLabel}><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />Allow fetching component source from this registry.</label><Button variant="outline" disabled={busy || !approved || !registryUrl || !registryName} onClick={() => void run(async () => { await marketplaceRequest({ action: 'trust-registry', url: registryUrl, name: registryName, approved: true }); setNotice('Registry saved. Source remains untrusted code and requires installation review.'); setRegistryUrl(''); setApproved(false) })}>Trust this source</Button>
        </section>
        <section className={styles.section}><h3>Fetch a component</h3><label className={styles.field}>Registry item JSON URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://ui.example.com/r/my-card.json" /></label><Button disabled={busy || !url} onClick={() => void run(async () => { await marketplaceRequest({ action: 'fetch', url, approved: true }); setNotice('Component fetched and saved locally. No source or commands were executed.'); setUrl('') })}>{busy ? <Loader2 className="animate-spin" size={14} /> : <ArrowDownToLine size={14} />}Fetch source</Button></section>
      </>}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}{notice ? <p role="status" className={styles.success}>{notice}</p> : null}
    </div>
  </dialog>
}

export function UIComponentsView() {
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [collection, setCollection] = useState<Collection>('all')
  const [category, setCategory] = useState('')
  const [source, setSource] = useState('all')
  const [sort, setSort] = useState('name')
  const [selectedId, setSelectedId] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [onlineOpen, setOnlineOpen] = useState(false)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await marketplaceRequest<MarketplaceCatalog>(undefined, signal)
    setCatalog(result)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => refresh(controller.signal)).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The component library is unavailable.') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh])
  const installedIds = useMemo(() => {
    const latest = new Map<string, MarketplaceCatalog['installations'][number]>()
    for (const entry of [...catalog?.installations ?? []].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) if (!latest.has(`${entry.componentId}:${entry.workspaceId}`)) latest.set(`${entry.componentId}:${entry.workspaceId}`, entry)
    return new Set([...latest.values()].filter((entry) => entry.status === 'installed').map((entry) => entry.componentId))
  }, [catalog])
  const filtered = useMemo(() => {
    if (!catalog) return []
    const search = query.trim().toLowerCase()
    return catalog.catalog.filter((component) => (!search || [component.name, component.description, component.category, ...component.tags].join(' ').toLowerCase().includes(search)) && (!category || component.category === category) && (source === 'all' || (source === 'local' ? !component.registryUrl : Boolean(component.registryUrl))) && (collection === 'all' || collection === 'favorites' && catalog.favorites.includes(component.id) || collection === 'installed' && installedIds.has(component.id) || collection === 'recent' && catalog.recent.includes(component.id))).sort((a, b) => sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : collection === 'recent' ? catalog.recent.indexOf(a.id) - catalog.recent.indexOf(b.id) : a.name.localeCompare(b.name))
  }, [catalog, query, category, source, collection, installedIds, sort])
  const localFiles = (catalog?.templates ?? []).flatMap((template) => template.components.map((file) => ({ template, file })))
  const localCount = collection === 'all' ? localFiles.filter(({ template, file }) => source !== 'registry' && (!category || localComponentCategory(file) === category) && [template.ref, file, template.framework, template.description].join(' ').toLowerCase().includes(query.trim().toLowerCase())).length : 0
  const totalComponents = (catalog?.catalog.length ?? 0) + localFiles.length
  const categoryCount = (name: string) => (catalog?.catalog.filter((component) => component.category === name).length ?? 0) + localFiles.filter(({ file }) => localComponentCategory(file) === name).length
  const selected = catalog?.catalog.find((component) => component.id === selectedId)
  const open = (component: MarketplaceComponent) => { setSelectedId(component.id); void marketplaceRequest({ action: 'recent', id: component.id }).then(() => refresh()).catch((reason) => setError(reason.message)) }
  const favorite = async (component: MarketplaceComponent) => {
    if (!catalog || busyId) return
    setBusyId(component.id); setError('')
    try { await marketplaceRequest({ action: 'favorite', id: component.id, value: !catalog.favorites.includes(component.id) }); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Favorite could not be saved.') } finally { setBusyId('') }
  }
  return <div className={styles.marketplace}>
    <header className={styles.pageHeader}><div className={styles.brand}><span className={styles.brandIcon}><Blocks size={22} /></span><div><div className={styles.eyebrow}>AGENTHUB / BUILD</div><h1>UI Components</h1></div></div><div className={styles.headerActions}><span className={styles.localBadge}><ShieldCheck size={13} />Local library</span><Button type="button" variant="outline" size="sm" onClick={() => { setError(''); setLoading(true); void refresh().catch((reason) => setError(reason.message)).finally(() => setLoading(false)) }} disabled={loading} aria-label="Refresh components"><RefreshCw className={loading ? 'animate-spin' : ''} size={14} /></Button><Button type="button" size="sm" onClick={() => setImportOpen(true)}><Plus size={15} />Add components</Button></div></header>
    <div className={styles.marketLayout}>
      <aside className={styles.sidebar} aria-label="Component collections and categories"><span className={styles.sectionLabel}>YOUR LIBRARY</span><div className={styles.collections}>{collections.map(({ id, label, Icon }) => <button key={id} aria-pressed={collection === id} onClick={() => setCollection(id)}><Icon size={15} /><span>{label}</span>{id === 'favorites' ? <small>{catalog?.favorites.length ?? 0}</small> : id === 'installed' ? <small>{installedIds.size}</small> : null}</button>)}</div><span className={styles.sectionLabel}>CATEGORIES</span><nav className={styles.categoryList} aria-label="Component categories"><button aria-pressed={!category} onClick={() => setCategory('')}>All components<span>{totalComponents}</span></button>{catalog?.categories.map((name) => <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}<span>{categoryCount(name)}</span></button>)}</nav><div className={styles.sidebarNote}><Code2 size={19} /><strong>Source first. Yours to build.</strong><p>Save code locally, review every change, and integrate with your own model.</p><button onClick={() => setImportOpen(true)}>Add your first source <ArrowRight size={13} /></button></div></aside>
      <section className={styles.discovery} aria-label="Component discovery"><div className={styles.intro}><span className={styles.eyebrow}>A TOOLKIT FOR YOUR NEXT IDEA</span><h2>Good interfaces start here.</h2><p>Discover reusable components. Inspect the source. Make them your own.</p><div className={styles.introMeta}><span><Layers3 size={13} />{totalComponents} saved components</span><span><Globe2 size={13} />{catalog?.registries.length ?? 0} trusted registries</span><span><Check size={13} />No cloud account required</span></div></div>
        <div className={styles.actionRow}><Button type="button" variant="outline" size="sm" aria-expanded={onlineOpen} onClick={() => setOnlineOpen(!onlineOpen)}><Globe2 size={14} />Browse Online</Button></div>
        {onlineOpen ? <GitHubTemplatesPanel onSaved={refresh} /> : <LocalTemplates templates={(catalog?.templates ?? []).filter((item) => collection === 'all' || collection === 'favorites' && catalog?.favorites.includes('github:' + item.ref))} query={query} workspaces={catalog?.workspaces} favorites={catalog?.favorites} onRefresh={refresh} />}
        <div className={styles.searchToolbar}><label className={styles.search}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search components, tags, and patterns…" aria-label="Search UI components" />{query ? <button onClick={() => setQuery('')} aria-label="Clear component search"><X size={14} /></button> : null}</label><HubSelect ariaLabel="Component source filter" value={source} onValueChange={(nextValue) => setSource(nextValue)}><HubSelectItem value="all">All sources</HubSelectItem><HubSelectItem value="local">Local and built-in</HubSelectItem><HubSelectItem value="registry">Remote registry</HubSelectItem></HubSelect><HubSelect ariaLabel="Sort components" value={sort} onValueChange={(nextValue) => setSort(nextValue)}><HubSelectItem value="name">Name A–Z</HubSelectItem><HubSelectItem value="updated">Recently updated</HubSelectItem></HubSelect></div>
        <div className={styles.resultHeading}><h3>{category || collections.find((item) => item.id === collection)?.label}</h3><span>{filtered.length + localCount} component{filtered.length + localCount === 1 ? '' : 's'}</span></div>
        {error ? <div role="alert" className={styles.error}>{error}</div> : null}
        {loading && !catalog ? <div className={styles.empty}><Loader2 className="animate-spin" size={25} /><h3>Opening your component library</h3><p>Reading local sources and installation history.</p></div> : !filtered.length && !localCount ? <div className={styles.empty}><Search size={28} /><h3>{query || category ? 'No matching components' : 'This collection is ready for your ideas'}</h3><p>{query || category ? 'Try another category or a shorter search.' : 'Import a registry item or save a component to this collection.'}</p><Button variant="outline" size="sm" onClick={() => { setQuery(''); setCategory(''); setCollection('all') }}>Explore all components</Button></div> : <div className={styles.grid}>{filtered.map((component) => <article key={component.id} className={styles.componentCard}>
          <button type="button" className={styles.cardPreviewButton} onClick={() => open(component)} aria-label={`Inspect ${component.name}`}><ComponentPreview component={component} style={DEFAULT_PREVIEW_STYLE} size="desktop" compact /><span className={styles.previewHint}>Inspect component <ArrowRight size={14} /></span></button>
          <div className={styles.cardBody}><div className={styles.cardTitleRow}><button onClick={() => open(component)}><h4>{component.name.replaceAll('-', ' ')}</h4></button><button type="button" className={styles.favoriteButton} aria-label={`${catalog?.favorites.includes(component.id) ? 'Remove' : 'Add'} ${component.name} ${catalog?.favorites.includes(component.id) ? 'from' : 'to'} favorites`} aria-pressed={catalog?.favorites.includes(component.id)} disabled={busyId === component.id} onClick={() => void favorite(component)}><Heart size={16} fill={catalog?.favorites.includes(component.id) ? 'currentColor' : 'none'} /></button></div><p>{component.description}</p><div className={styles.cardMeta}><span>{component.category}</span><span>{installedIds.has(component.id) ? <><PackageCheck size={12} />Installed</> : component.registryUrl ? 'Downloaded · Offline' : <><FolderOpen size={12} />Offline</>}</span></div><button className={styles.cardFooter} onClick={() => open(component)}><span>React <i />{component.files.length} source file{component.files.length === 1 ? '' : 's'}</span><ChevronRight size={14} /></button></div>
        </article>)}</div>}
        {!onlineOpen && collection === 'all' ? <LocalComponents templates={catalog?.templates ?? []} query={query} category={category} source={source} sort={sort} workspaces={catalog?.workspaces ?? []} onRefresh={refresh} /> : null}
        <p className={styles.libraryFooter}><ShieldCheck size={13} />Components preview in isolated browser frames. Installation always requires review.</p>
      </section>
    </div>
    {selected && catalog ? <ComponentDetails key={selected.id} component={selected} catalog={catalog} onClose={() => setSelectedId('')} onRefresh={refresh} /> : null}
    {importOpen && catalog ? <ImportPanel catalog={catalog} onClose={() => setImportOpen(false)} onRefresh={refresh} /> : null}
  </div>
}
