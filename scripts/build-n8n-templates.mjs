// ─── One-off n8n template importer ───────────────────────────────────────────
// Reads raw responses from n8n's OFFICIAL template API out of tmp-n8n/official/
// and emits two things:
//   src/lib/agent-hub/n8n-templates.ts  — compact graph metadata for the UI
//   public/n8n-templates/<id>.json      — the untouched n8n export, so any
//                                         template can be imported into a real
//                                         n8n instance unchanged
//
// Why the official API and not a GitHub mirror: scraped mirrors (Zie619,
// wassupjay, awesome-n8n-templates) strip the real data-flow connections and
// leave only dangling error-handler links — every one of them produced 0
// resolvable edges across 70+ sampled files. The official API keeps them.
//
// Fetch step (PowerShell):
//   $s = Invoke-RestMethod 'https://api.n8n.io/api/templates/search/?rows=24'
//   $ids = $s.workflows | ForEach-Object { "$($_.id)" }
//   foreach ($id in $ids) {
//     Invoke-WebRequest "https://api.n8n.io/templates/workflows/$id" `
//       -OutFile "tmp-n8n/official/$id.json" -UseBasicParsing
//   }
//
// Then: node scripts/build-n8n-templates.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const RAW = join(ROOT, 'tmp-n8n', 'official')
const OUT_DIR = join(ROOT, 'public', 'n8n-templates')

// Annotation-only / pass-through nodes that carry no graph value.
const SKIP = new Set(['stickyNote', 'noOp'])

const LOGIC_RE = /^(if|switch|merge|filter|aggregate|sort|limit|removeDuplicates|splitOut|splitInBatches|wait|itemLists|summarize|compareDatasets)$/

function shortType(t) {
  return String(t)
    .replace(/^n8n-nodes-base\./, '')
    .replace(/^@n8n\/n8n-nodes-langchain\./, 'lc:')
}

function kindOf(t) {
  if (/Trigger$/.test(t)) return 'trigger'
  if (t === 'n8n-nodes-base.webhook') return 'webhook'
  if (t === 'n8n-nodes-base.manualTrigger') return 'trigger'
  if (t === 'n8n-nodes-base.cron' || t === 'n8n-nodes-base.interval') return 'trigger'
  if (LOGIC_RE.test(shortType(t))) return 'logic'
  return 'action'
}

const files = readdirSync(RAW).filter((f) => f.endsWith('.json')).sort()
mkdirSync(OUT_DIR, { recursive: true })

const templates = []
let copied = 0

