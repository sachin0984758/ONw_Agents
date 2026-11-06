import { AsyncLocalStorage } from 'node:async_hooks'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR, resolveProjectRoot } from '../db-path'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'

export interface SelectedWorkspace { id: string; root: string; projectName: string }
const context = new AsyncLocalStorage<string>()
const registryFile = path.join(DB_DIR, 'session-workspaces.json')
const serialize = createSerializer()

export function defaultWorkspaceRoot(): string {
  if (process.env.AGENT_SESSION_WORKSPACE) return path.resolve(process.env.AGENT_SESSION_WORKSPACE)
  return resolveProjectRoot()
}

// Only server-owned session code may set this context. HTTP file/exec callers
// cannot supply a root and concurrent sessions never change process.cwd().
export function currentWorkspaceRoot(): string { return context.getStore() ?? defaultWorkspaceRoot() }
export function withWorkspaceRoot<T>(root: string, action: () => T): T { return context.run(root, action) }

async function readRegistry(): Promise<SelectedWorkspace[]> {
  try {
    const value = JSON.parse(await fs.readFile(registryFile, 'utf8'))
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is SelectedWorkspace => entry && typeof entry.id === 'string' && typeof entry.root === 'string' && path.isAbsolute(entry.root) && typeof entry.projectName === 'string')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function registerWorkspace(value: unknown): Promise<SelectedWorkspace> {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value.trim())) throw new Error('Choose an absolute folder path on this computer.')
  const root = await fs.realpath(value.trim())
  if (!(await fs.stat(root)).isDirectory()) throw new Error('Choose a folder, not a file.')
  return serialize(async () => {
    const entries = await readRegistry()
    const existing = entries.find((entry) => process.platform === 'win32' ? entry.root.toLowerCase() === root.toLowerCase() : entry.root === root)
    if (existing) return existing
    const selected = { id: crypto.randomUUID(), root, projectName: path.basename(root) || root }
    await writeJsonAtomic(registryFile, [...entries, selected], 0)
    return selected
  })
}

export async function resolveWorkspace(id?: string): Promise<SelectedWorkspace> {
  if (!id) { const root = defaultWorkspaceRoot(); return { id: '', root, projectName: path.basename(root) } }
  const selected = (await readRegistry()).find((entry) => entry.id === id)
  if (!selected) throw new Error('This folder is no longer selected. Browse to the project folder again.')
  if (!(await fs.stat(selected.root)).isDirectory()) throw new Error('The selected folder is no longer available.')
  return selected
}

export async function selectedWorkspaces(): Promise<SelectedWorkspace[]> { return [await resolveWorkspace(), ...await readRegistry()] }
