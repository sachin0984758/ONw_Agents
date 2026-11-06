import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-package-check-'))
const npmCli = process.env.npm_execpath
assert.ok(npmCli, 'Run this check with npm run check:package.')
const environment = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AGENTHUB_'))),
  NO_COLOR: '1', AGENTHUB_HOME: path.join(temp, 'home') }
let server
async function npm(args) {
  return exec(process.execPath, [npmCli, ...args], { cwd: root, env: environment, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
}

try {
  await fs.mkdir(path.join(root, 'dist'), { recursive: true })
  const stale = path.join(root, 'dist', 'obsolete-package-check.js')
  await fs.writeFile(stale, 'throw new Error("stale build output")')
  await npm(['run', 'build'])
  await assert.rejects(fs.access(stale), { code: 'ENOENT' })
  const { stdout } = await npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp])
  const [archive] = JSON.parse(stdout)
  assert.equal(archive.version, JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version)
  const files = archive.files.map((file) => file.path)
  assert.ok(files.includes('dist/cli/main.js'))
  assert.ok(files.includes('bin/agenthub.mjs'))
  assert.equal(files.some((file) => /^(?:src|tests|scripts|node_modules|\.agenthub|\.github)\//.test(file)), false)
  assert.equal(files.some((file) => /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|pfx|p12)$/.test(file)), false)
  const prefix = path.join(temp, 'prefix with spaces')
  await npm(['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, archive.filename)])
  const command = path.join(prefix, process.platform === 'win32' ? 'agenthub.cmd' : 'bin/agenthub')
  const smoke = async (args) => {
    if (process.platform === 'win32') {
      // All arguments below are fixed smoke-test switches. Shell quoting is
      // limited to this known temporary shim path, which may contain spaces.
      return exec(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${command}" ${args.join(' ')}"`], {
        cwd: temp, env: environment, timeout: 30_000, windowsHide: true, windowsVerbatimArguments: true,
      })
    }
    return exec(command, args, { cwd: temp, env: environment, timeout: 30_000 })
  }
  const version = await smoke(['--version'])
  assert.equal(version.stdout.trim(), archive.version)
  assert.match((await smoke(['--help'])).stdout, /agenthub/i)
  const config = JSON.parse((await smoke(['config', '--json'])).stdout)
  assert.equal(config.ok, true)
  assert.equal(path.resolve(config.workspace), path.resolve(temp))
  assert.equal(config.permissionMode, 'ask')
  server = http.createServer((request, response) => {
    const send = (body) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
    if (request.url?.endsWith('/models')) { send({ data: [{ id: 'package-fixture' }] }); return }
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const hadTool = body.messages.some((message) => message.role === 'tool')
      send({ choices: [{ message: hadTool ? { content: 'PACKAGE_TASK_FINISHED' } : {
        content: '', tool_calls: [{ id: 'package_call', type: 'function', function: {
          name: 'write_file', arguments: JSON.stringify({ path: 'package-proof.txt', content: 'PACKAGE_WRITE_VERIFIED' }),
        } }],
      }, finish_reason: hadTool ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 4 } })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  environment.AGENTHUB_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`
  environment.AGENTHUB_PROVIDER = 'custom'
  environment.AGENTHUB_MODEL = 'package-fixture'
  let denied
  try { await smoke(['--json', 'ARCHIVE_WRITE']) }
  catch (err) { assert.equal(err.code, 4); denied = err.stdout }
  assert.ok(denied, 'headless ask mode must deny a write without --yes')
  assert.equal(JSON.parse(denied.trim().split(/\r?\n/).at(-1)).status, 'partial')
  await assert.rejects(fs.access(path.join(temp, 'package-proof.txt')), { code: 'ENOENT' })
  const approved = await smoke(['--json', '--yes', 'ARCHIVE_WRITE'])
  assert.equal(JSON.parse(approved.stdout.trim().split(/\r?\n/).at(-1)).status, 'completed')
  assert.equal(await fs.readFile(path.join(temp, 'package-proof.txt'), 'utf8'), 'PACKAGE_WRITE_VERIFIED')
  console.log(JSON.stringify({ ok: true, platform: process.platform, node: process.version, archiveFiles: files.length,
    packedBytes: archive.size, installedCommand: 'version, help, JSON config, denied and approved tool writes passed', isolatedPrefix: true }, null, 2))
} finally {
  if (server) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  const checked = path.resolve(temp)
  assert.equal(path.dirname(checked), path.resolve(os.tmpdir()))
  assert.ok(path.basename(checked).startsWith('agenthub-package-check-'))
  await fs.rm(checked, { recursive: true, force: true, maxRetries: 3 })
}
