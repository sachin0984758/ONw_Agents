import fs from 'node:fs/promises'
import path from 'node:path'
import { DB_DIR } from './db-path'

const ROADMAP_DIR = path.join(DB_DIR, 'roadmaps')
export interface RoadmapSummary { slug: string; title: string; description: string }
export interface RoadmapNode { id: string; type: string; label: string; x: number; y: number; href: string }
export interface RoadmapGraph extends RoadmapSummary { nodes: RoadmapNode[]; edges: Array<{ from: string; to: string; style: string }> }

const VISUAL_NODE_TYPES = new Set(['title', 'topic', 'subtopic', 'section', 'label'])

/** Content nodes shown in the visual map; layout-only spacers and controls stay hidden. */
export function roadmapContentNodes(roadmap: RoadmapGraph): RoadmapNode[] {
  return roadmap.nodes.filter((node) => VISUAL_NODE_TYPES.has(node.type) && node.label.trim())
}

function roadmapOrder(a: RoadmapNode, b: RoadmapNode): number {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id)
}

/** Start at Introduction when present, otherwise at the first content topic in diagram order. */
export function roadmapStartingNode(roadmap: RoadmapGraph): RoadmapNode | null {
  const nodes = roadmapContentNodes(roadmap).sort(roadmapOrder)
  return nodes.find((node) => /^introduction$/i.test(node.label.trim())) ??
    nodes.find((node) => node.type === 'topic') ??
    nodes.find((node) => node.type === 'subtopic') ??
    nodes[0] ?? null
}

/** Match an explicit learner choice to a topic label from this published graph. */
export function roadmapNodeForReply(roadmap: RoadmapGraph, reply: string): RoadmapNode | null {
  const normalizedReply = reply.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()
  if (!normalizedReply) return null
  const replyWords = new Set(normalizedReply.split(/\s+/).filter((word) => word.length > 1))
  const ranked = roadmapContentNodes(roadmap).map((node) => {
    const label = node.label.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()
    const words = label.split(/\s+/).filter((word) => word.length > 1)
    const exact = normalizedReply === label || normalizedReply.includes(label)
    const score = exact ? words.length + 2 : words.filter((word) => replyWords.has(word)).length
    return { node, score, exact }
  }).filter((entry) => entry.score > 0)
  ranked.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || roadmapOrder(a.node, b.node))
  const best = ranked[0]
  if (!best || (!best.exact && best.score < 1)) return null
  if (ranked[1] && ranked[1].score === best.score && ranked[1].exact === best.exact) return null
  return best.node
}

/** Follow a published outgoing edge; fall back to the next diagram topic. */
export function nextRoadmapNode(roadmap: RoadmapGraph, currentId: string): RoadmapNode | null {
  const byId = new Map(roadmapContentNodes(roadmap).map((node) => [node.id, node]))
  const current = byId.get(currentId)
  if (!current) return roadmapStartingNode(roadmap)
  const outgoing = roadmap.edges
    .filter((edge) => edge.from === currentId)
    .map((edge) => byId.get(edge.to))
    .filter((node): node is RoadmapNode => Boolean(node))
    .sort(roadmapOrder)
  if (outgoing.length) return outgoing[0]
  return [...byId.values()].sort(roadmapOrder).find((node) => roadmapOrder(node, current) > 0) ?? null
}

/** Small evidence-based neighborhood for Understand Anything-style topic teaching. */
export function roadmapTopicNeighborhood(roadmap: RoadmapGraph, topicId: string): { current: RoadmapNode | null; prerequisites: RoadmapNode[]; next: RoadmapNode[] } {
  const byId = new Map(roadmap.nodes.map((node) => [node.id, node]))
  const contentIds = new Set(roadmapContentNodes(roadmap).map((node) => node.id))
  const related = (fromId: string, incoming: boolean) => roadmap.edges
    .filter((edge) => (incoming ? edge.to === fromId : edge.from === fromId))
    .map((edge) => byId.get(incoming ? edge.from : edge.to))
    .filter((node): node is RoadmapNode => Boolean(node && contentIds.has(node.id)))
    .sort(roadmapOrder)
  return {
    current: byId.get(topicId) ?? null,
    prerequisites: related(topicId, true),
    next: related(topicId, false),
  }
}

/**
 * Branch choices shown after the Data Analyst introduction are intentionally
 * broader than its immediate diagram edges: learners can start SQL, Excel, or
 * Tableau directly. SQL is a local roadmap switch; the other choices remain
 * topics in this cached graph.
 */
export function roadmapLessonChoices(roadmap: RoadmapGraph, topicId: string): string[] {
  const neighborhood = roadmapTopicNeighborhood(roadmap, topicId)
  if (roadmap.slug === 'data-analyst' && neighborhood.current?.label.toLowerCase() === 'introduction') {
    return ['Learn SQL', 'Excel', 'Tableau'].filter((label) =>
      roadmap.nodes.some((node) => node.label.toLowerCase() === label.toLowerCase()),
    )
  }
  return neighborhood.next.map((node) => node.label)
}

