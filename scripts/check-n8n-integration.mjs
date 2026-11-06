#!/usr/bin/env node
// ── n8n integration checks ───────────────────────────────────────────────────
//   node scripts/check-n8n-integration.mjs
//
// Runs the real n8n client (src/lib/agent-hub/n8n.ts) against a mock n8n HTTP
// server that implements the same public API surface (auth header, workflows,
// activate/deactivate, executions, webhook triggering). This exercises real
// request/response handling without needing n8n installed, and verifies that no
// API key ever leaks into a returned value or an error message.
import assert from 'node:assert/strict'
import http from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const VALID_KEY = 'n8n_api_KEY_do_not_leak_123456'

let pass = 0
const ok = (name) => {
  pass++
  console.log(`ok ${pass} - ${name}`)
}

// ── Build the TS modules to CommonJS in a temp dir ───────────────────────────

const buildDir = await fs.mkdtemp(path.join(os.tmpdir(), 'n8n-check-'))
const dbDir = path.join(buildDir, 'db')
await fs.mkdir(dbDir, { recursive: true })
await fs.writeFile(path.join(buildDir, 'package.json'), JSON.stringify({ type: 'commonjs' }))

for (const name of ['db-path', 'fs-atomic', 'n8n-types', 'n8n-store', 'n8n']) {
  const src = await fs.readFile(path.join(ROOT, 'src', 'lib', 'agent-hub', `${name}.ts`), 'utf-8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  await fs.writeFile(path.join(buildDir, `${name}.js`), out)
}

// Point persistence at the isolated temp db BEFORE the modules load.
process.env.AGENT_HUB_DB_DIR = dbDir
delete process.env.N8N_BASE_URL
delete process.env.N8N_API_KEY
delete process.env.N8N_ALLOWED_HOSTS

const require = createRequire(pathToFileURL(path.join(buildDir, 'noop.js')).href)
const n8n = require(path.join(buildDir, 'n8n.js'))

// ── Mock n8n server ──────────────────────────────────────────────────────────

const mock = {
  validKey: VALID_KEY,
  executionStatus: 'success',
  requireActivationForWebhook: true,
  failImportEchoKey: false,
  workflows: [],
  executions: [],
  webhookCalls: [],
  nextWorkflowId: 5000,
  nextExecutionId: 900,
  lastWorkflowId: null,
}

function json(res, code, body) {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(text)
}
function authOk(req) {
  return (req.headers['x-n8n-api-key'] || '') === mock.validKey
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}
function recordWebhook() {
  const id = String(mock.nextExecutionId++)
  const now = new Date()
  const exec = {
    id,
    workflowId: mock.lastWorkflowId,
    status: mock.executionStatus,
    mode: 'webhook',
    startedAt: now.toISOString(),
    stoppedAt: new Date(now.getTime() + 130).toISOString(),
  }
  mock.executions.push(exec)
  return exec
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname

  if (p === '/rest/settings') return json(res, 200, { data: { versionCli: '1.99.0' } })

  if (p === '/api/v1/workflows' && req.method === 'GET') {
    if (!authOk(req)) return json(res, 401, { message: 'unauthorized' })
    return json(res, 200, { data: mock.workflows.map((w) => ({ id: w.id, name: w.name, active: w.active })), nextCursor: null })
  }
  if (p === '/api/v1/workflows' && req.method === 'POST') {
    if (!authOk(req)) return json(res, 401, { message: 'unauthorized' })
    const body = JSON.parse((await readBody(req)) || '{}')
    if (mock.failImportEchoKey) {
      res.writeHead(500, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ message: `boom ${mock.validKey}` }))
    }
    const wf = { id: String(mock.nextWorkflowId++), name: body.name, active: false }
    mock.workflows.push(wf)
    mock.lastWorkflowId = wf.id
    return json(res, 200, { id: wf.id, name: wf.name, active: wf.active })
  }
  const wfMatch = p.match(/^\/api\/v1\/workflows\/([^/]+)(?:\/(activate|deactivate))?$/)
  if (wfMatch) {
    if (!authOk(req)) return json(res, 401, { message: 'unauthorized' })
    const wf = mock.workflows.find((w) => w.id === wfMatch[1])
    if (!wf) return json(res, 404, { message: 'not found' })
    if (wfMatch[2]) {
      wf.active = wfMatch[2] === 'activate'
      return json(res, 200, { id: wf.id, name: wf.name, active: wf.active })
    }
    return json(res, 200, { id: wf.id, name: wf.name, active: wf.active })
  }

  if (p === '/api/v1/executions' && req.method === 'GET') {
    if (!authOk(req)) return json(res, 401, { message: 'unauthorized' })
    const wfId = url.searchParams.get('workflowId')
    const data = mock.executions.filter((e) => !wfId || e.workflowId === wfId).slice(-5).reverse()
    return json(res, 200, { data })
  }
  const exMatch = p.match(/^\/api\/v1\/executions\/([^/]+)$/)
  if (exMatch) {
    if (!authOk(req)) return json(res, 401, { message: 'unauthorized' })
    const ex = mock.executions.find((e) => e.id === exMatch[1])
    if (!ex) return json(res, 404, { message: 'not found' })
    return json(res, 200, ex)
  }

  if (p.startsWith('/webhook/') || p.startsWith('/form/')) {
    const wf = mock.workflows.find((w) => w.id === mock.lastWorkflowId)
    mock.webhookCalls.push({ path: p, method: req.method })
    if (mock.requireActivationForWebhook && (!wf || !wf.active)) {
      return json(res, 404, { message: 'webhook not registered (workflow inactive)' })
    }
    recordWebhook()
    return json(res, 200, { ran: true, via: p })
  }

  json(res, 404, { message: `no route for ${req.method} ${p}` })
})

