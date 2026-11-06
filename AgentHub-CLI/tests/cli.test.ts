import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import http from 'node:http'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { exitCodeFor } from '../src/cli/headless.ts'
import { removeDir, tempDir } from './helpers.ts'

const execFileAsync = promisify(execFile)

function mainPath(): string {
  return fileURLToPath(new URL('../src/cli/main.ts', import.meta.url))
}

async function startMockProvider(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const send = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (!req.url) {
      res.writeHead(404).end()
      return
    }
    if (req.url.endsWith('/models')) {
      send({ data: [{ id: 'mock-model' }] })
      return
    }
    if (req.url.endsWith('/chat/completions')) {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        let body: { messages?: Array<{ role?: string; content?: string | null }> } = {}
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body
        } catch {
          res.writeHead(400).end('bad json')
          return
        }
        const messages = body.messages ?? []
        const isWriteRequest = messages.some(
          (message) => message.role === 'user' && (message.content ?? '').includes('WRITE_FILE'),
        )
        const hasToolResult = messages.some((message) => message.role === 'tool')
        if (isWriteRequest && !hasToolResult) {
          send({
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_cli_1',
                      type: 'function',
                      function: {
                        name: 'write_file',
                        arguments: JSON.stringify({ path: 'cli.txt', content: 'written by cli\n' }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 3 },
            model: 'mock-model',
          })
          return
        }
        send({
          choices: [{ message: { content: 'MOCK_OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 2 },
          model: 'mock-model',
        })
      })
      return
    }
    res.writeHead(404).end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No mock server address.')
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

async function runCli(
  args: string[],
  workspace: string,
  home: string,
  baseUrl: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(process.execPath, [mainPath(), '--workspace', workspace, ...args], {
      env: {
        ...process.env,
        AGENTHUB_HOME: home,
        AGENTHUB_BASE_URL: baseUrl,
        AGENTHUB_API_KEY: 'test-key',
        AGENTHUB_MODEL: 'mock-model',
        NO_COLOR: '1',
      },
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    })
    return { stdout: result.stdout, stderr: result.stderr, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 }
  }
}

test('exit code mapping is stable', () => {
  assert.equal(exitCodeFor({ status: 'completed' }), 0)
  assert.equal(exitCodeFor({ status: 'failed' }), 1)
  assert.equal(exitCodeFor({ status: 'cancelled' }), 3)
  assert.equal(exitCodeFor({ status: 'partial' }), 4)
})

test('CLI exposes migration, backup previews and review enforces read-only even with --yes', async () => {
  const workspace = await tempDir('agenthub-new-cli-ws-')
  const home = await tempDir('agenthub-new-cli-home-')
  const server = await startMockProvider()
  try {
    const file = path.join(home, 'config.json')
    const original = '{"provider":"custom"}'
    await fs.writeFile(file, original)
    const preview = await runCli(['config', 'migrate', '--user', '--dry-run', '--json'], workspace, home, server.url)
    assert.equal(preview.code, 0, preview.stderr)
    assert.equal(JSON.parse(preview.stdout).changed, true)
    assert.equal(await fs.readFile(file, 'utf8'), original)
    const migrated = await runCli(['config', 'migrate', '--user', '--json'], workspace, home, server.url)
    assert.equal(migrated.code, 0, migrated.stderr)
    assert.equal(await fs.readFile(JSON.parse(migrated.stdout).backup, 'utf8'), original)
    const backups = await runCli(['backups', 'prune', '--dry-run', '--json'], workspace, home, server.url)
    assert.equal(backups.code, 0, backups.stderr)
    assert.equal(JSON.parse(backups.stdout).dryRun, true)
    const review = await runCli(['--review', '--json', '--yes', 'WRITE_FILE'], workspace, home, server.url)
    assert.equal(review.code, 4, review.stderr)
    const events = review.stdout.trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(events.find((e) => e.type === 'run_started').permission, 'read-only')
    assert.equal(events.filter((e) => e.type === 'approval_requested').length, 0)
    await assert.rejects(fs.access(path.join(workspace, 'cli.txt')), { code: 'ENOENT' })
  } finally { await server.close(); await removeDir(workspace); await removeDir(home) }
})

test('doctor --probe exits nonzero when the selected model returns text instead of a tool call', async () => {
  const workspace = await tempDir('agenthub-doctor-ws-')
  const home = await tempDir('agenthub-doctor-home-')
  const server = await startMockProvider()
  try {
    const result = await runCli(['doctor', '--json', '--probe'], workspace, home, server.url)
    assert.equal(result.code, 1)
    const report = JSON.parse(result.stdout) as { ok: boolean; toolProbe: { status: string } }
    assert.equal(report.ok, false)
    assert.equal(report.toolProbe.status, 'inconclusive')
  } finally { await server.close(); await removeDir(workspace); await removeDir(home) }
})

test('doctor fails when session storage cannot be created', async () => {
  const workspace = await tempDir('agenthub-doctor-ws-')
  const home = await tempDir('agenthub-doctor-home-')
  const server = await startMockProvider()
  try {
    await fs.writeFile(path.join(home, 'sessions'), 'a file blocks the directory')
    const result = await runCli(['doctor', '--json'], workspace, home, server.url)
    assert.equal(result.code, 1)
    const report = JSON.parse(result.stdout) as { ok: boolean; sessions: { writable: boolean } }
    assert.equal(report.ok, false)
    assert.equal(report.sessions.writable, false)
  } finally { await server.close(); await removeDir(workspace); await removeDir(home) }
})

test('the launcher handles a headless SIGINT event, saves cancellation, and exits 3', { timeout: 15_000 }, async () => {
  const workspace = await tempDir('agenthub-signal-ws-')
  const home = await tempDir('agenthub-signal-home-')
  let child: ReturnType<typeof spawn> | undefined
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
      return
    }
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"Waiting"}}]}\n\n')
      child?.send('interrupt')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const launcher = fileURLToPath(new URL('../bin/agenthub.mjs', import.meta.url))
    const args = ['--workspace', workspace, '--json', 'wait']
    const harness = `process.argv = ${JSON.stringify([process.execPath, launcher, ...args])};
      process.on('message', () => process.emit('SIGINT'));
      await import(${JSON.stringify(pathToFileURL(launcher).href)});
      process.disconnect();`
    child = spawn(process.execPath, ['--input-type=module', '-e', harness], {
      env: { ...process.env, AGENTHUB_HOME: home, AGENTHUB_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        AGENTHUB_PROVIDER: 'custom', AGENTHUB_MODEL: 'mock-model', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const code = await new Promise<number | null>((resolve, reject) => {
      child!.once('error', reject)
      child!.once('close', resolve)
    })
    assert.equal(code, 3, stderr)
    const events = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line) as { type: string; status?: string; sessionId?: string })
    assert.equal(events.at(-1)?.status, 'cancelled')
    assert.equal(events.filter((event) => event.type === 'run_completed').length, 1)
    const sessionId = events.at(-1)?.sessionId
    const saved = JSON.parse(await fs.readFile(path.join(home, 'sessions', `${sessionId}.json`), 'utf8')) as { status: string }
    assert.equal(saved.status, 'cancelled')
  } finally {
    if (child && child.exitCode === null) child.kill()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('--print returns the answer and evidence; --json emits one object per line', async () => {
  const workspace = await tempDir('agenthub-cli-ws-')
  const home = await tempDir('agenthub-cli-home-')
  const server = await startMockProvider()
  try {
    await fs.writeFile(path.join(workspace, 'README.md'), '# cli\n', 'utf8')

    const printed = await runCli(['--print', '--max-steps', '2', 'say ok'], workspace, home, server.url)
    assert.equal(printed.code, 0)
    assert.match(printed.stdout, /MOCK_OK/)
    assert.match(printed.stderr, /--- evidence ---/)
    assert.doesNotMatch(printed.stderr, /test-key/)

    const json = await runCli(['--json', '--max-steps', '2', 'say ok'], workspace, home, server.url)
    assert.equal(json.code, 0)
    const lines = json.stdout.trim().split(/\r?\n/).filter(Boolean)
    assert.ok(lines.length >= 3)
    const events = lines.map((line) => JSON.parse(line) as { type?: string; status?: string })
    assert.equal(events[0]?.type, 'run_started')
    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(events.at(-1)?.status, 'completed')
    assert.equal(events.filter((event) => event.type === 'run_completed').length, 1)
  } finally {
    await server.close()
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('a denied write in --json mode exits 4 and creates no file', async () => {
  const workspace = await tempDir('agenthub-cli-ws-')
  const home = await tempDir('agenthub-cli-home-')
  const server = await startMockProvider()
  try {
    await fs.writeFile(path.join(workspace, 'README.md'), '# cli\n', 'utf8')
    const result = await runCli(['--json', '--max-steps', '3', 'WRITE_FILE now'], workspace, home, server.url)
    assert.equal(result.code, 4)
    const events = result.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; status?: string })
    const completed = events.find((event) => event.type === 'run_completed')
    assert.equal(completed?.status, 'partial')
    await assert.rejects(() => fs.access(path.join(workspace, 'cli.txt')))
  } finally {
    await server.close()
    await removeDir(workspace)
    await removeDir(home)
  }
})
