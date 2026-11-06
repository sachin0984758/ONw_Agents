'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowUp, CheckCircle2, ChevronDown, Circle, Folder, Globe, History, Link2, Loader2, Maximize2, Monitor, MousePointer2, Pause, Play, Plus, RefreshCw, Settings2, ShieldCheck, Square, Terminal, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HubSelect, HubSelectItem } from './hub-select'
import { AssistantAnswer } from './session-chat-view'
import { cn } from '@/lib/utils'

const captureTimestamp = () => Date.now()
import { useModelPreference } from '@/lib/agent-hub/use-model-preference'
import { inputPermissionRequired, OBSERVE_ONLY_NOTICE } from '@/lib/agent-hub/computer/access'
import { selectComputerModel, type ComputerModel } from '@/lib/agent-hub/computer/model-selection'
import { COMPUTER_READS, COMPUTER_TOOLS, nativeToolName, type AutoTask, type ComputerScope } from '@/lib/agent-hub/computer/protocol'
import styles from './auto-computer-view.module.css'
import conversationStyles from './conversation-profile.module.css'
import { AUTO_DELETION_EVENT, AUTO_SELECTION_EVENT, readAutoSelection, rememberAutoTask } from '@/lib/agent-hub/computer/navigation'
import { autoResultText } from '@/lib/agent-hub/computer/presentation'
import { previewPoint } from '@/lib/agent-hub/computer/preview-point'

interface Snapshot {
  preferences?: { workspaceId?: string }
  computer: { connected?: boolean; enabled?: boolean; paused?: boolean; readonly?: boolean; computer?: string; error?: string; requiresLocalRestart?: boolean }
  scope?: ComputerScope | null
  tasks: AutoTask[]
  activeId?: string | null
  models?: ComputerModel[]
  workspaces?: Array<{ id: string; root: string; projectName: string }>
  historyWarning?: string | null
}
const initial: Snapshot = { computer: {}, tasks: [] }
const suggestions = [
  ['Inspect my workspace', 'List the files in the selected workspace and summarize the project. Do not change anything.'],
  ['Read an open app', 'Inspect the permitted open applications and summarize what you can verify. Do not send input.'],
  ['Write in Notepad', 'Open a new empty Notepad tab and type a short welcome message. Verify the actual text.'],
]
const phaseLabel = (phase?: string) => ({ planned: 'Proposed plan', planning: 'Planning next action', observing: 'Observing', validating: 'Checking target', acting: 'Taking action', verifying: 'Verifying result', waiting: 'Waiting for approval', recovery: 'Recovering', completed: 'Completed', partial: 'Partially completed', cancelled: 'Stopped', failed: 'Needs attention', paused: 'Paused' })[phase || ''] || 'Ready'

const emptyScope = (): ComputerScope => ({ applications: [], domains: [], readonly: true, workspaceAccess: 'none', internet: false })