await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const BASE = `http://127.0.0.1:${port}`

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findTemplates() {
  const dir = path.join(ROOT, 'public', 'n8n-templates')
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'))
  const byKind = {}
  let withCreds = null
  for (const f of files) {
    const wf = JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8'))
    const info = n8n.classifyTrigger(wf)
    const id = `n8n-${f.replace(/\.json$/, '')}`
    if (!byKind[info.kind]) byKind[info.kind] = id
    if (!withCreds && info.requiredCredentials.length > 0) withCreds = id
  }
  return { byKind, withCreds, dir }
}

const tmpl = await findTemplates()
const webhookId = tmpl.byKind.webhook
assert.ok(webhookId, 'expected at least one webhook-triggered template')
assert.ok(tmpl.byKind.manual, 'expected at least one manual-triggered template')
assert.ok(tmpl.byKind.schedule, 'expected at least one scheduled template')
assert.ok(tmpl.withCreds, 'expected at least one template that references credentials')

console.log(`using templates: webhook=${webhookId} manual=${tmpl.byKind.manual} schedule=${tmpl.byKind.schedule} form=${tmpl.byKind.form ?? 'none'} creds=${tmpl.withCreds}`)

// ── 1. Connection states ─────────────────────────────────────────────────────

delete process.env.N8N_BASE_URL
delete process.env.N8N_API_KEY
let status = await n8n.getN8nStatus()
assert.equal(status.state, 'not_configured')
ok('status: not_configured when no base URL is set')

process.env.N8N_BASE_URL = 'http://127.0.0.1:1'
process.env.N8N_API_KEY = VALID_KEY
status = await n8n.getN8nStatus()
assert.equal(status.state, 'unreachable')
ok('status: unreachable when n8n is down')

process.env.N8N_BASE_URL = BASE
delete process.env.N8N_API_KEY
status = await n8n.getN8nStatus()
assert.equal(status.state, 'unauthorized')
assert.equal(status.version, '1.99.0')
ok('status: unauthorized + version probe when no API key')

process.env.N8N_API_KEY = 'wrong-key'
status = await n8n.getN8nStatus()
assert.equal(status.state, 'unauthorized')
ok('status: unauthorized when the API key is rejected')

process.env.N8N_API_KEY = VALID_KEY
status = await n8n.getN8nStatus()
assert.equal(status.state, 'connected')
assert.equal(status.version, '1.99.0')
ok('status: connected with a valid key, real version reported')

