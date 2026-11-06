import assert from 'node:assert/strict'
import test from 'node:test'
import { filterSensitiveEnvironment } from '../src/utils/env.ts'
import { execShell } from '../src/tools/shell.ts'

test('shell environment filters common credential variables and keeps ordinary runtime settings', () => {
  const filtered = filterSensitiveEnvironment({
    PATH: 'safe-path',
    NODE_ENV: 'test',
    OPENAI_API_KEY: 'secret-openai',
    GITHUB_TOKEN: 'secret-github',
    DATABASE_PASSWORD: 'secret-db',
    DATABASE_URL: 'postgres://user:secret@localhost/test',
    AWS_ACCESS_KEY_ID: 'secret-aws',
    GITHUB_WORKSPACE: 'C:\\repo',
  })
  assert.equal(filtered.PATH, 'safe-path')
  assert.equal(filtered.NODE_ENV, 'test')
  assert.equal(filtered.GITHUB_WORKSPACE, 'C:\\repo')
  assert.equal(filtered.OPENAI_API_KEY, undefined)
  assert.equal(filtered.GITHUB_TOKEN, undefined)
  assert.equal(filtered.DATABASE_PASSWORD, undefined)
  assert.equal(filtered.DATABASE_URL, undefined)
  assert.equal(filtered.AWS_ACCESS_KEY_ID, undefined)
})

test('spawned shell commands do not inherit credential-like environment values', async () => {
  const name = 'AGENTHUB_TEST_TOKEN'
  const previous = process.env[name]
  process.env[name] = 'do-not-expose-this'
  try {
    const result = await execShell(
      process.execPath,
      ['-e', `process.stdout.write(process.env.${name} ?? 'filtered')`],
      process.cwd(),
      5_000,
      1_000,
      new AbortController().signal,
    )
    assert.equal(result.code, 0)
    assert.equal(result.stdout, 'filtered')
  } finally {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
})

test('shell output limit applies to stdout and stderr combined', async () => {
  const controller = new AbortController()
  const script = "process.stdout.write(Buffer.alloc(800, 97)); process.stderr.write(Buffer.alloc(800, 98))"
  const result = await execShell(process.execPath, ['-e', script], process.cwd(), 5_000, 1_000, controller.signal)
  assert.equal(result.code, 0)
  assert.equal(result.truncated, true)
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 1_000)
})
