import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-platform-'))
  process.env.AGENT_HUB_DB_DIR = path.join(fixture, 'db')
  process.env.AGENT_SESSION_WORKSPACE = path.join(fixture, 'project')
  await fs.mkdir(process.env.AGENT_SESSION_WORKSPACE, { recursive: true })
  await fs.writeFile(path.join(process.env.AGENT_SESSION_WORKSPACE, 'hello.txt'), 'original')
  let passed = 0
  const check = (label: string, value: unknown) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`) }
  try {
    const { createConversation, saveConversation, getConversation } = await import('../src/lib/agent-hub/session/store')
    const { registerWorkspace } = await import('../src/lib/agent-hub/session/workspaces')
    const { createAuthorizedToolExecutor, sessionWorkspaceAccess, setSessionWorkspaceAccess } = await import('../src/lib/agent-hub/session/permissions')
    const { readModelPreference, saveModelPreference } = await import('../src/lib/agent-hub/model-preference-server')
    const { resolveModelTarget, isLoopbackModelEndpoint } = await import('../src/lib/agent-hub/model-routing')
    const { POST, GET } = await import('../src/app/api/agent-session/conversations/route')
    const send = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/agent-session/conversations', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost' }, body: JSON.stringify(body) }))
    const created = await (await send({ action: 'create', mode: 'edit' })).json()
    check('new HTTP sessions start without a selected folder or access, even with edit requested', created.ok && !created.conversation.workspaceId && created.conversation.workspaceAccess === 'none' && created.conversation.mode === 'ro' && created.workspace === null)
    check('conversation listing does not inspect the default project', (await (await GET(new NextRequest('http://localhost/api/agent-session/conversations'))).json()).workspace === null)
    const selected = await registerWorkspace(process.env.AGENT_SESSION_WORKSPACE)
    const session = createConversation({ workspace: '.', workspaceId: selected.id, mode: 'edit' })
    await saveConversation(session)
    const execute = createAuthorizedToolExecutor(session, 'Change hello.txt; delete hello.txt')
    const signal = new AbortController().signal
    check('a registered selected folder does not imply a grant', await sessionWorkspaceAccess(session.id, selected.id) === 'none')
    for (const tool of ['workspace_info', 'list_files', 'read_file', 'search', 'count_files', 'write_file', 'run_command']) check(`no access rejects ${tool}`, !(await execute(tool, { path: 'hello.txt', content: 'bad', command: 'echo bad' }, signal)).ok)
    check('planning works before folder authorization', (await execute('plan', { action: 'set', text: 'inspect; edit; verify' }, signal)).ok)
    await assert.rejects(setSessionWorkspaceAccess(session.id, undefined, 'read'), /Select a folder/)
    check('read permission cannot grant an implicit root', true)
    await setSessionWorkspaceAccess(session.id, selected.id, 'read')
    check('explicit reading returns the actual file', (await execute('read_file', { path: 'hello.txt' }, signal)).output.includes('original'))
    check('read grant rejects writing despite edit mode', !(await execute('write_file', { path: 'hello.txt', content: 'bad' }, signal)).ok)
    await setSessionWorkspaceAccess(session.id, selected.id, 'write')
    check('authorized writes use the existing reviewed file service', (await execute('edit_file', { path: 'hello.txt', oldText: 'original', newText: 'updated' }, signal)).ok && await fs.readFile(path.join(selected.root, 'hello.txt'), 'utf8') === 'updated')
    check('parent traversal remains blocked after granting write', !(await execute('read_file', { path: '../outside.txt' }, signal).catch(() => ({ ok: false }))).ok)
    await setSessionWorkspaceAccess(session.id, selected.id, 'none')
    session.workspaceAccess = 'write'; await saveConversation(session)
    check('saving a stale session cannot restore a revoked grant', await sessionWorkspaceAccess(session.id, selected.id) === 'none' && !(await execute('read_file', { path: 'hello.txt' }, signal)).ok)
    const other = await registerWorkspace(fixture)
    await setSessionWorkspaceAccess(session.id, other.id, 'read')
    check('a grant is bound to its exact workspace', await sessionWorkspaceAccess(session.id, selected.id) === 'none')
    const denied = await send({ action: 'settings', id: session.id, mode: 'edit' })
    check('HTTP settings cannot enable edit without write access', denied.status === 403)
    const grant = await send({ action: 'settings', id: session.id, workspaceAccess: 'write', mode: 'edit' })
    check('explicit HTTP grant applies to the selected folder', grant.ok && (await grant.json()).conversation.workspaceAccess === 'write')
    await send({ action: 'settings', id: session.id, workspaceAccess: 'none' })
    check('HTTP revocation blocks the next protected action', !(await execute('read_file', { path: 'hello.txt' }, signal)).ok)
    const aborted = new AbortController(); aborted.abort()
    await assert.rejects(execute('plan', { action: 'show' }, aborted.signal))
    check('cancellation stops tool dispatch', true)
    check('saved user conversation data remains', !!await getConversation(session.id))
    const initial = await readModelPreference()
    check('shared preference defaults to Auto with remote inference disabled', initial.model === '' && !initial.allowRemote)
    await Promise.all([saveModelPreference({ model: 'manual-local' }), saveModelPreference({ allowRemote: true })])
    check('concurrent preference updates retain both fields', (await readModelPreference()).model === 'manual-local' && (await readModelPreference()).allowRemote)
    await saveModelPreference({ model: '', allowRemote: false })
    check('loopback classification rejects remote/LAN/URL credentials', isLoopbackModelEndpoint('http://127.0.0.1:1234/v1') && isLoopbackModelEndpoint('http://[::1]:1234/v1') && !isLoopbackModelEndpoint('http://localhost.evil/v1') && !isLoopbackModelEndpoint('http://user:secret@localhost/v1') && !isLoopbackModelEndpoint('http://192.168.1.2:1234/v1'))
    const remote = [{ id: 'custom-remote', name: 'Remote', modelId: 'test', endpoint: 'https://example.com/v1', apiKey: 'never-log-this' }]
    await assert.rejects(resolveModelTarget('custom-remote', remote), /Remote model inference is disabled/)
    check('remote model requests are rejected before network dispatch by default', true)
    await saveModelPreference({ allowRemote: true })
    check('explicit remote inference consent enables a configured target', (await resolveModelTarget('custom-remote', remote)).modelId === 'test')
    await assert.rejects(resolveModelTarget('custom-remote', remote, { localOnly: true }), /only local/)
    check('Auto local-only policy remains stronger than global remote consent', true)
    const local = [{ ...remote[0], id: 'local-custom', endpoint: 'http://localhost:1234/v1' }]
    await saveModelPreference({ allowRemote: false })
    check('loopback custom endpoints do not require internet permission', (await resolveModelTarget('local-custom', local)).endpoint.includes('localhost'))
    console.log(`\n${passed} platform permission and routing checks passed.`)
  } finally {
    const target = path.resolve(fixture)
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('agenthub-platform-')) throw new Error('Unsafe fixture cleanup target.')
    await fs.rm(target, { recursive: true, force: true })
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