// ── 2. Secrets never appear in returned values ───────────────────────────────

const pub = await n8n.getPublicConfig()
assert.ok(!JSON.stringify(pub).includes(VALID_KEY), 'public config leaked the API key')
assert.equal(pub.hasApiKey, true)
assert.equal(pub.configured, true)
ok('public config never contains the API key')

assert.ok(!status.message.includes(VALID_KEY), 'status message leaked the API key')
ok('status message is secret-free')

assert.equal(n8n.redactSecrets(`header X-N8N-API-KEY: ${VALID_KEY}`, VALID_KEY), 'header X-N8N-API-KEY: ***')
assert.ok(!n8n.redactSecrets(`key=${VALID_KEY}`, VALID_KEY).includes(VALID_KEY))
ok('redactSecrets masks the API key')

// ── 3. Trigger classification (offline, from the real template files) ────────

const webhookInfo = await n8n.inspectTemplate(webhookId)
assert.equal(webhookInfo.trigger.kind, 'webhook')
assert.equal(webhookInfo.trigger.runnableOnDemand, true)
assert.ok(webhookInfo.trigger.webhookPath)
ok('classify: webhook template is runnable on demand with a path')

const manualInfo = await n8n.inspectTemplate(tmpl.byKind.manual)
assert.equal(manualInfo.trigger.kind, 'manual')
assert.equal(manualInfo.trigger.runnableOnDemand, false)
ok('classify: manual template is not runnable via the public API')

const schedInfo = await n8n.inspectTemplate(tmpl.byKind.schedule)
assert.equal(schedInfo.trigger.kind, 'schedule')
ok('classify: scheduled template recognised')

const credInfo = await n8n.inspectTemplate(tmpl.withCreds)
assert.ok(credInfo.requiredCredentials.length > 0)
ok('classify: required credentials are reported')

// ── 4. Import + de-duplication ───────────────────────────────────────────────

const imported = await n8n.importTemplate(webhookId)
assert.equal(imported.created, true)
assert.ok(imported.link.n8nWorkflowId)
ok('import: creates the workflow in n8n')

const reimported = await n8n.importTemplate(webhookId)
assert.equal(reimported.created, false)
assert.equal(reimported.link.n8nWorkflowId, imported.link.n8nWorkflowId)
ok('import: repeating does not create a duplicate')

// Simulate a cleared link file; import must find the existing n8n workflow by name.
await n8n.unlinkTemplate(webhookId)
const reattached = await n8n.importTemplate(webhookId)
assert.equal(reattached.created, false)
assert.equal(reattached.link.n8nWorkflowId, imported.link.n8nWorkflowId)
ok('import: re-attaches to an existing n8n workflow by name (no duplicate)')

// ── 5. Execution gating (no fabrication) ─────────────────────────────────────

// A user imports a workflow before trying to run it.
await n8n.importTemplate(tmpl.byKind.manual)
await n8n.importTemplate(tmpl.byKind.schedule)
await n8n.importTemplate(tmpl.withCreds)

let ex = await n8n.executeTemplate(webhookId)
assert.equal(ex.ok, false)
assert.equal(ex.blockedReason, 'needs_activation')
assert.equal(ex.record.n8nExecutionId, null)
ok('execute: webhook workflow is blocked until it is activated')

const manualEx = await n8n.executeTemplate(tmpl.byKind.manual, { confirmCredentials: true })
assert.equal(manualEx.blockedReason, 'manual_trigger')
assert.equal(manualEx.record.n8nExecutionId, null)
assert.equal(mock.executions.length, 0)
ok('execute: manual workflow is blocked with an explanation and runs nothing')

const schedEx = await n8n.executeTemplate(tmpl.byKind.schedule, { confirmCredentials: true })
assert.equal(schedEx.blockedReason, 'scheduled_trigger')
ok('execute: scheduled workflow is not started by Run')

const credEx = await n8n.executeTemplate(tmpl.withCreds)
assert.equal(credEx.blockedReason, 'needs_credentials')
assert.ok(credEx.record.error.includes('credentials'))
ok('execute: workflows with credentials require explicit confirmation')