/** Keep model context focused on the selected lesson instead of sending the full diagram. */
export function roadmapLessonContext(roadmap: RoadmapGraph, topicId: string, choices: string[]): string {
  const neighborhood = roadmapTopicNeighborhood(roadmap, topicId)
  const current = neighborhood.current
  if (!current) return `Local roadmap: ${roadmap.title}. The selected topic is missing from the local graph.`
  return [
    `Local roadmap: ${roadmap.title} (${roadmap.slug}). ${roadmap.description}`,
    `Selected graph topic: ${current.label} (${current.type}). Teach this topic only.`,
    `Direct prerequisites: ${neighborhood.prerequisites.map((node) => node.label).join(' · ') || 'none listed'}.`,
    `Choices to offer after this lesson: ${choices.join(' · ') || 'continue to the next linked topic'}.`,
    'The complete roadmap stays in the local graph resolver. Use its cached nodes for branch choices; never send learners to an external roadmap website.',
  ].join('\n')
}

async function readIndex(): Promise<{ roadmaps: RoadmapSummary[]; source: string } | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(ROADMAP_DIR, 'index.json'), 'utf8')) as { roadmaps: RoadmapSummary[]; source: string }
  } catch { return null }
}

export async function listRoadmaps(): Promise<RoadmapSummary[]> {
  const index = await readIndex()
  return (index?.roadmaps ?? []).slice().sort((a, b) => a.title.localeCompare(b.title))
}

export async function resolveRoadmap(slug: string): Promise<{ roadmap: RoadmapGraph; context: string } | null> {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return null
  try {
    const roadmap = JSON.parse(await fs.readFile(path.join(ROADMAP_DIR, `${slug}.json`), 'utf8')) as RoadmapGraph
    const byId = new Map(roadmap.nodes.map((node) => [node.id, node]))
    const ordered = roadmapContentNodes(roadmap).sort(roadmapOrder)
    const contentIds = new Set(ordered.map((node) => node.id))
    const lines = ordered.map((node, i) => `${i + 1}. [${node.type}] ${node.label}`)
    const links = roadmap.edges.flatMap((edge) => {
      const from = byId.get(edge.from); const to = byId.get(edge.to)
      if (!from?.label || !to?.label || !contentIds.has(from.id) || !contentIds.has(to.id)) return []
      return [`${from.label} -> ${to.label}${edge.style === 'dashed' ? ' [dashed]' : ''}`]
    })
    const context = [
      `Local roadmap: ${roadmap.title} (${roadmap.slug}) — ${roadmap.description}`,
      'Use this locally cached graph for topic order and branch choices. Do not provide or request external roadmap URLs.',
      'Diagram nodes, read in visual top-to-bottom then left-to-right order:',
      ...lines,
      'Diagram connections (direction follows the published arrow; dashed lines are dashed):',
      ...links,
    ].join('\n')
    return { roadmap, context }
  } catch { return null }
}

/** Resolve a branch to another locally cached roadmap; never return an external URL. */
export async function roadmapChoiceTarget(currentSlug: string, reply: string): Promise<string | null> {
  const graph = await resolveRoadmap(currentSlug)
  if (!graph || !reply.trim()) return null
  const words = new Set(reply.toLowerCase().match(/[a-z0-9+#]+/g) ?? [])
  const candidates = new Set<string>()
  for (const node of graph.roadmap.nodes) {
    const match = /^https?:\/\/roadmap\.sh\/([a-z0-9-]+)\/?$/i.exec(node.href)
    if (!match || match[1] === currentSlug) continue
    const labels = node.label.toLowerCase().match(/[a-z0-9+#]+/g) ?? []
    const meaningful = labels.filter((word) => !['learn', 'roadmap', 'start', 'visit'].includes(word))
    if (meaningful.some((word) => words.has(word)) || words.has(match[1])) candidates.add(match[1])
  }
  if (candidates.size !== 1) return null
  const target = [...candidates][0]
  return (await resolveRoadmap(target)) ? target : null
}

export function suggestedRoadmapSlug(languageId: string, mode: string): string {
  const exact: Record<string, string> = {
    python: 'python', javascript: 'javascript', typescript: 'typescript', java: 'java',
    cpp: 'cpp', c: 'c', csharp: 'asp-net-core', go: 'go', rust: 'rust', php: 'php',
    html: 'html', css: 'css', sql: 'sql', bash: 'shell-bash', powershell: 'computer-science',
    'excel-formulas': 'data-analyst', json: 'computer-science', yaml: 'devops',
  }
  return exact[languageId] ?? (mode === 'sql' ? 'sql' : mode === 'excel' ? 'data-analyst' : 'computer-science')
}