for (const file of files) {
  const n8nId = file.replace(/\.json$/, '')

  let wf
  try {
    const parsed = JSON.parse(readFileSync(join(RAW, file), 'utf8'))
    // The official API double-wraps: { workflow: { workflow: {...} } }
    wf = parsed?.workflow?.workflow ?? parsed?.workflow ?? parsed
  } catch {
    console.warn('skip (bad json):', file)
    continue
  }

  const allNodes = Array.isArray(wf.nodes) ? wf.nodes : []
  const conns = wf.connections && typeof wf.connections === 'object' ? wf.connections : {}

  // Drop annotation nodes; remember how many we dropped.
  const kept = allNodes.filter((n) => n && typeof n.name === 'string' && !SKIP.has(shortType(n.type ?? '')))
  if (kept.length === 0) {
    console.warn('skip (no renderable nodes):', file)
    continue
  }

  // Bounding box over kept positions -> normalize into 6..94 percent.
  const pos = kept.map((n) => (Array.isArray(n.position) && n.position.length === 2 ? n.position : [0, 0]))
  const xs = pos.map((p) => Number(p[0]) || 0)
  const ys = pos.map((p) => Number(p[1]) || 0)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const norm = (v, min, span) => Math.round((6 + ((v - min) / span) * 88) * 10) / 10

  const outNodes = kept.map((n, i) => {
    const t = shortType(n.type ?? 'noOp')
    return {
      id: `n${i}`,
      title: String(n.name ?? t).slice(0, 60),
      service: t.slice(0, 24),
      kind: kindOf(n.type ?? ''),
      x: norm(xs[i], minX, spanX),
      y: norm(ys[i], minY, spanY),
    }
  })

  // Official API keys `connections` by node NAME, one level shallower than a
  // real n8n export: { "<name>": { main: [ [ {node:"<target name>"} ] ] } }
  const nameMap = new Map(kept.map((n, i) => [String(n.name), `n${i}`]))
  const outEdges = []
  const seen = new Set()
  for (const [fromName, outs] of Object.entries(conns)) {
    const from = nameMap.get(fromName)
    if (!from || !outs || typeof outs !== 'object') continue
    const main = Array.isArray(outs.main) ? outs.main : Object.values(outs).find(Array.isArray)
    if (!Array.isArray(main)) continue
    for (const branch of main) {
      if (!Array.isArray(branch)) continue
      for (const link of branch) {
        const target = link && typeof link.node === 'string' ? nameMap.get(link.node) : undefined
        if (!target || target === from) continue
        const key = `${from}>${target}`
        if (seen.has(key)) continue
        seen.add(key)
        outEdges.push({ from, to: target })
      }
    }
  }

  const services = [...new Set(outNodes.map((n) => n.service))].sort()
  const triggers = [...new Set(outNodes.filter((n) => n.kind === 'trigger' || n.kind === 'webhook').map((n) => n.service))]
  const settings = wf.settings && typeof wf.settings === 'object' ? wf.settings : {}

  // Re-read the wrapper for human metadata (description, category, author).
  let meta = {}
  try {
    meta = JSON.parse(readFileSync(join(RAW, file), 'utf8'))?.workflow ?? {}
  } catch {
    meta = {}
  }
  const categories = Array.isArray(meta.categories)
    ? meta.categories.map((c) => String(c?.name ?? c)).filter(Boolean)
    : []
  const category = categories[0] ?? 'Other'
  const description = typeof meta.description === 'string' ? meta.description : ''
  const author = meta.user && typeof meta.user === 'object' ? String(meta.user.name ?? meta.user.username ?? '') : ''

  templates.push({
    id: `n8n-${n8nId}`,
    name: String(wf.name ?? `Template ${n8nId}`).slice(0, 90),
    category,
    services,
    triggers,
    nodeCount: outNodes.length,
    edgeCount: outEdges.length,
    noteCount: allNodes.length - kept.length,
    complexity: outNodes.length <= 5 ? 'Low' : outNodes.length <= 12 ? 'Medium' : 'High',
    trigger: triggers[0] ?? (outNodes.some((n) => n.kind === 'webhook') ? 'webhook' : 'manual'),
    timezone: typeof settings.timezone === 'string' ? settings.timezone : 'UTC',
    active: wf.active === true,
    description: description.replace(/\s+/g, ' ').slice(0, 400),
    author,
    jsonUrl: `/n8n-templates/${n8nId}.json`,
    sourceUrl: `https://n8n.io/workflows/${n8nId}`,
    nodes: outNodes,
    edges: outEdges,
  })

  // Ship the real n8n export so it imports into n8n unchanged.
  writeFileSync(join(OUT_DIR, `${n8nId}.json`), JSON.stringify(wf))
  copied++
}

const header = `// ─── n8n workflow templates (GENERATED — do not edit by hand) ─────────────
// ${templates.length} real workflows from n8n's official template gallery
// (https://n8n.io/workflows). The untouched n8n JSON for every template is
// served from public/n8n-templates/ at \`jsonUrl\`, so each one can be imported
// into a real n8n instance as-is. \`sourceUrl\` links to its gallery page.
// Regenerate with: node scripts/build-n8n-templates.mjs
// ─────────────────────────────────────────────────────────────────────────────
`
const body = `import type { N8nTemplate } from './types'

export const N8N_TEMPLATES: N8nTemplate[] = ${JSON.stringify(templates)}

export const N8N_CATEGORIES: string[] = ${JSON.stringify([...new Set(templates.map((t) => t.category))].sort())}

export const N8N_SOURCE_REPO = 'https://n8n.io/workflows'
`

writeFileSync(join(ROOT, 'src', 'lib', 'agent-hub', 'n8n-templates.ts'), header + body)

const totNodes = templates.reduce((a, t) => a + t.nodeCount, 0)
const totEdges = templates.reduce((a, t) => a + t.edgeCount, 0)
console.log(`templates=${templates.length} nodes=${totNodes} edges=${totEdges} copied=${copied}`)
console.log(`templates with 0 edges: ${templates.filter((t) => t.edgeCount === 0).length}`)
