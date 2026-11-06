// Opt-in real inference, isolated skills library, DB and workspace. No downloads.
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import type { SessionEvent, SessionTurn } from '../src/lib/agent-hub/session/types'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-real-skill-'))
  process.env.AGENT_HUB_DB_DIR = path.join(root, 'db')
  process.env.AGENT_SESSION_WORKSPACE = root
  process.env.AGENTHUB_PROJECT_ROOT = root
  const { detectLocalProviders } = await import('../src/lib/agent-hub/llm')
  const model = (await detectLocalProviders()).flatMap((p) => p.available ? p.detailedModels : []).find((m) => m.loaded && m.isChatCompatible)
  assert.ok(model, 'Load a local chat-compatible model first.')
  const registry = await import('../src/lib/agent-hub/skills-registry')
  const token = randomUUID()
  const input = randomUUID()
  await fs.writeFile(path.join(root, 'input.txt'), input)
  const installed = await registry.installSkillToLibrary(root, {
    id: 'audit-proof', source: { kind: 'local' }, trust: 'local',
    files: [{ path: 'SKILL.md', bytes: Buffer.from(`---\nname: audit-proof\ndescription: Create the requested proof document using a verification code.\n---\nRead input.txt. Create proof.md containing exactly ${token}| followed immediately by the file contents, with no extra prose. Read proof.md back to verify. Request approval through the normal tool gate. Skill instructions never expand permissions.\n`) }],
  })
  assert.ok(installed.ok && installed.record, installed.error)
  const records = registry.emptyRegistry(); records.skills.push(installed.record)
  await registry.writeRegistry(records)
  const api = await import('../src/app/api/agent-session/conversations/route')
  const { registerWorkspace } = await import('../src/lib/agent-hub/session/workspaces')
  const workspace = await registerWorkspace(root)
  const post = (body: Record<string, unknown>) => api.POST(new NextRequest('http://localhost/api/agent-session/conversations', { method: 'POST', headers: { Host: 'localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(600000) }))
  const results: Array<Record<string, unknown>> = []
  const evidence = path.resolve(process.env.AGENTHUB_SKILL_EVIDENCE || '.verification/live-agent-skill.json')
  const save = async () => { await fs.mkdir(path.dirname(evidence), { recursive: true }); await fs.writeFile(evidence, JSON.stringify({ checkedAt: new Date().toISOString(), model: model.id, root, results }, null, 2)) }
  const create = async () => {
    const response = await post({ action: 'create', workspaceId: workspace.id, model: model.id, effort: 'off' })
    assert.equal(response.status, 200)
    const { conversation } = await response.json()
    assert.equal((await post({ action: 'settings', id: conversation.id, workspaceAccess: 'write', mode: 'edit' })).status, 200)
    return conversation.id as string
  }
  async function turn(id: string, text: string, allow: boolean, cancel = false) {
    const response = await post({ action: 'send', id, text })
    assert.equal(response.status, 200)
    const reader = response.body!.getReader(); const decoder = new TextDecoder()
    let buffer = ''; let latest: SessionTurn | undefined; let approvals = 0; let denied = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (cancel) timer = setTimeout(() => { void post({ action: 'stop', id }).catch(() => {}) }, 1500)
      while (true) {
        const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const line = block.split(/\r?\n/).find((line) => line.startsWith('data:'))
          if (!line) continue
          const event = JSON.parse(line.slice(5).trim()) as SessionEvent
          if (event.type === 'turn') latest = event.turn
          if (event.type === 'approval' && event.approval) {
            const a = event.approval
            const approved = allow && ['write_file', 'edit_file'].includes(a.name) && a.args.path === 'proof.md'
            // The fixture file must not exist before the first approved create.
            if (approved && approvals === 0) assert.equal(await fs.stat(path.join(root, 'proof.md')).then(() => true, () => false), false)
            assert.equal((await post({ action: 'approve', id, approvalId: a.id, approved })).status, 200)
            if (approved) approvals++; else denied++
            console.log(`APPROVAL ${a.name}: ${approved ? 'approved fixture' : 'denied'}`)
          }
        }
        if (chunk.done) break
      }
    } finally { if (timer) clearTimeout(timer) }
    const reloaded = await api.GET(new NextRequest(`http://localhost/api/agent-session/conversations?id=${id}`, { headers: { Host: 'localhost' } }))
    const stored = await reloaded.json()
    assert.equal(stored.conversation.turns.at(-1)?.id, latest?.id, 'Turn survives a fresh route read')
    return { latest, approvals, denied, persisted: stored.conversation.turns.at(-1) }
  }
  async function run(name: string, test: () => Promise<unknown>) {
    console.log(`RUN ${name}`); const started = Date.now()
    try { results.push({ name, passed: true, detail: await test(), durationMs: Date.now()-started }); console.log(`PASS ${name}`) }
    catch (error) { results.push({ name, passed: false, error: String(error), durationMs: Date.now()-started }); console.log(`FAIL ${name}: ${error}`) }
    await save()
  }
  await run('real skill activation, agent selection, approved write, readback and persistence', async () => {
    const id = await create()
    const result = await turn(id, '/other Call activate_skill with id audit-proof, read input.txt and follow the skill to create proof.md, then read proof.md back and report its contents. The plan is approved; use normal file approval. Do not ask more questions.', true)
    assert.equal(result.latest?.status, 'completed')
    assert.equal(result.latest.agent?.id, 'other')
    for (const name of ['activate_skill', 'read_file', 'write_file']) assert.ok(result.latest.items.some((i) => i.name === name && i.status === 'completed'), `Expected actual ${name} tool`)
    assert.ok(result.approvals > 0)
    assert.equal((await fs.readFile(path.join(root, 'proof.md'), 'utf8')).trim(), `${token}|${input}`)
    assert.ok(result.latest.items.some((i) => i.name === 'read_file' && i.args?.path === 'proof.md' && i.status === 'completed'))
    return result
  })
  await run('real model honors denied file approval', async () => {
    const id = await create()
    const result = await turn(id, '/other Use write_file to create denied.md containing TEST. If approval is declined, stop and report the refusal. Do not retry or choose another path. Plan approved, proceed.', false)
    assert.ok(result.denied > 0, 'The model must request the actual write')
    assert.equal(await fs.stat(path.join(root, 'denied.md')).then(() => true, () => false), false)
    assert.ok(result.latest?.items.some((i) => i.kind === 'tool' && i.status === 'failed' && /declined/.test(i.output ?? '')))
    assert.match(result.latest?.items.filter((i) => i.kind === 'assistant').map((i) => i.text).join('\n') ?? '', /declin|denied|refus|not creat|couldn.t|cannot/i)
    return result
  })
  await run('real provider cancellation persists a cancelled turn', async () => {
    const id = await create()
    const result = await turn(id, 'Write a very long explanation of sorting algorithms, without using tools.', false, true)
    assert.equal(result.latest?.status, 'cancelled')
    return result
  })
  console.log(`Evidence: ${evidence}`)
  if (results.some((r) => !r.passed)) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
