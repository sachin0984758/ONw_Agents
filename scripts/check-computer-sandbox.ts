import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readComputerPreferences } from '../src/lib/agent-hub/computer/preferences'
import { resolveWorkspace } from '../src/lib/agent-hub/session/workspaces'
import { createConversation } from '../src/lib/agent-hub/session/store'
import { createToolExecutor } from '../src/lib/agent-hub/session/tools'

async function main() {
  let passed = 0
  const check = (label: string, value: unknown) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`) }
  const preferences = await readComputerPreferences()
  const workspace = await resolveWorkspace(preferences.workspaceId)
  check('Auto has a saved registered sandbox workspace', !!preferences.workspaceId && workspace.root.toLowerCase() === path.join(os.homedir(), 'AgentHub-Sandbox').toLowerCase())
  const directory = `checks/verify-${Date.now()}`
  const note = `${directory}/note.txt`
  const script = `${directory}/verify.cjs`
  const conversation = createConversation({ workspace: '.', workspaceId: workspace.id, mode: 'edit' })
  const execute = createToolExecutor(conversation, `Create and verify ${note} and ${script} in the sandbox.`)
  const signal = new AbortController().signal
  check('file creation works inside the sandbox', (await execute('write_file', { path: note, content: 'Sandbox creation verified\n' }, signal)).ok)
  check('file reads return actual sandbox contents', (await execute('read_file', { path: note }, signal)).output.includes('Sandbox creation verified'))
  check('an existing file can be updated after reading it', (await execute('edit_file', { path: note, oldText: 'creation', newText: 'update' }, signal)).ok)
  const content = `const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');assert.equal(process.cwd().toLowerCase(),${JSON.stringify(workspace.root.toLowerCase())});assert.equal(fs.readFileSync(path.join(__dirname,'note.txt'),'utf8'),'Sandbox update verified\\n');console.log('SANDBOX_READY');`
  check('a verification script can be created', (await execute('write_file', { path: script, content }, signal)).ok)
  const run = await execute('run_command', { command: `node ${script}` }, signal)
  check('commands run in the sandbox and verify the actual edited file', run.ok && run.output.includes('SANDBOX_READY'))
  check('independent filesystem reads confirm the update', await fs.readFile(path.join(workspace.root, note), 'utf8') === 'Sandbox update verified\n')
  await assert.rejects(() => execute('read_file', { path: '../outside.txt' }, signal))
  check('file tools cannot traverse outside the sandbox', true)
  await fs.mkdir('output/computer-use', { recursive: true })
  await fs.writeFile('output/computer-use/sandbox-acceptance.json', JSON.stringify({ passed, checkedAt: new Date().toISOString(), root: workspace.root, workspaceId: workspace.id, directory, commandResult: run.output }, null, 2))
  console.log(`\n${passed} sandbox workspace checks passed.`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
