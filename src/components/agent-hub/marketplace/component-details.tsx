'use client'

import { HubSelect, HubSelectItem } from '../hub-select'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpRight, Bot, Check, Code2, Download, FolderOpen, History, Loader2, PackageCheck, Palette, RotateCcw, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/agent-hub/code-block'
import { useHub } from '@/lib/agent-hub/store'
import { rememberCodingSession } from '@/lib/agent-hub/session/navigation'
import type { InstallProposal, Installation, MarketplaceComponent, StylingPreset } from '@/lib/agent-hub/marketplace/types'
import { marketplaceRequest, exportComponent, componentRegistryItem, type MarketplaceCatalog, type MarketplaceWorkspace } from './client'
import { ComponentPreview } from './component-preview'
import { DEFAULT_PREVIEW_STYLE } from './preview-document'
import styles from '../ui-components-view.module.css'

const tabs = ['preview', 'source', 'install', 'history'] as const
type Tab = typeof tabs[number]

function StyleControls({ value, onChange, catalog, onSave }: { value: StylingPreset; onChange: (value: StylingPreset) => void; catalog: MarketplaceCatalog; onSave: () => Promise<void> }) {
  const [name, setName] = useState('My component preset')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const patch = (change: Partial<StylingPreset>) => { onChange({ ...value, ...change }); setSaved(false) }
  return <details className={styles.styleControls}>
    <summary><Palette size={14} /><span>Customize this preview</span><small>Isolated styling</small></summary>
    <div className={styles.styleGrid}>
      <label className={styles.field}>Saved preset<HubSelect ariaLabel="Saved preview preset" value="" onValueChange={(nextValue) => { const preset = catalog.presets.find((entry) => entry.id === nextValue); if (preset) onChange(preset) }}><HubSelectItem value="">Choose a preset</HubSelectItem>{catalog.presets.map((preset) => <HubSelectItem key={preset.id} value={preset.id}>{preset.name}</HubSelectItem>)}</HubSelect></label>
      <label className={styles.field}>Typography<HubSelect ariaLabel="Typography" value={value.typography} onValueChange={(nextValue) => patch({ typography: nextValue as StylingPreset['typography'] })}><HubSelectItem value="sans">Sans serif</HubSelectItem><HubSelectItem value="mono">Monospace</HubSelectItem><HubSelectItem value="serif">Serif</HubSelectItem></HubSelect></label>
      <label className={styles.colorField}>Background<input type="color" value={value.background} onChange={(event) => patch({ background: event.target.value })} /></label><label className={styles.colorField}>Foreground<input type="color" value={value.foreground} onChange={(event) => patch({ foreground: event.target.value })} /></label><label className={styles.colorField}>Accent<input type="color" value={value.accent} onChange={(event) => patch({ accent: event.target.value })} /></label>
      <label className={styles.field}>Spacing<HubSelect ariaLabel="Spacing" value={value.spacing} onValueChange={(nextValue) => patch({ spacing: nextValue as StylingPreset['spacing'] })}><HubSelectItem value="compact">Compact</HubSelectItem><HubSelectItem value="comfortable">Comfortable</HubSelectItem></HubSelect></label>
      <label className={styles.field}>Corner radius · {value.radius}px<input type="range" min="0" max="20" value={value.radius} onChange={(event) => patch({ radius: Number(event.target.value) })} /></label><label className={styles.field}>Shadow intensity · {value.shadow}<input type="range" min="0" max="30" value={value.shadow} onChange={(event) => patch({ shadow: Number(event.target.value) })} /></label>
      <label className={styles.checkboxLabel}><input type="checkbox" checked={value.motion} onChange={(event) => patch({ motion: event.target.checked })} />Restrained transitions</label>
      <label className={styles.field}>Preset name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
      <Button type="button" variant="outline" size="sm" disabled={busy || !name.trim()} onClick={() => { setBusy(true); setError(''); void marketplaceRequest({ action: 'preset', preset: { ...value, id: `preset-${name.toLowerCase().replace(/[^a-z\d]+/g, '-').slice(0, 60)}`, name: name.trim() } }).then(onSave).then(() => setSaved(true)).catch((reason) => setError(reason.message)).finally(() => setBusy(false)) }}>{busy ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Palette size={14} />}{saved ? 'Preset saved' : 'Save preview preset'}</Button>
    </div>{error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </details>
}

export function ComponentDetails({ component, catalog, onClose, onRefresh }: { component: MarketplaceComponent; catalog: MarketplaceCatalog; onClose: () => void; onRefresh: () => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const setView = useHub((state) => state.setView)
  const [tab, setTab] = useState<Tab>('preview')
  const [size, setSize] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [style, setStyle] = useState(DEFAULT_PREVIEW_STYLE)
  const [demoTitle, setDemoTitle] = useState('')
  const [file, setFile] = useState(component.files[0]?.path ?? '')
  const [workspaceId, setWorkspaceId] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [folderOpen, setFolderOpen] = useState(false)
  const [proposal, setProposal] = useState<InstallProposal | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sourceEditor, setSourceEditor] = useState<string | null>(null)
  const [aiRequest, setAiRequest] = useState('Review this component for my project and propose an integration that preserves existing behavior.')
  const sourceFile = component.files.find((entry) => entry.path === file) ?? component.files[0]
  const workspaces = catalog.workspaces.filter((entry) => entry.id)
  const selectedWorkspace = workspaces.find((entry) => entry.id === workspaceId)
  const installations = useMemo(() => catalog.installations.filter((entry) => entry.componentId === component.id), [catalog, component.id])
  const lastInstalled = installations.find((entry) => entry.status === 'installed' && entry.workspaceId === workspaceId)
  useEffect(() => { dialogRef.current?.showModal() }, [])
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError(''); setNotice('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The component action failed.') } finally { setBusy('') }
  }
  const propose = (operation: InstallProposal['operation'], installation?: Installation) => void run('propose', async () => {
    const result = await marketplaceRequest<{ proposal: InstallProposal }>({ action: 'propose', id: component.id, workspaceId, operation, ...(installation ? { installationId: installation.id } : {}) })
    setProposal(result.proposal); setTab('install')
  })
  const pick = (action: 'pick' | 'select') => void run('folder', async () => {
    const response = await fetch('/api/agent-session/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'select' ? { path: folderPath.trim() } : {}) }) })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.error || 'The project folder could not be selected.')
    if (result.cancelled) return
    await onRefresh(); setWorkspaceId((result.workspace as MarketplaceWorkspace).id); setProposal(null); setFolderOpen(false); setFolderPath('')
  })
  const handoff = () => void run('agent', async () => {
    const response = await fetch('/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', workspace: '.', workspaceId, mode: 'ro' }) })
    const result = await response.json()
    if (!response.ok || !result.ok) throw new Error(result.error || 'The coding session could not be created.')
    const draft = `Use the UI Component Marketplace to help with this request: ${aiRequest.trim()}\n\nSelected component: ${component.name}\nComponent id: ${component.id}\nDescription: ${component.description}\nFramework: ${component.framework}\nRevision: ${component.revision}\nDependencies: ${[...component.dependencies, ...component.devDependencies].join(', ') || 'None declared'}\nFiles: ${component.files.map((entry) => entry.target).join(', ')}\n\nFirst inspect this marketplace component with the available tools. Check compatibility with the explicitly selected workspace after I grant access. Distinguish a proposal from an installation. Preserve event handlers and existing behavior. Show planned changes, request approval for installation, edits and commands, and verify actual results. Do not install or execute component source merely because it appears in a registry.`
    window.sessionStorage.setItem(`agenthub-session-draft:${result.conversation.id}`, draft)
    rememberCodingSession(result.conversation.id); onClose(); setView('sessions')
  })
  const switchTheme = () => setStyle((current) => current.theme === 'dark' ? { ...current, theme: 'light', background: '#f7f8fb', foreground: '#171921' } : { ...current, theme: 'dark', background: '#101115', foreground: '#f3f3f7' })
  return <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="component-detail-title" onCancel={onClose} onClose={onClose}>
    <header className={styles.dialogHeader}><div><span className={styles.eyebrow}>{component.category}</span><h2 id="component-detail-title">{component.name.replaceAll('-', ' ')}</h2><p>{component.description}</p></div><button type="button" onClick={onClose} aria-label="Close component details" className={styles.iconButton}><X size={19} /></button></header>
    <div className={styles.detailMetadata}><span>React</span><span>{component.source}</span><span>By {component.author || 'Unspecified author'}</span><span>{component.license || 'License not declared'}</span><code title={component.revision}>Revision {component.revision.slice(0, 12)}</code></div>
    <nav className={styles.tabs} aria-label="Component details">{tabs.map((id) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{id === 'preview' ? <Palette size={14} /> : id === 'source' ? <Code2 size={14} /> : id === 'install' ? <Download size={14} /> : <History size={14} />}{id === 'install' ? 'Install & integrate' : id}</button>)}<button type="button" className={styles.exportButton} onClick={() => exportComponent(component)}><ArrowDownToLine size={14} />Export JSON</button></nav>
    <div className={styles.detailBody}>
      {error ? <div role="alert" className={styles.error}>{error}</div> : null}{notice ? <div role="status" className={styles.success}>{notice}</div> : null}
      {tab === 'preview' ? <>
        <ComponentPreview component={component} style={style} size={size} onSize={setSize} onTheme={switchTheme} title={demoTitle} />
        {component.preview.kind === 'builtin' ? <><label className={styles.field}>Demo heading<input value={demoTitle} onChange={(event) => setDemoTitle(event.target.value.slice(0, 120))} placeholder="Use the original heading" maxLength={120} /></label><StyleControls value={style} onChange={setStyle} catalog={catalog} onSave={onRefresh} /></> : null}
        <section className={styles.section}><h3>Source and compatibility</h3><p className={styles.muted}>Declared framework: {component.framework}. Package and registry dependencies are inspected before installation. Browser preview does not establish compatibility with your project.</p><div className={styles.dependencyTags}>{[...component.dependencies, ...component.devDependencies].length ? [...component.dependencies, ...component.devDependencies].map((dependency) => <code key={dependency}>{dependency}</code>) : <span>No package dependencies declared</span>}</div>{component.registryDependencies.length ? <p className={styles.muted}>Registry dependencies: {component.registryDependencies.join(', ')}. They require separate review.</p> : null}</section>
      </> : null}
      {tab === 'source' ? <>
        <div className={styles.sourceToolbar}><label className={styles.field}>Source file<HubSelect ariaLabel="Component source file" value={file} onValueChange={(nextValue) => setFile(nextValue)}>{component.files.map((entry) => <HubSelectItem key={entry.path} value={entry.path}>{entry.path}</HubSelectItem>)}</HubSelect></label><Button variant="outline" size="sm" onClick={() => setSourceEditor(sourceEditor === null ? componentRegistryItem(component) : null)}>{sourceEditor === null ? 'Edit local copy' : 'Close editor'}</Button></div>
        {sourceEditor !== null ? <section className={styles.sourceEditor}><p className={styles.muted}>Saves a local registry item. It does not edit installed project files. Keep the same local component name to update its stored revision.</p><textarea aria-label="Edit local component registry JSON" value={sourceEditor} onChange={(event) => setSourceEditor(event.target.value)} spellCheck={false} rows={18} /><Button disabled={Boolean(busy)} size="sm" onClick={() => void run('source', async () => { await marketplaceRequest({ action: 'import', item: JSON.parse(sourceEditor) }); await onRefresh(); setNotice('Local source saved. Installed project files have not changed.'); setSourceEditor(null) })}>{busy === 'source' ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}Save local source</Button></section> : sourceFile ? <CodeBlock language={sourceFile.path.split('.').at(-1)} code={sourceFile.content} /> : <p className={styles.muted}>This registry item contains no files.</p>}
      </> : null}
      {tab === 'install' ? <>
        <section className={styles.workspaceBox}><div className={styles.sectionTitle}><FolderOpen size={17} /><div><h3>Choose the target project</h3><p>Select a registered folder explicitly. Browsing this library does not grant project access.</p></div></div><div className={styles.workspaceRow}><HubSelect ariaLabel="Component target workspace" value={workspaceId} onValueChange={(nextValue) => { setWorkspaceId(nextValue); setProposal(null) }}><HubSelectItem value="">No workspace selected</HubSelectItem>{workspaces.map((workspace) => <HubSelectItem key={workspace.id} value={workspace.id}>{workspace.projectName} — {workspace.root}</HubSelectItem>)}</HubSelect><Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => pick('pick')}>{busy === 'folder' ? <Loader2 className="animate-spin" size={14} /> : <FolderOpen size={14} />}Browse</Button><Button variant="ghost" size="sm" onClick={() => setFolderOpen((open) => !open)}>Paste path</Button></div>{selectedWorkspace ? <code className={styles.workspacePath}>{selectedWorkspace.root}</code> : null}{folderOpen ? <div className={styles.workspaceRow}><input aria-label="Absolute component project folder" value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="C:\\Projects\\my-app" /><Button variant="outline" size="sm" disabled={Boolean(busy) || !folderPath.trim()} onClick={() => pick('select')}>Select folder</Button></div> : null}</section>
        {!proposal ? <section className={styles.section}><h3>Review before anything changes</h3><p className={styles.muted}>Inspect exact paths, existing-file conflicts, dependencies and compatibility warnings. Every write needs your approval. No package manager or downloaded script runs automatically.</p><div className={styles.actionRow}><Button disabled={Boolean(busy) || !workspaceId} onClick={() => propose('install')}>{busy === 'propose' ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}{lastInstalled ? 'Review reinstall / update' : 'Review installation'}</Button>{lastInstalled ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => propose('uninstall', lastInstalled)}><Trash2 size={14} />Review uninstall</Button> : null}{component.registryUrl ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void run('fetch', async () => { await marketplaceRequest({ action: 'fetch', url: component.registryUrl, approved: true }); await onRefresh(); setNotice('Latest registry source fetched. Review the new revision before updating project files.') })}><RotateCcw size={14} />Fetch latest source</Button> : null}</div></section> : <section className={styles.proposal} aria-label="Proposed component changes"><div className={styles.sectionTitle}><ShieldAlert size={20} /><div><h3>Review {proposal.operation}</h3><p>{proposal.files.length} proposed file change{proposal.files.length === 1 ? '' : 's'} in {proposal.workspaceRoot}</p></div></div>{proposal.warnings.length ? <ul className={styles.warningList}>{proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}{proposal.dependencies.length ? <div className={styles.dependencyNotice}><strong>Dependencies require a separate approved command</strong><p>{proposal.dependencies.join(', ')}</p><p>Source installation does not run npm or package lifecycle scripts.</p></div> : null}<div className={styles.proposalFiles}>{proposal.files.map((change) => <details key={change.path}><summary><code>{change.path}</code><span>{change.conflict ? 'Existing file conflict' : change.after === null ? 'Remove / restore' : change.before === null ? 'New file' : 'Modify'}</span></summary><div className={styles.diffColumns}><div><h4>Before</h4>{change.before === null ? <p>File does not exist</p> : <CodeBlock code={change.before} language={change.path.split('.').at(-1)} />}</div><div><h4>After</h4>{change.after === null ? <p>File will be removed</p> : <CodeBlock code={change.after} language={change.path.split('.').at(-1)} />}</div></div></details>)}</div><div className={styles.actionRow}><Button disabled={Boolean(busy)} onClick={() => void run('apply', async () => { const result = await marketplaceRequest<{ installation: Installation; verification: string[] }>({ action: 'apply', proposalId: proposal.id, approved: true }); await onRefresh(); setProposal(null); setNotice(`${proposal.operation === 'install' ? 'Component files installed' : proposal.operation === 'uninstall' ? 'Component uninstalled' : 'Previous source restored'}. ${result.verification?.join(' ') || result.installation.verification.join(' ')}`) })}>{busy === 'apply' ? <Loader2 className="animate-spin" size={14} /> : <ShieldCheck size={14} />}Approve {proposal.operation} changes</Button><Button variant="outline" disabled={Boolean(busy)} onClick={() => setProposal(null)}>Cancel proposal</Button></div><small className={styles.muted}>This review expires at {new Date(proposal.expiresAt).toLocaleTimeString()}. Changed files or source require a fresh review.</small></section>}
        <section className={styles.assistantBox}><div className={styles.sectionTitle}><Bot size={19} /><div><h3>Integrate with your local agent</h3><p>Continue in Sessions using the shared model. The draft is prepared for your review; no task runs automatically.</p></div></div><label className={styles.field}>What should the agent help with?<textarea value={aiRequest} rows={3} onChange={(event) => setAiRequest(event.target.value)} /></label><Button variant="outline" disabled={Boolean(busy) || !workspaceId || !aiRequest.trim()} onClick={handoff}>{busy === 'agent' ? <Loader2 className="animate-spin" size={14} /> : <ArrowUpRight size={14} />}Continue in Sessions</Button></section>
      </> : null}
      {tab === 'history' ? <>{!installations.length ? <div className={styles.empty}><History size={25} /><h3>No installation history</h3><p>Reviewed changes and verification results appear here after an actual install.</p><Button variant="outline" size="sm" onClick={() => setTab('install')}>Review installation</Button></div> : <div className={styles.history}>{installations.map((installation) => <article key={installation.id}><div className={styles.historyTitle}><PackageCheck size={16} /><strong>{installation.operation} · {installation.status}</strong><time>{new Date(installation.createdAt).toLocaleString()}</time></div><code>{installation.workspaceRoot}</code><p>Revision {installation.revision.slice(0, 12)} · {installation.files.length} files</p><ul>{installation.verification.map((line, index) => <li key={index}>{line}</li>)}</ul><Button variant="outline" size="sm" disabled={Boolean(busy) || !workspaceId || installation.workspaceId !== workspaceId || installation.operation !== 'install'} onClick={() => propose('restore', installation)}><RotateCcw size={13} />Review pre-install restore</Button>{!workspaceId ? <p className={styles.muted}>Select this installation’s workspace under Install & integrate to review recovery.</p> : null}</article>)}</div>}</> : null}
    </div>
    <footer className={styles.dialogFooter}><ShieldCheck size={13} />Source is data. Preview, install and integration each have separate boundaries.</footer>
  </dialog>
}
