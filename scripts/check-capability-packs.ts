import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let checks = 0
function ok(condition: unknown, label: string): void {
  checks++
  if (!condition) throw new Error(`FAIL ${label}`)
  process.stdout.write(`PASS ${label}\n`)
}
async function rejects(action: () => unknown | Promise<unknown>, label: string): Promise<void> {
  let rejected = false
  try { await action() } catch { rejected = true }
  ok(rejected, label)
}

const customPack = (id: string, dependencies: Array<{ id: string; optional?: boolean }> = []) => ({
  id, version: '1.0.0', name: id, description: 'Local declarative capability pack for registry tests.', category: 'test',
  keywords: ['capability test'], capabilities: ['workspace-search'], skills: [], tools: ['search'], templates: [], components: [], dependencies,
  platforms: ['any'], compatibleAgents: ['research'], modelRequirements: ['chat'], requiredPermissions: ['selected-workspace-read'],
  license: null, source: { kind: 'local' },
})

async function main(): Promise<void> {
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agenthub-capabilities-'))
process.env.AGENT_HUB_DB_DIR = temporaryRoot
const registry = await import('../src/lib/agent-hub/capabilities/registry')
try {
  const initial = await registry.readCapabilityPacks()
  ok(initial.length === 7 && initial.every((pack) => !pack.installed), 'built-in pack catalog is discoverable without installing it')
  await rejects(() => registry.updateCapabilityPack('enable', { id: 'website-builder' }), 'cannot enable a pack before install')
  await registry.updateCapabilityPack('install', { id: 'website-builder' })
  await registry.updateCapabilityPack('assign', { id: 'website-builder', agentId: 'website' })
  await registry.updateCapabilityPack('enable', { id: 'website-builder' })
  const websiteContext = await registry.capabilityPromptContext('website', 'Build a portfolio website with reusable components')
  ok(websiteContext.includes('UI/UX design workflow') && websiteContext.includes('never claim visual inspection'), 'design guidance reaches the agent without inventing vision tools')
  ok(websiteContext.includes('Website Builder') && websiteContext.includes('search_ui_components'), 'enabled assigned pack reaches the matching agent prompt with existing tools')
  ok(!(await registry.capabilityPromptContext('research', 'Build a portfolio website')).includes('Website Builder'), 'agent assignment does not affect another agent')
  ok(!(await registry.capabilityPromptContext('website', 'Explain how recursion works')).includes('Website Builder'), 'unrelated requests do not load the assigned pack')
  await registry.updateCapabilityPack('disable', { id: 'website-builder' })
  ok(!(await registry.capabilityPromptContext('website', 'Build a portfolio website')).includes('Website Builder'), 'disabled packs are no longer selected')
  await registry.updateCapabilityPack('enable', { id: 'website-builder' })
  ok((await registry.capabilityPromptContext('website', 'Build a portfolio website')).includes('Website Builder'), 're-enabled pack is selected again')
  await registry.updateCapabilityPack('uninstall', { id: 'website-builder' })
  ok(!(await registry.capabilityPromptContext('website', 'Build a portfolio website')).includes('Website Builder'), 'uninstall removes a built-in pack from runtime routing')
  await rejects(() => registry.updateCapabilityPack('assign', { id: 'game-development', agentId: 'research' }), 'unsupported agent assignment is rejected')
  await rejects(() => registry.validateCapabilityManifest({ ...customPack('unsafe-tools'), tools: ['run_arbitrary_script'] }), 'unknown tool names are rejected')
  await rejects(() => registry.validateCapabilityManifest(customPack('self-cycle', [{ id: 'self-cycle' }])), 'self-referential dependency is rejected')
  await rejects(() => registry.updateCapabilityPack('install', { id: 'missing-pack' }), 'unknown pack installation is rejected')
  await registry.updateCapabilityPack('import', { manifest: customPack('base-pack') })
  await registry.updateCapabilityPack('import', { manifest: customPack('dependent-pack', [{ id: 'base-pack' }]) })
  await rejects(() => registry.updateCapabilityPack('uninstall', { id: 'base-pack' }), 'required dependencies protect an installed shared pack')
  await registry.updateCapabilityPack('uninstall', { id: 'dependent-pack' })
  await registry.updateCapabilityPack('uninstall', { id: 'base-pack' })
  ok(true, 'local pack lifecycle stays in the temporary registry and removes cleanly')
  process.stdout.write(`\n${checks}/${checks} capability checks passed.\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })

