import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from '../db-path'
import { writeJsonAtomic } from '../fs-atomic'
import { readWorkspaceFiles, mutateWorkspaceFile } from '../workspace-files'
import { resolveWorkspace, withWorkspaceRoot } from '../session/workspaces'
import { marketplaceRead, readMarketplace, serializeMarketplace, writeMarketplace } from './catalog'
import { safeComponentPath } from './registry'
import type { Installation, InstallProposal, ProposedFile } from './types'

const shared = globalThis as typeof globalThis & { agentHubMarketplaceProposals?: Map<string, InstallProposal> }
const pending = shared.agentHubMarketplaceProposals ??= new Map<string, InstallProposal>()
const snapshotDirectory = path.join(DB_DIR, 'marketplace-snapshots')
async function workspace(id: string) { if (!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Explicitly select and approve a registered workspace. The AgentHub installation folder is never chosen implicitly.'); return resolveWorkspace(id) }
async function read(root: string, file: string): Promise<string | null> {
  const response = await withWorkspaceRoot(root, () => readWorkspaceFiles(new URLSearchParams({ op: 'read', path: file, limit: '1000' })))
  if (response.status === 404) return null
  if (response.body.ok !== true) throw new Error(String(response.body.error ?? 'File cannot be read safely.'))
  if (Number(response.body.totalLines) > 1000 || typeof response.body.content !== 'string') throw new Error(`File ${file} exceeds the review limit. Installation was not attempted.`)
  return response.body.content
}
/** Extra lstat checks reject all linked ancestors, even links that currently point in scope. */
async function checkPath(root: string, relative: string) {
  safeComponentPath(relative)
  const realRoot = await fs.realpath(root)
  const relativeRoot = path.relative(realRoot, path.resolve(root))
  if (relativeRoot && (relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot))) throw new Error('The selected root changed; choose the workspace again.')
  let current = root
  for (const part of relative.split('/')) { current = path.join(current, part); try { const stat = await fs.lstat(current); if (stat.isSymbolicLink()) throw new Error('Component file paths may not contain symbolic links or junctions.'); if (current !== path.join(root, ...relative.split('/')) && !stat.isDirectory()) throw new Error('A target parent is not a folder.') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } }
}
async function mutate(root: string, file: string, content: string | null) {
  await checkPath(root, file)
  if (content === null && await read(root, file) === null) return
  const response = await withWorkspaceRoot(root, () => mutateWorkspaceFile({ op: content === null ? 'delete' : 'write', path: file, ...(content === null ? {} : { content }), mode: 'edit' }))
  if (response.body.ok !== true) throw new Error(String(response.body.error ?? 'File change failed.'))
}
export async function proposeInstall(input: { id: string; workspaceId: string; operation?: InstallProposal['operation']; installationId?: string }): Promise<InstallProposal> {
  const selected = await workspace(input.workspaceId)
  const operation = input.operation ?? 'install'; const component = await marketplaceRead(input.id)
  const state = await readMarketplace()
  const previous = input.installationId ? state.installations.find((entry) => entry.id === input.installationId && entry.workspaceId === selected.id && entry.componentId === component.id) : state.installations.findLast((entry) => entry.workspaceId === selected.id && entry.componentId === component.id)
  if (operation !== 'install' && !previous) throw new Error('Choose an installation in this workspace first.')
  const warnings: string[] = []
  const packageText = await read(selected.root, 'package.json')
  if (!packageText) throw new Error('The selected project has no readable package.json. Choose an existing React project before installing React source.')
  let manifest: { dependencies?: Record<string,string>; devDependencies?: Record<string,string> }
  try { manifest = JSON.parse(packageText) } catch { throw new Error('The project package.json is invalid.') }
  const installedDependencies = { ...manifest.devDependencies, ...manifest.dependencies }
  if (!installedDependencies.react) throw new Error('The selected project does not declare React. This marketplace currently installs React source only.')
  const dependencies = [...component.dependencies, ...component.devDependencies].filter((entry) => { const name = entry.match(/^(@[^/]+\/[^@]+|[^@]+)/)?.[1] ?? entry; return !installedDependencies[name] })
  for (const entry of [...component.dependencies, ...component.devDependencies]) {
    const match = entry.match(/^(@[^/]+\/[^@]+|[^@]+)(?:@(.+))?$/)
    if (match?.[2] && installedDependencies[match[1]] && installedDependencies[match[1]] !== match[2]) warnings.push(`Dependency version review: ${match[1]} requests ${match[2]}; the project declares ${installedDependencies[match[1]]}. No version is changed automatically.`)
  }
  if (dependencies.length) warnings.push(`Missing npm dependencies: ${dependencies.join(', ')}. Source installation does not run package commands. Use a separately approved Session command to add them, with lifecycle scripts disabled when appropriate.`)
  if (component.registryDependencies.length) warnings.push(`Related registry items are not recursively installed: ${component.registryDependencies.join(', ')}. Import and review each dependency separately.`)
  if (Object.keys(installedDependencies).some((name) => name === 'next')) warnings.push('Next.js project detected. Review client/server boundaries and imports before integrating this component.')
  warnings.push('Installation verifies exact source bytes. It does not compile the project, integrate imports or claim the component is visually tested.')
  warnings.push('Source imports are preserved verbatim. Check local aliases, relative imports, supporting utilities and Tailwind configuration before integrating.')
  const sources = operation === 'install' ? component.files.map((file) => ({ path: file.target, after: file.content })) : previous!.files.map((file) => ({ path: file.path, after: file.before }))
  const files: ProposedFile[] = []
  for (const source of sources) {
    await checkPath(selected.root, source.path)
    const before = await read(selected.root, source.path)
    if (operation !== 'install') {
      const priorFile = previous!.files.find((entry) => entry.path === source.path)!
      if (before !== priorFile.after) throw new Error(`File ${source.path} changed since installation. Refusing to remove or restore user edits.`)
    }
    files.push({ path: source.path, before, after: source.after, conflict: operation === 'install' && before !== null && before !== source.after })
  }
  if (files.some((file) => file.conflict)) warnings.push('Existing files differ. Approval will overwrite exactly the contents shown in this review; a recoverable snapshot is created first.')
  const proposal: InstallProposal = { id: crypto.randomUUID(), componentId: component.id, componentName: component.name, revision: component.revision, workspaceId: selected.id, workspaceRoot: selected.root, operation, ...(previous ? { installationId: previous.id } : {}), files, dependencies, warnings, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }
  for (const [id, entry] of pending) if (Date.parse(entry.expiresAt) < Date.now()) pending.delete(id)
  if (pending.size >= 100) throw new Error('Too many open installation reviews. Wait for old reviews to expire.')
  pending.set(proposal.id, structuredClone(proposal))
  return proposal
}
export async function applyProposal(id: string, approved: boolean): Promise<{ installation: Installation; verification: string[] }> {
  if (!approved) throw new Error('Explicit approval of the exact file review is required.')
  return serializeMarketplace(async () => {
    const proposal = pending.get(id)
    if (!proposal || Date.parse(proposal.expiresAt) <= Date.now()) throw new Error('Installation review expired or was already used. Review the changes again.')
    pending.delete(id)
    const selected = await workspace(proposal.workspaceId)
    if (selected.root !== proposal.workspaceRoot) throw new Error('Workspace changed after review.')
    if ((await marketplaceRead(proposal.componentId)).revision !== proposal.revision) throw new Error('Component source changed after review. Create a new review.')
    for (const file of proposal.files) { await checkPath(selected.root, file.path); if (await read(selected.root, file.path) !== file.before) throw new Error(`File ${file.path} changed after review. Nothing was installed.`) }
    const snapshotFile = path.join(snapshotDirectory, `${proposal.id}.json`)
    await writeJsonAtomic(snapshotFile, { version: 1, status: 'prepared', proposal, createdAt: new Date().toISOString() })
    const changed: ProposedFile[] = []
    try {
      for (const file of proposal.files) { if (await read(selected.root, file.path) !== file.before) throw new Error(`File ${file.path} changed during installation.`); await mutate(selected.root, file.path, file.after); changed.push(file); if (await read(selected.root, file.path) !== file.after) throw new Error(`Verification failed for ${file.path}.`) }
      const verification = proposal.files.map((file) => `${file.path}: ${file.after === null ? 'removed' : 'exact contents verified'}`)
      const installation: Installation = { id: proposal.id, componentId: proposal.componentId, componentName: proposal.componentName, revision: proposal.revision, workspaceId: selected.id, workspaceRoot: selected.root, operation: proposal.operation, files: proposal.files, createdAt: new Date().toISOString(), status: proposal.operation === 'install' ? 'installed' : proposal.operation === 'uninstall' ? 'uninstalled' : 'restored', verification }
      const state = await readMarketplace(); state.installations.push(installation); state.installations = state.installations.slice(-300); await writeMarketplace(state)
      await writeJsonAtomic(snapshotFile, { version: 1, status: 'completed', proposal, installation })
      return { installation, verification }
    } catch (error) {
      const recovery: string[] = []
      for (const file of changed.reverse()) { try { if (await read(selected.root, file.path) !== file.after) throw new Error('File changed outside the installer; preserving that change.'); await mutate(selected.root, file.path, file.before) } catch (rollbackError) { recovery.push(`${file.path}: ${rollbackError instanceof Error ? rollbackError.message : 'Rollback failed'}`) } }
      await writeJsonAtomic(snapshotFile, { version: 1, status: recovery.length ? 'recovery-required' : 'rolled-back', proposal, recovery }).catch(() => {})
      throw new Error(`${error instanceof Error ? error.message : 'Installation failed.'} ${recovery.length ? 'Automatic rollback could not restore every file. The local snapshot is retained for recovery.' : 'Changes made by this transaction were rolled back.'}`)
    }
  })
}
