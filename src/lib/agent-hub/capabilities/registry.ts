import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from '../db-path'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import { SESSION_AGENTS } from '../session/agents'
import { SESSION_TOOLS } from '../session/tools'
import { CAPABILITY_PACK_VERSION, type CapabilityPackManifest, type CapabilityPackState, type InstalledCapabilityPack } from './types'

const registryFile = path.join(DB_DIR, 'capability-packs.json')
const shared = globalThis as typeof globalThis & { agentHubCapabilitySerializer?: ReturnType<typeof createSerializer> }
const serialize = shared.agentHubCapabilitySerializer ??= createSerializer()
const AGENT_IDS = new Set<string>(SESSION_AGENTS.map((agent) => agent.id))
const TOOL_IDS = new Set<string>(SESSION_TOOLS.map((tool) => tool.name))
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const BUILTINS: CapabilityPackManifest[] = [
  {
    id: 'obsidian-memory', version: '1.0.0', name: 'Obsidian Memory', category: 'memory',
    description: 'Search real local vault notes and retrieve source-backed memory. New memories require explicit review before saving.',
    keywords: ['obsidian', 'memory', 'notes', 'vault'], capabilities: ['local-note-search', 'linked-notes', 'reviewed-memory'],
    skills: [], tools: ['search_memory', 'list_memory_files', 'read_memory', 'propose_memory'], templates: [], components: [], dependencies: [], platforms: ['any'],
    compatibleAgents: ['website', 'game', 'research', 'other'], modelRequirements: ['local-chat'], requiredPermissions: ['connected-vault', 'review-memory-writes'], license: null, source: { kind: 'builtin' },
  },
  {
    id: 'website-builder', version: '1.1.0', name: 'Website Builder', category: 'website',
    description: 'Design clear user flows, responsive interfaces and accessible states; reuse reviewed local components and verify the result with available evidence.',
    keywords: ['website', 'web app', 'portfolio', 'landing page', 'component', 'interface', 'ui', 'ux', 'design', 'layout', 'accessibility'],
    capabilities: ['component-search', 'component-inspection', 'reviewed-component-install', 'responsive-design', 'accessibility-review', 'visual-verification-guidance'], skills: [],
    tools: ['search_ui_components', 'read_ui_component', 'propose_ui_component', 'list_files', 'read_file', 'write_file', 'edit_file'],
    templates: ['website-template-library'], components: ['local-ui-component-marketplace'], dependencies: [], platforms: ['any'],
    compatibleAgents: ['website'], modelRequirements: ['chat'], requiredPermissions: ['selected-workspace', 'approve-file-mutations'],
    license: null, source: { kind: 'builtin' },
  },
  {
    id: 'coding-workflows', version: '1.0.0', name: 'Coding Workflows', category: 'development',
    description: 'Inspect a selected repository, make approval-gated edits, run approved commands and verify observed results.',
    keywords: ['code', 'coding', 'debug', 'bug', 'test', 'typescript', 'python', 'repository', 'refactor'],
    capabilities: ['repository-inspection', 'approval-gated-edits', 'approved-command-execution', 'verification'], skills: [],
    tools: ['workspace_info', 'list_files', 'read_file', 'search', 'write_file', 'edit_file', 'delete_file', 'plan'],
    templates: [], components: [], dependencies: [], platforms: ['any'], compatibleAgents: ['website', 'game', 'research', 'other'],
    modelRequirements: ['chat'], requiredPermissions: ['selected-workspace', 'approve-file-mutations', 'approve-commands'],
    license: null, source: { kind: 'builtin' },
  },
  {
    id: 'game-development', version: '1.0.0', name: 'Game Development', category: 'games',
    description: 'Use the installed Skills Library and existing project structure to guide game-specific implementation.',
    keywords: ['game', 'gameplay', 'physics', 'three.js', 'godot', 'unity', 'pygame', 'racing'],
    capabilities: ['engine-detection', 'game-skill-routing', 'approved-project-edits'], skills: [],
    tools: ['workspace_info', 'list_files', 'read_file', 'search', 'activate_skill', 'write_file', 'edit_file', 'plan'],
    templates: [], components: [], dependencies: [], platforms: ['any'], compatibleAgents: ['game'],
    modelRequirements: ['chat'], requiredPermissions: ['selected-workspace', 'approve-file-mutations', 'approve-commands'],
    license: null, source: { kind: 'builtin' },
  },
  {
    id: 'research-workflows', version: '1.0.0', name: 'Research Workflows', category: 'research',
    description: 'Search selected project files and report evidence with source paths. External web research is not included in this pack.',
    keywords: ['research', 'compare', 'evidence', 'findings', 'audit', 'inspect'],
    capabilities: ['workspace-search', 'evidence-reporting'], skills: [],
    tools: ['workspace_info', 'list_files', 'count_files', 'read_file', 'search', 'plan'],
    templates: [], components: [], dependencies: [], platforms: ['any'], compatibleAgents: ['research'],
    modelRequirements: ['chat'], requiredPermissions: ['selected-workspace-read'], license: null, source: { kind: 'builtin' },
  },
  {
    id: 'general-tasks', version: '1.0.0', name: 'General Tasks', category: 'productivity',
    description: 'Plan local workspace tasks and carry out explicitly approved file operations through AgentHub tools.',
    keywords: ['organize', 'file', 'folder', 'task', 'general', 'document'],
    capabilities: ['workspace-organization', 'approval-gated-file-operations'], skills: [],
    tools: ['workspace_info', 'list_files', 'count_files', 'read_file', 'write_file', 'edit_file', 'delete_file', 'plan'],
    templates: [], components: [], dependencies: [], platforms: ['any'], compatibleAgents: ['other'],
    modelRequirements: ['chat'], requiredPermissions: ['selected-workspace', 'approve-file-mutations'], license: null, source: { kind: 'builtin' },
  },
  {
    id: 'teaching', version: '1.0.0', name: 'Teaching', category: 'learning',
    description: 'Provide structured explanations and practice using the existing Teaching Agent and learning bank.',
    keywords: ['teach', 'learn', 'lesson', 'explain', 'practice', 'quiz', 'roadmap'],
    capabilities: ['structured-teaching', 'practice'], skills: [],
    tools: ['plan', 'activate_skill', 'workspace_info', 'list_files', 'read_file', 'search'],
    templates: ['existing-teaching-framework', 'roadmap-library'], components: [], dependencies: [], platforms: ['any'],
    compatibleAgents: ['other'], modelRequirements: ['chat'], requiredPermissions: ['selected-workspace-read'], license: null, source: { kind: 'builtin' },
  },
]

