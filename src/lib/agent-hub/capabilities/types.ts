export const CAPABILITY_PACK_VERSION = 1 as const

export type CapabilityPackSource = {
  kind: 'builtin' | 'local' | 'registry'
  url?: string
}

/** A capability pack references existing AgentHub resources; it never embeds executable code. */
export interface CapabilityPackManifest {
  id: string
  version: string
  name: string
  description: string
  category: string
  keywords: string[]
  capabilities: string[]
  skills: string[]
  tools: string[]
  templates: string[]
  components: string[]
  dependencies: Array<{ id: string; optional?: boolean }>
  platforms: Array<'win32' | 'darwin' | 'linux' | 'any'>
  compatibleAgents: string[]
  modelRequirements: string[]
  requiredPermissions: string[]
  license: string | null
  source: CapabilityPackSource
}

export interface InstalledCapabilityPack extends CapabilityPackManifest {
  installed: boolean
  enabled: boolean
  assignedAgents: string[]
  installedAt?: string
  health: 'ready' | 'needs-review' | 'incompatible'
  healthMessage?: string
}

export interface CapabilityPackState {
  version: typeof CAPABILITY_PACK_VERSION
  packs: InstalledCapabilityPack[]
}

