import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { removeDir, tempDir } from './helpers.ts'

const exec = promisify(execFile)
const main = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))

async function fixture() {
  const root = await tempDir('agenthub-memory-json-')
  const workspace = path.join(root, 'workspace')
  const home = path.join(root, 'home')
  await fs.mkdir(workspace)
  const run = async (...args: string[]) => {
    const options = { cwd: workspace, env: { ...process.env, AGENTHUB_HOME: home, NO_COLOR: '1' }, windowsHide: true, timeout: 15_000 }
    let stdout: string
    let code = 0
    try { stdout = (await exec(process.execPath, [main, '--workspace', workspace, 'memory', ...args, '--json'], options)).stdout }
    catch (err) { const failure = err as { stdout: string; code: number }; stdout = failure.stdout; code = failure.code }
    return { code, data: JSON.parse(stdout) as { ok: boolean; added?: string; duplicate?: boolean; error?: string; entries?: Array<{ text: string }> } }
  }
  return { root, workspace, run }
}

test('memory JSON mode keeps duplicate and failure responses machine readable', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.run('add', 'Prefer TypeScript')).data.ok, true)
    const duplicate = await f.run('add', 'prefer typescript')
    assert.equal(duplicate.code, 0)
    assert.equal(duplicate.data.duplicate, true)
    const missing = await f.run('remove', '99')
    assert.equal(missing.code, 1)
    assert.equal(missing.data.ok, false)
    const secret = await f.run('add', 'token=abcdefghijklmnopqrstuvwx')
    assert.equal(secret.code, 2)
    assert.equal(secret.data.ok, false)
    assert.equal(JSON.stringify(secret.data).includes('abcdefghijklmnopqrstuvwx'), false)
  } finally { await removeDir(f.root) }
})

test('memory deduplication does not discard a distinct entry that is a substring', async () => {
  const f = await fixture()
  try {
    await f.run('add', 'Prefer TypeScript for application code')
    const added = await f.run('add', 'Prefer TypeScript')
    assert.equal(added.data.added, 'Prefer TypeScript')
    assert.equal((await f.run('list')).data.entries?.length, 2)
  } finally { await removeDir(f.root) }
})

test('memory size failure emits JSON and preserves the file bytes', async () => {
  const f = await fixture()
  try {
    const memoryPath = path.join(f.workspace, '.agenthub', 'memory.md')
    await fs.mkdir(path.dirname(memoryPath))
    const before = '- ' + 'x'.repeat(65_520) + '\n'
    await fs.writeFile(memoryPath, before)
    const result = await f.run('add', 'A durable fact which exceeds the remaining capacity')
    assert.equal(result.code, 1)
    assert.equal(result.data.ok, false)
    assert.equal(await fs.readFile(memoryPath, 'utf8'), before)
  } finally { await removeDir(f.root) }
})
