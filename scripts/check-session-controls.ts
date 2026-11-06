import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-session-controls-'))
  process.env.AGENT_HUB_DB_DIR = path.join(fixture, 'db')
  process.env.AGENT_SESSION_WORKSPACE = path.join(fixture, 'default')
  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes(':1234/') && (url.endsWith('/api/v0/models') || url.endsWith('/v1/models'))) {
      return Response.json({ data: [{ id: 'session-controls-fixture-model', type: 'llm', state: 'loaded', arch: 'fixture' }] })
    }
    return realFetch(input, init)
  }
  let passed = 0
  const check = (name: string, value: unknown) => { assert.ok(value, name); passed++; console.log(`  PASS ${name}`) }
  try {
    const roots = ['default', 'project A', 'project B'].map((name) => path.join(fixture, name))
    for (const [index, root] of roots.entries()) {
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(path.join(root, 'shared.txt'), `project-${index}`)
      await fs.writeFile(path.join(root, 'AGENTS.md'), `Instructions for project-${index}`)
    }
    await fs.mkdir(path.join(roots[1], 'nested'))
    await fs.writeFile(path.join(roots[1], 'nested', 'only-A.txt'), 'nested A')
    const api = await import('../src/app/api/agent-session/conversations/route')
    const folders = await import('../src/app/api/agent-session/workspaces/route')
    const store = await import('../src/lib/agent-hub/session/store')
    const tools = await import('../src/lib/agent-hub/session/tools')
    const workspaces = await import('../src/lib/agent-hub/session/workspaces')
    const runtime = await import('../src/lib/agent-hub/session/runtime')
    const { codingSessionUrl } = await import('../src/lib/agent-hub/session/navigation')
    check('hover selection replaces stale session links', new URL(codingSessionUrl('http://localhost/?view=sessions&session=old', 'chosen')).searchParams.get('session') === 'chosen')
    check('deleting the last session removes its stale link', !new URL(codingSessionUrl('http://localhost/?view=sessions&session=old')).searchParams.has('session'))
    const req = (body: Record<string, unknown>, origin?: string) => new NextRequest('http://localhost/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) })
    const post = async (body: Record<string, unknown>) => { const response = await api.POST(req(body)); return { status: response.status, data: await response.json() } }
    const selectedA = await folders.POST(req({ action: 'select', path: roots[1] }))
    const a = (await selectedA.json()).workspace
    const b = await workspaces.registerWorkspace(roots[2])
    check('system paths with spaces can be selected', selectedA.status === 200 && a.root === roots[1])
    check('reselecting a folder retains its registered id', (await workspaces.registerWorkspace(roots[1])).id === a.id)
    check('folder selection rejects cross-origin pages', (await folders.POST(req({ action: 'select', path: roots[1] }, 'https://untrusted.example'))).status === 403)
    check('relative paths cannot register arbitrary roots', (await folders.POST(req({ action: 'select', path: '../project' }))).status === 400)
    check('files cannot be selected as project folders', (await folders.POST(req({ action: 'select', path: path.join(roots[1], 'shared.txt') }))).status === 400)
    check('missing folders return a visible error', (await folders.POST(req({ action: 'select', path: path.join(fixture, 'missing') }))).status === 400)
    const createdA = await post({ action: 'create', workspaceId: a.id, workspace: '.', mode: 'edit' })
    const createdB = await post({ action: 'create', workspaceId: b.id, workspace: '.', mode: 'edit' })
    const initialA = createdA.data.conversation
    check('new selected-folder sessions still require explicit authorization', initialA.workspaceAccess === 'none' && initialA.mode === 'ro')
    const grantedA = await post({ action: 'settings', id: initialA.id, workspaceAccess: 'write', mode: 'edit' })
    const ca = grantedA.data.conversation
    const cb = createdB.data.conversation
    check('session creation binds the selected folder', createdA.status === 200 && ca.workspaceId === a.id && ca.workspaceLabel === a.root)
    check('unregistered root ids cannot open sessions', (await post({ action: 'create', workspaceId: crypto.randomUUID(), workspace: '.' })).status === 400)
    check('absolute paths cannot bypass the folder registry', (await post({ action: 'create', workspace: roots[2] })).status === 400)
    check('parent traversal is rejected', (await post({ action: 'create', workspaceId: a.id, workspace: '..' })).status === 400)
    const loaded = await api.GET(new NextRequest(`http://localhost/api/agent-session/conversations?id=${ca.id}`, { headers: { Host: 'localhost' } }))
    check('reload returns the selected project root', (await loaded.json()).workspace.root === a.root)
    const [readA, readB, readDefault] = await Promise.all([
      tools.fileRequest('read', { path: 'shared.txt' }, undefined, a.id),
      tools.fileRequest('read', { path: 'shared.txt' }, undefined, b.id),
      tools.fileRequest('read', { path: 'shared.txt' }),
    ])
    check('concurrent sessions read their own project folders', readA.content === 'project-1' && readB.content === 'project-2')
    check('selecting a folder never changes the app root', readDefault.content === 'project-0' && workspaces.currentWorkspaceRoot() === roots[0])
    check('selected-folder instructions are loaded', (await tools.workspaceInstructions('.', a.id)).includes('Instructions for project-1'))
    const gameGuidance = await tools.workspaceInstructions('.', a.id, 'Create an X or O browser game')
    check('game guidance follows the selected project and does not invent an uninstalled router', gameGuidance.includes('Game-development workflow: no game router is installed') && gameGuidance.includes('no browser screenshot or gameplay interaction tool'))
    const facts = await tools.createToolExecutor(ca, 'where are you')('workspace_info', {}, new AbortController().signal)
    check('working-folder facts come from the selected real directory', facts.ok && facts.output.includes(`Working folder: ${a.root}`) && !facts.output.includes(roots[2]))
    const { runConversation, startTurn } = await import('../src/lib/agent-hub/session/runner')
    const locationSession = store.createConversation({ workspace: '.', workspaceId: a.id })
    const locationTurn = startTurn(locationSession, 'in which location are u in')
    await runConversation(locationSession, locationTurn, { execute: tools.createToolExecutor(locationSession, locationTurn.request), respond: async () => { throw new Error('Location must not ask a model to guess.') }, approve: async () => false, save: async () => {}, emit: () => {}, system: '', tools: [] }, new AbortController().signal)
    check('location questions return verified facts without any model call', locationTurn.status === 'completed' && locationTurn.items.some((item) => item.name === 'workspace_info') && locationTurn.items.at(-1)?.text.includes(a.root))
    const executeA = tools.createToolExecutor(ca, 'edit shared.txt')
    const signal = new AbortController().signal
    const listing = await executeA('list_files', { path: 'nested' }, signal)
    check('file listing uses the chosen project', listing.ok && listing.output.includes('only-A.txt'))
    const count = await executeA('count_files', {}, signal)
    check('file counting uses the chosen project', count.ok && count.output.startsWith('3 files'))
    await assert.rejects(() => executeA('read_file', { path: '../project B/shared.txt' }, signal))
    check('model paths cannot escape the selected folder', true)
    const denied = await executeA('edit_file', { path: 'shared.txt', oldText: 'project-1', newText: 'edited-A' }, signal)
    check('existing files still require a read before editing', !denied.ok)
    await executeA('read_file', { path: 'shared.txt' }, signal)
    const edited = await executeA('edit_file', { path: 'shared.txt', oldText: 'project-1', newText: 'edited-A' }, signal)
    check('approved edits target the selected folder', edited.ok && await fs.readFile(path.join(a.root, 'shared.txt'), 'utf8') === 'edited-A')
    check('other projects remain unchanged', await fs.readFile(path.join(b.root, 'shared.txt'), 'utf8') === 'project-2' && await fs.readFile(path.join(roots[0], 'shared.txt'), 'utf8') === 'project-0')
    await fs.symlink(b.root, path.join(a.root, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir')
    check('junctions cannot read outside the selected folder', !(await executeA('read_file', { path: 'outside-link/shared.txt' }, signal)).ok)
    check('junctions cannot write outside the selected folder', !(await executeA('write_file', { path: 'outside-link/new-file.txt', content: 'no' }, signal)).ok)
    const readonly = tools.createToolExecutor({ ...ca, mode: 'ro' }, 'create file')
    check('read-only sessions still reject writes', !(await readonly('write_file', { path: 'no.txt', content: 'no' }, signal)).ok)
    const command = await executeA('run_command', { command: 'node -p "process.cwd()"' }, signal)
    check('shell commands remain unavailable in Agent Sessions', !command.ok && command.output.includes('Unknown tool.'))
    const changed = await post({ action: 'settings', id: ca.id, workspaceId: b.id, workspace: '.' })
    check('an empty chat can change its working folder', changed.status === 200 && changed.data.conversation.workspaceId === b.id)
    const busy = changed.data.conversation
    busy.turns.push({ id: crypto.randomUUID(), request: 'hello', status: 'completed', startedAt: new Date().toISOString(), items: [], changes: [] })
    await store.saveConversation(busy)
    check('existing chat history cannot silently switch folders', (await post({ action: 'settings', id: ca.id, workspaceId: a.id })).status === 409)
    runtime.beginRun(busy, () => {})
    check('running chats cannot be deleted', (await post({ action: 'delete', id: ca.id })).status === 409)
    runtime.finishRun(ca.id)
    check('deletion rejects cross-origin requests', (await api.POST(req({ action: 'delete', id: ca.id }, 'https://untrusted.example'))).status === 403)
    check('idle chats can be deleted', (await post({ action: 'delete', id: ca.id })).status === 200)
    check('deleted chats disappear from the index and cannot reload', !(await store.listConversations()).some((item) => item.id === ca.id) && await store.getConversation(ca.id) === null)
    check('deleting one chat preserves other chats', (await store.getConversation(cb.id))?.workspaceId === b.id)
    await assert.rejects(() => store.saveConversation(busy))
    check('late saves cannot resurrect a deleted chat', true)
    check('Undo restores the original chat and messages', (await post({ action: 'restore', id: ca.id })).status === 200 && (await store.getConversation(ca.id))?.turns.length === 1)
    check('chat deletion never deletes project files', await fs.readFile(path.join(a.root, 'shared.txt'), 'utf8') === 'edited-A')
    check('invalid session ids fail cleanly', (await post({ action: 'delete', id: '../db' })).status === 404)
    console.log(`\n${passed} session control checks passed.`)
  } finally {
    globalThis.fetch = realFetch
    if (path.dirname(fixture) === os.tmpdir() && path.basename(fixture).startsWith('agenthub-session-controls-')) await fs.rm(fixture, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
