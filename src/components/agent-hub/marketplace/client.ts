import type { GitHubTemplate } from '@/lib/agent-hub/marketplace/github-templates'
import type { MarketplaceComponent, Installation, StylingPreset, TrustedRegistry } from '@/lib/agent-hub/marketplace/types'

export interface MarketplaceWorkspace { id: string; root: string; projectName: string }
export interface MarketplaceCatalog {
  templates?: GitHubTemplate[]; catalog: MarketplaceComponent[]; favorites: string[]; recent: string[]; presets: StylingPreset[];
  installations: Installation[]; registries: TrustedRegistry[]; categories: string[]; workspaces: MarketplaceWorkspace[];
}
export async function marketplaceRequest<T>(body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/ui-components', {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' }), signal,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.ok) throw new Error(data?.error || `The component library returned HTTP ${response.status}.`)
  return data as T
}
export function exportComponent(component: MarketplaceComponent): void {
  const item = {
    $schema: 'https://ui.shadcn.com/schema/registry-item.json', name: component.name, type: 'registry:ui',
    description: component.description, categories: [component.category], dependencies: component.dependencies,
    devDependencies: component.devDependencies, registryDependencies: component.registryDependencies,
    author: component.author, license: component.license,
    files: component.files.map((file) => ({ path: file.path, target: file.target, type: file.type, content: file.content })),
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = `${component.name.replace(/[^a-z\d_-]/gi, '-')}.json`; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function componentRegistryItem(component: MarketplaceComponent): string {
  return JSON.stringify({ $schema: 'https://ui.shadcn.com/schema/registry-item.json', name: component.name, type: 'registry:ui', description: component.description, categories: [component.category], dependencies: component.dependencies, devDependencies: component.devDependencies, registryDependencies: component.registryDependencies, author: component.author, license: component.license, files: component.files }, null, 2)
}
