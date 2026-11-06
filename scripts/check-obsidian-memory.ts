import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agenthub-obsidian-'))
  process.env.AGENT_HUB_DB_DIR = path.join(root, 'db')
  const vaultRoot = path.join(root, 'vault'); await mkdir(path.join(vaultRoot, '.obsidian'), { recursive: true })
  await writeFile(path.join(vaultRoot, 'Alpha.md'), '# Alpha\n\nThe lunar recall code is ORBIT-947. [[Beta]]')
  await writeFile(path.join(vaultRoot, 'Beta.md'), '# Beta\n\n[[Alpha]]')
  await writeFile(path.join(vaultRoot, '.obsidian', 'secret.md'), 'NEVER READ')
  const vault = await import('../src/lib/agent-hub/obsidian/vault'), ctx = await import('../src/lib/agent-hub/obsidian/context'), registry = await import('../src/lib/agent-hub/capabilities/registry')
  let checks = 0
  const check = (value: unknown, label: string) => { assert.ok(value, label); checks++; console.log('PASS', label) }
  try {
    await vault.connectVault(vaultRoot)
    check((await vault.noteIndex()).notes.length === 2, 'real files indexed, hidden config excluded')
    check((await vault.searchNotes('lunar recall')).notes[0]?.path === 'Alpha.md', 'actual content search')
    const note = await vault.readNote('Alpha.md')
    check(note.links[0]?.path === 'Beta.md' && note.backlinks[0]?.path === 'Beta.md', 'wiki links and backlinks')
    const graph = await vault.vaultGraph()
    check(graph.notes.length === 2 && graph.scanned === 2 && graph.links.length === 1 && graph.links[0].from === 'Alpha.md' && graph.links[0].to === 'Beta.md', 'graph uses actual wiki references and deduplicates reciprocal links')
    for (const invalid of ['../outside.md', '.obsidian/secret.md', 'C:/secret.md', 'Alpha.md/../../x.md']) { await assert.rejects(vault.readNote(invalid)); checks++ }
    const external = path.join(root, 'outside'); await mkdir(external); await writeFile(path.join(external, 'escape.md'), 'outside')
    await symlink(external, path.join(vaultRoot, 'linked'), 'junction')
    await assert.rejects(vault.readNote('linked/escape.md')); checks++
    const proposal = await vault.proposeMemory('Remember lunar code', 'ORBIT-947', 'user')
    check(!(await vault.noteIndex(true)).notes.some((item) => item.path.startsWith('AgentHub Memory/')), 'proposal does not write a note')
    await assert.rejects(vault.reviewMemory(proposal.id, 'wrong-hash', true)); checks++
    const result = await vault.reviewMemory(proposal.id, proposal.hash, true)
    check((await readFile(path.join(vaultRoot, result.path!), 'utf8')).includes('ORBIT-947'), 'approved memory is an actual persistent Markdown file')
    await assert.rejects(vault.reviewMemory(proposal.id, proposal.hash, true)); checks++
    const declined = await vault.proposeMemory('Decline me', 'Do not save', 'user'); await vault.reviewMemory(declined.id, declined.hash, false)
    check(!(await vault.memoryState()).proposals.length, 'decline removes pending proposal')
    await registry.updateCapabilityPack('install', { id: 'obsidian-memory' }); await registry.updateCapabilityPack('assign', { id: 'obsidian-memory', agentId: 'other' }); await registry.updateCapabilityPack('enable', { id: 'obsidian-memory' })
    const local = { endpoint: 'http://127.0.0.1:1234/v1/chat/completions', apiKey: '', modelId: 'fixture', label: 'fixture' }
    check((await ctx.memoryPromptContext('chat', 'lunar recall', local)).includes('ORBIT-947'), 'retrieval supplies real note text to local context')
    check(!await ctx.memoryPromptContext('chat', 'lunar recall', { ...local, endpoint: 'https://example.com/v1' }), 'cloud model gets no notes')
    check(!await ctx.memoryPromptContext('website', 'lunar recall', local), 'unassigned agent gets no notes')
    await registry.updateCapabilityPack('disable', { id: 'obsidian-memory' })
    check(!await ctx.memoryPromptContext('chat', 'lunar recall', local), 'disable stops new retrieval')
    await vault.disconnectVault(); await assert.rejects(vault.readNote('Alpha.md')); checks++
    console.log(`${checks}/${checks} temporary-vault checks passed; model responses not mocked or tested here.`)
  } finally { if (!root.startsWith(path.join(os.tmpdir(), 'agenthub-obsidian-'))) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }) }
}
void main().catch((e) => { console.error(e); process.exitCode = 1 })