export function validateCapabilityManifest(value: unknown): CapabilityPackManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Capability manifest must be an object.')
  const v = value as Record<string, unknown>
  const str = (key: string, max: number, required = true) => {
    const item = v[key]
    if (typeof item !== 'string' || item.length > max || (required && !item.trim())) throw new Error(`Invalid capability manifest field: ${key}.`)
    return item.trim()
  }
  const list = (key: string, allowed?: Set<string>): string[] => {
    const item = v[key]
    if (!Array.isArray(item) || item.length > 100 || item.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > 128 || (allowed && !allowed.has(entry)))) throw new Error(`Invalid or unsupported capability manifest list: ${key}.`)
    return [...new Set(item.map((entry: string) => entry.trim()))]
  }
  const id = str('id', 64)
  const version = str('version', 64)
  if (!ID.test(id) || !SEMVER.test(version)) throw new Error('Manifest id must be a stable lowercase slug and version must be semantic versioning.')
  if (v.source && typeof v.source === 'object' && (v.source as Record<string, unknown>).kind === 'builtin') throw new Error('Built-in capability packs cannot be imported or replaced.')
  const sourceValue = v.source && typeof v.source === 'object' ? v.source as Record<string, unknown> : {}
  const sourceKind = sourceValue.kind === 'registry' ? 'registry' : sourceValue.kind === 'local' ? 'local' : null
  if (!sourceKind) throw new Error('Imported capability packs need local or registry provenance.')
  let sourceUrl: string | undefined
  if (sourceValue.url !== undefined) {
    if (typeof sourceValue.url !== 'string' || sourceValue.url.length > 2048) throw new Error('Invalid capability source URL.')
    const parsed = new URL(sourceValue.url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) throw new Error('Registry sources must use HTTPS without credentials or custom ports.')
    sourceUrl = parsed.href
  }
  const dependencies = v.dependencies === undefined ? [] : v.dependencies
  if (!Array.isArray(dependencies) || dependencies.length > 50 || dependencies.some((dep) => !dep || typeof dep !== 'object' || typeof dep.id !== 'string' || !ID.test(dep.id) || (dep.optional !== undefined && typeof dep.optional !== 'boolean'))) throw new Error('Invalid capability dependencies.')
  const platforms = list('platforms')
  if (platforms.some((entry) => !['win32', 'darwin', 'linux', 'any'].includes(entry))) throw new Error('Unsupported platform in capability manifest.')
  if (dependencies.some((dep: { id: string }) => dep.id === id)) throw new Error('A capability pack cannot depend on itself.')
  const license = v.license === undefined || v.license === null ? null : str('license', 100)
  return {
    id, version, name: str('name', 120), description: str('description', 2000), category: str('category', 80),
    keywords: list('keywords'), capabilities: list('capabilities'), skills: list('skills'), tools: list('tools', TOOL_IDS),
    templates: list('templates'), components: list('components'), dependencies: dependencies.map((dep: { id: string; optional?: boolean }) => ({ id: dep.id, ...(dep.optional ? { optional: true } : {}) })),
    platforms: platforms as CapabilityPackManifest['platforms'], compatibleAgents: list('compatibleAgents', AGENT_IDS), modelRequirements: list('modelRequirements'),
    requiredPermissions: list('requiredPermissions'), license,
    source: { kind: sourceKind, ...(sourceUrl ? { url: sourceUrl } : {}) },
  }
}

