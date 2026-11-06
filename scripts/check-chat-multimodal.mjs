#!/usr/bin/env node
// ── Chat multimodal + Thinking behavioural checks ────────────────────────────
//   node scripts/check-chat-multimodal.mjs
//
// Runs the REAL /api/chat route (src/app/api/chat/route.ts) against a mocked
// provider and proves, end-to-end:
//   * a text-only model REFUSES an image (400) and suggests an available vision
//     model instead of pretending to see it,
//   * a vision model receives a real multimodal `image_url` content part,
//   * a document attachment is extracted locally and folded into the request,
//     while the shared transcript stores only the file NAME,
//   * the Thinking control sends a NATIVE `reasoning_effort` only for a model
//     that supports it, applying a clearly-labelled prompt instruction otherwise,
//     and reports which mode was actually used.
//
// No provider, cloud service, or network access is required. The db directory is
// isolated so the live workspace/history is never touched.
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { compileChatFixture } from './compile-chat-fixture.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(title) {
  console.log(`\n── ${title} ──`)
}

// 1×1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const DOC_B64 = Buffer.from('# Title\n\nHello doc body\n', 'utf-8').toString('base64')

// ── Mock provider (records every completion request) ────────────────────────
const received = []
const mock = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    let body = {}
    try {
      body = JSON.parse(raw)
    } catch {
      /* ignore */
    }
    received.push(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'mock reply' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }),
    )
  })
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const providerPort = mock.address().port
const providerEndpoint = `http://127.0.0.1:${providerPort}/v1`

// ── Mock LM Studio probe (loaded text model + loaded vision model) ──────────
const LM_MODELS = [
  { id: 'qwen2.5-coder-3b-instruct', type: 'llm', arch: 'qwen2', state: 'loaded' },
  { id: 'qwen2.5-vl-7b-instruct', type: 'vlm', arch: 'qwen2vl', state: 'loaded' },
  { id: 'idle-model', type: 'llm', arch: 'x', state: 'not-loaded' },
]
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.includes('127.0.0.1:' + providerPort)) return realFetch(input, init)
  if (url.includes(':11434')) {
    const err = new Error(`connect ECONNREFUSED ${url}`)
    err.name = 'TypeError'
    throw err
  }
  if (url.includes(':1234')) {
    if (url.endsWith('/chat/completions')) {
      let body = {}
      try {
        body = JSON.parse(init?.body ?? '{}')
      } catch {
        /* ignore */
      }
      received.push(body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'mock reply' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
        text: async () => '',
      }
    }
    return { ok: true, status: 200, json: async () => ({ data: LM_MODELS }), text: async () => '' }
  }
  return realFetch(input, init)
}

// ── Isolated db dir ─────────────────────────────────────────────────────────
const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-mm-db-'))
const historyFile = path.join(dbDir, 'chat-history.json')
process.env.AGENT_HUB_DB_DIR = dbDir
await fs.writeFile(
  path.join(dbDir, 'custom-models.json'),
  JSON.stringify([
    { id: 'doc-model', name: 'Doc', endpoint: providerEndpoint, apiKey: '', modelId: 'qwen2.5-coder-3b-instruct', createdAt: new Date().toISOString() },
    { id: 'native-model', name: 'Native', endpoint: providerEndpoint, apiKey: '', modelId: 'o3-mini', createdAt: new Date().toISOString() },
  ]),
  'utf-8',
)

