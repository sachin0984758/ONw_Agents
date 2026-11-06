'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RoadmapGraph, RoadmapNode } from '@/lib/agent-hub/roadmap-library'
import { FeedbackMarkdown } from './feedback-panel'

interface RoadmapDioramaProps {
  roadmap: RoadmapGraph
  focusTopicId: string
  completedTopicIds: string[]
  currentLesson: string
  onContinue: () => void
  onBack: () => void
  className?: string
}

function nodeColor(type: string): string {
  if (type === 'title') return '#fbbf24'
  if (type === 'topic') return '#22d3ee'
  if (type === 'section') return '#34d399'
  if (type === 'label') return '#94a3b8'
  return '#a78bfa'
}

function contentNodesForVisual(roadmap: RoadmapGraph): RoadmapNode[] {
  const visibleTypes = new Set(['title', 'topic', 'subtopic', 'section', 'label'])
  return roadmap.nodes.filter((node) => visibleTypes.has(node.type) && node.label.trim())
}

function topicNeighborhood(roadmap: RoadmapGraph, topicId: string) {
  const byId = new Map(roadmap.nodes.map((node) => [node.id, node]))
  const visible = new Set(contentNodesForVisual(roadmap).map((node) => node.id))
  const related = (incoming: boolean) => roadmap.edges
    .filter((edge) => (incoming ? edge.to === topicId : edge.from === topicId))
    .map((edge) => byId.get(incoming ? edge.from : edge.to))
    .filter((node): node is RoadmapNode => Boolean(node && visible.has(node.id)))
  return { prerequisites: related(true), next: related(false) }
}

function topicPosition(node: RoadmapNode, bounds: { minX: number; maxX: number; minY: number; maxY: number }) {
  const xRange = Math.max(1, bounds.maxX - bounds.minX)
  const yRange = Math.max(1, bounds.maxY - bounds.minY)
  return new Float32Array([
    ((node.x - bounds.minX) / xRange - 0.5) * 28,
    (0.5 - (node.y - bounds.minY) / yRange) * 18,
    node.type === 'title' ? 1.2 : node.type === 'topic' ? 0.35 : node.type === 'section' ? -0.35 : -0.8,
  ])
}