function defaultRecord(manifest: CapabilityPackManifest): InstalledCapabilityPack {
  return { ...manifest, installed: false, enabled: false, assignedAgents: [], health: 'ready' }
}

function normalizeSaved(value: unknown): InstalledCapabilityPack[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    try {
      if (!entry || typeof entry !== 'object' || typeof entry.installed !== 'boolean' || typeof entry.enabled !== 'boolean' || !Array.isArray(entry.assignedAgents)) return []
      const sourceKind = entry.source?.kind
      const manifest = validateCapabilityManifest(sourceKind === 'builtin' ? { ...entry, source: { kind: 'local' } } : entry)
      if (sourceKind === 'builtin' && !BUILTINS.some((builtin) => builtin.id === manifest.id)) return []
      return [{ ...manifest, installed: entry.installed, enabled: entry.installed && entry.enabled, assignedAgents: entry.assignedAgents.filter((id: unknown) => typeof id === 'string' && AGENT_IDS.has(id) && manifest.compatibleAgents.includes(id)), installedAt: typeof entry.installedAt === 'string' ? entry.installedAt : undefined, health: 'needs-review' as const, healthMessage: 'Imported metadata is declarative only; inspect referenced skills, components and permissions before enabling.' }]
    } catch { return [] }
  })
}

