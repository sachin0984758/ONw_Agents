// Download the public roadmap.sh diagram data for this user's private local use.
// The source license forbids redistributing its content, so output stays under
// ignored db/roadmaps and must not be committed or published.
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveDbDir } from '../src/lib/agent-hub/db-path.ts'

const output = path.join(resolveDbDir(), 'roadmaps')
const source = 'https://roadmap.sh'

async function loadRoute(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'AgentHub personal roadmap reference cache' } })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const html = await response.text()
  const match = html.match(/streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/)
  if (!match) throw new Error(`Could not read roadmap data from ${url}`)
  const table = JSON.parse(JSON.parse(match[1]))
  const decoded = new Map()
  function read(index) {
    if (typeof index !== 'number' || index < 0) return index
    if (decoded.has(index)) return decoded.get(index)
    const value = table[index]
    if (Array.isArray(value)) {
      const result = []
      decoded.set(index, result)
      for (const item of value) result.push(typeof item === 'number' ? read(item) : item)
      return result
    }
    if (value && typeof value === 'object') {
      const result = {}
      decoded.set(index, result)
      for (const [key, item] of Object.entries(value)) result[read(Number(key.slice(1)))] = read(item)
      return result
    }
    decoded.set(index, value)
    return value
  }
  const root = read(0)
  const loader = Object.values(root.loaderData ?? {}).find((value) => value?.roadmap)
  if (!loader?.roadmap || !Array.isArray(loader.officialRoadmaps)) throw new Error(`Roadmap data missing from ${url}`)
  return loader
}

function normalizeRoadmap(roadmap) {
  const nodes = (roadmap.nodes ?? []).flatMap((node) => {
    if (!node?.id || !node.type) return []
    const data = node.data ?? {}
    return [{
      id: node.id,
      type: node.type,
      label: typeof data.label === 'string' ? data.label : '',
      x: Number.isFinite(node.position?.x) ? node.position.x : 0,
      y: Number.isFinite(node.position?.y) ? node.position.y : 0,
      href: typeof data.href === 'string' ? data.href : '',
    }]
  })
  const edges = (roadmap.edges ?? []).flatMap((edge) =>
    edge?.source && edge?.target
      ? [{ from: edge.source, to: edge.target, style: edge.data?.edgeStyle === 'dashed' ? 'dashed' : 'solid' }]
      : [],
  )
  return { slug: roadmap.slug, title: roadmap.title?.card ?? roadmap.slug, description: roadmap.description ?? '', nodes, edges }
}

await fs.mkdir(output, { recursive: true })
const indexPage = await loadRoute(`${source}/python`)
const catalog = indexPage.officialRoadmaps
  .filter((roadmap) => roadmap.status === 'published' && roadmap.slug)
  .map((roadmap) => ({ slug: roadmap.slug, title: roadmap.title?.card ?? roadmap.slug, description: roadmap.description ?? '' }))

const queue = [...catalog]
const failures = []
let completed = 0
await Promise.all(Array.from({ length: 5 }, async () => {
  while (queue.length) {
    const item = queue.shift()
    try {
      const page = await loadRoute(`${source}/${encodeURIComponent(item.slug)}`)
      const roadmap = normalizeRoadmap(page.roadmap)
      if (roadmap.nodes.length === 0) throw new Error('Roadmap has no diagram nodes')
      await fs.writeFile(path.join(output, `${item.slug}.json`), `${JSON.stringify(roadmap)}\n`, 'utf8')
      completed += 1
      console.log(`[${completed}/${catalog.length}] ${item.title}: ${roadmap.nodes.length} nodes, ${roadmap.edges.length} links`)
    } catch (error) {
      failures.push({ slug: item.slug, message: error instanceof Error ? error.message : String(error) })
    }
  }
}))

await fs.writeFile(path.join(output, 'index.json'), `${JSON.stringify({
  source,
  fetchedAt: new Date().toISOString(),
  license: 'Personal local use only. roadmap.sh content is copyrighted; do not redistribute or publish this cache.',
  roadmaps: catalog,
  failures,
}, null, 2)}\n`, 'utf8')
if (failures.length) {
  console.error(`${failures.length} roadmaps could not be refreshed; see db/roadmaps/index.json.`)
  process.exitCode = 1
} else {
  console.log(`Saved ${completed} personal-use roadmap diagrams to ${output}`)
}