// ── 6. Real execution through the webhook trigger ────────────────────────────

mock.requireActivationForWebhook = false // activate first, then run
const link = await n8n.setActivation(webhookId, true)
assert.equal(link.activated, true)
ok('activate: workflow activation is persisted from n8n')

// The mock registers the webhook against the workflow that owns it.
mock.lastWorkflowId = link.n8nWorkflowId

mock.executionStatus = 'success'
let run = await n8n.executeTemplate(webhookId)
assert.equal(run.ok, true)
assert.equal(run.record.status, 'success')
assert.ok(run.record.n8nExecutionId, 'expected the real n8n execution id')
assert.equal(run.record.mode, 'webhook')
assert.ok(mock.webhookCalls.length >= 1, 'webhook was actually invoked')
assert.ok((run.record.n8nDurationMs ?? 0) > 0 || run.record.requestDurationMs >= 0)
ok('execute: success is confirmed from the n8n execution record (id + status)')

mock.executionStatus = 'error'
run = await n8n.executeTemplate(webhookId)
assert.equal(run.record.status, 'error')
assert.ok(run.record.n8nExecutionId)
ok('execute: a failed n8n execution is reported as an error (not success)')

// ── 7. Status refresh from n8n ───────────────────────────────────────────────

const refreshed = await n8n.refreshExecutionRecord(run.record.id)
assert.equal(refreshed.status, 'error')
assert.ok(refreshed.n8nExecutionId)
ok('refresh: pulls the real status from n8n for an existing record')

// ── 8. Persistence across reload ─────────────────────────────────────────────

const stateFile = path.join(dbDir, 'n8n-state.json')
const persisted = JSON.parse(await fs.readFile(stateFile, 'utf-8'))
assert.ok(persisted.executions.length >= 4, 'execution history was not persisted')
assert.ok(persisted.links[webhookId], 'workflow link was not persisted')
assert.ok(!JSON.stringify(persisted).includes(VALID_KEY), 'persisted state leaked the API key')
ok('persistence: links + execution history survive a reload, secret-free')

// ── 9. Import failures are scrubbed ──────────────────────────────────────────

mock.failImportEchoKey = true
await n8n.unlinkTemplate(webhookId)
mock.workflows = mock.workflows.filter((w) => w.name !== webhookInfo.name) // force a create
let threw = null
try {
  await n8n.importTemplate(webhookId)
} catch (e) {
  threw = e
}
assert.ok(threw, 'expected the import to throw')
assert.ok(!String(threw.message).includes(VALID_KEY), `error message leaked the key: ${threw.message}`)
assert.ok(String(threw.message).includes('***'))
ok('errors: a failing n8n response is scrubbed of secrets')
mock.failImportEchoKey = false

// ── 10. SSRF host allowlist ──────────────────────────────────────────────────

process.env.N8N_ALLOWED_HOSTS = 'n8n.example.com'
assert.throws(() => n8n.assertAllowedHost(BASE), /not permitted by N8N_ALLOWED_HOSTS/)
ok('security: N8N_ALLOWED_HOSTS blocks a host that is not allow-listed')
delete process.env.N8N_ALLOWED_HOSTS
process.env.N8N_ALLOWED_HOSTS = '127.0.0.1'
assert.throws(() => n8n.buildWebhookUrl({ webhookBaseUrl: BASE, baseUrl: BASE }, { ...webhookInfo.trigger, webhookPath: '../evil' }), /unsafe|not permitted/)
ok('security: webhook paths are validated and hosts are allow-listed')
delete process.env.N8N_ALLOWED_HOSTS

process.env.N8N_ALLOW_PRIVATE_HOSTS = 'false'
assert.throws(() => n8n.assertAllowedHost(BASE), /private and N8N_ALLOW_PRIVATE_HOSTS is false/)
ok('security: N8N_ALLOW_PRIVATE_HOSTS can forbid private hosts')
delete process.env.N8N_ALLOW_PRIVATE_HOSTS

// ── Done ─────────────────────────────────────────────────────────────────────

server.close()
await fs.rm(buildDir, { recursive: true, force: true })

console.log(`\n${pass} n8n integration checks passed`)
