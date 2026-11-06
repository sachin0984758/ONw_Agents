#!/usr/bin/env node
// ── Runtime model detection checks ───────────────────────────────────────────
//   node scripts/check-runtime-models.mjs
//
// Proves the Overview/sidebar "running model" indicator reflects ONLY models a
// provider confirms are loaded, and never seeded/fabricated data. The real
// src/lib/agent-hub/llm.ts is transpiled and called against a mocked fetch, so
// no provider is required and no real network call is made.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

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

const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const realFetch = globalThis.fetch

function mockFetch(routes) {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url
    for (const [frag, handler] of routes) {
      if (url.includes(frag)) return handler(url)
    }
    const err = new Error(`connect ECONNREFUSED ${url}`)
    err.name = 'TypeError'
    throw err
  }
}
function restoreFetch() {
  globalThis.fetch = realFetch
}

// ── Build the real modules ───────────────────────────────────────────────────
const BUILD_DIR = path.join(ROOT, '.tmp-runtime-check')
await fs.rm(BUILD_DIR, { recursive: true, force: true })
await fs.mkdir(BUILD_DIR, { recursive: true })
for (const name of ['chat-settings', 'usage-events', 'llm']) {
  const src = await fs.readFile(path.join(ROOT, 'src', 'lib', 'agent-hub', `${name}.ts`), 'utf-8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  await fs.writeFile(path.join(BUILD_DIR, `${name}.js`), out, 'utf-8')
}
const require = createRequire(pathToFileURL(path.join(ROOT, 'package.json')).href)
const llm = require(path.join(BUILD_DIR, 'llm.js'))

const readSource = (rel) => fs.readFile(path.join(ROOT, rel), 'utf-8')

try {
  // ── 1. LM Studio: only `state === 'loaded'` counts ────────────────────────
  section('LM Studio loaded-state (the screenshot case)')
  mockFetch([
    [
      '/api/v0/models',
      () =>
        jsonRes({
          data: [
            { id: 'qwen2.5-coder-3b-instruct', type: 'llm', arch: 'qwen2', state: 'loaded' },
            { id: 'gemma-5-4b-it-Q4_K_M.gguf', type: 'llm', arch: 'gemma', state: 'not-loaded' },
            { id: 'nomic-embed', type: 'embeddings', state: 'loaded' },
          ],
        }),
    ],
  ])
  let report = await llm.detectRuntimeModels()
  ok('only the actually-loaded chat model is reported', report.loaded.length === 1 && report.loaded[0].id === 'qwen2.5-coder-3b-instruct')
  ok('a downloaded-but-not-loaded model is not "running"', !report.loaded.some((m) => m.id === 'gemma-5-4b-it-Q4_K_M.gguf'))
  ok('loaded embeddings are excluded from chat runtime', !report.loaded.some((m) => m.type === 'embeddings'))
  ok('the reported model carries its provider name', report.loaded[0].providerName === 'LM Studio')
  ok('status is ok when a provider reports loaded state', report.status === 'ok')

  // ── 2. Nothing loaded ─────────────────────────────────────────────────────
  section('Provider online, nothing loaded')
  mockFetch([
    ['/api/v0/models', () => jsonRes({ data: [{ id: 'idle-model', type: 'llm', state: 'not-loaded' }] })],
  ])
  report = await llm.detectRuntimeModels()
  ok('an online provider with no loaded model reports zero loaded', report.loaded.length === 0)
  ok('status stays ok (state IS known — it is just empty)', report.status === 'ok')
  restoreFetch()

  // ── 3. Provider offline ───────────────────────────────────────────────────
  section('Provider offline')
  mockFetch([])
  report = await llm.detectRuntimeModels()
  ok('offline provider reports no loaded models', report.loaded.length === 0)
  ok('offline provider is reported as offline, not as a running model', report.status === 'offline')

  // ── 4. Ollama: /api/ps (running) vs /api/tags (installed) ─────────────────
  section('Ollama running vs installed')
  mockFetch([
    ['/api/ps', () => jsonRes({ models: [{ name: 'llama3:8b' }] })],
    ['/api/tags', () => jsonRes({ models: [{ name: 'llama3:8b' }, { name: 'qwen2.5:7b' }] })],
  ])
  report = await llm.detectRuntimeModels()
  ok('Ollama reports only the model loaded into memory', report.loaded.length === 1 && report.loaded[0].id === 'llama3:8b')
  ok('an installed-but-idle Ollama model is not reported as running', !report.loaded.some((m) => m.id === 'qwen2.5:7b'))

  // ── 5. Ollama without /api/ps → state unavailable (never invented) ────────
  section('Loaded state cannot be determined')
  mockFetch([
    ['/api/ps', () => jsonRes({}, 404)],
    ['/api/tags', () => jsonRes({ models: [{ name: 'llama3:8b' }] })],
  ])
  report = await llm.detectRuntimeModels()
  ok('no running model is invented when /api/ps is unavailable', report.loaded.length === 0)
  ok("status is 'unavailable' (not 'ok', not a fake model)", report.status === 'unavailable')

  // ── 6. Only /v1/models reachable → cannot tell loaded state ───────────────
  section('OpenAI-compatible /v1/models only')
  mockFetch([
    ['/api/v0/models', () => jsonRes({}, 404)],
    ['/api/ps', () => jsonRes({}, 404)],
    ['/api/tags', () => jsonRes({}, 404)],
    ['/models', () => jsonRes({ data: [{ id: 'some-model' }] })],
  ])
  report = await llm.detectRuntimeModels()
  ok('a plain inventory listing never implies a running model', report.loaded.length === 0)
  ok("status is 'unavailable' when loaded state cannot be read", report.status === 'unavailable')
  restoreFetch()

  // ── 7. Static guarantees: no seeded/fabricated running data ───────────────
  section('Static guarantees (no fabricated running model)')
  const seedModels = await readSource('src/lib/agent-hub/seed-models.ts')
  ok('seed model data contains no `running: true`', !/running:\s*true/.test(seedModels))
  const overview = await readSource('src/components/agent-hub/overview.tsx')
  ok('Overview no longer derives a running model from seeded state', !/models\.find\(\s*\(m\)\s*=>\s*m\.running/.test(overview))
  ok('Overview uses the live runtime hook', overview.includes('useRuntimeModels(') && overview.includes('data-testid="runtime-model"'))
  ok('Overview distinguishes loaded/offline/unavailable/no-model states', overview.includes("'No model loaded'") && overview.includes("'offline'") && overview.includes("'unavailable'"))
  const shell = await readSource('src/components/agent-hub/shell.tsx')
  ok('sidebar no longer counts seeded running models', !/state\.models\.filter\(\s*\(m\)\s*=>\s*m\.running/.test(shell))
  ok('sidebar uses the live runtime hook', shell.includes('useRuntimeModels(') && shell.includes('data-testid="sidebar-runtime"'))
  const route = await readSource('src/app/api/runtime/models/route.ts')
  ok('runtime API route exists and is node/dynamic', route.includes('detectRuntimeModels') && route.includes("runtime = 'nodejs'") && route.includes("dynamic = 'force-dynamic'"))
  const llmSrc = await readSource('src/lib/agent-hub/llm.ts')
  ok('Ollama uses /api/ps for running state', llmSrc.includes('/api/ps'))
  ok('loaded-state determinability is tracked', llmSrc.includes('loadedStateKnown'))
} finally {
  restoreFetch()
  await fs.rm(BUILD_DIR, { recursive: true, force: true })
}

console.log('\n' + '─'.repeat(60))
console.log(`Runtime model checks: ${pass} passed, ${fail} failed`)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
}
process.exit(fail === 0 ? 0 : 1)
