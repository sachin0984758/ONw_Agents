import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { NextRequest } from 'next/server'

async function main() {
  const base = path.resolve(os.tmpdir())
  const fixture = await fs.mkdtemp(path.join(base, 'agenthub-auto-preferences-'))
  process.env.AGENT_HUB_DB_DIR = path.join(fixture, 'db')
  process.env.AGENT_SESSION_WORKSPACE = fixture
  process.env.AGENTHUB_LOCAL_ONLY = '1'
  let passed = 0
  const check = (label: string, value: unknown) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`) }
  try {
    const { registerWorkspace } = await import('../src/lib/agent-hub/session/workspaces')
    const { readComputerPreferences } = await import('../src/lib/agent-hub/computer/preferences')
    const { needsAutoApproval, validateComputerScope, assertScopeTool } = await import('../src/lib/agent-hub/computer/access')
    const grant = { applications: ['notepad'], domains: [], readonly: false }
    check('old grants default to asking every time', validateComputerScope(grant).approvalMode === 'always-ask' && needsAutoApproval(grant, 'desktop.open_application'))
    check('Ask every time requires approval for app launch and typing', needsAutoApproval({ ...grant, approvalMode: 'always-ask' }, 'desktop.open_application') && needsAutoApproval({ ...grant, approvalMode: 'always-ask' }, 'desktop.type_text'))
    check('Ask when needed allows app launch but requires approval for input and file changes', !needsAutoApproval({ ...grant, approvalMode: 'when-needed' }, 'desktop.open_application') && ['desktop.click', 'desktop.type_text', 'browser.navigate', 'run_command', 'delete_file'].every((name) => needsAutoApproval({ ...grant, approvalMode: 'when-needed' }, name)))
    check('Full access suppresses individual prompts', !needsAutoApproval({ ...grant, approvalMode: 'full' }, 'desktop.type_text'))
    check('Full access cannot override observe-only', needsAutoApproval({ ...grant, readonly: true, approvalMode: 'full' }, 'desktop.type_text'))
    assert.throws(() => assertScopeTool({ ...grant, approvalMode: 'full' }, 'write_file'), /Workspace write permission/)
    assert.throws(() => assertScopeTool({ ...grant, approvalMode: 'full' }, 'browser.open'), /Browser permission/)
    assert.throws(() => assertScopeTool(undefined, 'desktop.type_text'), /revoked/)
    check('full mode preserves workspace, browser and revocation boundaries', true)
    const { POST } = await import('../src/app/api/computer/route')
    const root = path.join(fixture, 'Sandbox')
    await fs.mkdir(root)
    const selected = await registerWorkspace(root)
    const post = (workspaceId?: string, origin: string | null = 'http://localhost') => POST(new NextRequest('http://localhost/api/computer', { method: 'POST', headers: { Host: 'localhost', 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ action: 'workspace', workspaceId }) }))
    check('a new installation has no silently selected extra folder', !(await readComputerPreferences()).workspaceId)
    const saved = await post(selected.id)
    check('a registered sandbox can be saved as the default', saved.ok && (await saved.json()).preferences.workspaceId === selected.id)
    check('the preference is persisted on disk', JSON.parse(await fs.readFile(path.join(fixture, 'db/computer-preferences.json'), 'utf8')).workspaceId === selected.id)
    check('an unknown workspace cannot be selected', (await post(crypto.randomUUID())).status === 400)
    check('an absolute path cannot bypass the registry', (await post(root)).status === 400)
    check('invalid selections preserve the existing preference', (await readComputerPreferences()).workspaceId === selected.id)
    check('cross-origin pages cannot change the default', (await post(selected.id, 'https://untrusted.example')).status === 403)
    check('requests without Origin cannot change the default', (await post(selected.id, null)).status === 403)
    check('explicitly selecting the app root can clear the preference', (await post()).ok && !(await readComputerPreferences()).workspaceId)
    console.log(`\n${passed} workspace preference checks passed.`)
  } finally {
    assert.ok(path.dirname(path.resolve(fixture)) === base && path.basename(fixture).startsWith('agenthub-auto-preferences-'))
    await fs.rm(fixture, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