/** Dioramas-inspired WebGL knowledge map: the roadmap data itself remains authoritative. */
export function RoadmapDiorama({ roadmap, focusTopicId, completedTopicIds, currentLesson, onContinue, onBack, className }: RoadmapDioramaProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRootRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef(new Map<string, HTMLButtonElement>())
  const controlsRef = useRef<{ reset: () => void } | null>(null)
  const [selectedId, setSelectedId] = useState(focusTopicId)
  const [query, setQuery] = useState('')
  const [webglError, setWebglError] = useState('')
  const contentNodes = useMemo(() => contentNodesForVisual(roadmap), [roadmap])
  const nodesById = useMemo(() => new Map(roadmap.nodes.map((node) => [node.id, node])), [roadmap.nodes])
  const focusNode = nodesById.get(focusTopicId) ?? contentNodes[0] ?? null
  const selectedNode = nodesById.get(selectedId) ?? focusNode
  const completed = useMemo(() => new Set(completedTopicIds), [completedTopicIds])
  const neighborhood = useMemo(
    () => selectedNode ? topicNeighborhood(roadmap, selectedNode.id) : null,
    [roadmap, selectedNode],
  )
  const bounds = useMemo(() => {
    const xs = contentNodes.map((node) => node.x).filter(Number.isFinite)
    const ys = contentNodes.map((node) => node.y).filter(Number.isFinite)
    return {
      minX: Math.min(...xs, 0), maxX: Math.max(...xs, 1),
      minY: Math.min(...ys, 0), maxY: Math.max(...ys, 1),
    }
  }, [contentNodes])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = sceneRootRef.current
    if (!canvas || !container || contentNodes.length === 0) return
    let cancelled = false
    let cleanup: (() => void) | null = null

    void Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
    ]).then(([THREE, controlsModule]) => {
      if (cancelled) return
      let renderer: InstanceType<typeof THREE.WebGLRenderer>
      try {
        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
      } catch {
        setWebglError('This browser could not start WebGL. Use the searchable topic list below.')
        return
      }
      setWebglError('')
      const scene = new THREE.Scene()
      scene.background = new THREE.Color('#08111f')
      scene.fog = new THREE.FogExp2('#08111f', 0.012)
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 140)
      camera.position.set(0, 0, 32)
      const controls = new controlsModule.OrbitControls(camera, renderer.domElement)
      controlsRef.current = controls
      controls.enableDamping = true
      controls.dampingFactor = 0.065
      controls.enablePan = true
      controls.minDistance = 12
      controls.maxDistance = 65
      controls.target.set(0, 0, 0)

      scene.add(new THREE.AmbientLight('#c5d9ff', 1.35))
      const keyLight = new THREE.PointLight('#7dd3fc', 85, 70)
      keyLight.position.set(-8, 10, 18)
      scene.add(keyLight)
      const fillLight = new THREE.PointLight('#a78bfa', 55, 55)
      fillLight.position.set(12, -8, -5)
      scene.add(fillLight)

      const starGeometry = new THREE.BufferGeometry()
      const disposableGeometries: Array<InstanceType<typeof THREE.BufferGeometry>> = [starGeometry]
      const disposableMaterials: Array<InstanceType<typeof THREE.Material>> = []
      const starPositions = new Float32Array(420 * 3)
      for (let i = 0; i < starPositions.length; i += 3) {
        starPositions[i] = (Math.random() - 0.5) * 100
        starPositions[i + 1] = (Math.random() - 0.5) * 70
        starPositions[i + 2] = -20 - Math.random() * 35
      }
      starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
      const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#8295b5', size: 0.08, transparent: true, opacity: 0.5 }))
      scene.add(stars)

      const nodeMeshes = new Map<string, InstanceType<typeof THREE.Mesh>>()
      const sphere = new THREE.SphereGeometry(1, 18, 14)
      for (const node of contentNodes) {
        const color = completed.has(node.id) ? '#22c55e' : node.id === focusTopicId ? '#fb923c' : nodeColor(node.type)
        const material = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: node.id === focusTopicId ? 0.72 : 0.32,
          roughness: 0.3,
          metalness: 0.18,
        })
        disposableMaterials.push(material)
        const mesh = new THREE.Mesh(sphere, material)
        const [x, y, z] = topicPosition(node, bounds)
        mesh.position.set(x, y, z)
        mesh.scale.setScalar(node.type === 'title' ? 0.5 : node.type === 'topic' ? 0.34 : node.type === 'subtopic' ? 0.23 : 0.17)
        mesh.userData.nodeId = node.id
        scene.add(mesh)
        nodeMeshes.set(node.id, mesh)
      }

      const byId = new Map(contentNodes.map((node) => [node.id, node]))
      for (const edge of roadmap.edges) {
        const from = byId.get(edge.from)
        const to = byId.get(edge.to)
        if (!from || !to) continue
        const start = topicPosition(from, bounds)
        const end = topicPosition(to, bounds)
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(start[0], start[1], start[2]),
          new THREE.Vector3((start[0] + end[0]) / 2, (start[1] + end[1]) / 2 + 0.28, Math.max(start[2], end[2]) + 1.15),
          new THREE.Vector3(end[0], end[1], end[2]),
        )
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(14))
        const lineMaterial = new THREE.LineBasicMaterial({ color: edge.style === 'dashed' ? '#64748b' : '#38bdf8', transparent: true, opacity: edge.style === 'dashed' ? 0.35 : 0.55 })
        disposableGeometries.push(lineGeometry)
        disposableMaterials.push(lineMaterial)
        const line = new THREE.Line(lineGeometry, lineMaterial)
        scene.add(line)
      }

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const onClick = (event: MouseEvent) => {
        const rect = renderer.domElement.getBoundingClientRect()
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
        const hit = raycaster.intersectObjects([...nodeMeshes.values()], false)[0]
        if (hit?.object.userData.nodeId) setSelectedId(String(hit.object.userData.nodeId))
      }
      renderer.domElement.addEventListener('click', onClick)

      let frame = 0
      const render = () => {
        frame = window.requestAnimationFrame(render)
        controls.update()
        renderer.render(scene, camera)
        const width = container.clientWidth
        const height = container.clientHeight
        for (const node of contentNodes) {
          const label = labelRefs.current.get(node.id)
          const mesh = nodeMeshes.get(node.id)
          if (!label || !mesh || width === 0 || height === 0) continue
          const projected = mesh.position.clone().project(camera)
          const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.04 && Math.abs(projected.y) < 1.08
          label.style.visibility = visible ? 'visible' : 'hidden'
          if (!visible) continue
          const px = ((projected.x + 1) / 2) * width
          const py = ((1 - projected.y) / 2) * height
          const scale = node.id === focusTopicId ? 1 : 0.86
          label.style.transform = `translate(-50%, -50%) translate(${px}px, ${py}px) scale(${scale})`
        }
      }
      const resize = () => {
        const width = Math.max(1, container.clientWidth)
        const height = Math.max(1, container.clientHeight)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(container)
      resize()
      render()

      cleanup = () => {
        window.cancelAnimationFrame(frame)
        observer.disconnect()
        renderer.domElement.removeEventListener('click', onClick)
        controls.dispose()
        sphere.dispose()
        for (const geometry of disposableGeometries) geometry.dispose()
        for (const material of disposableMaterials) material.dispose()
        controlsRef.current = null
        renderer.dispose()
      }
    }).catch(() => setWebglError('The 3D roadmap scene could not load. Use the searchable topic list below.'))

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [roadmap, contentNodes, bounds, focusTopicId, completed])

  const filteredNodes = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? contentNodes.filter((node) => node.label.toLowerCase().includes(q)) : []
  }, [contentNodes, query])

  function resetCamera() {
    controlsRef.current?.reset()
    setSelectedId(focusTopicId)
  }

  const neighborList = (items: RoadmapNode[] | undefined) => items?.length ? items.map((node) => node.label).join(' · ') : 'No direct links listed in this roadmap.'

  return (
    <section className={className} data-testid="roadmap-diorama" aria-label={`${roadmap.title} interactive roadmap visualization`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Dioramas topic map</p>
          <p className="text-[10px] text-muted-foreground">Drag to orbit · scroll to zoom · select a label or topic · {contentNodes.length} mapped topics</p>
        </div>
        <Button variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={resetCamera}>
          <RotateCcw className="size-3" /> Focus current
        </Button>
      </div>

      <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div ref={sceneRootRef} className="relative h-[min(52vh,30rem)] min-h-64 overflow-hidden rounded-xl border border-sky-300/20 bg-[#08111f] shadow-inner" data-testid="roadmap-diorama-scene">
          <canvas ref={canvasRef} className="absolute inset-0 size-full cursor-grab active:cursor-grabbing" aria-label="Interactive 3D roadmap graph" />
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {contentNodes.map((node) => {
              const active = node.id === focusTopicId
              const done = completed.has(node.id)
              return (
                <button
                  key={node.id}
                  ref={(element) => { if (element) labelRefs.current.set(node.id, element); else labelRefs.current.delete(node.id) }}
                  type="button"
                  className={`pointer-events-auto absolute left-0 top-0 max-w-40 truncate rounded-full border px-1.5 py-0.5 text-[9px] leading-tight shadow-lg backdrop-blur-sm transition-colors ${active ? 'border-orange-300/70 bg-orange-400/20 text-orange-50' : done ? 'border-emerald-300/50 bg-emerald-500/15 text-emerald-100' : 'border-slate-400/30 bg-slate-900/75 text-slate-100 hover:border-sky-200/80'}`}
                  title={`${node.type}: ${node.label}`}
                  onClick={(event) => { event.stopPropagation(); setSelectedId(node.id) }}
                  aria-pressed={selectedNode?.id === node.id}
                  data-roadmap-node-label={node.id}
                >
                  {node.label}
                </button>
              )
            })}
          </div>
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5 text-[9px] text-slate-200">
            <span className="rounded-full border border-orange-300/50 bg-slate-950/75 px-2 py-1">Current topic</span>
            <span className="rounded-full border border-emerald-300/50 bg-slate-950/75 px-2 py-1">Completed</span>
            <span className="rounded-full border border-violet-300/40 bg-slate-950/75 px-2 py-1">Related topic</span>
          </div>
          {webglError ? <p className="absolute right-2 top-2 max-w-56 rounded-md bg-slate-950/80 p-2 text-[10px] text-amber-100">{webglError}</p> : null}
        </div>

        <aside className="flex min-h-64 flex-col rounded-xl border bg-card p-3">
          <label htmlFor="roadmap-topic-search" className="mb-1 text-[10px] font-medium">Find a topic</label>
          <div className="flex items-center gap-1 rounded-md border px-2">
            <Search className="size-3 text-muted-foreground" />
            <input id="roadmap-topic-search" value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none" placeholder="Search all roadmap topics" />
          </div>
          {query ? (
            <div className="hub-scroll mt-2 max-h-24 space-y-1 overflow-auto">
              {filteredNodes.map((node) => <button key={node.id} type="button" onClick={() => setSelectedId(node.id)} className="block w-full truncate rounded px-2 py-1 text-left text-[10px] hover:bg-secondary" data-roadmap-topic-result={node.id}>{node.label}</button>)}
              {!filteredNodes.length ? <p className="px-2 py-1 text-[10px] text-muted-foreground">No matching topic.</p> : null}
            </div>
          ) : null}
          <div className="mt-3 min-h-0 flex-1 overflow-auto">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Selected topic · {selectedNode?.type ?? 'topic'}</p>
            <h3 className="mt-1 text-sm font-semibold leading-snug">{selectedNode?.label ?? 'Select a node'}</h3>
            {selectedNode?.id === focusTopicId ? <span className="mt-1 inline-flex rounded-full bg-orange-500/10 px-2 py-0.5 text-[9px] text-orange-700 dark:text-orange-300">Current lesson</span> : null}
            <div className="mt-3 space-y-2 text-[10px] leading-relaxed">
              <p><span className="font-semibold">Prerequisites / incoming links:</span><br />{neighborList(neighborhood?.prerequisites)}</p>
              <p><span className="font-semibold">Next / outgoing links:</span><br />{neighborList(neighborhood?.next)}</p>
            </div>
            {currentLesson && selectedNode?.id === focusTopicId ? (
              <details className="mt-3 rounded-md border p-2" open data-testid="roadmap-topic-guide">
                <summary className="cursor-pointer text-[10px] font-semibold">Current topic guide · what to do and avoid</summary>
                <div className="mt-2 text-[10px] leading-relaxed"><FeedbackMarkdown text={currentLesson} /></div>
              </details>
            ) : null}
            <details className="mt-3">
              <summary className="cursor-pointer text-[10px] font-medium">All {contentNodes.length} roadmap topics</summary>
              <div className="hub-scroll mt-1 max-h-36 space-y-0.5 overflow-auto">
                {contentNodes.map((node) => <button key={node.id} type="button" onClick={() => setSelectedId(node.id)} className={`block w-full truncate rounded px-2 py-1 text-left text-[10px] hover:bg-secondary ${node.id === focusTopicId ? 'font-semibold text-orange-600 dark:text-orange-300' : ''}`}>{completed.has(node.id) ? '✓ ' : ''}{node.label}</button>)}
              </div>
            </details>
          </div>
        </aside>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onBack}>Back to lesson</Button>
        <Button size="sm" className="h-8 text-xs" onClick={onContinue} data-testid="roadmap-continue-topic">Continue to next topic</Button>
      </div>
    </section>
  )
}
