import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from '../db-path'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import { normalizeRegistryItem, registryURL, downloadRegistryItem, hashContent } from './registry'
import { COMPONENT_CATEGORIES, type MarketplaceComponent, type MarketplaceState, type StylingPreset } from './types'

const storeFile = path.join(DB_DIR, 'ui-component-marketplace.json')
const shared = globalThis as typeof globalThis & { agentHubMarketplaceSerializer?: ReturnType<typeof createSerializer> }
export const serializeMarketplace = shared.agentHubMarketplaceSerializer ??= createSerializer()
const builtin = (name: string, title: string, category: string, content: string): MarketplaceComponent => ({ ...normalizeRegistryItem({ name, title, description: 'Original, dependency-free AgentHub React component. Review its source, then install into your selected project.', type: 'registry:component', author: 'AgentHub', license: 'MIT', category, tags: ['react', 'tailwind', 'local'], files: [{ path: `${name}.tsx`, content }] }, 'AgentHub originals'), id: `builtin:${name}`, preview: { kind: 'builtin', key: name } })
export const BUILTIN_COMPONENTS: MarketplaceComponent[] = [
  builtin('task-card', 'Task progress card', 'Agent interfaces', `'use client'\nexport default function TaskCard({ title = 'Project checklist', steps = ['Inspect project', 'Implement changes', 'Verify results'], completed = 1 }: { title?: string; steps?: string[]; completed?: number }) {\n  return <section className="border border-zinc-300 bg-white p-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"><h2 className="text-base font-semibold">{title}</h2><ol className="mt-4 space-y-3">{steps.map((step, index) => <li key={step} className="flex items-center gap-3 text-sm"><span aria-label={index < completed ? 'Completed' : 'Pending'} className={index < completed ? 'text-emerald-600' : 'text-zinc-500'}>{index < completed ? '✓' : '○'}</span>{step}</li>)}</ol><p className="mt-4 text-xs text-zinc-500">{completed} of {steps.length} steps completed</p></section>\n}\n`),
  builtin('status-badge', 'Connection status', 'Buttons and controls', `export default function StatusBadge({ status = 'Ready' }: { status?: 'Ready' | 'Connecting' | 'Offline' }) {\n  return <span role="status" className="inline-flex items-center gap-2 border border-current px-3 py-1 text-xs font-medium"><span aria-hidden="true" className={\`size-2 rounded-full \${status === 'Ready' ? 'bg-emerald-500' : status === 'Connecting' ? 'bg-amber-500' : 'bg-zinc-400'}\`} />{status}</span>\n}\n`),
  builtin('chat-input', 'Compact chat composer', 'AI chat interfaces', `'use client'\nimport { useState, type FormEvent } from 'react'\nexport default function ChatInput({ onSend, disabled = false }: { onSend: (message: string) => void; disabled?: boolean }) {\n  const [message, setMessage] = useState('')\n  function submit(event: FormEvent) { event.preventDefault(); if (!disabled && message.trim()) { onSend(message.trim()); setMessage('') } }\n  return <form onSubmit={submit} className="flex items-end gap-3 border border-zinc-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950"><textarea aria-label="Message" value={message} onChange={(event) => setMessage(event.target.value)} disabled={disabled} placeholder="Describe your task…" className="min-h-16 flex-1 resize-y bg-transparent p-2 text-sm outline-none focus:ring-2 focus:ring-violet-500" /><button type="submit" disabled={disabled || !message.trim()} className="bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-40">Send</button></form>\n}\n`),
]
export async function readMarketplace(): Promise<MarketplaceState> {
  let saved: Partial<MarketplaceState> = {}
  try { saved = JSON.parse(await fs.readFile(storeFile, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Component library could not be read. Existing data has been preserved.') }
  return { version: 1, components: [...BUILTIN_COMPONENTS, ...(Array.isArray(saved.components) ? saved.components.filter((entry) => !entry.id.startsWith('builtin:')) : [])], favorites: saved.favorites ?? [], recent: saved.recent ?? [], presets: saved.presets ?? [], registries: saved.registries ?? [], installations: saved.installations ?? [] }
}
export async function writeMarketplace(state: MarketplaceState): Promise<void> { await writeJsonAtomic(storeFile, state) }
export async function marketplaceSearch(query = '', category = '') { const state = await readMarketplace(); const needle = query.toLowerCase(); return state.components.filter((entry) => (!category || entry.category === category) && `${entry.name} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase().includes(needle)) }
export async function marketplaceRead(id: string): Promise<MarketplaceComponent> { const entry = (await readMarketplace()).components.find((component) => component.id === id); if (!entry) throw new Error('Component not found.'); return entry }
export async function importComponent(raw: unknown, registryUrl?: string) {
  const component = normalizeRegistryItem(raw, registryUrl ? new URL(registryUrl).hostname : 'Local library', registryUrl)
  await serializeMarketplace(async () => { const state = await readMarketplace(); state.components = [...state.components.filter((entry) => entry.id !== component.id), component]; if (state.components.length > 300) throw new Error('The local library is limited to 300 components. Export or remove unused entries before importing.'); await writeMarketplace(state) })
  return component
}
export async function importFromRegistry(urlValue: unknown, approved: boolean) {
  if (!approved) throw new Error('Explicit approval is required before contacting a registry.')
  const url = registryURL(urlValue); const state = await readMarketplace()
  if (!state.registries.some((entry) => { const trusted = new URL(entry.url); const prefix = trusted.pathname.endsWith('/') ? trusted.pathname : `${trusted.pathname}/`; return url.origin === trusted.origin && (url.pathname === trusted.pathname || url.pathname.startsWith(prefix)) })) throw new Error('Trust this registry URL prefix before fetching a component.')
  return importComponent(await downloadRegistryItem(url), url.href)
}
export async function trustRegistry(urlValue: unknown, name: string, approved: boolean) {
  if (!approved) throw new Error('Registry access requires approval.')
  const url = registryURL(urlValue)
  return serializeMarketplace(async () => { const state = await readMarketplace(); const registry = { id: hashContent(url.href).slice(0, 24), name: name.slice(0, 100) || url.hostname, url: url.href, createdAt: new Date().toISOString() }; state.registries = [...state.registries.filter((entry) => entry.id !== registry.id), registry].slice(-30); await writeMarketplace(state); return registry })
}
export async function updateCollection(action: 'favorite' | 'recent', id: string, value = true) {
  if (id.startsWith('github:')) {
    const { readGitHubTemplate } = await import('./github-templates')
    if (!await readGitHubTemplate(id.slice(7))) throw new Error('Download this template before adding it to your collection.')
  } else await marketplaceRead(id)
  return serializeMarketplace(async () => { const state = await readMarketplace(); const key = action === 'favorite' ? 'favorites' : 'recent'; state[key] = [ ...(value ? [id] : []), ...state[key].filter((entry) => entry !== id) ].slice(0, 300); await writeMarketplace(state); return state[key] })
}
export async function savePreset(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid styling preset.')
  const preset = value as StylingPreset
  if (!/^[a-z0-9-]{1,80}$/i.test(preset.id) || typeof preset.name !== 'string' || preset.name.length > 100 || !['light','dark'].includes(preset.theme) || ![preset.background,preset.foreground,preset.accent].every((color) => /^#[a-f0-9]{6}$/i.test(color)) || !['sans','mono','serif'].includes(preset.typography) || !['compact','comfortable'].includes(preset.spacing) || !Number.isFinite(preset.radius) || preset.radius < 0 || preset.radius > 24 || !Number.isFinite(preset.shadow) || preset.shadow < 0 || preset.shadow > 1 || typeof preset.motion !== 'boolean') throw new Error('Preset contains unsupported values. Use six-digit hex colors and supported typography, spacing, radius and shadow settings.')
  return serializeMarketplace(async () => { const state = await readMarketplace(); state.presets = [...state.presets.filter((entry) => entry.id !== preset.id), preset].slice(-50); await writeMarketplace(state); return preset })
}
export { COMPONENT_CATEGORIES }
