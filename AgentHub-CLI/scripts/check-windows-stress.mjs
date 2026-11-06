import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { loadConfig } from '../src/config/load.ts'
import { buildRepoContext } from '../src/context/repo.ts'
import { MemoryStore } from '../src/context/memory.ts'
import { SessionStore } from '../src/sessions/store.ts'

if (process.platform !== 'win32') throw new Error('This check is intended for Windows.')

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-windows-stress-'))
const workspace = path.join(root, 'workspace')
const home = path.join(root, 'home')
await fs.mkdir(workspace)
await fs.mkdir(home)
process.env.AGENTHUB_HOME = home

const config = await loadConfig({ cwd: workspace, cli: { workspace } })

const fileCount = 2500
const repoStart = performance.now()
for (let start = 0; start < fileCount; start += 100) {
  await Promise.all(Array.from({ length: Math.min(100, fileCount - start) }, async (_, offset) => {
    const index = start + offset
    const folder = path.join(workspace, `group-${Math.floor(index / 80).toString().padStart(2, '0')}`)
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, `module-${index.toString().padStart(4, '0')}.ts`), `export const value${index} = ${index}\n`)
  }))
}
await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { check: 'node --check index.js' } }))
const repo = await buildRepoContext(config)
const repoMs = Math.round(performance.now() - repoStart)
assert.ok(repo.treeCount > 140 && repo.treeCount <= 160, `Expected the repository scan to stop at its 160-entry cap; saw ${repo.treeCount}.`)
assert.ok(repo.notes.some((note) => note.includes('truncated')), 'Expected an explicit tree truncation note.')

const memoryStart = performance.now()
const memory = new MemoryStore(config)
await Promise.all(Array.from({ length: 150 }, (_, index) => memory.put(`Windows stress fact ${index}: value-${index}`, 'fact')))
const memoryEntries = await memory.list()
const memoryMs = Math.round(performance.now() - memoryStart)
assert.equal(memoryEntries.length, 150)
assert.equal(new Set(memoryEntries.map((entry) => entry.text)).size, 150)

const sessionStart = performance.now()
const sessions = new SessionStore(config)
const created = Array.from({ length: 100 }, (_, index) => sessions.create({
  task: `Windows stress session ${index}`,
  workspace,
  provider: 'lmstudio',
  model: 'stress-fixture',
  permissionMode: 'read-only',
}))
assert.equal(new Set(created.map((session) => session.id)).size, 100)
for (let start = 0; start < created.length; start += 20) {
  await Promise.all(created.slice(start, start + 20).map((session) => sessions.save(session)))
}
const loaded = await Promise.all(created.map((session) => sessions.load(session.id)))
const listed = await sessions.list(100)
const sessionsMs = Math.round(performance.now() - sessionStart)
assert.equal(loaded.length, 100)
assert.equal(listed.length, 100)
assert.equal(new Set(loaded.map((session) => session.id)).size, 100)

console.log(JSON.stringify({
  status: 'PASS',
  platform: process.platform,
  node: process.version,
  evidenceRoot: root,
  repository: { generatedFiles: fileCount, scannedEntries: repo.treeCount, truncated: repo.notes.some((note) => note.includes('truncated')), elapsedMs: repoMs },
  memory: { concurrentFacts: memoryEntries.length, uniqueFacts: new Set(memoryEntries.map((entry) => entry.text)).size, elapsedMs: memoryMs },
  sessions: { totalSaves: 100, maxConcurrentSaves: 20, loaded: loaded.length, listed: listed.length, elapsedMs: sessionsMs },
}, null, 2))
