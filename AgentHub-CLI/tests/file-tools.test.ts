import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { BackupStore } from '../src/core/backups.ts'
import { PlanState } from '../src/core/plan.ts'
import { RunLedger } from '../src/core/ledger.ts'
import type { AgentEvent } from '../src/core/events.ts'
import type { PolicyAction } from '../src/policy/engine.ts'
import { editFileTool, writeFileTool } from '../src/tools/files.ts'
import type { ToolContext } from '../src/tools/types.ts'
import { emptySkills, removeDir, tempDir, testConfig } from './helpers.ts'

async function fixture(authorize?: ToolContext['authorize']) {
  const workspace = await tempDir('agenthub-file-tool-ws-')
  const home = await tempDir('agenthub-file-tool-home-')
  const config = testConfig(workspace, home, { permissionMode: 'ask' })
  const backups = new BackupStore(config)
  const events: AgentEvent[] = []
  const actions: PolicyAction[] = []
  const ledger = new RunLedger()
  const ctx: ToolContext = {
    runId: 'file-test',
    workspace,
    config,
    authorize: authorize ?? (async (action) => {
      actions.push(action)
      return { ok: true, reason: 'approved for test' }
    }),
    events: (event) => events.push(event),
    signal: new AbortController().signal,
    backups,
    skills: emptySkills(),
    plan: new PlanState(),
    ledger,
    activeSkills: new Set(),
  }
  return { workspace, home, config, backups, events, actions, ledger, ctx }
}

test('write_file aborts when the file changes while approval is pending', async () => {
  let file = ''
  const f = await fixture(async () => {
    await fs.writeFile(file, 'user edit during approval')
    return { ok: true, reason: 'approved' }
  })
  try {
    file = path.join(f.workspace, 'sample.txt')
    await fs.writeFile(file, 'before approval')

    const result = await writeFileTool.run({ path: 'sample.txt', content: 'agent replacement' }, f.ctx)

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /changed after this edit was prepared/)
    assert.equal(await fs.readFile(file, 'utf8'), 'user edit during approval')
    assert.deepEqual(await f.backups.list(), [])
  } finally {
    await removeDir(f.workspace)
    await removeDir(f.home)
  }
})

test('edit_file preserves CRLF, records an edit, and leaves a restorable backup', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.workspace, 'sample.txt')
    const original = 'first\r\nsecond\r\n'
    await fs.writeFile(file, original, 'utf8')

    const result = await editFileTool.run({ path: 'sample.txt', old_text: 'second\n', new_text: 'updated\n' }, f.ctx)

    assert.equal(result.ok, true)
    assert.equal(await fs.readFile(file, 'utf8'), 'first\r\nupdated\r\n')
    assert.equal(f.actions[0]?.kind, 'fs.write')
    assert.deepEqual(f.ledger.changedFiles().map((entry) => [entry.path, entry.change]), [['sample.txt', 'modified']])
    assert.ok(f.events.some((event) => event.type === 'files_changed' && event.path === 'sample.txt'))
    assert.equal((await f.backups.list()).length, 1)

    const restored = await f.backups.restoreLast()
    assert.equal(restored?.deleted, false)
    assert.equal(await fs.readFile(file, 'utf8'), original)
  } finally {
    await removeDir(f.workspace)
    await removeDir(f.home)
  }
})

test('write_file denied by policy leaves the file and backup history unchanged', async () => {
  const f = await fixture(async () => ({ ok: false, reason: 'Denied by test policy.', hard: true }))
  try {
    const file = path.join(f.workspace, 'sample.txt')
    await fs.writeFile(file, 'original', 'utf8')

    const result = await writeFileTool.run({ path: 'sample.txt', content: 'replacement' }, f.ctx)

    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Denied by test policy/)
    assert.equal(await fs.readFile(file, 'utf8'), 'original')
    assert.deepEqual(await f.backups.list(), [])
    assert.equal(f.ledger.changedFiles().length, 0)
    assert.equal(f.events.filter((event) => event.type === 'files_changed').length, 0)
  } finally {
    await removeDir(f.workspace)
    await removeDir(f.home)
  }
})

test('edit_file requires unambiguous text unless replace_all is selected', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.workspace, 'sample.txt')
    await fs.writeFile(file, 'foo foo', 'utf8')

    const ambiguous = await editFileTool.run({ path: 'sample.txt', old_text: 'foo', new_text: 'bar' }, f.ctx)
    assert.equal(ambiguous.ok, false)
    assert.match(ambiguous.error ?? '', /appears 2 times/)
    assert.equal(f.actions.length, 0, 'ambiguous edits must fail before authorization')
    assert.equal(await fs.readFile(file, 'utf8'), 'foo foo')

    const replaced = await editFileTool.run({ path: 'sample.txt', old_text: 'foo', new_text: 'bar', replace_all: true }, f.ctx)
    assert.equal(replaced.ok, true)
    assert.equal(await fs.readFile(file, 'utf8'), 'bar bar')
  } finally {
    await removeDir(f.workspace)
    await removeDir(f.home)
  }
})
