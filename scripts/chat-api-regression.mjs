#!/usr/bin/env node
// ─── /api/chat regression suite ──────────────────────────────────────────────
// Standalone regression tests for the defects fixed during the 2026-10-13
// audit. No test framework required — plain Node, exit code 1 on any
// failure. Run against an ISOLATED server instance, e.g.:
//
//   AGENT_HUB_DB_DIR=$(mktemp -d) PORT=3101 npx next dev &
//   node scripts/chat-api-regression.mjs http://localhost:3101 "$AGENT_HUB_DB_DIR"
//
// Args: [baseURL] [dbDir]   (dbDir must match the server's AGENT_HUB_DB_DIR)
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs'
import path from 'path'

const BASE = process.argv[2] ?? 'http://localhost:3101'
const DB_DIR = process.argv[3] ?? path.join(process.cwd(), 'db')
const HISTORY = path.join(DB_DIR, 'chat-history.json')
const CUSTOM_MODELS = path.join(DB_DIR, 'custom-models.json')

let passed = 0
let failed = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function post(body, headers = {}) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function get() {
  const res = await fetch(`${BASE}/api/chat`)
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function del(headers = {}) {
  const res = await fetch(`${BASE}/api/chat`, { method: 'DELETE', headers })
  return { status: res.status, json: await res.json().catch(() => null) }
}

// Provider-status probe (read-only): used by R9 to assert the header reports
// what the endpoint can actually do, not just what is configured.
async function getStatus(model = '') {
  const url = `${BASE}/api/chat?resource=status${model ? `&model=${encodeURIComponent(model)}` : ''}`
  const res = await fetch(url)
  return { status: res.status, json: await res.json().catch(() => null) }
}

async function readHistoryFile() {
  try {
    return JSON.parse(await fs.readFile(HISTORY, 'utf-8'))
  } catch {
    return null
  }
}

async function seedHistory(records) {
  await fs.mkdir(DB_DIR, { recursive: true })
  await fs.writeFile(HISTORY, JSON.stringify(records, null, 2), 'utf-8')
}

// The shared LLM provider rate-limits bursts (~5-6 calls/min in this
// environment). Tests that invoke the model space themselves out and retry
// once on a provider-side failure so suite results reflect app behavior,
// not quota noise.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function llmPost(body, headers = {}) {
  await sleep(12000)
  let r = await post(body, headers)
  if (r.status === 500) {
    await sleep(20000)
    r = await post(body, headers)
  }
  return r
}

// ── clean slate ───────────────────────────────────────────────────────────────
await del()
console.log(`\n/api/chat regression suite → ${BASE}\nisolated db dir: ${DB_DIR}\n`)

// R1 · invalid JSON is a 400 client error, not a misleading 500  (defect F6)
{
  const r = await post('{"message": broken')
  ok('R1 invalid JSON → 400', r.status === 400, `got ${r.status} ${JSON.stringify(r.json)}`)
}

// R2 · oversized message rejected with 413 before hitting the provider (F7)
{
  const r = await post(JSON.stringify({ message: 'x'.repeat(20000) }))
  ok('R2 oversized message → 413', r.status === 413, `got ${r.status}`)
}

// R3 · cross-origin writes blocked; same-origin/agent (no Origin) allowed (F3)
{
  const evil = await post(JSON.stringify({ message: 'csrf' }), { Origin: 'http://evil.example' })
  ok('R3a foreign Origin POST → 403', evil.status === 403, `got ${evil.status}`)
  const evilDel = await del({ Origin: 'http://evil.example' })
  ok('R3b foreign Origin DELETE → 403', evilDel.status === 403, `got ${evilDel.status}`)
  const sameOrigin = await llmPost(JSON.stringify({ message: 'same-origin writes must work' }), { Origin: 'http://localhost:3101' })
  ok('R3c same-origin POST → 200', sameOrigin.status === 200 && sameOrigin.json?.ok === true, `got ${sameOrigin.status}`)
}

// R4 · concurrent POSTs serialize: no lost updates, no provider 429s   (F2)
{
  await del()
  const marks = ['concurrency-alpha', 'concurrency-beta', 'concurrency-gamma']
  const results = await Promise.all(
    marks.map((m) => llmPost(JSON.stringify({ message: `Reply with only: ${m}` }))),
  )
  const allOk = results.every((r) => r.status === 200 && r.json?.ok === true)
  const file = await readHistoryFile()
  const contents = (file ?? []).map((m) => m.content)
  const allPersisted = marks.every((m) => contents.some((c) => c.includes(m)))
  ok(
    'R4 3 parallel POSTs all succeed + all persisted',
    allOk && allPersisted && file.length === 6,
    `ok=${allOk} persisted=${allPersisted} records=${file?.length}`,
  )
}

// R5 · corrupt history file: no crash, backup preserved, next write safe (F4)
{
  await fs.rm(HISTORY, { force: true })
  await fs.writeFile(HISTORY, '[{"role":"user","content":"trunc', 'utf-8')
  const g = await get()
  ok('R5a corrupt file GET → 200 + []', g.status === 200 && g.json?.messages?.length === 0, `got ${g.status}`)
  const dirFiles = await fs.readdir(DB_DIR)
  const backup = dirFiles.find((f) => f.startsWith('chat-history.json.corrupt-'))
  ok('R5b corrupt file backed up (.corrupt-*)', Boolean(backup), `files: ${dirFiles.join(', ')}`)
  const r = await llmPost(JSON.stringify({ message: 'after corruption, say RECOVERED' }))
  const file = await readHistoryFile()
  ok('R5c write after corruption works', r.status === 200 && file?.length === 2, `status=${r.status} records=${file?.length}`)
}

