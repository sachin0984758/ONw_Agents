import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertScopeTool, validateComputerScope } from '../src/lib/agent-hub/computer/access'
import type { ComputerScope } from '../src/lib/agent-hub/computer/protocol'

let passed = 0
const check = (name: string, value: unknown) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`) }
  const waitForSavedTask = async (id: string, phase: string) => {
    // The runtime writes atomically on its own task queue. A busy full-suite or
    // production build can delay filesystem scheduling beyond the old 1s window.
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        const saved = JSON.parse(await readFile(path.join(process.env.AGENT_HUB_DB_DIR!, 'computer-tasks.json'), 'utf8')) as { tasks: Array<{ id: string; phase: string; scope: ComputerScope }> }
        const task = saved.tasks.find((entry) => entry.id === id && entry.phase === phase)
        if (task) return task
      } catch { /* the first atomic write may not have completed yet */ }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const file = path.join(process.env.AGENT_HUB_DB_DIR!, 'computer-tasks.json')
    throw new Error(`Auto task ${id} was not durably saved with phase ${phase} under ${process.env.AGENT_HUB_DB_DIR}. File: ${await readFile(file, 'utf8')}`)
  }
const base: ComputerScope = { applications: ['notepad'], domains: [], readonly: true }
async function main() {
  const normalized = validateComputerScope(base)
  check('legacy omitted grants become no files and no internet', normalized.workspaceAccess === 'none' && normalized.internet === false && !normalized.workspaceId)
  for (const input of [
    { ...base, applications: [] },
    { ...base, workspaceAccess: 'read' },
    { ...base, workspaceAccess: 'write', workspaceId: 'chosen' },
    { ...base, domains: ['localhost'] },
    { ...base, applications: ['browser'], domains: ['example.org'] },
  ]) {
    assert.throws(() => validateComputerScope(input as ComputerScope)); check('invalid or implicit scope is denied', true)
  }
  check('local browser is explicit and does not grant internet', validateComputerScope({ ...base, applications: ['browser'], domains: ['localhost'] }).internet === false)
  check('external browser hosts require explicit internet', validateComputerScope({ ...base, applications: ['browser'], domains: ['example.org'], internet: true }).internet)
  check('workspace-only operation needs no application grant', validateComputerScope({ ...base, applications: [], workspaceId: 'chosen', workspaceAccess: 'read' }).workspaceAccess === 'read')
  check('unused saved workspace preference does not authorize it', !validateComputerScope({ ...base, workspaceId: 'saved' }).workspaceId)
  for (const name of ['workspace_info', 'read_file', 'list_files', 'count_files', 'search', 'write_file', 'edit_file', 'delete_file', 'run_command', 'browser.open']) {
    assert.throws(() => assertScopeTool(normalized, name)); check(`${name} cannot use an omitted grant`, true)
  }
  const read = { ...base, workspaceId: 'chosen', workspaceAccess: 'read' as const }
  assertScopeTool(read, 'read_file'); check('explicit read scope can inspect files', true)
  assert.throws(() => assertScopeTool(read, 'write_file')); check('read scope cannot write', true)
  assertScopeTool({ ...read, readonly: false, workspaceAccess: 'write' }, 'write_file'); check('explicit writable scope can propose an approved change', true)
  assert.throws(() => assertScopeTool(undefined, 'read_file')); check('revocation denies a subsequent sensitive operation', true)
  const directory = await mkdtemp(path.join(tmpdir(), 'auto-platform-test-'))
  const previousDb = process.env.AGENT_HUB_DB_DIR
  process.env.AGENT_HUB_DB_DIR = directory
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  let proposedUnsafeTool = false
  globalThis.fetch = async (input, options) => {
    const url = String(input); requests.push(url)
    if (url.endsWith('/chat/completions')) {
      const body = JSON.parse(String(options?.body))
      check('planning request exposes zero executable tools', !body.tools || body.tools.length === 0)
      check('planning request states inspection was not performed', body.messages.some((message: {content:string}) => message.content.includes('No desktop inspection was authorized')))
      const content = proposedUnsafeTool ? '```tool\n{"name":"desktop_open_application","args":{"application":"notepad"}}\n```' : 'Proposed plan: identify the goal, request access, verify results. No action performed.'
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 12 } })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (url.includes(':1234/api/v0/models')) return Response.json({ data: [{ id: 'test-local', type: 'llm', state: 'loaded' }] })
    return Response.json({ data: [] })
  }
  try {
    const runtime = await import('../src/lib/agent-hub/computer/runtime')
    const task = await runtime.startAutoTask({ request: 'Plan a safe task', profile: 'balanced', model: '', visionModel: '', saveSummary: false, planningOnly: true })
    for (let i = 0; i < 100 && task.phase !== 'planned' && task.phase !== 'failed'; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    check('a real runtime plan completes without companion authorization', task.phase === 'planned')
    const savedPlan = await waitForSavedTask(task.id, 'planned')
    check('runtime durably records the completed plan and its scope', savedPlan.scope.workspaceAccess === 'none')
    check('planning task retains an empty scope', task.scope.applications.length === 0 && task.scope.workspaceAccess === 'none' && !task.scope.internet)
    check('planning records proposal rather than verified execution', task.events.at(-1)?.verified === false)
    check('planning makes only loopback model requests', requests.every((url) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname)))
    await assert.rejects(() => runtime.startAutoTask({ request: 'Open Notepad', profile: 'balanced', model: '', visionModel: '', saveSummary: false }), /grant session permissions/)
    check('execution cannot reuse a planning-only task as authorization', true)
    proposedUnsafeTool = true
    const unsafe = await runtime.startAutoTask({ request: 'Plan only', profile: 'balanced', model: '', visionModel: '', saveSummary: false, planningOnly: true })
    for (let i = 0; i < 100 && !['failed', 'cancelled'].includes(unsafe.phase); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    check('unavailable model-proposed tool cannot launch an application while planning', unsafe.phase === 'failed' && !unsafe.events.some((event) => event.phase === 'acting'))
    try { await waitForSavedTask(unsafe.id, 'failed') }
    catch (error) {
      console.error('Auto persistence diagnostic:', await runtime.autoSnapshot())
      throw error
    }
    check('runtime persists failed task outcome for later review', true)
    await runtime.controlTask('stop')
    check('stop clears runtime permission grants', (await runtime.autoSnapshot()).scope === null)
    await assert.rejects(() => runtime.manualComputerAction('desktop.type_text', {}, true), /permissions/)
    check('confirmed manual input still fails without a connected granted companion', true)
  } finally {
    globalThis.fetch = originalFetch
    if (previousDb === undefined) delete process.env.AGENT_HUB_DB_DIR; else process.env.AGENT_HUB_DB_DIR = previousDb
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep))
    await rm(directory, { recursive: true, force: true })
  }
  console.log(`\n${passed} Auto permission and planning checks passed.`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
