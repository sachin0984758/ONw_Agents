'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Bot, ChevronRight, Code2, Focus, GitBranch, Layers3, Maximize2, Network, Pause, Play, Search, ZoomIn, ZoomOut, Brain, FileText, Plug, X } from 'lucide-react'
import { useHub } from '@/lib/agent-hub/store'
import { buildAgentNetwork, buildVaultNetwork, combineNetworkUniverses, projectPoint, projectUniversePoint, workspaceTreeGraph, NETWORK_COLORS, type AgentNetworkNode, type NetworkKind, type WorkspaceTreeEntry } from '@/lib/agent-hub/agent-network'
import { useObsidianNetwork, obsidianRequest } from './use-obsidian-network'
import type { MemoryRead, ObsidianVault } from '@/lib/agent-hub/obsidian/types'
import { ObsidianNoteMarkdown } from './obsidian-note-markdown'
import { readableNote } from '@/lib/agent-hub/obsidian/presentation'
import { drawGalaxyNebula } from './galaxy-nebula'
import type { CodeGraph } from '@/lib/agent-hub/types'
import styles from './agents-network.module.css'

const KINDS: Array<{ kind: NetworkKind; label: string }> = [
  { kind: 'agent', label: 'Agents' }, { kind: 'worktree', label: 'Worktrees' },
  { kind: 'session', label: 'Sessions' }, { kind: 'code', label: 'Code' },
]
export function AgentsNetwork({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const state = useHub((s) => s.state)
  const selectedAgentId = useHub((s) => s.selectedAgentId)
  const selectAgent = useHub((s) => s.selectAgent)
  const [fileGraph, setFileGraph] = useState<CodeGraph | null>(null)
  const [obsidian, setObsidian] = useState(false), [revision, setRevision] = useState(0), [connecting, setConnecting] = useState(false)
  const [devices, setDevices] = useState<ObsidianVault[]>([]), [devicePath, setDevicePath] = useState(''), [deviceError, setDeviceError] = useState(''), [deviceBusy, setDeviceBusy] = useState(false)
  const vault = useObsidianNetwork(obsidian, revision)
  const network = useMemo(() => {
    const workspace = buildAgentNetwork(state.projectName, state.agents, state.sessions, fileGraph ?? state.graph)
    if (!obsidian || !vault.graph) return workspace
    return combineNetworkUniverses(workspace, buildVaultNetwork(vault.graph))
  }, [obsidian, vault.graph, state.projectName, state.agents, state.sessions, state.graph, fileGraph])
  const kinds = obsidian ? [...KINDS, { kind: 'note' as const, label: 'Notes' }] : KINDS
  const [note, setNote] = useState<MemoryRead | null>(null), [noteError, setNoteError] = useState(''), [noteLoading, setNoteLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<NetworkKind | 'all'>('all')
  const [rotation, setRotation] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [labels, setLabels] = useState(true)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [reset, setReset] = useState(0)
  const spinning = rotation
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const camera = useRef({ yaw: 0, pitch: -.15 })
  const selectedId = focusId ?? `agent:${selectedAgentId}`
  const selected = network.nodes.find((node) => node.id === selectedId) ?? network.nodes[0]
  const search = query.trim().toLowerCase()
  const matches = (node: AgentNetworkNode) => (filter === 'all' || node.kind === filter) && (!search || `${node.label} ${node.detail}`.toLowerCase().includes(search))
  const matchingNodes = network.nodes.filter(matches)
  const chooseNode = (node: AgentNetworkNode) => { setFocusId(node.id); if (node.agentId) selectAgent(node.agentId) }
  const selectedPath = obsidian ? selected?.notePath : undefined
  useEffect(() => {
    if (!selectedPath) return
    const controller = new AbortController()
    void Promise.resolve().then(() => { setNote(null); setNoteLoading(true); setNoteError(''); return obsidianRequest(`?op=read&path=${encodeURIComponent(selectedPath)}`, undefined, controller.signal) }).then((result) => { if (!controller.signal.aborted) setNote(result.note) }).catch((e) => { if (!controller.signal.aborted) setNoteError(e.message) }).finally(() => { if (!controller.signal.aborted) setNoteLoading(false) })
    return () => controller.abort()
  }, [selectedPath, vault.graph?.connectionId])
  const findDevices = async () => {
    setDeviceBusy(true); setDeviceError('')
    try { const data = await obsidianRequest('?op=discover'); setDevices(data.vaults); if (data.vaults[0]) setDevicePath(data.vaults[0].root) }
    catch (e) { setDeviceError(e instanceof Error ? e.message : 'Obsidian was not detected.') }
    finally { setDeviceBusy(false) }
  }

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/agent-session/files?op=tree&path=src&depth=5', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        const body = await response.json() as { ok?: boolean; tree?: unknown }
        if (!body.ok || !Array.isArray(body.tree) || controller.signal.aborted) return
        const entries = body.tree.filter((entry): entry is WorkspaceTreeEntry => !!entry && typeof entry === 'object' && typeof entry.path === 'string' && (entry.type === 'file' || entry.type === 'dir'))
        if (entries.length) setFileGraph(workspaceTreeGraph(entries))
      })
      .catch(() => { /* Keep the stored graph available when the workspace cannot be read. */ })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const frame = frameRef.current
    if (!canvas || !frame) return
    const context = canvas.getContext('2d')
    if (!context) return
    const ctx = context
    let width = 0; let height = 0; let animation = 0; let lastTime = 0; let disposed = false
    let drag: { id: number; x: number; y: number; moved: number } | null = null
    let hoverId: string | null = null
    let projected: Array<{ node: AgentNetworkNode; x: number; y: number; depth: number; scale: number }> = []
    const active = new Set(network.nodes.filter((node) => (filter === 'all' || node.kind === filter) && (!search || `${node.label} ${node.detail}`.toLowerCase().includes(search))).map((node) => node.id))

    function draw() {
      if (disposed || !width || !height) return
      ctx.clearRect(0, 0, width, height)
      const fit = Math.min(width / (obsidian && vault.graph ? 1300 : 1000), height / 1000) * zoom
      const project = obsidian && vault.graph ? projectUniversePoint : projectPoint
      projected = network.nodes.map((node) => ({ node, ...project(node, camera.current.yaw, camera.current.pitch, fit, width, height) }))
      if (obsidian && vault.graph) {
        // Decorative stars and soft galaxy halos are not graph nodes or relationships.
        for (let star = 0; star < 90; star++) {
          const x = ((star * 193 + 43) % 997) / 997 * width, y = ((star * 337 + 71) % 991) / 991 * height
          ctx.fillStyle = star % 3 ? '#b6a5df33' : '#c9e9ff44'; ctx.fillRect(x, y, 1, 1)
        }
        for (const point of projected.filter((item) => item.node.kind === 'project')) {
          if (point.node.galaxy) { drawGalaxyNebula(ctx, point.node, camera.current.yaw, camera.current.pitch, fit, width, height); continue }
          const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 180 * fit)
          glow.addColorStop(0, point.node.id === 'vault' ? '#2dd4bf18' : '#a78bfa20'); glow.addColorStop(1, '#08080e00')
          ctx.fillStyle = glow; ctx.fillRect(point.x - 180 * fit, point.y - 180 * fit, 360 * fit, 360 * fit)
        }
      }
      const points = new Map(projected.map((point) => [point.node.id, point]))
      for (const edge of network.edges) {
        const from = points.get(edge.from); const to = points.get(edge.to)
        if (!from || !to) continue
        const relevant = active.has(edge.from) && active.has(edge.to)
        const connected = edge.from === selectedId || edge.to === selectedId
        const galaxyLink = from.node.galaxy && to.node.galaxy
        ctx.globalAlpha = relevant ? connected ? .72 : galaxyLink ? .008 : .21 : .006
        ctx.strokeStyle = from.node.color
        ctx.lineWidth = connected ? 1.1 : .65
        ctx.beginPath(); ctx.moveTo(from.x, from.y)
        const curve = (from.node.x - to.node.x) * .045
        ctx.quadraticCurveTo((from.x + to.x) / 2 + curve, (from.y + to.y) / 2 - curve, to.x, to.y)
        ctx.stroke()
      }
      projected.sort((a, b) => b.depth - a.depth)
      const occupied: Array<{ x: number; y: number; w: number }> = []
      for (const point of projected) {
        const { node, x, y, scale } = point
        const relevant = active.has(node.id)
        const focused = selectedId === node.id || hoverId === node.id
        const radius = Math.max(node.galaxy ? .7 : 1.5, node.radius * scale)
        ctx.globalAlpha = relevant ? .68 + Math.min(.32, scale * .25) : .11
        if (focused) {
          ctx.beginPath(); ctx.arc(x, y, radius + 5, 0, Math.PI * 2)
          ctx.strokeStyle = '#ede9fe'; ctx.lineWidth = 1.2; ctx.stroke()
        }
        ctx.shadowColor = node.color
        ctx.shadowBlur = focused || node.kind === 'agent' || node.kind === 'project' ? 13 : 0
        ctx.fillStyle = node.color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill()
        ctx.shadowBlur = 0
        const important = focused || node.kind === 'agent' || node.kind === 'project' || (search && relevant)
        if (!relevant || (!labels && !focused)) continue
        if (!important && (node.radius < 4 || scale < .65)) continue
        const label = node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label
        const universeRoot = obsidian && vault.graph && node.kind === 'project'
        ctx.font = `${universeRoot ? '600' : focused ? '500' : '400'} ${universeRoot ? 14 : focused ? 12 : 10}px ui-monospace, SFMono-Regular, Consolas, monospace`
        const labelX = x + radius + 7; const labelY = y + 3; const labelWidth = ctx.measureText(label).width
        if (!important && occupied.some((box) => Math.abs(box.y - labelY) < 14 && labelX < box.x + box.w && labelX + labelWidth > box.x)) continue
        ctx.globalAlpha = focused ? 1 : important ? .88 : .52
        ctx.strokeStyle = '#08080e'; ctx.lineWidth = 3; ctx.strokeText(label, labelX, labelY)
        ctx.fillStyle = focused ? '#ffffff' : '#c9c6d7'; ctx.fillText(label, labelX, labelY)
        occupied.push({ x: labelX, y: labelY, w: labelWidth })
      }
      ctx.globalAlpha = 1
      canvas!.dataset.rotation = camera.current.yaw.toFixed(5)
    }
    function tick(time: number) {
      animation = 0
      if (disposed || document.hidden) { lastTime = 0; return }
      if (lastTime && time - lastTime < 30) { animation = requestAnimationFrame(tick); return }
      // Keep the automatic orbit running during pointer drags. The user can
      // stop it explicitly with the toolbar control; a drag only adjusts view.
      if (lastTime && spinning) camera.current.yaw += Math.min(.05, (time - lastTime) / 1000) * (obsidian && vault.graph ? .035 : .12)
      lastTime = time; draw()
      if (spinning && !disposed) animation = requestAnimationFrame(tick)
    }
    function redraw() { draw(); if (spinning && !animation && !document.hidden && !disposed) animation = requestAnimationFrame(tick) }
    const observer = new ResizeObserver(() => {
      const bounds = frame!.getBoundingClientRect(); width = bounds.width; height = bounds.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas!.width = Math.round(width * dpr); canvas!.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); redraw()
    })
    observer.observe(frame)
    const localPoint = (event: PointerEvent) => { const rect = canvas!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
    const hit = (x: number, y: number) => [...projected].reverse().find((point) => active.has(point.node.id) && Math.hypot(point.x - x, point.y - y) < Math.max(11, point.node.radius * point.scale + 5))
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || drag) return
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 }; canvas!.setPointerCapture(event.pointerId)
    }
    const pointerMove = (event: PointerEvent) => {
      if (drag && event.pointerId === drag.id) {
        const dx = event.clientX - drag.x; const dy = event.clientY - drag.y
        drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = event.clientX; drag.y = event.clientY
        camera.current.yaw += dx * .006; camera.current.pitch = Math.max(-1.15, Math.min(1.15, camera.current.pitch + dy * .005))
        canvas!.style.cursor = 'grabbing'; draw()
      } else {
        const point = localPoint(event); hoverId = hit(point.x, point.y)?.node.id ?? null
        canvas!.style.cursor = hoverId ? 'pointer' : 'grab'; if (!spinning) draw()
      }
    }
    const pointerUp = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return
      if (drag.moved < 6) { const point = localPoint(event); const target = hit(point.x, point.y); if (target) { setFocusId(target.node.id); if (target.node.agentId) selectAgent(target.node.agentId) } }
      drag = null; canvas!.style.cursor = 'grab'
      if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId)
      redraw()
    }
    const pointerCancel = () => { drag = null; redraw() }
    const wheel = (event: WheelEvent) => { event.preventDefault(); setZoom((value) => Math.max(.45, Math.min(2.5, value * Math.exp(-event.deltaY * .001)))) }
    const visibility = () => { if (document.hidden) lastTime = 0; else redraw() }
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerCancel)
    canvas.addEventListener('wheel', wheel, { passive: false }); document.addEventListener('visibilitychange', visibility)
    redraw()
    return () => {
      disposed = true; cancelAnimationFrame(animation); observer.disconnect()
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel)
      canvas.removeEventListener('wheel', wheel); document.removeEventListener('visibilitychange', visibility)
    }
  }, [network, spinning, zoom, labels, selectedId, search, filter, reset, selectAgent, obsidian, vault.graph])

  const resetView = () => { camera.current = { yaw: 0, pitch: -.15 }; setZoom(1); setReset((value) => value + 1) }
  const group = (kind: NetworkKind, label: string) => {
    const items = matchingNodes.filter((node) => node.kind === kind)
    if (!items.length) return null
    const Icon = kind === 'note' ? FileText : kind === 'agent' ? Bot : kind === 'session' ? Activity : kind === 'worktree' ? GitBranch : Code2
    return <details key={kind} className={styles.group} open={kind === 'note' || kind === 'agent' || Boolean(search)}>
      <summary><ChevronRight size={12} /><Icon size={13} /><span>{label}</span><small>{items.length}</small></summary>
      <div>{items.map((node) => <button key={node.id} type="button" title={node.detail} onClick={() => chooseNode(node)} aria-pressed={selectedId === node.id} className={styles.nodeRow} data-chat-surface="sidebar-item"><i style={{ background: node.color }} /><span>{node.label}</span></button>)}</div>
    </details>
  }

  return <section className={styles.network} aria-label="Agent network explorer" data-chat-surface="workspace" data-chat-kind="agent-network">
    <div className={styles.toolbar} data-chat-surface="header">
      <div className={styles.brand}><span className={styles.brandIcon}><Network size={17} /></span><div><strong data-chat-surface="brand-title">Agent network</strong><small data-chat-surface="brand-subtitle">{state.projectName}</small></div></div>
      <label className={styles.vaultToggle} data-chat-surface="toolbar-action"><input type="checkbox" role="switch" checked={obsidian} aria-checked={obsidian} aria-label="Show Obsidian notes" onChange={(event) => { setObsidian(event.target.checked); setFocusId(null); setFilter('all'); setQuery('') }} /><Brain size={14} /><span>Obsidian</span><i /></label>
      <button type="button" className={styles.spinButton} data-chat-surface="toolbar-action" onClick={() => setConnecting(!connecting)} aria-expanded={connecting}><Plug size={13} /><span>Connect device</span></button>
      <label className={styles.search} data-chat-surface="search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search network nodes" placeholder={obsidian ? 'Search agents, notes, universes…' : 'Search agents, nodes, sessions…'} />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear network search">×</button>}</label>
      <div className={styles.snapshot} data-chat-surface="snapshot"><i />{obsidian ? vault.loading ? 'Reading vault…' : vault.status?.available ? 'Local vault connected' : 'Connect a vault' : 'Workspace snapshot'}</div>
      <button type="button" data-chat-surface="toolbar-action" className={styles.spinButton} aria-label={spinning ? 'Pause graph rotation' : 'Resume graph rotation'} aria-pressed={spinning} onClick={() => setRotation(!spinning)}>{spinning ? <Pause size={13} /> : <Play size={13} />}<span>{spinning ? 'Rotating' : 'Paused'}</span></button>
      <button type="button" data-chat-surface="toolbar-primary" className={styles.workspaceButton} onClick={onOpenWorkspace}><Layers3 size={14} /><span>Workspace</span><ChevronRight size={12} /></button>
    </div>
    {connecting && <div role="dialog" aria-label="Connect local Obsidian" className={styles.devicePanel}><div><strong>Connect local Obsidian</strong><button aria-label="Close connection panel" onClick={() => setConnecting(false)}><X size={15} /></button></div><p>Find the vault on this computer, then connect it. Your notes stay local. The toggle changes the graph view.</p><button className={styles.spinButton} disabled={deviceBusy} onClick={() => void findDevices()}>Search Obsidian</button>{devices.map((device) => <button key={device.id} className={styles.deviceChoice} onClick={() => setDevicePath(device.root)}>{device.name}<small>{device.root}</small></button>)}<input aria-label="Local Obsidian vault path" placeholder="Or paste a vault folder path" value={devicePath} onChange={(e) => setDevicePath(e.target.value)} /><p>Connect authorizes the existing local-memory pack for this vault. Reviewed memory writes remain required.</p>{deviceError && <p role="alert">{deviceError}</p>}<button className={styles.workspaceButton} disabled={deviceBusy || !devicePath.trim()} onClick={() => { setDeviceBusy(true); setDeviceError(''); void obsidianRequest('', { action: 'connect', path: devicePath }).then(() => { setRevision((value) => value + 1); setObsidian(true); setFocusId(null); setFilter('all'); setQuery(''); setConnecting(false) }).catch((e) => setDeviceError(e.message)).finally(() => setDeviceBusy(false)) }}>Connect vault</button></div>}
    <div className={styles.body} data-chat-surface="feed">
      <aside className={styles.explorer} aria-label="Network explorer" data-chat-surface="sidebar">
        <div className={styles.explorerHeading} data-chat-surface="sidebar-heading">EXPLORER <span>{network.nodes.length}</span></div>
        <div className={styles.filters} aria-label="Filter network by type" data-chat-surface="sidebar-filters"><button type="button" data-chat-surface="sidebar-filter" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>{kinds.map(({ kind, label }) => <button key={kind} type="button" data-chat-surface="sidebar-filter" aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{label}</button>)}</div>
        <div className={styles.nodeList}>
          {obsidian && vault.graph && <div className={styles.universeList} aria-label="Network universes"><button aria-pressed={selectedId === 'project'} onClick={() => { setFocusId('project'); setQuery(''); setFilter('all') }}><i style={{ background: '#d9b9ff' }} /><span>{state.projectName}</span><small>Workspace</small></button><button aria-pressed={selectedId === 'vault'} onClick={() => { setFocusId('vault'); setQuery(''); setFilter('all') }}><i style={{ background: '#5eead4' }} /><span>Obsidian</span><small>{vault.graph.notes.length} notes</small></button></div>}
          {group('agent', 'Agents')}{group('worktree', 'Worktrees')}{group('session', 'Sessions')}{group('code', fileGraph ? 'Project files' : 'Code snapshot')}{obsidian && group('note', 'Obsidian notes')}
          {!matchingNodes.length && <p className={styles.empty}>No matching nodes.<button type="button" onClick={() => { setQuery(''); setFilter('all') }}>Clear filters</button></p>}
        </div>
        <div className={styles.explorerFooter} data-chat-surface="sidebar-footer">{obsidian && vault.graph ? `${state.projectName} + Obsidian` : fileGraph ? 'Project file tree + stored agents' : 'Stored relationships'}<br /><span>{obsidian && vault.graph ? `${vault.graph.notes.length} notes · ${network.totalCodeNodes} code nodes${vault.graph.limited ? ' · bounded scan' : ''}` : `${network.nodes.filter((node) => node.kind === 'code').length} of ${network.totalCodeNodes} code nodes shown`}</span></div>
      </aside>
      <div className={styles.scene} ref={frameRef}>
        <canvas ref={canvasRef} className={styles.canvas} role="img" aria-label={obsidian && vault.graph ? '3D universe with two separate galaxies: the project workspace and real local Obsidian notes. Both are visible together.' : 'Rotating 3D graph of stored agents, sessions, worktrees, and code. Use the explorer buttons to select nodes.'} />
        <div className={styles.sceneHint}><span className={styles.hintDot} />{spinning ? 'AUTO ORBIT' : 'ORBIT PAUSED'}<span>Drag to rotate · scroll to zoom</span></div>
        <div className={styles.legend}>{kinds.map(({ kind, label }) => <span key={kind}><i style={{ background: NETWORK_COLORS[kind] }} />{label}</span>)}</div>
        {selected && <div className={`${styles.inspector} ${selectedPath ? styles.noteInspector : ''}`} aria-live="polite"><div><i style={{ background: selected.color }} /><span>{selected.kind}</span></div><strong>{selected.label}</strong><p>{selected.detail}</p>{selected.agentId && <button type="button" onClick={onOpenWorkspace}>Agent details <ChevronRight size={12} /></button>}{selectedPath && <><button type="button" onClick={() => setFocusId('vault')}>Close note <X size={12} /></button>{noteLoading && <p role="status">Reading actual note…</p>}{noteError && <p role="alert">{noteError}</p>}{note?.path === selectedPath && !noteLoading && <div className={styles.noteContent} aria-label="Selected Obsidian note"><ObsidianNoteMarkdown>{readableNote(note.content)}</ObsidianNoteMarkdown>{note.truncated && <p>Showing first 256 KB.</p>}<a href={note.obsidianUrl}>Open in Obsidian</a></div>}</>}</div>}
        {obsidian && (vault.loading || !vault.status?.available || vault.error) && <div className={styles.vaultNotice} role="status">{vault.error || (vault.loading ? 'Reading your vault and actual note links…' : 'Connect your local vault with Connect device → Search Obsidian.')}</div>}
        <div className={styles.controls} aria-label="Graph controls">
          <button type="button" aria-label="Zoom in graph" onClick={() => setZoom((value) => Math.min(2.5, value * 1.2))}><ZoomIn size={16} /></button>
          <button type="button" aria-label="Zoom out graph" onClick={() => setZoom((value) => Math.max(.45, value / 1.2))}><ZoomOut size={16} /></button>
          <button type="button" aria-label="Reset graph view" onClick={resetView}><Focus size={16} /></button>
          <button type="button" aria-label="Toggle graph labels" aria-pressed={labels} onClick={() => setLabels((value) => !value)}><Code2 size={15} /></button>
          <button type="button" aria-label="Expand graph fullscreen" onClick={() => { if (!document.fullscreenElement) void frameRef.current?.requestFullscreen?.().catch(() => {}); else void document.exitFullscreen().catch(() => {}) }}><Maximize2 size={15} /></button>
        </div>
        {!matchingNodes.length && <div className={styles.noResults}>No nodes match “{query || filter}”</div>}
      </div>
    </div>
    <div className={styles.statusbar} data-chat-surface="statusbar"><span>{network.nodes.length} nodes <b>·</b> {network.edges.length} connections</span><span>{matchingNodes.length} matched <b>·</b> {Math.round(zoom * 100)}% zoom</span><span>{obsidian && vault.graph ? '2 universes · workspace + Obsidian' : '3D workspace graph'}</span></div>
  </section>
}
