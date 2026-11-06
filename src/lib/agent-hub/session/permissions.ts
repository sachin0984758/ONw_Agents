import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from '../db-path'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import { resolveWorkspace } from './workspaces'
import { createToolExecutor } from './tools'
import type { CodingConversation, ToolOutcome } from './types'

export type WorkspaceAccess = 'none' | 'read' | 'write'
interface Grant { workspaceId: string; access: WorkspaceAccess; updatedAt: string }
const file = path.join(DB_DIR, 'session-permissions.json')
const shared = globalThis as typeof globalThis & { sessionPermissionQueue?: ReturnType<typeof createSerializer> }
const serialize = shared.sessionPermissionQueue ??= createSerializer()
async function read(): Promise<Record<string, Grant>> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid permissions store.')
    return value as Record<string, Grant>
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
}
export async function sessionWorkspaceAccess(id: string, workspaceId?: string): Promise<WorkspaceAccess> {
  const grant = (await read())[id]
  return workspaceId && grant?.workspaceId === workspaceId && ['read', 'write'].includes(grant.access) ? grant.access : 'none'
}
export async function setSessionWorkspaceAccess(id: string, workspaceId: string | undefined, access: WorkspaceAccess) {
  if (!/^[a-f0-9-]{36}$/i.test(id) || !['none', 'read', 'write'].includes(access)) throw new Error('Invalid session permission.')
  if (access !== 'none') { if (!workspaceId) throw new Error('Select a folder before granting access.'); await resolveWorkspace(workspaceId) }
  await serialize(async () => {
    const grants = await read()
    if (access === 'none') delete grants[id]
    else grants[id] = { workspaceId: workspaceId!, access, updatedAt: new Date().toISOString() }
    await writeJsonAtomic(file, grants)
  })
}
export const WORKSPACE_MUTATIONS = new Set(['write_file', 'edit_file', 'delete_file', 'install_ui_component'])
export const WORKSPACE_FREE_TOOLS = new Set(['help', 'plan', 'ask_user', 'activate_skill', 'search_ui_components', 'read_ui_component', 'search_memory', 'list_memory_files', 'read_memory', 'propose_memory'])
/** Re-read the separate grant store before every action. Saving a stale turn cannot restore a revoked grant. */
export function createAuthorizedToolExecutor(conversation: CodingConversation, request: string) {
  const execute = createToolExecutor(conversation, request)
  return async (name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome> => {
    signal.throwIfAborted()
    if (!WORKSPACE_FREE_TOOLS.has(name)) {
      const access = await sessionWorkspaceAccess(conversation.id, conversation.workspaceId)
      signal.throwIfAborted()
      if (access === 'none') return { ok: false, output: 'No workspace access is authorized. Select a project folder and explicitly allow reading before using project tools.' }
      if (WORKSPACE_MUTATIONS.has(name) && access !== 'write') return { ok: false, output: 'Write access is not authorized. Grant it in Project folder; each file change still requires approval.' }
    }
    return execute(name, args, signal)
  }
}