export async function readCapabilityPacks(): Promise<InstalledCapabilityPack[]> {
  let saved: InstalledCapabilityPack[] = []
  try {
    const raw = JSON.parse(await fs.readFile(registryFile, 'utf8')) as Partial<CapabilityPackState>
    if (raw.version === CAPABILITY_PACK_VERSION) saved = normalizeSaved(raw.packs)
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Capability registry could not be read; existing data was preserved.') }
  const builtins = BUILTINS.map((manifest) => {
    const stored = saved.find((entry) => entry.id === manifest.id)
    return stored ? { ...manifest, installed: stored.installed, enabled: stored.installed && stored.enabled, assignedAgents: stored.assignedAgents, installedAt: stored.installedAt, health: 'ready' as const } : defaultRecord(manifest)
  })
  return [...builtins, ...saved.filter((entry) => !BUILTINS.some((builtin) => builtin.id === entry.id))]
}

async function savePacks(packs: InstalledCapabilityPack[]): Promise<void> {
  await writeJsonAtomic(registryFile, { version: CAPABILITY_PACK_VERSION, packs: packs.filter((pack) => pack.source.kind !== 'builtin' || pack.installed) })
}

export async function updateCapabilityPack(action: 'install' | 'enable' | 'disable' | 'assign' | 'uninstall' | 'import', input: Record<string, unknown>): Promise<InstalledCapabilityPack[]> {
  return serialize(async () => {
    let packs = await readCapabilityPacks()
    if (action === 'import') {
      const manifest = validateCapabilityManifest(input.manifest)
      if (BUILTINS.some((entry) => entry.id === manifest.id)) throw new Error('A built-in pack already owns this ID.')
      packs = packs.filter((entry) => entry.id !== manifest.id)
      packs.push({ ...manifest, installed: true, enabled: false, assignedAgents: [], installedAt: new Date().toISOString(), health: 'needs-review', healthMessage: 'Imported metadata is declarative only; inspect referenced skills, components and permissions before enabling.' })
    } else {
      const id = typeof input.id === 'string' ? input.id : ''
      const index = packs.findIndex((entry) => entry.id === id)
      if (index < 0) throw new Error('Capability pack not found.')
      const pack = packs[index]
      if (action === 'install') {
        const missing = pack.dependencies.filter((dependency) => !dependency.optional && !packs.some((candidate) => candidate.id === dependency.id && candidate.installed))
        if (missing.length) throw new Error(`Install required capability dependencies first: ${missing.map((dependency) => dependency.id).join(', ')}.`)
        const incompatible = pack.platforms.length && !pack.platforms.includes('any') && !pack.platforms.includes(process.platform as 'win32' | 'darwin' | 'linux')
        if (incompatible) throw new Error(`This pack does not support ${process.platform}.`)
        packs[index] = { ...pack, installed: true, enabled: false, installedAt: new Date().toISOString() }
      }
      if (action === 'enable' || action === 'disable') {
        if (!pack.installed) throw new Error('Install this capability pack before changing its enabled state.')
        packs[index] = { ...pack, enabled: action === 'enable' }
      }
      if (action === 'assign') {
        if (!pack.installed) throw new Error('Install this capability pack before assigning it.')
        const agentId = typeof input.agentId === 'string' ? input.agentId : ''
        if (!AGENT_IDS.has(agentId) || !pack.compatibleAgents.includes(agentId)) throw new Error('This agent is not supported by the selected pack.')
        const assigned = input.assigned !== false
        const assignedAgents = new Set(pack.assignedAgents)
        if (assigned) assignedAgents.add(agentId); else assignedAgents.delete(agentId)
        packs[index] = { ...pack, assignedAgents: [...assignedAgents] }
      }
      if (action === 'uninstall') {
        const dependents = packs.filter((candidate) => candidate.installed && candidate.dependencies.some((dependency) => dependency.id === id && !dependency.optional))
        if (dependents.length) throw new Error(`Cannot uninstall this pack while required by: ${dependents.map((candidate) => candidate.name).join(', ')}.`)
        if (pack.source.kind === 'builtin') packs[index] = { ...pack, installed: false, enabled: false, assignedAgents: [] }
        else packs.splice(index, 1)
      }
    }
    await savePacks(packs)
    return packs
  })
}

export async function capabilityPromptContext(agentId: string, request: string): Promise<string> {
  const lower = request.toLocaleLowerCase()
  const assigned = (await readCapabilityPacks()).filter((pack) => pack.installed && pack.enabled && pack.assignedAgents.includes(agentId))
  const relevant = assigned.filter((pack) => pack.keywords.some((keyword) => lower.includes(keyword.toLocaleLowerCase())))
  if (!relevant.length) return ''
  const design = relevant.some((pack) => pack.id === 'website-builder') ? '\nUI/UX design workflow: inspect the existing interface and identify the primary user task before editing. Preserve the project design language and working interactions. Establish information hierarchy, spacing, typography, readable contrast, and consistent interactive states. Prefer progressive disclosure for setup controls and show useful content immediately. Reuse reviewed local components when suitable. Implement keyboard navigation, visible focus, accessible labels, loading, empty, error and disabled states. Check desktop, tablet and mobile layouts, long content and overflow. When screenshots or image inputs are actually available, inspect the rendered result, compare against the task, and iterate. This pack does not provide a screenshot tool or vision model: never claim visual inspection without actual image evidence; report that limitation and provide the checks that did run. Test the real primary flow and distinguish build success from interaction and visual verification.' : ''
  return `Enabled capability packs relevant to this request:\n${relevant.map((pack) => `- ${pack.name} (${pack.id}@${pack.version}): ${pack.description}\n  Capabilities: ${pack.capabilities.join(', ') || '(none)'}\n  Existing AgentHub tools: ${pack.tools.join(', ') || '(none)'}\n  Existing resources: ${[...pack.skills.map((id) => `skill:${id}`), ...pack.components.map((id) => `component:${id}`), ...pack.templates.map((id) => `template:${id}`)].join(', ') || '(none)'}`).join('\n')}\nThese manifests only route to existing resources. They do not grant permissions or create tools; follow the selected-workspace and per-action approval rules.${design}`
}

export function builtInCapabilityManifest(id: string): CapabilityPackManifest | undefined { return BUILTINS.find((entry) => entry.id === id) }

