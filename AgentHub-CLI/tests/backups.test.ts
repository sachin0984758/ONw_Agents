import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { BackupStore } from '../src/core/backups.ts'
import { removeDir, tempDir, testConfig } from './helpers.ts'

async function fixture() {
  const root = await tempDir('agenthub-backup-test-')
  const workspace = path.join(root, 'workspace')
  const home = path.join(root, 'home')
  await fs.mkdir(workspace)
  const store = new BackupStore(testConfig(workspace, home))
  return { root, workspace, store }
}

test('undo restores the original bytes when the current file still matches the recorded AgentHub write', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.workspace, 'sample.txt')
    const original = Buffer.from('before\r\n')
    await fs.writeFile(file, original)
    await f.store.backup(file, 'after\r\n')
    await fs.writeFile(file, 'after\r\n')

    const restored = await f.store.restoreLast()

    assert.equal(restored?.deleted, false)
    assert.deepEqual(await fs.readFile(file), original)
  } finally {
    await removeDir(f.root)
  }
})

test('undo leaves a user-edited file untouched after AgentHub changes it', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.workspace, 'sample.txt')
    await fs.writeFile(file, 'before')
    await f.store.backup(file, 'agent result')
    await fs.writeFile(file, 'agent result')
    await fs.writeFile(file, 'later user edit')

    await assert.rejects(f.store.restoreLast(), /changed after AgentHub recorded the write/)
    assert.equal(await fs.readFile(file, 'utf8'), 'later user edit')
  } finally {
    await removeDir(f.root)
  }
})

test('undo does not delete a created file after a later user edit', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.workspace, 'created.txt')
    await f.store.backup(file, 'agent result')
    await fs.writeFile(file, 'agent result')
    await fs.writeFile(file, 'user data')

    await assert.rejects(f.store.restoreLast(), /changed after AgentHub created it/)
    assert.equal(await fs.readFile(file, 'utf8'), 'user data')
  } finally {
    await removeDir(f.root)
  }
})

test('undo refuses legacy fingerprints and modified backup contents', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.workspace, 'sample.txt')
    await fs.writeFile(file, 'before')
    await f.store.backup(file, 'after')
    await fs.writeFile(file, 'after')
    const saved = (await f.store.list())[0]
    assert.ok(saved?.backup)
    await fs.writeFile(saved.backup, 'tampered backup')

    await assert.rejects(f.store.restoreLast(), /saved backup is missing or has changed/)
    assert.equal(await fs.readFile(file, 'utf8'), 'after')

    await fs.writeFile(path.join(f.store.root, 'index.json'), JSON.stringify([{
      at: new Date().toISOString(), original: file, backup: saved.backup, existed: true,
    }]))
    await assert.rejects(f.store.restoreLast(), /no recorded post-change fingerprint/)
    assert.equal(await fs.readFile(file, 'utf8'), 'after')
  } finally {
    await removeDir(f.root)
  }
})

test('corrupt backup index fails closed without replacing the index or source file', async () => {
  const f = await fixture()
  try {
    const file = path.join(f.workspace, 'sample.txt')
    const corruptIndex = '{broken json'
    await fs.writeFile(file, 'keep')
    await fs.mkdir(f.store.root, { recursive: true })
    await fs.writeFile(path.join(f.store.root, 'index.json'), corruptIndex)

    await assert.rejects(f.store.backup(file, 'new value'), /Backup index is not valid JSON/)
    assert.equal(await fs.readFile(path.join(f.store.root, 'index.json'), 'utf8'), corruptIndex)
    assert.equal(await fs.readFile(file, 'utf8'), 'keep')
  } finally {
    await removeDir(f.root)
  }
})
