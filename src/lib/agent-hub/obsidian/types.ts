export const OBSIDIAN_PACK_ID = 'obsidian-memory'
export const MEMORY_SCOPES = [
  { id: 'chat', name: 'Chat' }, { id: 'teaching', name: 'Teaching & explanations' },
  { id: 'website', name: 'Website Builder' }, { id: 'game', name: 'Game Developer' },
  { id: 'research', name: 'Research Analyst' }, { id: 'other', name: 'General & custom agents' },
  { id: 'auto', name: 'Auto' },
] as const
export type MemoryScope = typeof MEMORY_SCOPES[number]['id']
export interface ObsidianVault { id: string; name: string; root: string }
export interface VaultConnection extends ObsidianVault { workspaceId: string; connectedAt: string }
export interface MemoryNote { path: string; title: string; bytes: number; modifiedAt: string; snippet?: string }
export interface VaultGraph { connectionId: string; name: string; notes: MemoryNote[]; links: Array<{ from: string; to: string }>; limited: boolean; scanned: number }
export interface MemoryRead { path: string; title: string; content: string; truncated: boolean; links: MemoryNote[]; backlinks: MemoryNote[]; obsidianUrl: string }
export interface MemoryActivity { id: string; at: string; action: 'connected' | 'disconnected' | 'search' | 'read' | 'retrieved' | 'proposed' | 'saved' | 'declined'; scope: string; paths: string[] }
export interface MemoryProposal { id: string; connectionId: string; title: string; content: string; hash: string; scope: string; createdAt: string }
export interface ObsidianStatus {
  connection: VaultConnection | null; available: boolean; error?: string; noteCount: number; scanLimited: boolean
  enabled: boolean; assignedAgents: string[]; activity: MemoryActivity[]; proposals: MemoryProposal[]
}
