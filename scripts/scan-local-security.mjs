import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

// Deliberately fixed scope. This is a reviewed local audit, not an unrestricted
// agent command runner or a comprehensive penetration test.
const base = 'http://127.0.0.1:3000'
const root = path.resolve('.verification/security-2026-11-06')
await mkdir(root, { recursive: true })
const executable = path.join(root, 'tools/nuclei.exe')
const release = JSON.parse(await readFile(path.join(root, 'release.json'), 'utf8'))
const binaryHash = createHash('sha256').update(await readFile(executable)).digest('hex')
const archiveHash = createHash('sha256').update(await readFile(path.join(root, 'tools/nuclei.zip'))).digest('hex')
assert.equal(archiveHash, release.sha256, 'Official release archive digest changed.')
const templates = ['git-config.yaml', 'http-missing-security-headers.yaml', 'swagger-api.yaml', 'nextjs-vite-public-env.yaml', 'laravel-env.yaml', 'javascript-env-config.yaml']
const hashes = []
for (const name of templates) {
  const text = await readFile(path.join(root, 'templates', name), 'utf8')
  assert.ok(!/^(?:flow|code|javascript|dns|tcp|headless|ssl|file|workflows):/m.test(text))
  assert.ok(!/interactsh-url|\bmethod:\s*(?:POST|PUT|PATCH|DELETE)/i.test(text))
  hashes.push({ name, sha256: createHash('sha256').update(text).digest('hex') })
}
const requests = [], denied = []
let forwarded = 0
// Both target and internal HTTP requests go through a proxy that cannot forward
// outside the one authorized origin. CONNECT and mutating methods are refused.
const proxy = http.createServer((req, res) => {
  let url
  try { url = new URL(req.url) } catch { res.writeHead(400).end(); return }
  if (url.origin !== base || !['GET', 'HEAD'].includes(req.method) || ++forwarded > 500) {
    denied.push({ host: url.host, method: req.method }); res.writeHead(403).end(); return
  }
  const request = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host }, timeout: 10000 }, upstream => {
    requests.push({ path: url.pathname, status: upstream.statusCode })
    res.writeHead(upstream.statusCode, upstream.headers)
    upstream.pipe(res)
  })
  request.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
  request.on('timeout', () => request.destroy())
  req.pipe(request)
})
proxy.on('connect', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'))
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`
await writeFile(path.join(root, 'config.yaml'), '{}\n')
const args = ['-u', base, ...templates.flatMap(name => ['-t', path.join(root, 'templates', name)]),
  '-config', path.join(root, 'config.yaml'), '-duc', '-ni', '-dut', '-dr', '-no-stdin', '-pt', 'http',
  '-rl', '3', '-c', '1', '-bs', '1', '-timeout', '8', '-retries', '0', '-no-color', '-or', '-ot',
  '-proxy', proxyUrl, '-pi', '-jle', path.join(root, 'nuclei-findings.jsonl')]
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:SystemRoot|WINDIR|COMSPEC|PATH|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)))
const started = new Date().toISOString()
const log = []
let exit
try {
  const child = spawn(executable, args, { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => log.push(data)); child.stderr.on('data', data => log.push(data))
  const timer = setTimeout(() => child.kill(), 240000)
  try { exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) }) } finally { clearTimeout(timer) }
} finally { await new Promise(resolve => proxy.close(resolve)) }
await writeFile(path.join(root, 'nuclei.log'), Buffer.concat(log))
await writeFile(path.join(root, 'scan-manifest.json'), JSON.stringify({ started, ended: new Date().toISOString(), target: base, release, binaryHash, templates: hashes, args, exit, forwarded: requests.length, requests, denied }, null, 2))
console.log('Nuclei finished:', JSON.stringify({ exit, reviewedTemplates: templates.length, forwarded: requests.length, denied: denied.length }))
assert.equal(exit, 0, 'Nuclei did not complete successfully; inspect the local log.')

const checks = []
async function check(name, url, expected, headers = {}, method = 'GET') {
  // Use raw HTTP: Node fetch can replace a supplied Host, invalidating a
  // DNS-rebinding probe. Consume responses without retaining their contents.
  const status = await new Promise((resolve, reject) => {
    const request = http.request(new URL(base + url), { headers, method, timeout: 15000 }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode)); response.on('error', reject)
    })
    request.on('error', reject); request.on('timeout', () => request.destroy(new Error('Boundary probe timed out'))); request.end()
  })
  checks.push({ name, path: url, method, status, expected, passed: expected.includes(status) })
}
await check('Application is reachable', '/', [200])
for (const file of ['/.env', '/.env.local', '/.git/config', '/package.json', '/db/obsidian-memory.json']) await check('Private file is not publicly served', file, [403, 404])
for (const endpoint of ['/api/chat', '/api/custom-models', '/api/obsidian', '/api/agent-session/conversations', '/api/capabilities', '/api/computer', '/api/ui-components']) {
  await check('Hostile browser origin is rejected', endpoint, [403], { Origin: 'https://attacker.invalid' })
}
await check('Unsupported workspace GET is rejected', '/api/agent-session/workspaces', [405], { Origin: 'https://attacker.invalid' })
await check('Hostile workspace POST is rejected before mutation', '/api/agent-session/workspaces', [403], { Origin: 'https://attacker.invalid' }, 'POST')
await check('Browser cross-site metadata is rejected without Origin', '/api/obsidian', [403], { 'Sec-Fetch-Site': 'cross-site' })
await check('Opaque browser origin is rejected', '/api/obsidian', [403], { Origin: 'null' })
await check('Different local port origin is rejected', '/api/obsidian', [403], { Origin: 'http://127.0.0.1:3999' })
await check('DNS rebinding Host is rejected', '/api/obsidian', [403], { Host: 'attacker.invalid:3000' })
await check('Cross-origin invalid POST is rejected before mutation', '/api/custom-models', [403], { Origin: 'https://attacker.invalid' }, 'POST')
await check('Vault traversal read is rejected', '/api/obsidian?op=file&path=..%2F.env', [400, 403])
await check('Hidden vault settings read is rejected', '/api/obsidian?op=file&path=.obsidian%2Fapp.json', [400, 403])
await check('Workspace traversal read is rejected', '/api/agent-session/files?op=read&path=..%2F.env', [400, 403])
await check('Workspace secret read is rejected', '/api/agent-session/files?op=read&path=.env', [403])
await writeFile(path.join(root, 'boundary-checks.json'), JSON.stringify(checks, null, 2))
const findings = (await readFile(path.join(root, 'nuclei-findings.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
console.log('Nuclei matches (no sensitive extracted values):', JSON.stringify(findings.map(row => ({ id: row['template-id'], matcher: row['matcher-name'], severity: row.info?.severity }))))
console.log('Live boundary checks:', checks.filter(row => row.passed).length + '/' + checks.length)
for (const failed of checks.filter(row => !row.passed)) console.log('REVIEW', JSON.stringify(failed))
process.exitCode = checks.every(row => row.passed) ? 0 : 1