// ── Build the real route + runtime deps ─────────────────────────────────────
const buildDir = await fs.mkdtemp(path.join(ROOT, '.tmp-chat-mm-'))
try {
  for (const name of ['model-preference', 'model-preference-server', 'model-routing', 'task-guidance', 'usage-events', 'request-origin', 'chat-control', 'chat-store', 'chat-quiz', 'advanced-lesson', 'db-path', 'fs-atomic', 'custom-models', 'chat-settings', 'chat-types', 'llm', 'teach-prompt', 'token-usage', 'seed-agents', 'seed-sessions', 'seed-models', 'seed-graph', 'seed-changes', 'seed-workflow', 'seed', 'normalize', 'state-file', 'attachments', 'document-extract']) {
    const src = await fs.readFile(path.join(ROOT, 'src', 'lib', 'agent-hub', `${name}.ts`), 'utf-8')
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    await fs.writeFile(path.join(buildDir, `${name}.js`), out)
  }
  const quizParserSrc = await fs.readFile(path.join(ROOT, 'src', 'lib', 'agent-hub', 'quiz-parser.ts'), 'utf-8')
  await fs.writeFile(path.join(buildDir, 'quiz-parser.js'), ts.transpileModule(quizParserSrc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText)
  await compileChatFixture(ROOT, buildDir)
  let routeSrc = await fs.readFile(path.join(ROOT, 'src', 'app', 'api', 'chat', 'route.ts'), 'utf-8')
  routeSrc = routeSrc.replace(/@\/lib\/agent-hub\//g, './')
  const routeOut = ts.transpileModule(routeSrc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  await fs.writeFile(path.join(buildDir, 'route.js'), routeOut)

  const require = createRequire(pathToFileURL(path.join(ROOT, 'package.json')).href)
  const route = require(path.join(buildDir, 'route.js'))

  const post = async (body) => {
    const res = await route.POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Host: 'localhost' },
        body: JSON.stringify(body),
      }),
    )
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  const lastUserContent = () => {
    const msgs = received.at(-1)?.messages ?? []
    return msgs[msgs.length - 1]?.content
  }
  const systemOf = () => (received.at(-1)?.messages ?? []).find((m) => m.role === 'system')?.content ?? ''

  // ── A · text-only model must refuse an image ──────────────────────────────
  section('Image + text-only model (honest refusal)')
  const a = await post({
    message: 'what is in this image?',
    settings: { model: 'lmstudio' },
    stateless: true,
    attachments: [{ name: 'shot.png', mime: 'image/png', size: 68, dataBase64: PNG_B64 }],
  })
  ok('the request is rejected (not faked)', a.status === 400 && a.json?.ok === false, `status=${a.status}`)
  ok('the error explains the model is text-only', /text-only and cannot see images/.test(a.json?.error ?? ''))
  ok('the error suggests an available vision model', /qwen2\.5-vl-7b-instruct/.test(a.json?.error ?? ''))
  ok('no provider completion was attempted for the refusal', received.length === 0)

  // ── B · vision model receives a real image part ───────────────────────────
  section('Image + vision model (real multimodal payload)')
  const b = await post({
    message: 'describe this',
    settings: { model: 'qwen2.5-vl-7b-instruct' },
    stateless: true,
    attachments: [{ name: 'shot.png', mime: 'image/png', size: 68, dataBase64: PNG_B64 }],
  })
  const bContent = lastUserContent()
  ok('the vision request succeeds', b.status === 200 && b.json?.ok === true, `status=${b.status}`)
  ok('the request carried an OpenAI multimodal content array', Array.isArray(bContent))
  ok(
    'the image is a real image_url data part',
    Array.isArray(bContent) && bContent.some((p) => p.type === 'image_url' && /^data:image\/png;base64,/.test(p.image_url?.url ?? '')),
  )
  ok('the user text is preserved alongside the image', Array.isArray(bContent) && bContent.some((p) => p.type === 'text' && p.text === 'describe this'))
  ok('a verified vision model is not flagged with a warning', !b.json?.visionWarning)

  // ── C · document is extracted locally, name-only in history ───────────────
  section('Document attachment (local extraction)')
  await fs.rm(historyFile, { force: true })
  const c = await post({
    message: 'summarise this file',
    settings: { model: 'doc-model' },
    attachments: [{ name: 'notes.md', mime: 'text/markdown', size: 20, dataBase64: DOC_B64 }],
  })
  const cContent = lastUserContent()
  const cText = Array.isArray(cContent) ? cContent.map((p) => p.text ?? '').join('\n') : String(cContent)
  ok('the document request succeeds', c.status === 200 && c.json?.ok === true, `status=${c.status}`)
  ok('the extracted contents reach the model', cText.includes('Hello doc body'))
  ok('the document is labelled with its filename', cText.includes('notes.md'))
  const hist = JSON.parse((await fs.readFile(historyFile, 'utf-8')) ?? '[]')
  ok('history records the attachment NAME', hist.some((m) => String(m.content).includes('notes.md')))
  ok('history does NOT store the extracted contents', !hist.some((m) => String(m.content).includes('Hello doc body')))

  // ── D · Thinking: native only where supported ─────────────────────────────
  section('Thinking — native reasoning model')
  const d = await post({
    message: 'plan it',
    settings: { model: 'native-model', thinking: true, effort: 'high' },
    stateless: true,
  })
  ok('native request succeeds', d.status === 200 && d.json?.ok === true)
  ok('a native reasoning_effort param was sent', received.at(-1)?.reasoning_effort === 'high')
  ok('the response reports native thinking mode', d.json?.thinking?.mode === 'native' && d.json?.thinking?.effort === 'high')

  section('Thinking — prompt-guided model')
  const e = await post({
    message: 'plan it',
    settings: { model: 'doc-model', thinking: true, effort: 'low' },
    stateless: true,
  })
  ok('prompt-guided request succeeds', e.status === 200 && e.json?.ok === true)
  ok('NO native reasoning_effort param is sent', received.at(-1)?.reasoning_effort === undefined)
  ok('a clearly-labelled prompt instruction is applied', /Thinking" \(effort: low\)/.test(systemOf()))
  ok('the response reports prompt-guided mode honestly', e.json?.thinking?.mode === 'prompt')

  section('Thinking — off')
  const f = await post({ message: 'plain', settings: { model: 'doc-model', thinking: false }, stateless: true })
  ok('thinking off sends no reasoning param', received.at(-1)?.reasoning_effort === undefined)
  ok('thinking off applies no prompt instruction', !/Thinking" \(effort:/.test(systemOf()))
  ok('thinking off is reported as off', f.json?.thinking?.mode === 'off')

  // ── G · invalid effort is rejected safely ─────────────────────────────────
  section('Validation')
  const g = await post({ message: 'hi', settings: { model: 'doc-model', thinking: true, effort: 'extreme' }, stateless: true })
  ok('an unknown effort falls back to medium (no crash)', g.status === 200 && g.json?.thinking?.effort === 'medium')

  const h = await post({
    message: 'bad file',
    settings: { model: 'doc-model' },
    stateless: true,
    attachments: [{ name: 'evil.exe', mime: 'application/x-msdownload', size: 10, dataBase64: 'AAAA' }],
  })
  ok('an unsupported attachment is rejected explicitly', h.status === 400 && /not a supported/.test(h.json?.error ?? ''))
} finally {
  globalThis.fetch = realFetch
  await new Promise((resolve) => mock.close(resolve))
  await fs.rm(buildDir, { recursive: true, force: true }).catch(() => {})
  await fs.rm(dbDir, { recursive: true, force: true }).catch(() => {})
}

console.log('\n' + '─'.repeat(60))
console.log(`Chat multimodal + thinking checks: ${pass} passed, ${fail} failed`)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
}
// Let the HTTP mock and its stdio handles finish closing naturally. Calling
// process.exit() here can trip a Windows libuv UV_HANDLE_CLOSING assertion
// when this suite is launched from the serial project runner.
process.exitCode = fail === 0 ? 0 : 1