// R6 · storage cap: >200 messages trimmed to the newest 200 on write
{
  const recs = []
  for (let i = 1; i <= 205; i++) {
    recs.push({ role: i % 2 ? 'user' : 'assistant', content: `cap-${i}`, time: `2026-10-13T01:${String(i % 60).padStart(2, '0')}:00Z` })
  }
  await seedHistory(recs)
  const r = await llmPost(JSON.stringify({ message: 'cap test: just acknowledge briefly' }))
  const file = await readHistoryFile()
  // 205 seeded + 2 new = 207 → trim keeps the newest 200 → oldest kept = cap-8.
  // The assistant reply's exact text is model-dependent; assert structure only.
  const last = file?.[file?.length - 1]
  ok(
    'R6 cap trims to 200, newest kept',
    r.status === 200 && file?.length === 200 && file[0].content === 'cap-8' &&
      last?.role === 'assistant' && typeof last?.content === 'string' && last.content.length > 0,
    `status=${r.status} records=${file?.length} first=${file?.[0]?.content}`,
  )
}

// R7 · validation basics still hold (regression guard)
{
  const missing = await post('{}')
  const blank = await post(JSON.stringify({ message: '   ' }))
  const wrongType = await post(JSON.stringify({ message: 42 }))
  ok(
    'R7 missing/blank/wrong-type → 400',
    missing.status === 400 && blank.status === 400 && wrongType.status === 400,
    `got ${missing.status}/${blank.status}/${wrongType.status}`,
  )
}

// R8 · GET does not mutate; DELETE is idempotent
{
  const before = JSON.stringify(await readHistoryFile())
  await get()
  const after = JSON.stringify(await readHistoryFile())
  ok('R8a GET does not mutate history', before === after)
  const d1 = await del()
  const d2 = await del()
  const g = await get()
  ok(
    'R8b DELETE idempotent + cleared',
    d1.status === 200 && d2.status === 200 && g.json?.messages?.length === 0,
  )
}

// R9 · the status endpoint must not claim a dead custom endpoint is live (F8)
// resolveTarget() returns a custom model's stored config without dialing it,
// so GET /api/chat?resource=status used to report connected:true even when
// nothing was listening (e.g. LM Studio stopped). Runs LAST so its custom
// models never influence the provider-dependent tests above.
{
  const { createServer } = await import('node:http')
  const okServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"data":[]}')
  })
  await new Promise((r) => okServer.listen(0, '127.0.0.1', r))
  const port = okServer.address().port
  try {
    await fs.mkdir(DB_DIR, { recursive: true })
    await fs.writeFile(
      CUSTOM_MODELS,
      JSON.stringify([
        { id: 'cm-live', name: 'Reachable stub', endpoint: `http://127.0.0.1:${port}`, apiKey: 'stub'.padEnd(8, 'x'), modelId: 'stub-1', createdAt: '2026-10-17T00:00:00Z' },
        { id: 'cm-dead', name: 'Dead endpoint', endpoint: 'http://127.0.0.1:9', apiKey: 'stubdead', modelId: 'stub-1', createdAt: '2026-10-17T00:00:00Z' },
      ]),
      'utf-8',
    )

    // Explicitly target the reachable custom model (auto-select is allowed to
    // prefer a live local provider, e.g. when LM Studio happens to be running).
    const alive = await getStatus('cm-live')
    ok(
      'R9a status: reachable custom endpoint → connected:true',
      alive.json?.connected === true && alive.json?.endpoint === `http://127.0.0.1:${port}`,
      `state=${alive.json?.connected} endpoint=${alive.json?.endpoint}`,
    )

    const dead = await getStatus('cm-dead')
    ok(
      'R9b status: dead custom endpoint → connected:false + reachability warning',
      dead.json?.connected === false &&
        dead.json?.endpoint === 'http://127.0.0.1:9' &&
        /not reachable/.test(String(dead.json?.warning ?? '')),
      `status=${dead.status} state=${dead.json?.connected} warning=${dead.json?.warning}`,
    )

    // The chat POST path itself must keep failing loudly on the dead endpoint.
    const badPost = await post(JSON.stringify({ message: 'dead-endpoint-post', settings: { model: 'cm-dead' } }))
    const file = await readHistoryFile()
    // DELETE removes the file outright, and a failed POST must never create
    // one — so "nothing persisted" is: file absent, present-but-empty, or
    // missing entries.
    const noFakeReply =
      file === null || (Array.isArray(file) && (file.length === 0 || file.every((m) => m.role !== 'assistant')))
    ok(
      'R9c chat POST to dead custom endpoint fails loudly, nothing persisted',
      badPost.status >= 400 && badPost.json?.ok === false && noFakeReply,
      `status=${badPost.status} err=${badPost.json?.error} records=${Array.isArray(file) ? file.length : 'absent'}`,
    )
  } finally {
    okServer.close()
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  console.error('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