export function AutoComputerView({ conversationLayout }: { conversationLayout: 'unified' | 'separate' }) {
  const globalModel = useModelPreference()
  const model = globalModel.preference.model
  const [data, setData] = useState<Snapshot>(initial)
  const [polledAt, setPolledAt] = useState(0)
  const [models, setModels] = useState<ComputerModel[]>([])
  const [workspaces, setWorkspaces] = useState<NonNullable<Snapshot['workspaces']>>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [newSession, setNewSession] = useState(true)
  const [request, setRequest] = useState('')
  const [visionModel, setVisionModel] = useState('auto')
  const [profile, setProfile] = useState<'fast' | 'balanced' | 'careful'>('balanced')
  const [scope, setScope] = useState<ComputerScope>(emptyScope)
  const [domainText, setDomainText] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [consent, setConsent] = useState(false)
  const [saveSummary, setSaveSummary] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [permissionHelp, setPermissionHelp] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mobilePane, setMobilePane] = useState<'task' | 'computer'>('task')
  const [toolName, setToolName] = useState('desktop.get_windows')
  const [toolArgs, setToolArgs] = useState('{}')
  const [toolConfirmed, setToolConfirmed] = useState(false)
  const [toolResult, setToolResult] = useState<Record<string, unknown> | null>(null)
  const [preview, setPreview] = useState('')
  const [appWindow, setAppWindow] = useState<{ handle: number; bounds: number[]; title?: string } | null>(null)
  const [previewStatus, setPreviewStatus] = useState('')
  const [previewUpdatedAt, setPreviewUpdatedAt] = useState(0)
  const [appText, setAppText] = useState('')
  const appBusy = useRef(false)
  const screenRef = useRef<HTMLDivElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const followFeed = useRef(true)
  const mounted = useRef(false)
  useEffect(() => {
    let cancelled = false
    const selectTask = () => {
      const id = readAutoSelection()
      if (!id || cancelled) return
      setSelected(id); setNewSession(false); setHistoryOpen(false)
      setMobilePane('task'); setSettingsOpen(false); followFeed.current = true
    }
    const onSelection = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      if (!id) return
      setSelected(id); setNewSession(false); setHistoryOpen(false)
      setMobilePane('task'); setSettingsOpen(false); followFeed.current = true
    }
    void Promise.resolve().then(selectTask)
    window.addEventListener(AUTO_SELECTION_EVENT, onSelection)
    return () => { cancelled = true; window.removeEventListener(AUTO_SELECTION_EVENT, onSelection) }
  }, [])
  useEffect(() => {
    const onDeleted = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail
      if (typeof id !== 'string') return
      setData((current) => ({ ...current, tasks: current.tasks.filter((entry) => entry.id !== id) }))
      if (selected === id) {
        rememberAutoTask(''); setSelected(null); setNewSession(true); setRequest('')
        setPreview(''); setAppWindow(null); setToolResult(null)
      }
    }
    window.addEventListener(AUTO_DELETION_EVENT, onDeleted)
    return () => window.removeEventListener(AUTO_DELETION_EVENT, onDeleted)
  }, [selected])
  const refresh = useCallback(async (includeModels = false) => {
    const response = await fetch(`/api/computer${includeModels ? '?models=true' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    const value = await response.json() as Snapshot & { ok: boolean; error?: string }
    if (!response.ok || !value.ok) throw new Error(value.error || 'Could not reach Auto.')
    if (!mounted.current) return value
    setData(value); setPolledAt(Date.now())
    if (value.activeId) { setNewSession(false); setSelected((previous) => previous ?? value.activeId ?? null) }
    if (value.computer.enabled && value.scope) { setScope(value.scope); setDomainText(value.scope.domains.join(', ')) }
    if (value.models) setModels(value.models)
    if (value.workspaces) setWorkspaces(value.workspaces)
    return value
  }, [])
  useEffect(() => {
    mounted.current = true
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let polls = 0
    const poll = async () => {
      try { await refresh(polls++ % 5 === 0); if (!cancelled) setError((previous) => previous === 'Auto connection lost. Retrying…' ? '' : previous) }
      catch { if (!cancelled) setError('Auto connection lost. Retrying…') }
      if (!cancelled) timer = setTimeout(poll, document.visibilityState === 'hidden' ? 15000 : 1000)
    }
    void poll()
    const focused = () => { void refresh(true).catch(() => {}) }
    window.addEventListener('focus', focused)
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer); window.removeEventListener('focus', focused) }
  }, [refresh])
  const act = async (body: Record<string, unknown>) => {
    setPending(true); setError('')
    try {
      const response = await fetch('/api/computer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const value = await response.json()
      if (!response.ok || !value.ok) throw new Error(value.error || 'Auto request failed.')
      await refresh()
      return value
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Auto request failed.'); return null }
    finally { setPending(false) }
  }
  const chooseFolder = async (action: 'pick' | 'select') => {
    setPending(true); setError('')
    try {
      const response = await fetch('/api/agent-session/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'select' ? { path: folderPath.trim() } : {}) }) })
      const value = await response.json()
      if (!response.ok || !value.ok) throw new Error(value.error || 'Could not select that folder.')
      if (!value.cancelled) { setScope((current) => ({ ...current, workspaceId: value.workspace.id, workspaceAccess: 'read' })); setWorkspaces((entries) => [...entries.filter((entry) => entry.id !== value.workspace.id), value.workspace]); setFolderPath('') }
    } catch (error) { setError((error as Error).message) }
    finally { setPending(false) }
  }
  const active = !!data.activeId
  const refreshApp = async (handle: number) => {
    const captured = await act({ action: 'tool', name: 'desktop.capture_screen', args: { handle } })
    if (captured?.result?.image) {
      const window = captured.result.window as { bounds: number[]; title?: string }
      setPreview(captured.result.image); setAppWindow({ handle, bounds: window.bounds, title: window.title }); setPreviewStatus('Live mirror'); setPreviewUpdatedAt(captureTimestamp())
    }
  }
  const appHandle = appWindow?.handle
  const previewAvailable = Boolean(preview)
  useEffect(() => {
    if (!appHandle || !previewAvailable || !data.computer.enabled || data.scope?.screenshots === false || active || settingsOpen) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const capture = async () => {
      if (stopped) return
      if (!pending && !appBusy.current && document.visibilityState !== 'hidden') {
        appBusy.current = true
        try {
          const response = await fetch('/api/computer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tool', name: 'desktop.capture_screen', args: { handle: appHandle } }), cache: 'no-store', signal: AbortSignal.timeout(8000) })
          const value = await response.json()
          if (!response.ok || !value.ok) throw new Error(value.error || 'Preview capture failed.')
          const captured = value.result as { image?: string; window?: { bounds?: number[]; title?: string } }
          if (captured.image && captured.window?.bounds) {
            setPreview(captured.image); setAppWindow((current) => current?.handle === appHandle ? { ...current, bounds: captured.window!.bounds!, title: captured.window!.title } : current)
            setPreviewStatus('Live mirror'); setPreviewUpdatedAt(captureTimestamp())
          }
        } catch (reason) {
          if (!stopped) setPreviewStatus(reason instanceof Error && /minimized|restore/i.test(reason.message) ? 'Restore the app to resume its preview' : 'Preview paused · bring the app forward to resume')
        } finally {
          appBusy.current = false
        }
      }
      if (!stopped) timer = setTimeout(capture, 1500)
    }
    timer = setTimeout(capture, 1500)
    return () => { stopped = true; clearTimeout(timer) }
  }, [appHandle, previewAvailable, data.computer.enabled, data.scope?.screenshots, active, settingsOpen, pending])
  const interactApp = async (kind: 'click' | 'type_text' | 'press_key', point?: { x: number; y: number }, key?: string) => {
    if (!appWindow || active || pending || appBusy.current) return
    if (!data.computer.enabled || data.scope?.readonly) { reviewPermissions(); return }
    appBusy.current = true
    try {
      const focused = await act({ action: 'tool', name: 'desktop.focus_window', args: { handle: appWindow.handle }, confirmed: true })
      const observed = focused?.result?.observation
      if (!observed) return
      if (point && JSON.stringify(observed.window.bounds) !== JSON.stringify(appWindow.bounds)) { setError('The app moved. Preview refreshed; click the target again.'); await refreshApp(appWindow.handle); return }
      const controls = observed.elements as Array<{ id: string; control_type: string; focused: boolean; bounds: number[] }>
      const hit = point ? controls.filter((entry) => point.x >= entry.bounds[0] && point.x < entry.bounds[2] && point.y >= entry.bounds[1] && point.y < entry.bounds[3]).sort((a, b) => (a.bounds[2] - a.bounds[0]) * (a.bounds[3] - a.bounds[1]) - (b.bounds[2] - b.bounds[0]) * (b.bounds[3] - b.bounds[1]))[0] : undefined
      const editor = controls.filter((entry) => ['Document', 'Edit'].includes(entry.control_type) && entry.focused)
      if (kind === 'type_text' && editor.length !== 1) { setError('Click an editable area in the app before sending text.'); return }
      const args = { snapshot_id: observed.snapshot_id, ...(point ?? {}), ...(hit ? { element_id: hit.id } : {}), ...(kind === 'type_text' ? { element_id: editor[0].id, text: appText } : {}), ...(key ? { key } : {}) }
      const result = await act({ action: 'tool', name: `desktop.${kind}`, args, confirmed: true })
      if (result && kind === 'type_text') setAppText('')
      await refreshApp(appWindow.handle)
    } finally { appBusy.current = false }
  }
  const running = data.tasks.find((item) => item.id === data.activeId)
  const task = newSession && !active ? undefined : data.tasks.find((item) => item.id === selected) ?? running ?? data.tasks[0]
  const selectedModel = selectComputerModel(models, model)
  const latest = task?.events.at(-1)
  const pendingModelMs = task && task.id === data.activeId && task.phase === 'planning' && latest?.action === 'model' ? Math.max(0, polledAt - Date.parse(latest.startedAt)) : 0
  const displayedModelMs = (task?.modelMs ?? 0) + pendingModelMs
  const screenshot = preview || task?.screenshot || ''
  const toolMutation = !COMPUTER_READS.has(toolName)
  useEffect(() => {
    const feed = feedRef.current
    if (feed && followFeed.current) feed.scrollTop = task ? feed.scrollHeight : 0
  }, [task])
  const reviewPermissions = () => {
    setSettingsOpen(true); setMobilePane('computer')
    if (!request.trim() && task?.permissionRequired) setRequest(task.request)
  }
  const newTask = async () => { const value = await act({ action: 'reset' }); if (!value) return; rememberAutoTask(''); setScope(emptyScope()); setDomainText(''); setConsent(false); setSettingsOpen(false); setSelected(null); setNewSession(true); setRequest(''); setToolResult(null); setPreview(''); setAppWindow(null); setHistoryOpen(false); setMobilePane('task'); followFeed.current = true }
  const deleteAutoTask = async (id: string) => {
    const value = await act({ action: 'delete', id })
    if (!value) return
    window.dispatchEvent(new CustomEvent(AUTO_DELETION_EVENT, { detail: id }))
  }
  const run = async () => {
    if (!selectedModel) { setError('No available chat model. Start the LM Studio server, then refresh models.'); return }
    if (!globalModel.ready || globalModel.saving) { setError('Wait for the shared model setting to load.'); return }
    const needsInput = data.computer.enabled && inputPermissionRequired(request, data.scope?.readonly !== false)
    if (needsInput) { setPermissionHelp(needsInput); reviewPermissions(); return }
    setPermissionHelp('')
    setPreview(''); setAppWindow(null)
    const value = await act({ action: data.computer.enabled ? 'start' : 'plan', input: { request, model, visionModel, profile, saveSummary } })
    if (value?.task) { rememberAutoTask(value.task.id); setSelected(value.task.id); setNewSession(false); setSettingsOpen(false); setRequest(''); followFeed.current = true }
  }
  return <div className={cn(styles.root, conversationLayout === 'unified' && conversationStyles.unified)} data-chat-surface="workspace" data-testid="auto-workspace">
    <div className={styles.canvas} data-chat-surface="canvas">
    <header className={styles.header} data-chat-surface="header">
      <div className={styles.brand}><span className={styles.brandIcon}><MousePointer2 size={19} /></span><div><h1>Auto</h1><p>Your local computer agent</p></div></div>
      <div className={styles.headerActions}>
        <span className={styles.connection}><i className={data.computer.connected ? styles.online : ''} />{data.computer.connected ? data.computer.computer || 'Connected' : 'Disconnected'}</span>
        <Button size="sm" variant="outline" disabled={pending || active || data.computer.requiresLocalRestart} onClick={() => void act({ action: data.computer.connected ? 'disconnect' : 'connect' })}><Link2 size={14} />{data.computer.connected ? 'Disconnect' : 'Connect computer'}</Button>
        <Button size="sm" variant={settingsOpen ? 'secondary' : 'ghost'} aria-label="Auto settings" aria-expanded={settingsOpen} onClick={() => { setSettingsOpen(!settingsOpen); setMobilePane('computer') }}><Settings2 size={16} /><span className={styles.optional}>Settings</span></Button>
        <Button size="sm" variant="outline" className="text-destructive" aria-label="Emergency Stop" onClick={() => void act({ action: 'stop' })}><Square size={13} /><span className={styles.optional}>Stop all</span></Button>
      </div>
    </header>
    {error || globalModel.error || data.computer.error ? <div role="alert" className={styles.error}><AlertTriangle size={15} /><span>{error || globalModel.error || data.computer.error}</span><button aria-label="Dismiss Auto error" onClick={() => setError('')}><X size={15} /></button></div> : null}
    {data.historyWarning ? <div role="status" className={styles.error}><AlertTriangle size={15} /><span>{data.historyWarning}</span></div> : null}
    <div className={styles.mobileTabs} role="group" aria-label="Auto workspace pane"><button aria-pressed={mobilePane === 'task'} onClick={() => setMobilePane('task')}>Task</button><button aria-pressed={mobilePane === 'computer'} onClick={() => setMobilePane('computer')}>Computer{settingsOpen ? ' · Settings' : ''}</button></div>
    <div className={styles.workspace} data-chat-surface="content">
      <div className={styles.dock} aria-label="Auto workspace tools"><button aria-label="Workspace permissions" onClick={reviewPermissions}><Folder size={22} /></button><button aria-label="Computer preview" onClick={() => { setSettingsOpen(false); setMobilePane(mobilePane === 'computer' ? 'task' : 'computer') }}><Globe size={22} /></button><button aria-label="New Auto worker" disabled={active || pending} onClick={() => void newTask()}><Plus size={23} /></button></div>
      <section className={cn(styles.taskPane, mobilePane !== 'task' && styles.mobileHidden)} aria-label="Auto task conversation">
        <div className={styles.paneHeader}><button className={styles.iconButton} aria-label="Auto session history" aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}><History size={16} /></button><span className={styles.truncate}>{task?.title || 'New task'}</span><button className={styles.iconButton} disabled={active} aria-label="New Auto session" onClick={() => void newTask()}><Plus size={17} /></button></div>
        {historyOpen ? <aside className={styles.history} aria-label="Auto sessions"><div className={styles.sectionHeading}>Recent tasks<button className={styles.iconButton} aria-label="Close session history" onClick={() => setHistoryOpen(false)}><X size={15} /></button></div>{data.tasks.length ? data.tasks.map((entry) => <div key={entry.id} className={styles.historyRow}><button className={styles.historyOpen} aria-current={task?.id === entry.id ? 'true' : undefined} onClick={() => rememberAutoTask(entry.id)}><strong>{entry.title}</strong><span>{phaseLabel(entry.phase)} · {entry.modelCalls} calls</span></button><button className={styles.historyDelete} disabled={entry.id === data.activeId} aria-label={`Delete Auto task ${entry.title}`} title={entry.id === data.activeId ? 'Stop the active task before deleting it' : 'Delete Auto task'} onClick={() => { if (window.confirm('Delete this Auto task and its history?')) void deleteAutoTask(entry.id) }}><Trash2 size={15} /></button></div>) : <p>No tasks yet. Your completed and running tasks will appear here.</p>}</aside> : null}
        <div ref={feedRef} className={styles.feed} data-chat-surface="feed" onScroll={() => { const el = feedRef.current; if (el) followFeed.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70 }}>
          {!task ? <div className={styles.welcome}><span className={styles.welcomeIcon}><MousePointer2 size={26} /></span><p className={styles.eyebrow} data-chat-surface="eyebrow">COMPUTER USE · LOCAL</p><h2>Let Auto handle<br />the routine.</h2><p>Give your computer a task. Review the plan.<br />Grant only the access you want.</p><section className={styles.welcomeCard} aria-label="How Auto works"><div className={styles.welcomeCardHeading}><ShieldCheck size={19} /><strong>Plan first. Stay in control.</strong></div><ul><li>Start with a clear task plan</li><li>Choose which apps, files, and sites are in scope</li><li>Access stays off until you grant it</li></ul></section><p className={styles.welcomeNote}>One task at a time, on your terms.</p><div className={styles.suggestions}>{suggestions.map(([title, prompt]) => <button key={title} onClick={() => setRequest(prompt)}><span>{title}</span><ArrowUp size={13} /></button>)}</div></div> : <>
            <div className={styles.userMessage} data-chat-surface="user-message">{task.request}</div>
            <div className={styles.taskMeta}><span className={styles.phase}><i className={task.id === data.activeId ? styles.pulse : ''} />{task.permissionRequired ? 'Needs input permission' : phaseLabel(task.phase)}</span><span>{task.modelCalls} calls · {(displayedModelMs / 1000).toFixed(1)}s inference</span></div>
            {task.modelLabel ? <p className={styles.modelUsed}>{task.modelLabel}</p> : null}
            {task.plan.length ? <details className={styles.plan} data-chat-surface="plan" open><summary>Task plan <ChevronDown size={13} /></summary><div>{task.plan.map((step, index) => <p key={index}>{step}</p>)}</div></details> : null}
            <div className={styles.timeline} aria-label="Task activity">{task.events.filter((entry) => entry.action !== 'finish').map((entry) => <details key={entry.id} className={styles.event}><summary>{entry.verified ? <CheckCircle2 size={15} className="text-emerald-500" /> : entry.ok === false ? <AlertTriangle size={15} className="text-amber-500" /> : <Circle size={13} />}<span>{entry.action === 'model' ? 'Planning next action' : entry.action === 'model_load' ? 'Loading local model' : entry.action.replaceAll('_', ' ').replaceAll('.', ' · ')}</span><small>{entry.verified ? 'Verified' : entry.ok === false ? 'Failed' : phaseLabel(entry.phase)}</small><ChevronDown size={12} /></summary><pre>{entry.output}</pre></details>)}</div>
            {task.approval ? <div role="alert" className={styles.approval}><ShieldCheck size={19} /><h3>Review this action</h3><p>{task.approval.name}</p><pre>{JSON.stringify(task.approval.args, null, 2)}</pre><div><Button size="sm" disabled={pending} onClick={() => void act({ action: 'approve', id: task.id, approvalId: task.approval?.id, decision: 'once' })}>Allow once</Button>{task.approval.canRemember ? <Button size="sm" variant="outline" disabled={pending} title="Remember this exact action until the task ends" onClick={() => void act({ action: 'approve', id: task.id, approvalId: task.approval?.id, decision: 'always' })}>Always allow</Button> : null}<Button size="sm" variant="outline" disabled={pending} onClick={() => void act({ action: 'approve', id: task.id, approvalId: task.approval?.id, decision: 'decline' })}>Decline</Button></div></div> : null}
            {task.result ? <div className={styles.answer}><AssistantAnswer content={autoResultText(task)} agentName="Auto" /></div> : task.id === data.activeId ? <p className={styles.working} role="status"><Loader2 size={14} className="animate-spin" />{latest?.action === 'model_load' ? 'Loading your local model…' : phaseLabel(task.phase)}…</p> : null}
            {task.permissionRequired && !active ? <Button size="sm" variant="secondary" onClick={() => { setRequest(task.request); setPermissionHelp(inputPermissionRequired(task.request, true) ?? 'Review the access required for this task.'); reviewPermissions() }}><ShieldCheck size={14} />Review access and retry</Button> : null}
          </>}
        </div>
        <div className={styles.composerArea} data-chat-surface="composer-area">
          {!data.computer.enabled ? <div className={styles.modeNotice}><ShieldCheck size={13} /><span>Planning only · no computer access</span><button onClick={reviewPermissions}>Grant access</button></div> : scope.readonly ? <div data-testid="auto-observe-only" className={styles.modeNotice}><ShieldCheck size={13} /><span>Observe only</span><button onClick={reviewPermissions}>Review permissions</button></div> : <div className={styles.modeNotice}><ShieldCheck size={13} /><span>{data.scope?.approvalMode === 'full' ? 'Full access within authorized scope' : data.scope?.approvalMode === 'when-needed' ? 'Ask when needed' : 'Ask every time'}</span></div>}
          <form className={styles.composer} data-chat-surface="composer" onSubmit={(event) => { event.preventDefault(); if (request.trim() && !active && !pending) void run() }}>
            <textarea aria-label="Auto task" value={request} onChange={(event) => setRequest(event.target.value)} disabled={active} placeholder="Describe a task for your computer…" rows={1} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (request.trim() && !active && !pending) void run() } }} />
            <div className={styles.composerTools}>
              <HubSelect ariaLabel="Auto local model" value={model} onValueChange={(value) => void globalModel.setModel(value).catch((error) => setError(error.message))} disabled={active || !globalModel.ready || globalModel.saving} className={styles.modelSelect}><HubSelectItem value="">Automatic · local model</HubSelectItem>{model && !models.some((entry) => entry.id === model) ? <HubSelectItem value={model}>{model} · unavailable</HubSelectItem> : null}{models.filter((entry) => entry.chat).map((entry) => <HubSelectItem key={`${entry.providerId}:${entry.id}`} value={entry.id}>{entry.label}{entry.loaded ? ' · loaded' : ' · loads on start'}</HubSelectItem>)}</HubSelect>
              <button type="button" className={styles.iconButton} aria-label="Refresh local models" disabled={pending} onClick={() => void refresh(true).catch((reason) => setError(reason.message))}><RefreshCw size={14} /></button>
              {active ? <><button type="button" className={styles.iconButton} aria-label={running?.phase === 'paused' ? 'Resume task' : 'Pause task'} onClick={() => void act({ action: running?.phase === 'paused' ? 'resume' : 'pause', id: data.activeId })}>{running?.phase === 'paused' ? <Play size={16} /> : <Pause size={16} />}</button><button type="button" className={styles.send} aria-label="Stop task" onClick={() => void act({ action: 'stop', id: data.activeId })}><Square size={14} /></button></> : <button type="submit" className={styles.send} disabled={pending || !request.trim() || !globalModel.ready || globalModel.saving} aria-label={data.computer.enabled ? 'Run Auto' : 'Plan task without access'}>{pending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={19} />}</button>}
            </div>
          </form>
        </div>
      </section>
      <section className={cn(styles.computerPane, mobilePane !== 'computer' && styles.mobileHidden)} aria-label="Computer workspace">
        <div className={styles.paneHeader}><Monitor size={15} /><span className={styles.truncate}>{settingsOpen ? 'Configuration' : appWindow?.title || 'Computer'}</span><span className={styles.badge}>{data.computer.enabled ? data.computer.readonly ? 'Observe only' : 'Control enabled' : 'Control off'}</span><button className={styles.iconButton} aria-label={settingsOpen ? 'Close Auto settings' : 'Expand computer preview'} onClick={() => { if (settingsOpen) { setSettingsOpen(false); setMobilePane('task') } else void screenRef.current?.requestFullscreen().catch(() => setError('Fullscreen is unavailable in this browser.')) }}>{settingsOpen ? <X size={16} /> : <Maximize2 size={15} />}</button></div>
        {settingsOpen ? <div className={styles.settings} aria-label="Auto configuration">
          <div className={styles.settingsIntro}><h2>Make yourself at home</h2><p>Choose the exact access for this worker. No saved preference authorizes work.</p></div>
          <section className={styles.settingsSection}><h3><Settings2 size={15} />Model & execution</h3><p>Automatic follows the available local chat model. If none is loaded, an installed model loads when you run a task.</p>
            <label>Operating profile<HubSelect ariaLabel="Auto operating profile" value={profile} onValueChange={(value) => setProfile(value as typeof profile)} disabled={active} className="w-full">{['fast', 'balanced', 'careful'].map((value) => <HubSelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</HubSelectItem>)}</HubSelect></label>
            <label>Visual grounding<HubSelect ariaLabel="Auto vision model" value={visionModel} onValueChange={setVisionModel} disabled={active} className="w-full"><HubSelectItem value="auto">Automatic · available loaded vision model</HubSelectItem><HubSelectItem value="">Off · UI Automation and DOM</HubSelectItem>{models.filter((entry) => entry.vision && entry.loaded && entry.chat).map((entry) => <HubSelectItem key={entry.id} value={entry.id}>{entry.label}</HubSelectItem>)}</HubSelect></label>
            <p>Desktop apps run on Windows, not in an OS sandbox. File-tool boundaries do not confine every app write; review all input. Text models use UI Automation and browser structure. Screenshot grounding needs a loaded vision model; model quality determines task reliability.</p><label className={styles.checkbox}><input type="checkbox" checked={saveSummary} onChange={(event) => setSaveSummary(event.target.checked)} />Save a compact summary locally</label>
          </section>
          <section className={styles.settingsSection}><h3><ShieldCheck size={15} />Session permissions</h3>
            {permissionHelp ? <p role="status" className="whitespace-pre-line">{permissionHelp}</p> : null}
            <p>{scope.readonly ? OBSERVE_ONLY_NOTICE : 'Input enabled for selected apps. The approval mode below determines which proposed actions ask for confirmation.'}</p>
            <label className={styles.checkbox}><input type="checkbox" checked={scope.readonly} disabled={active || data.computer.enabled} onChange={(event) => setScope((previous) => ({ ...previous, readonly: event.target.checked, workspaceAccess: event.target.checked && previous.workspaceAccess === 'write' ? 'read' : previous.workspaceAccess }))} />Read only: inspect without input</label>
            <label className={styles.field}>Approval mode
              <HubSelect ariaLabel="Auto approval mode" value={scope.approvalMode ?? 'always-ask'} disabled={active || data.computer.enabled || scope.readonly} onValueChange={(value) => {
                const approvalMode = value as ComputerScope['approvalMode']
                setScope((previous) => ({ ...previous, approvalMode }))
              }}>
                <HubSelectItem value="always-ask">Ask every time</HubSelectItem>
                <HubSelectItem value="when-needed">Ask when needed</HubSelectItem>
                <HubSelectItem value="full">Full access within authorized scope</HubSelectItem>
              </HubSelect>
            </label>
            <p>{scope.readonly ? 'Read only prevents all input actions.' : scope.approvalMode === 'full' ? 'Auto can act without individual prompts within the apps, hosts and workspace you grant below. Revoke access to stop it.' : scope.approvalMode === 'when-needed' ? 'Opening and arranging apps, hovering and scrolling proceed automatically. Typing, clicking, navigation, file changes and commands still ask.' : 'Each proposed change asks for approval.'}</p>
            {data.computer.enabled && !active ? <Button size="sm" variant="outline" disabled={pending} onClick={() => void act({ action: 'stop' }).then((value) => { if (value) setConsent(false) })}>Revoke access to change permissions</Button> : null}
            <fieldset disabled={active || data.computer.enabled} className={styles.apps}>{(['notepad', 'explorer', 'vscode', 'calculator', 'browser'] as const).map((app) => <label key={app} className={styles.checkbox}><input type="checkbox" checked={scope.applications.includes(app)} onChange={(event) => setScope((value) => ({ ...value, applications: event.target.checked ? [...value.applications, app] : value.applications.filter((item) => item !== app) }))} />{{ vscode: 'VS Code', browser: 'Separate browser', notepad: 'Notepad', explorer: 'File Explorer', calculator: 'Calculator' }[app]}</label>)}</fieldset>
            <label>Pointer movement<HubSelect ariaLabel="Pointer movement speed" value={scope.pointerProfile ?? 'normal'} disabled={active || data.computer.enabled} onValueChange={(value) => setScope((current) => ({ ...current, pointerProfile: value as ComputerScope['pointerProfile'] }))} className="w-full"><HubSelectItem value="fast">Fast</HubSelectItem><HubSelectItem value="normal">Normal</HubSelectItem><HubSelectItem value="demonstration">Demonstration</HubSelectItem></HubSelect></label>
            <label className={styles.checkbox}><input type="checkbox" checked={scope.screenshots !== false} disabled={active || data.computer.enabled} onChange={(event) => setScope((current) => ({ ...current, screenshots: event.target.checked }))} />Allow screenshots of the permitted foreground window</label>
            <label><span className="flex items-center gap-1"><Folder size={12} />File-tool workspace</span><HubSelect ariaLabel="Auto working folder" value={scope.workspaceId ?? ''} disabled={active || data.computer.enabled} onValueChange={(value) => setScope((current) => ({ ...current, workspaceId: value || undefined, workspaceAccess: value ? 'read' : 'none' }))} className="w-full"><HubSelectItem value="">No folder access</HubSelectItem>{workspaces.filter((entry) => entry.id).map((entry) => <HubSelectItem key={entry.id} value={entry.id}>{entry.root}</HubSelectItem>)}</HubSelect></label>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={active || pending || data.computer.enabled} onClick={() => void chooseFolder('pick')}><Folder size={13} />Browse folder</Button></div>
            <label>Or select an absolute folder path<input className={styles.input} aria-label="Auto folder path" disabled={active || pending || data.computer.enabled} value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="C:/Projects/MyApp" /></label><Button size="sm" variant="outline" disabled={active || pending || data.computer.enabled || !folderPath.trim()} onClick={() => void chooseFolder('select')}>Select this folder</Button>
            <label>Workspace access<HubSelect ariaLabel="Auto workspace access" value={scope.workspaceAccess ?? 'none'} disabled={active || data.computer.enabled || !scope.workspaceId} onValueChange={(value) => setScope((current) => ({ ...current, workspaceAccess: value as ComputerScope['workspaceAccess'] }))} className="w-full"><HubSelectItem value="none">No files</HubSelectItem><HubSelectItem value="read">Read files</HubSelectItem><HubSelectItem value="write" disabled={scope.readonly}>Read and propose approved changes</HubSelectItem></HubSelect></label>
            <label className={styles.checkbox}><input type="checkbox" checked={scope.internet === true} disabled={active || data.computer.enabled} onChange={(event) => setScope((current) => ({ ...current, internet: event.target.checked }))} />Allow internet on the exact browser hostnames below</label>
            <label>Allowed browser hostnames<input aria-label="Allowed browser hostnames" value={domainText} disabled={active || data.computer.enabled} onChange={(event) => setDomainText(event.target.value)} className={styles.input} /></label>
            <label className={styles.checkbox}><input type="checkbox" checked={consent} disabled={active} onChange={(event) => setConsent(event.target.checked)} />I authorize access to the selected apps and workspace for this session.</label>
            <Button size="sm" disabled={pending || active || !data.computer.connected || !consent || (!scope.applications.length && (!scope.workspaceId || scope.workspaceAccess === 'none')) || data.computer.enabled} onClick={() => void act({ action: 'enable', scope: { ...scope, domains: domainText.split(',').map((value) => value.trim()).filter(Boolean) } }).then((value) => { if (value) { setSettingsOpen(false); setMobilePane('task') } })}><Play size={13} />Grant session access</Button>{data.computer.enabled ? <p>Access is active. Stop all revokes it immediately.</p> : !data.computer.connected ? <p>Connect computer using the button at the top first.</p> : null}
          </section>
          <details className={styles.settingsSection}><summary><Terminal size={15} />Inspect individual tools<ChevronDown size={13} /></summary><div className={styles.manualTools}><p>Use fresh handles and element IDs. Tools are disabled during a running task.</p>
            <HubSelect ariaLabel="Computer tool" value={toolName} disabled={active} onValueChange={(value) => { setToolName(value); setToolConfirmed(false); setToolArgs(value === 'desktop.open_application' ? '{"application":"notepad"}' : '{}') }} className="w-full">{COMPUTER_TOOLS.filter((tool) => tool.name !== 'visual_ground').map((tool) => <HubSelectItem key={tool.name} value={nativeToolName(tool.name)}>{nativeToolName(tool.name)}</HubSelectItem>)}</HubSelect>
            <textarea aria-label="Computer tool arguments" value={toolArgs} disabled={active} onChange={(event) => { setToolArgs(event.target.value); setToolConfirmed(false) }} rows={4} className={styles.input} />
            {toolMutation ? <label className={styles.checkbox}><input type="checkbox" checked={toolConfirmed} onChange={(event) => setToolConfirmed(event.target.checked)} />I reviewed and approve this exact action.</label> : null}
            <Button size="sm" variant="outline" disabled={pending || active || !data.computer.enabled || (toolMutation && !toolConfirmed)} onClick={() => { try { const args = JSON.parse(toolArgs); void act({ action: 'tool', name: toolName, args, confirmed: toolConfirmed }).then((value) => { if (value) { setToolResult(value); setToolConfirmed(false); if (value.result?.image) { setPreview(value.result.image); setSettingsOpen(false) } } }) } catch { setError('Enter valid JSON tool arguments.') } }}>Run tool</Button>
            {toolResult ? <pre data-testid="computer-tool-result">{JSON.stringify(toolResult, (key, value) => key === 'image' ? '[local screenshot in preview]' : value, 2)}</pre> : null}
          </div></details>
        </div> : <>
          <div className="border-b p-3" aria-label="Computer applications">
            <div className="mb-2 flex items-center justify-between text-xs"><strong>Applications</strong><button type="button" className="underline" disabled={active} onClick={reviewPermissions}>Manage access</button></div>
            <div className="flex flex-wrap gap-2">{(['notepad', 'calculator', 'explorer', 'vscode'] as const).map((application) => {
              const allowed = data.computer.enabled && data.scope?.applications.includes(application)
              const label = { notepad: 'Notepad', calculator: 'Calculator', explorer: 'File Explorer', vscode: 'VS Code' }[application]
              return <Button key={application} size="sm" variant="outline" disabled={pending || active} onClick={async () => {
                if (!allowed || data.scope?.readonly) { setPermissionHelp(`To open ${label}, select it in Session permissions, clear Read only and grant access.`); reviewPermissions(); return }
                const opened = await act({ action: 'tool', name: 'desktop.open_application', args: { application }, confirmed: true })
                const handle = opened?.result?.windows?.[0]?.handle
                if (!handle) return
                const focused = await act({ action: 'tool', name: 'desktop.focus_window', args: { handle }, confirmed: true })
                if (!focused || data.scope?.screenshots === false) return
                await refreshApp(handle)
              }}>{label}{!allowed ? ' · access needed' : ''}</Button>
            })}</div>
            <p className="mt-2 text-[10px] text-muted-foreground">Apps run on Windows and mirror here. Click the preview to interact with the selected app.</p>
          </div>
          {appWindow ? <div className="border-b p-3" aria-label="App interaction controls">
            <div className="mb-2 flex flex-wrap gap-2">{['Enter', 'Tab', 'Backspace', 'Escape'].map((key) => <Button key={key} size="sm" variant="outline" disabled={pending || active || data.scope?.readonly} onClick={() => void interactApp('press_key', undefined, key)}>{key}</Button>)}<Button size="sm" variant="outline" disabled={pending || active} onClick={async () => { const focused = await act({ action: 'tool', name: 'desktop.focus_window', args: { handle: appWindow.handle }, confirmed: true }); if (focused) await refreshApp(appWindow.handle) }}>Refresh app</Button></div>
            <form onSubmit={(event) => { event.preventDefault(); void interactApp('type_text') }} className="flex items-end gap-2"><textarea aria-label="Text to type in app" placeholder="Click the app editor, then type here…" value={appText} disabled={pending || active} onChange={(event) => setAppText(event.target.value)} rows={2} maxLength={8000} className={styles.input} /><Button type="submit" size="sm" disabled={pending || active || !appText || data.scope?.readonly}>Type in app</Button></form>
            <p className="mt-2 text-[10px] text-muted-foreground">Click the mirrored app to control it. The preview refreshes automatically while AgentHub is visible.</p>
          </div> : null}
          {/* eslint-disable-next-line @next/next/no-img-element -- Live local data URI: preserve native pixel geometry for click mapping; never proxy or recompress screenshots. */}
          <div ref={screenRef} className={styles.screen} data-testid="auto-computer-preview" onClick={(event) => { const image = event.target; if (!(image instanceof HTMLImageElement) || !preview || !appWindow || active || pending) return; const point = previewPoint(event.clientX, event.clientY, image.getBoundingClientRect(), { width: image.naturalWidth, height: image.naturalHeight }, appWindow.bounds); if (point) void interactApp('click', point) }}>{screenshot ? <><img decoding="async" loading="eager" src={screenshot} alt={`Live mirrored preview of ${appWindow?.title || 'the permitted Windows app'}`} /><span className={styles.captureLabel}>{active ? 'Preview paused while Auto runs' : previewStatus || 'Live mirror'}{previewUpdatedAt ? ` · ${new Date(previewUpdatedAt).toLocaleTimeString()}` : ''}</span></> : <div className={styles.screenEmpty}><div className={styles.monitorArt}><Monitor size={48} strokeWidth={1} /><span><MousePointer2 size={19} /></span></div><h2>Your computer, in view</h2><p>Captured windows appear here as Auto works.<br />Only permitted applications can be inspected.</p><span className={styles.screenHint}><ShieldCheck size={13} />Screenshots stay on this computer</span>{!data.computer.connected ? <Button size="sm" variant="outline" disabled={pending} onClick={() => void act({ action: 'connect' })}><Link2 size={14} />Connect computer</Button> : !data.computer.enabled ? <Button size="sm" variant="outline" onClick={reviewPermissions}>Configure permissions</Button> : null}</div>}</div>
        </>}
      </section>
    </div>
    </div>
  </div>
}
