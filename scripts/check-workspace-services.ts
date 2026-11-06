import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-services-'))
  process.env.AGENT_HUB_DB_DIR = path.join(fixture, 'db')
  process.env.AGENT_SESSION_WORKSPACE = path.join(fixture, 'a')
  let passed = 0
  const check = (name: string, value: unknown) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`) }
  try {
    for (const name of ['a', 'b', 'db']) await fs.mkdir(path.join(fixture, name))
    const { readWorkspaceFiles, mutateWorkspaceFile } = await import('../src/lib/agent-hub/workspace-files')
    const { readWorkspaceCommands, executeWorkspaceCommand } = await import('../src/lib/agent-hub/workspace-exec')
    const { withWorkspaceRoot } = await import('../src/lib/agent-hub/session/workspaces')
    const files = await import('../src/app/api/agent-session/files/route')
    const commands = await import('../src/app/api/agent-session/exec/route')
    const request = (body: unknown, origin = 'http://localhost', raw = false) => new NextRequest('http://localhost/api/agent-session/files', { method: 'POST', headers: { host: 'localhost', origin, 'content-type': 'application/json' }, body: raw ? String(body) : JSON.stringify(body) })
    const q = (values: Record<string, string>) => new URLSearchParams(values)
    check('file adapter refuses cross-origin mutation', (await files.POST(request({}, 'https://untrusted.example'))).status === 403)
    check('command adapter refuses cross-origin mutation', (await commands.POST(request({}, 'https://untrusted.example'))).status === 403)
    for (const input of [null, [], 'text']) {
      check('file service rejects non-object JSON', (await mutateWorkspaceFile(input)).status === 400)
      check('command service rejects non-object JSON', (await executeWorkspaceCommand(input)).status === 400)
    }
    check('file adapter rejects invalid JSON', (await files.POST(request('{', undefined, true))).status === 400)
    check('command adapter rejects invalid JSON', (await commands.POST(request('{', undefined, true))).status === 400)
    check('read-only mode blocks file writes', (await mutateWorkspaceFile({ op: 'write', path: 'sample.txt', content: 'alpha', mode: 'ro' })).status === 403)
    check('read-only mode blocks commands', (await executeWorkspaceCommand({ command: 'echo safe', mode: 'ro' })).status === 403)
    const write = { op: 'write', path: 'sample.txt', content: 'alpha', mode: 'edit' }
    check('HTTP adapter creates real fixture file', (await files.POST(request(write))).status === 200)
    check('shared service reads the same bytes', (await readWorkspaceFiles(q({ op: 'read', path: 'sample.txt' }))).body.content === 'alpha')
    check('shared service edits real file', (await mutateWorkspaceFile({ op: 'edit', path: 'sample.txt', oldText: 'alpha', newText: 'beta', mode: 'edit' })).body.ok)
    check('HTTP adapter reads edited bytes', (await (await files.GET(new NextRequest('http://localhost/api/agent-session/files?op=read&path=sample.txt', { headers: { host: 'localhost' } }))).json()).content === 'beta')
    check('path traversal remains blocked', (await readWorkspaceFiles(q({ op: 'read', path: '../outside' }))).status === 400)
    await fs.writeFile(path.join(fixture, 'b', 'outside-private.txt'), 'OUTSIDE_ONLY_MARKER')
    await fs.symlink(path.join(fixture, 'b'), path.join(fixture, 'a', 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir')
    check('recursive search never follows an outside junction', ((await readWorkspaceFiles(q({ op: 'search', pattern: 'OUTSIDE_ONLY_MARKER' }))).body.matches as unknown[]).length === 0)
    check('recursive filenames never follow an outside junction', ((await readWorkspaceFiles(q({ op: 'filenames', q: 'outside-private' }))).body.files as unknown[]).length === 0)
    check('recursive tree never follows an outside junction', !JSON.stringify((await readWorkspaceFiles(q({ op: 'tree' }))).body).includes('outside-private'))
    await fs.mkdir(path.join(fixture, 'a', 'db'))
    await fs.symlink(path.join(fixture, 'a', 'db'), path.join(fixture, 'a', 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    check('a directory alias cannot bypass protected-location writes', (await mutateWorkspaceFile({ ...write, path: 'alias/hidden.json' })).status === 403)
    check('protected destination is untouched', (await fs.readdir(path.join(fixture, 'a', 'db'))).length === 0)
    check('secret reads remain blocked', (await readWorkspaceFiles(q({ op: 'read', path: '.env.local' }))).status === 403)
    check('generated lockfile writes remain blocked', (await mutateWorkspaceFile({ ...write, path: 'package-lock.json' })).status === 403)
    const abort = new AbortController(); abort.abort()
    check('cancelled recursive counts return 408', (await readWorkspaceFiles(q({ op: 'count' }), abort.signal)).status === 408)
    check('command blocklist remains enforced', (await executeWorkspaceCommand({ command: 'shutdown /s', mode: 'edit' })).status === 403)
    check('command cwd cannot escape selected project', (await executeWorkspaceCommand({ command: 'echo safe', workspace: '../b', mode: 'edit' })).status === 400)
    const cwd = await executeWorkspaceCommand({ command: 'node -p "process.cwd()"', mode: 'edit' })
    check('real command executes inside fixture project', cwd.body.exitCode === 0 && String(cwd.body.stdout).trim() === path.join(fixture, 'a'))
    const exit = await executeWorkspaceCommand({ command: 'node -e "process.exit(7)"', mode: 'edit' })
    check('real nonzero exit is preserved', exit.body.exitCode === 7)
    const output = await executeWorkspaceCommand({ command: 'node -e "console.log(String.fromCharCode(120).repeat(100000))"', mode: 'edit' })
    check('real command output is bounded and flagged', output.body.truncated === true && String(output.body.stdout).length < 70000)
    const task = await executeWorkspaceCommand({ command: 'node -e "console.log(42)"', background: true, mode: 'edit' })
    check('background task is visible to its owning project', (await readWorkspaceCommands(q({ op: 'list' }))).body.tasks instanceof Array && task.body.ok)
    await withWorkspaceRoot(path.join(fixture, 'b'), async () => {
      check('other project cannot list task', ((await readWorkspaceCommands(q({ op: 'list' }))).body.tasks as unknown[]).length === 0)
      check('other project cannot read task logs', (await readWorkspaceCommands(q({ op: 'logs', taskId: String(task.body.id) }))).status === 404)
      check('other project cannot stop task', (await executeWorkspaceCommand({ action: 'stop', taskId: task.body.id, mode: 'edit' })).status === 404)
    })
    const state = path.join(fixture, 'db', 'agent-hub-state.json')
    await fs.writeFile(state, JSON.stringify({ settings: { codeExecution: false } }))
    check('persisted capability switch blocks mutation', (await mutateWorkspaceFile(write)).status === 403)
    check('persisted capability switch blocks command', (await executeWorkspaceCommand({ command: 'echo safe', mode: 'edit' })).status === 403)
    check('reads still work when execution is disabled', (await readWorkspaceFiles(q({ op: 'read', path: 'sample.txt' }))).body.content === 'beta')
    await fs.unlink(state)
    check('file deletion only removes test file', (await mutateWorkspaceFile({ op: 'delete', path: 'sample.txt', mode: 'edit' })).body.deleted)
    check('deleted test file is no longer readable', (await readWorkspaceFiles(q({ op: 'read', path: 'sample.txt' }))).status === 404)
    console.log(`\n${passed} workspace service checks passed.`)
  } finally {
    assert.equal(path.dirname(fixture), os.tmpdir())
    await fs.rm(fixture, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
