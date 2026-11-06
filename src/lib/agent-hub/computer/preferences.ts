import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from '../db-path'
import { writeJsonAtomic } from '../fs-atomic'
import { resolveWorkspace } from '../session/workspaces'

export interface ComputerPreferences { workspaceId?: string }
const file = path.join(DB_DIR, 'computer-preferences.json')

export async function readComputerPreferences(): Promise<ComputerPreferences> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'))
    return typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export async function saveComputerWorkspace(workspaceId?: string): Promise<ComputerPreferences> {
  await resolveWorkspace(workspaceId) // Accept only an existing, registered folder.
  const preferences = workspaceId ? { workspaceId } : {}
  await writeJsonAtomic(file, preferences)
  return preferences
}
