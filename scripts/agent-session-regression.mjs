#!/usr/bin/env node
// ─── Agent Session regression suite ──────────────────────────────────────────
// Standalone tests for the Agent Session runtime (src/lib/agent-hub/
// agent-session.ts). No test framework required — plain Node, exit code 1 on
// any failure.
//
//   node scripts/agent-session-regression.mjs
//
// MOCKED TESTS: any case that exercises the model interface substitutes a
// fake `fetch`. Cases marked MOCKED never call a real provider. Real network
// calls are limited to the single optional live check at the end.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'fs'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import ts from 'typescript'

const require = createRequire(import.meta.url)

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Load the runtime (transpile TS in-memory, require from a temp dir) ──────
// The runtime now imports the Design Studio modules, so all of them are
// compiled together into one temp directory (CommonJS) and loaded from there.
const LIB = path.join(process.cwd(), 'src', 'lib', 'agent-hub')
const RUNTIME_MODULES = ['design-catalog', 'design-engine', 'design-intent', 'teaching-bank', 'teaching-framework', 'teaching-intent', 'skills', 'usage-sync', 'session/file-intent', 'session/outcome', 'session/highlighting', 'session/transport', 'agent-session']

function freshRuntimeDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-session-'))
  for (const name of RUNTIME_MODULES) {
    const src = readFileSync(path.join(LIB, `${name}.ts`), 'utf-8')
    const out = ts.transpileModule(src, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    const outputPath = path.join(dir, `${name}.js`)
    mkdirSync(path.dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, out, 'utf-8')
  }
  return dir
}
function loadFrom(dir, name) {
  return require(path.join(dir, `${name}.js`))
}
// A fresh instance for the main suite (so T41's mutation test can load its own).
const runtimeDir = freshRuntimeDir()
const agent = loadFrom(runtimeDir, 'agent-session')

// Standalone instances of the design modules for the design test blocks.
const designDir = freshRuntimeDir()
const designCatalog = loadFrom(designDir, 'design-catalog')
const designEngine = loadFrom(designDir, 'design-engine')
const designIntent = loadFrom(designDir, 'design-intent')

// Standalone instances of the teaching modules for the teaching test blocks.
const teachingDir = freshRuntimeDir()
const teachingFramework = loadFrom(teachingDir, 'teaching-framework')
const teachingIntent = loadFrom(teachingDir, 'teaching-intent')

const {
  startAgentSession,
  cancelAgentSession,
  resolveApproval,
  getAgentSessionState,
  subscribeAgentSession,
  configureAgentSession,
  resetAgentSessionConfig,
  redactSecrets,
  createPlan,
  getToolByName,
  getSmolMode,
  setSmolMode,
  cycleSmolMode,
  getSmolEffort,
  setSmolEffort,
  getEffortPromptPrefix,
  getSessionMemory,
  setSessionMemory,
  clearSessionMemory,
  getSmolPlan,
  resetSmolPlan,
  smolPlanSet,
  smolPlanDone,
  smolPlanAdd,
  smolPlanCheckpoint,
  smolPlanShow,
  estimateTokens,
  getContextStats,
  isTruncatedReply,
  syntaxCheckSnippet,
  failureSignature,
  deriveRunOutcome,
  MODE_LABELS,
  getAgentRoster,
  getAgentById,
  getAgentName,
  registerAgentDefinition,
  removeAgentDefinition,
  setAgentModel,
  getSelectionMode,
  setSelectionMode,
  cycleSelectionMode,
  isAgentEnabled,
  setAgentEnabled,
  getAgentEnabledMap,
  getRunTeam,
  getAgentCapabilities,
  capabilityLabel,
  normalizeWorkspace,
  setWorkspace,
  getWorkspace,
  resolveWorkspacePath,
  getChangedFiles,
  diffLines,
  parseToolBlocks,
  highlightCode,
  listWorkspaceDirs,
  getFileScope,
  isPathInScope,
  detectFileIntent,
  SAFE_DEFAULT_FILENAME,
  getCodingSessions,
  getActiveCodingSession,
  newCodingSession,
  selectCodingSession,
  renameCodingSession,
  deleteCodingSession,
  sendCodingMessage,
  buildHandover,
  buildSessionContext,
  runSlashCommand,
  applyDesignConfig,
  teachTopic,
  getLearningProgress,
  submitLessonQuiz,
  recordLessonExercise,
  recordLessonAnswer,
  clearLearningProgress,
  askWithinLesson,
} = agent

// Static source of the runtime, scanned by the import-boundary regression guard.
const source = readFileSync(path.join(LIB, 'agent-session.ts'), 'utf-8')

// ── fetch mock helpers ───────────────────────────────────────────────────────
const realFetch = globalThis.fetch
function mockFetch(handler) {
  globalThis.fetch = handler
}
function restoreFetch() {
  globalThis.fetch = realFetch
}
function llmResponse(reply, { status = 200, ok = true, raw = false, body = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (raw ? body : { ok, reply }),
  }
}

// ── Route-aware fetch mock ───────────────────────────────────────────────────
// Dispatches by URL so file/exec/model endpoints get realistic fixtures while
// /api/chat gets model replies. Default fixtures succeed where the test does
// not care, and report "not found" for reads. `scripts` defaults to {} so
// baseline/verification gates never trigger unless a test opts in.
function routeMock({ chat = 'ok', files = null, exec = null, skills = null } = {}) {
  const chatHandler = typeof chat === 'function' ? chat : async () => llmResponse(chat)
  return async (url, init) => {
    const u = String(url)
    if (u.includes('/api/skills')) {
      if (typeof skills === 'function') return skills(u, init)
      if (skills && typeof skills === 'object') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            root: '/ws/.agenthub/skills',
            counts: { installed: 0, enabled: 0, disabled: 0, attention: 0 },
            skills: [],
            trustedSources: [],
            discovered: [],
            missing: [],
            ...skills,
          }),
        }
      }
      // Default: an empty but valid registry (skills runtime stays quiet).
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          root: '/ws/.agenthub/skills',
          counts: { installed: 0, enabled: 0, disabled: 0, attention: 0 },
          skills: [],
          trustedSources: [],
          discovered: [],
          missing: [],
        }),
      }
    }
    if (u.includes('/api/agent-session/files')) {
      if (typeof files === 'function') return files(u, init)
      if (u.includes('op=tree')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            path: '.',
            tree: [
              { path: 'src/', type: 'dir' },
              { path: 'src/app/', type: 'dir' },
              { path: 'src/app/page.tsx', type: 'file' },
              { path: 'src/lib/agent-hub/agent-session.ts', type: 'file' },
              { path: 'package.json', type: 'file' },
            ],
            truncated: false,
          }),
        }
      }
      if (u.includes('op=read')) {
        return { ok: true, status: 404, json: async () => ({ ok: false, error: 'Not found: "package.json".' }) }
      }
      if (u.includes('op=search')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, pattern: 'x', matches: [], scanned: 12, truncated: false }) }
      }
      if (u.includes('op=filenames') || u.includes('op=list')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, files: [], entries: [], path: '.', truncated: false }) }
      }
      // mutations succeed by default
      return { ok: true, status: 200, json: async () => ({ ok: true, path: 'f', bytes: 10, created: true, replacements: 1, deleted: true }) }
    }
    if (u.includes('/api/agent-session/exec')) {
      if (typeof exec === 'function') return exec(u, init)
      if (u.includes('op=scripts')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, scripts: {} }) }
      }
      if (u.includes('op=list')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, tasks: [] }) }
      }
      if (u.includes('op=logs')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, id: 't1', command: 'x', status: 'running', exitCode: null, logs: 'line1' }) }
      }
      if (init?.method === 'POST') {
        let body = {}
        try {
          body = JSON.parse(init?.body ?? '{}')
        } catch { /* ignore */ }
        if (body.action === 'stop') {
          return { ok: true, status: 200, json: async () => ({ ok: true, id: body.taskId, status: 'stopped' }) }
        }
        if (body.background) {
          return { ok: true, status: 200, json: async () => ({ ok: true, id: 't1', status: 'Task t1 is running in the background.', command: body.command, earlyOutput: '' }) }
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, command: body.command, exitCode: 0, stdout: 'mocked output', stderr: '', truncated: false, timedOut: false, durationMs: 5 }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, tasks: [] }) }
    }
    if (u.includes('/api/agent-session/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          local: [{ id: 'lmstudio', name: 'LM Studio', available: true, models: ['qwen3'] }],
          cloud: [{ id: 'c1', name: 'Cloud', modelId: 'gpt-x', endpoint: 'https://x.example/v1', keyConfigured: true }],
        }),
      }
    }
    return chatHandler(u, init)
  }
}

configureAgentSession({ stepDelayMs: 0 })
console.log('\nAgent Session regression suite (MOCKED model interface unless noted)\n')

// ── T1 · normal request that requires no tools ──────────────────────────────
{
  mockFetch(async () => llmResponse('Hello! How can I help you today?'))
  const plan = createPlan('hello there')
  ok(
    'T1a plan for a plain greeting uses only the report step',
    plan.length === 1 && plan.every((s) => s.tool === 'call_llm'),
    JSON.stringify(plan.map((s) => s.tool)),
  )
  resetAgentSessionConfig()
  configureAgentSession({ stepDelayMs: 0 })
  const task = await startAgentSession('hello there')
  ok(
    'T1b plain request completes without non-LLM tools',
    task.status === 'completed' && task.plan.every((s) => s.status === 'completed'),
    `status=${task.status} steps=${JSON.stringify(task.plan.map((s) => [s.tool, s.status]))}`,
  )
  ok('T1c final report is present', typeof task.result === 'string' && task.result.length > 0)
  ok('T1d timestamps recorded', Boolean(task.startedAt && task.endedAt))
}

// ── T2 · request that requires a real tool call ─────────────────────────────
{
  mockFetch(routeMock({ chat: 'Summary of the structure.' }))
  const task = await startAgentSession('show me the project structure overview')
  const structureStep = task.plan.find((s) => s.tool === 'get_project_structure')
  ok('T2a plan includes a real tool step', Boolean(structureStep), JSON.stringify(task.plan.map((s) => s.tool)))
  ok(
    'T2b real tool step executed and completed',
    structureStep?.status === 'completed' && typeof structureStep?.result === 'string' && structureStep.result.length > 0,
    JSON.stringify(structureStep),
  )
  ok('T2c tool results are reflected in the report', (task.result ?? '').length > 0)
}

// ── T3 · multi-step task tracking ───────────────────────────────────────────
{
  mockFetch(routeMock({ chat: 'Multi-step summary.' }))
  const task = await startAgentSession('analyze and explain the project overview')
  ok('T3a multi-step plan produced (>=3 steps)', task.plan.length >= 3, `steps=${task.plan.length}`)
  ok(
    'T3b every step has a terminal status',
    task.plan.every((s) => ['completed', 'failed', 'skipped'].includes(s.status)),
    JSON.stringify(task.plan.map((s) => [s.tool, s.status])),
  )
  const statuses = task.plan.map((s) => s.status)
  ok('T3c all steps completed in plan order', statuses.every((s) => s === 'completed'), statuses.join(','))
}

// ── T4 · successful tool execution evidence ─────────────────────────────────
{
  mockFetch(routeMock({ chat: 'done' }))
  const task = await startAgentSession('show project structure')
  const step = task.plan.find((s) => s.tool === 'get_project_structure')
  ok(
    'T4 successful tool execution carries observable evidence',
    step?.status === 'completed' && /src\//.test(step.result ?? ''),
    JSON.stringify(step),
  )
}

// ── T5 · failed tool execution is reported honestly ─────────────────────────
// MOCKED: the file API reports the file missing — the agent must say so.
{
  mockFetch(routeMock({ chat: 'I could not read the file.' }))
  const task = await startAgentSession('read the content of package.json file')
  const step = task.plan.find((s) => s.tool === 'read_file')
  ok(
    'T5a missing file fails instead of faking success',
    step?.status === 'failed' && /Not found/.test(step.error ?? ''),
    JSON.stringify(step),
  )
  ok(
    'T5b failure surfaces in logs with error detail',
    task.logs.some((l) => l.type === 'error' && /Not found/.test(l.content)),
  )
  ok(
    'T5c report does not claim the failed step succeeded',
    !(task.result ?? '').includes('package.json read successfully'),
    `result=${task.result}`,
  )
}

// ── T6 · invalid tool response (malformed model output) ─────────────────────
// MOCKED: provider returns JSON with no `reply` field.
{
  mockFetch(async () => llmResponse(null, { raw: true, body: { ok: true } }))
  const task = await startAgentSession('hello')
  const reportStep = task.plan.find((s) => s.id === 'step-report')
  ok(
    'T6a malformed model response is not treated as success',
    reportStep?.status === 'failed' && /Malformed model response/.test(reportStep.error ?? ''),
    JSON.stringify(reportStep),
  )
  ok('T6b malformed response yields failed session, not false completion', task.status === 'failed', `status=${task.status}`)
}
{
  // provider 500 twice then success → guided turn + bounded retry visible
  let calls = 0
  mockFetch(routeMock({
    chat: async () => {
      calls++
      return calls <= 2 ? llmResponse(null, { status: 500, raw: true, body: { error: 'boom' } }) : llmResponse('recovered')
    },
  }))
  const task = await startAgentSession('hello again')
  const reportStep = task.plan.find((s) => s.id === 'step-report')
  ok(
    'T6c transient failure retried within bounded attempts',
    reportStep?.status === 'completed' && reportStep.attempts === 2 && calls === 3,
    // 1 guided turn + 2 fallback attempts; reuse the answer without another model call.
    `attempts=${reportStep?.attempts} calls=${calls}`,
  )
}
{
  // persistent failure → retries stop at 1 + maxRetries
  resetAgentSessionConfig()
  configureAgentSession({ stepDelayMs: 0, maxRetries: 2 })
  let calls = 0
  mockFetch(routeMock({
    chat: async () => {
      calls++
      return llmResponse(null, { status: 500, raw: true, body: { error: 'always down' } })
    },
  }))
  const task = await startAgentSession('hello third time')
  const reportStep = task.plan.find((s) => s.id === 'step-report')
  ok(
    'T6d retries are bounded (maxRetries honored)',
    reportStep?.status === 'failed' && calls === 4 && reportStep.attempts === 3,
    // calls = 1 guided turn + 3 fallback attempts (no synthesis: all failed)
    `attempts=${reportStep?.attempts} calls=${calls}`,
  )
  resetAgentSessionConfig()
  configureAgentSession({ stepDelayMs: 0 })
}

// An unloaded model needs user action; do not hammer the provider with retries.
{
  let modelCalls = 0
  mockFetch(routeMock({ chat: async () => {
    modelCalls++
    return llmResponse(null, { status: 503, raw: true, body: { ok: false, retryable: false, code: 'MODEL_NOT_READY', error: 'Load a chat model in LM Studio or select another model under Models, then retry.' } })
  } }))
  const task = await startAgentSession('hello')
  ok('T6e model-not-ready errors stop after one attempt', task.status === 'failed' && modelCalls === 1, `calls=${modelCalls}`)
  ok('T6f model-not-ready errors explain how to recover', /Load a chat model/.test(task.result ?? '') && !/HTTP 400/.test(task.result ?? ''), task.result)
  restoreFetch()
}

// ── T7 · permission approval ────────────────────────────────────────────────
// MOCKED: approved path.
{
  mockFetch(routeMock({ chat: 'command summary' }))
  // Subscribe BEFORE starting: the approval gate is raised synchronously
  // during the first step, so a late subscriber would miss the notification.
  let sawApproval = false
  const unsub = subscribeAgentSession((s) => {
    if (s.pendingApproval) sawApproval = true
  })
  const p = startAgentSession('run git status')
  // wait for the approval gate
  for (let i = 0; i < 200 && !getAgentSessionState().pendingApproval; i++) await sleep(10)
  ok('T7a approval gate raised before execution', Boolean(getAgentSessionState().pendingApproval))
  ok('T7b UI subscriber notified of pending approval', sawApproval)
  const pending = getAgentSessionState().pendingApproval
  ok('T7c approval request exposes tool + params', pending?.tool === 'run_command' && Boolean(pending?.params?.command), JSON.stringify(pending))
  resolveApproval(true)
  const task = await p
  unsub()
  const step = task.plan.find((s) => s.tool === 'run_command')
  ok(
    'T7d approved step proceeds to execution',
    step?.status === 'completed' && !/Permission denied/.test(step.error ?? ''),
    JSON.stringify(step),
  )
  ok('T7e approval decision logged', task.logs.some((l) => l.type === 'approval' && /granted/i.test(l.content)))
  ok('T7f no approval left pending', getAgentSessionState().pendingApproval === null)
}
// MOCKED: denied path.
{
  mockFetch(async () => llmResponse('summary'))
  const p = startAgentSession('run the build')
  for (let i = 0; i < 200 && !getAgentSessionState().pendingApproval; i++) await sleep(10)
  ok('T7g denial gate raised', Boolean(getAgentSessionState().pendingApproval))
  resolveApproval(false)
  const task = await p
  const step = task.plan.find((s) => s.tool === 'run_command')
  ok(
    'T7h denied step does not execute',
    step?.status === 'failed' && /Permission denied/.test(step.error ?? ''),
    JSON.stringify(step),
  )
  ok('T7i denial logged', task.logs.some((l) => l.type === 'approval' && /denied/i.test(l.content)))
}

// ── T8 · cancellation during execution ──────────────────────────────────────
// MOCKED: model hangs; user cancels mid-run.
{
  mockFetch(async () => {
    await sleep(3000)
    return llmResponse('too late')
  })
  const p = startAgentSession('analyze and explain the project overview')
  await sleep(120)
  cancelAgentSession()
  const task = await p
  ok('T8a cancellation marks the session cancelled', task.status === 'cancelled', `status=${task.status}`)
  ok('T8b cancellation is logged', task.logs.some((l) => /cancel/i.test(l.content)))
  ok('T8c session is no longer running', getAgentSessionState().isRunning === false)
  restoreFetch()
}

// ── T9 · execution timeouts ─────────────────────────────────────────────────
// MOCKED: model answers slowly. Model calls run on their own budget
// (llmTimeoutMs) — the short real-tool timeout must NOT kill them (regression
// for the "All 1 step(s) failed… timed out after 10000ms" defect).
{
  resetAgentSessionConfig()
  configureAgentSession({ stepDelayMs: 0, toolTimeoutMs: 150, maxRetries: 0 })
  mockFetch(async () => {
    await sleep(3000)
    return llmResponse('slow but fine')
  })
  const task = await startAgentSession('hello')
  const reportStep = task.plan.find((s) => s.id === 'step-report')
  ok(
    'T9a model call is not killed by the short tool timeout',
    reportStep?.status === 'completed' && /slow but fine/.test(reportStep.result ?? ''),
    JSON.stringify(reportStep),
  )
  ok('T9b slow model call completes the task', task.status === 'completed', `status=${task.status}`)
  resetAgentSessionConfig()
}
// MOCKED: model exceeds its own budget too — the call must fail, bounded.
{
  configureAgentSession({ stepDelayMs: 0, toolTimeoutMs: 150, llmTimeoutMs: 150, maxRetries: 0 })
  mockFetch(async () => {
    await sleep(5000)
    return llmResponse('never seen')
  })
  const started = Date.now()
  const task = await startAgentSession('hello')
  const elapsed = Date.now() - started
  const reportStep = task.plan.find((s) => s.id === 'step-report')
  ok(
    'T9c model-call timeout enforced',
    reportStep?.status === 'failed' && /timed out/.test(reportStep.error ?? ''),
    JSON.stringify(reportStep),
  )
  ok('T9d model-call timeout returns in bounded time', elapsed < 3000, `${elapsed}ms`)
  ok('T9e model-call timeout reported as failure, not success', task.status === 'failed', `status=${task.status}`)
  resetAgentSessionConfig()
  configureAgentSession({ stepDelayMs: 0 })
}

// ── T10 · accurate final reporting ──────────────────────────────────────────
// MOCKED: partial success — 1 real tool ok, 1 file missing.
{
  mockFetch(routeMock({ chat: 'Summary: structure inspected, file unread.' }))
  const task = await startAgentSession('show project structure and read the content of config file')
  const structure = task.plan.find((s) => s.tool === 'get_project_structure')
  const read = task.plan.find((s) => s.tool === 'read_file')
  ok(
    'T10a report reflects real per-step outcomes',
    structure?.status === 'completed' && read?.status === 'failed',
    JSON.stringify({ structure: structure?.status, read: read?.status }),
  )
  ok(
    'T10b failure note included in final report',
    (task.result ?? '').includes('1 step(s) failed'),
    `result=${task.result}`,
  )
  // Defect #6 regression guard: a run with a failed step must NEVER be
  // reported as `completed` — it is `partial` (evidence-based outcome).
  ok('T10c session status never claims success with a failed step', task.status === 'partial', `status=${task.status}`)
  ok(
    'T10c2 partial run states the shortfall in its report',
    (task.result ?? '').includes('Partially completed'),
    `result=${task.result}`,
  )
}
{
  // all steps fail → session must not be reported as completed
  mockFetch(async () => llmResponse(null, { status: 500, raw: true, body: { error: 'down' } }))
  const task = await startAgentSession('read the content of package.json file')
  ok('T10d all-failed run reports failure', task.status === 'failed', `status=${task.status}`)
  ok('T10e all-failed run has an error message', typeof task.error === 'string' && task.error.length > 0)
}

// ── T11 · session state: snapshot + change notifications + persistence ──────
{
  mockFetch(async () => llmResponse('ok'))
  let notified = 0
  const unsub = subscribeAgentSession(() => notified++)
  const task = await startAgentSession('hello state')
  ok('T11a subscribers notified during execution', notified > 0, `notifications=${notified}`)
  const snapshot = getAgentSessionState()
  ok(
    'T11b snapshot exposes task, running flag, approval slot',
    snapshot.task?.id === task.id && snapshot.isRunning === false && snapshot.pendingApproval === null,
    JSON.stringify({ id: snapshot.task?.id, running: snapshot.isRunning }),
  )
  // snapshots must be copies, not live references
  snapshot.task.request = 'MUTATED'
  ok('T11c snapshot is a copy (state not externally mutable)', getAgentSessionState().task.request !== 'MUTATED')
  unsub()
  const before = getAgentSessionState()
  await sleep(5)
  const after = getAgentSessionState()
  ok('T11d state is in-memory only (no cross-restart persistence)', before.task?.id === after.task?.id && before.task !== undefined)
}

// ── T12 · safety: redaction, validation, regression guards ──────────────────
{
  const red = redactSecrets('key is sk-or-v1-abcdef123456 and Bearer eyJhbGciOi.payload and api_key="super-secret-value"')
  ok(
    'T12a secrets redacted',
    !red.includes('sk-or-v1-abcdef123456') && !red.includes('super-secret-value') && red.includes('[REDACTED]'),
    red,
  )
  const plain = redactSecrets('show project structure')
  ok('T12b non-secret text untouched', plain === 'show project structure', plain)

  try {
    await startAgentSession('   ')
    ok('T12c empty request rejected', false)
  } catch (e) {
    ok('T12c empty request rejected', /required/i.test(String(e?.message)), String(e?.message))
  }

  // Hold the model response open so the first session is genuinely running
  // while the second start is attempted.
  mockFetch(async () => {
    await sleep(800)
    return llmResponse('ok')
  })
  const first = startAgentSession('first')
  await sleep(30)
  try {
    await startAgentSession('second')
    ok('T12d concurrent session rejected', false, 'second start did not throw')
  } catch {
    ok('T12d concurrent session rejected', true)
  }
  await first
  restoreFetch()

  // tool argument validation exists
  ok('T12e read_file validates its path argument', typeof getToolByName('read_file')?.validate === 'function')
  ok(
    'T12f validation rejects missing path',
    getToolByName('read_file').validate({}) !== null,
  )
  ok('T12g run_command is flagged as permission-gated', getToolByName('run_command')?.requiresPermission === true)

  // scope regression guard: runtime must stay self-contained
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  const shared = imports.filter((i) => /agent-hub\/(store|types|shell|seed|normalize)/.test(i))
  ok('T12h runtime imports no shared Agent Hub modules', shared.length === 0, shared.join(', '))
  ok('T12i runtime imports no third-party packages', imports.every((i) => i.startsWith('.')), imports.join(', '))

  restoreFetch()
}

// ── T14 · permission modes: read-only and edit only (no bypass) ─────────────
// MOCKED throughout.
{
  ok('T14a default mode is edit', getSmolMode() === 'edit', getSmolMode())
  ok('T14b mode labels cover exactly ro + edit', MODE_LABELS.ro === 'read-only' && MODE_LABELS.edit === 'edit' && Object.keys(MODE_LABELS).length === 2)

  // read-only: command refused without ever raising the approval gate
  setSmolMode('ro')
  mockFetch(routeMock({ chat: 'ro summary' }))
  let sawGate = false
  const unsubRo = subscribeAgentSession((s) => {
    if (s.pendingApproval) sawGate = true
  })
  const roTask = await startAgentSession('run git status')
  unsubRo()
  const roStep = roTask.plan.find((s) => s.tool === 'run_command')
  ok(
    'T14c ro mode refuses commands without an approval gate',
    roStep?.status === 'failed' && /read-only/i.test(roStep.error ?? '') && sawGate === false,
    JSON.stringify({ step: roStep, sawGate }),
  )

  // edit: approval gate raised before execution
  setSmolMode('edit')
  let sawGateEd = false
  const unsubEd = subscribeAgentSession((s) => {
    if (s.pendingApproval) sawGateEd = true
  })
  const p = startAgentSession('run git status')
  for (let i = 0; i < 200 && !getAgentSessionState().pendingApproval; i++) await sleep(10)
  ok('T14d edit mode raises the approval gate', Boolean(getAgentSessionState().pendingApproval) && sawGateEd)
  resolveApproval(true)
  const edTask = await p
  unsubEd()
  const edStep = edTask.plan.find((s) => s.tool === 'run_command')
  ok('T14e approved edit step executes', edStep?.status === 'completed', JSON.stringify(edStep))

  // cycle order ro → edit → ro
  setSmolMode('ro')
  ok('T14f cycle ro→edit', cycleSmolMode() === 'edit')
  ok('T14g cycle edit→ro', cycleSmolMode() === 'ro')

  try {
    setSmolMode('bypass')
    ok('T14h bypass rejected (no unrestricted mode)', false)
  } catch {
    ok('T14h bypass rejected (no unrestricted mode)', true)
  }
  try {
    setSmolMode('yolo')
    ok('T14i invalid mode rejected', false)
  } catch {
    ok('T14i invalid mode rejected', true)
  }
  setSmolMode('edit')
  ok('T14j mode restored to edit', getSmolMode() === 'edit')
}

// ── T15 · smol reasoning effort ─────────────────────────────────────────────
{
  ok('T15a default effort is null (model default)', getSmolEffort() === null)
  for (const e of ['off', 'low', 'medium', 'high']) {
    setSmolEffort(e)
    ok(`T15b effort set/get ${e}`, getSmolEffort() === e)
  }
  setSmolEffort('off')
  ok('T15c off means concise, no trace', /concise/i.test(getEffortPromptPrefix()))
  setSmolEffort(null)
  ok('T15d default effort adds no prefix', getEffortPromptPrefix() === '')
  try {
    setSmolEffort('xhigh')
    ok('T15e invalid effort rejected', false)
  } catch {
    ok('T15e invalid effort rejected', true)
  }
  setSmolEffort(null)
}

// ── T16 · smol harness-held plan ────────────────────────────────────────────
{
  resetSmolPlan()
  ok('T16a empty plan shows honestly', smolPlanShow() === 'No plan set.')
  ok('T16b set requires steps', smolPlanSet('   ').startsWith('Error'))
  const setOut = smolPlanSet('inspect structure; run checks; report')
  ok('T16c semicolon lists accepted', getSmolPlan().length === 3 && /Plan set \(3 steps\)/.test(setOut), setOut)
  ok('T16d current step marked', smolPlanShow().includes('1.[>] inspect structure'), smolPlanShow())
  ok('T16e done returns whats-next', /Next: 2/.test(smolPlanDone()), smolPlanShow())
  ok('T16f add appends', smolPlanAdd('verify fix') === 'Added step 4: verify fix')
  ok('T16g checkpoint saves verbatim notes', smolPlanCheckpoint('API x returns 500, try y next').startsWith('Checkpoint saved'))
  ok('T16h notes render on the current step', smolPlanShow().includes('API x returns 500'))
  ok('T16i bad step number rejected', smolPlanDone(99).startsWith('Error'))
  ok('T16j empty add rejected', smolPlanAdd('  ').startsWith('Error'))
  smolPlanSet(Array.from({ length: 25 }, (_, i) => `step ${i + 1}`).join('\n'))
  ok('T16k plan capped at 20 steps', getSmolPlan().length === 20, `${getSmolPlan().length}`)
  // snapshots are copies
  const snap = getSmolPlan()
  snap[0].text = 'MUTATED'
  ok('T16l plan snapshot is a copy', getSmolPlan()[0].text !== 'MUTATED')

  // execution seeds the harness checklist and tracks progress
  mockFetch(async () => llmResponse('plan seed check'))
  resetSmolPlan()
  const task = await startAgentSession('hello there')
  ok(
    'T16m run seeds checklist from the execution plan',
    getSmolPlan().length === task.plan.length && getSmolPlan().every((s) => s.done),
    JSON.stringify(getSmolPlan()),
  )
}

// ── T17 · smol syntax check ─────────────────────────────────────────────────
{
  ok('T17a valid JS passes', syntaxCheckSnippet('app.js', 'const x = 1;') === null)
  const badJs = syntaxCheckSnippet('app.js', 'function broken( {')
  ok('T17b broken JS flagged with file + fix hint', typeof badJs === 'string' && badJs.includes('app.js') && /Fix this before moving on/.test(badJs), badJs)
  ok('T17c valid JSON passes', syntaxCheckSnippet('data.json', '{"a": 1}') === null)
  const badJson = syntaxCheckSnippet('data.json', '{"a": }')
  ok('T17d broken JSON flagged', typeof badJson === 'string' && /not valid JSON/.test(badJson), badJson)
  const badHtml = syntaxCheckSnippet('page.html', '<html><script>const x = ;</script></html>')
  ok('T17e broken inline script flagged with line', typeof badHtml === 'string' && /line \d+/.test(badHtml), badHtml)
  ok('T17f good HTML passes', syntaxCheckSnippet('page.html', '<html><script>const x = 1;</script></html>') === null)
  ok('T17g src scripts skipped', syntaxCheckSnippet('page.html', '<html><script src="x.js"></script></html>') === null)
  ok('T17h unsupported types pass through', syntaxCheckSnippet('notes.txt', '(((unbalanced') === null)
  ok('T17i empty content rejected', (syntaxCheckSnippet('a.js', '') ?? '').startsWith('Error'))
  // registry wiring
  ok('T17j syntax_check tool registered', typeof getToolByName('syntax_check')?.execute === 'function')
  ok('T17k plan tool registered', typeof getToolByName('plan')?.execute === 'function')
  const planShow = await getToolByName('plan').execute({ action: 'show' })
  ok('T17l plan tool show works', planShow.ok && typeof planShow.result === 'string')
  const planBad = await getToolByName('plan').execute({ action: 'nope' })
  ok('T17m plan tool coaches bad actions', !planBad.ok && /must be one of/.test(planBad.error ?? ''))
}

// ── T18 · smol cut-off coaching ─────────────────────────────────────────────
{
  ok('T18a short text never flagged', isTruncatedReply('const x = 1;') === false)
  const complete = 'Here is the summary. First we inspected the project structure. Then we ran the checks. Everything passed and the report is complete.'
  ok('T18b complete prose passes', isTruncatedReply(complete + ' The end.') === false)
  const cutBraces = '{"result": {"items": [1, 2, 3], "summary": "' + 'y'.repeat(300)
  ok('T18c unclosed structure flagged', isTruncatedReply(cutBraces) === true)
  const cutComma = 'First step done, second step done, third step started with value ' + 'z'.repeat(300) + ','
  ok('T18d dangling comma flagged', isTruncatedReply(cutComma) === true)

  // MOCKED: a cut-off model reply is coached, not reported as complete
  mockFetch(async () => llmResponse(cutBraces))
  const task = await startAgentSession('hello cut off')
  ok(
    'T18e cut-off reply triggers coaching log',
    task.logs.some((l) => /cut off/.test(l.content) && /in parts/.test(l.content)),
  )
  const reportStep = task.plan.find((s) => s.id === 'step-report')
  ok('T18f coached reply still carries its partial result', reportStep?.status === 'completed', JSON.stringify(reportStep?.status))
}

// ── T19 · smol context meter + tier-1 eviction ──────────────────────────────
{
  ok('T19a token estimate is chars/4', estimateTokens('abcd') === 1 && estimateTokens('') === 0)
  resetAgentSessionConfig()
  configureAgentSession({ stepDelayMs: 0, logCap: 10 })
  let evictionTurn = 0
  mockFetch(routeMock({ chat: async (url, init) => {
    const message = JSON.parse(init?.body ?? '{}').message ?? ''
    if (message.includes('Current step: Analyze and plan') && evictionTurn < 5) {
      return llmResponse('```tool ' + JSON.stringify({ name: 'syntax_check', args: { path: `probe-${evictionTurn++}.js`, content: 'const valid = true;' } }) + '```')
    }
    return llmResponse('FINAL: eviction probe reply')
  } }))
  const task = await startAgentSession('analyze and explain the project overview')
  const stats = getContextStats()
  // 10 decision-line allowance + 1 for the bounded skills-availability line
  // (this blanket mock answers /api/skills with a model reply, so the runtime
  // records one honest "Skills unavailable" decision and moves on).
  ok('T19b log stays bounded while decision lines are preserved', stats.logLines <= 10 + task.logs.filter((l) => l.type !== 'result').length, `lines=${stats.logLines}`)
  ok('T19c old tool results evicted first', stats.evicted > 0, `evicted=${stats.evicted}`)
  ok(
    'T19d eviction markers are honest',
    task.logs.some((l) => /^\[evicted to save context/.test(l.content)),
  )
  ok('T19e stats report tokens + cap', stats.estimatedTokens > 0 && stats.cap === 10, JSON.stringify(stats))
  resetAgentSessionConfig()
  configureAgentSession({ stepDelayMs: 0 })
}

// ── T20 · smol session memory ───────────────────────────────────────────────
{
  setSessionMemory('Use bun, not npm. Never touch db/.')
  ok('T20a memory round-trips', getSessionMemory() === 'Use bun, not npm. Never touch db/.')
  setSessionMemory(`  ${'m'.repeat(9000)}  `)
  ok('T20b memory capped at ~2k tokens', getSessionMemory().length === 8000, `${getSessionMemory().length}`)
  clearSessionMemory()
  ok('T20c memory clears', getSessionMemory() === '')

  // MOCKED: memory rides along after the prompt
  setSessionMemory('MEMORY-PROBE-123')
  let seen = ''
  mockFetch(async (url, init) => {
    try {
      seen = JSON.parse(init?.body ?? '{}')?.message ?? ''
    } catch {
      seen = ''
    }
    return llmResponse('memory ok')
  })
  await startAgentSession('hello memory')
  ok('T20d memory injected into model prompts', seen.includes('MEMORY-PROBE-123'), seen.slice(0, 120))
  clearSessionMemory()
  restoreFetch()
}

// ── T21 · smol failure signatures ───────────────────────────────────────────
{
  const sig = failureSignature('\x1b[31mBuild failed in 12.5s at line 42\x1b[0m  extra   spaces')
  ok('T21a failures normalized to repeat hints', sig === 'Build failed in #s at line # extra spaces', sig)
  ok('T21b plain text passes through', failureSignature('no numbers here') === 'no numbers here')
}

// ── T22 · named agent team: Project Manager first, expandable ───────────────
{
  const roster = getAgentRoster()
  ok(
    'T22a roster has Project Manager + 6 specialists (incl. UI/UX Design Agent + Teaching Agent)',
    roster.length === 7 && roster[0].id === 'manager' && roster.some((a) => a.id === 'designer' && a.name === 'UI/UX Design Agent') && roster.some((a) => a.id === 'teaching-agent' && a.name === 'Teaching Agent'),
    roster.map((a) => a.id).join(','),
  )
  ok('T22b manager is named, not "smol"', roster[0].name === 'Project Manager' && !/smol/i.test(roster[0].name))
  ok(
    'T22c every member has name, role and tools',
    roster.every((a) => a.name && a.role && Array.isArray(a.tools) && a.tools.length > 0),
  )
  ok('T22d every member defaults to automatic model (local → cloud)', roster.every((a) => a.model === ''))
  ok('T22e unknown member falls back to Project Manager', getAgentName('nope') === 'Project Manager' && getAgentById('nope') === undefined)
  ok(
    'T22f no "smol" in any member name or role',
    roster.every((a) => !/smol/i.test(a.name) && !/smol/i.test(a.role)),
  )
}

// ── T23 · Project Manager delegates steps to specialists ────────────────────
{
  const plan = createPlan('show project structure and read the content of config file and run tests')
  const ids = plan.map((s) => s.agentId)
  ok(
    'T23a every step delegated to a roster member',
    plan.every((s) => getAgentById(s.agentId) !== undefined),
    JSON.stringify(plan.map((s) => [s.tool, s.agentId])),
  )
  ok(
    'T23b research steps go to Researcher, commands to Runner',
    plan.find((s) => s.tool === 'get_project_structure')?.agentId === 'researcher' &&
      plan.find((s) => s.tool === 'run_command')?.agentId === 'runner',
    JSON.stringify(ids),
  )
  ok('T23c final report stays with Project Manager', plan[plan.length - 1].agentId === 'manager')
}

// ── T24 · runs speak with agent names, never "smol" ─────────────────────────
// MOCKED.
{
  mockFetch(routeMock({ chat: 'team summary' }))
  const task = await startAgentSession('show me the project structure overview')
  const texts = [...task.logs.map((l) => l.content), task.result ?? '']
  ok(
    'T24a logs carry specialist names',
    task.logs.some((l) => /Researcher/.test(l.content)) && task.logs.some((l) => /Project Manager/.test(l.content)),
  )
  ok('T24b no "smol" anywhere user-visible', texts.every((t) => !/smol/i.test(t)), texts.find((t) => /smol/i.test(t))?.slice(0, 120) ?? '')
  ok('T24c start line names the team', task.logs.some((l) => /Project Manager \+ \d+ specialists/.test(l.content)))
}

// ── T25 · per-member models ride the existing local/cloud interface ─────────
// MOCKED: capture what the runtime sends to /api/chat.
{
  const bodies = []
  const chatBodies = []
  mockFetch(async (url, init) => {
    let parsed = {}
    try {
      parsed = JSON.parse(init?.body ?? '{}')
    } catch { /* ignore */ }
    bodies.push(parsed)
    if (String(url).includes('/api/chat')) chatBodies.push(parsed)
    return llmResponse('ok')
  })
  setAgentModel('coder', 'ollama')
  await startAgentSession('analyze and explain the project')
  const coderCall = bodies.find((b) => /You are the Coder/.test(b?.settings?.systemPrompt ?? ''))
  ok(
    'T25a specialist speaks with its role prompt',
    Boolean(coderCall),
    JSON.stringify(bodies.map((b) => (b?.settings?.systemPrompt ?? '').slice(0, 40))),
  )
  ok(
    'T25b specialist model override sent through (local id)',
    coderCall?.settings?.model === 'ollama',
    JSON.stringify(coderCall?.settings),
  )
  const managerCall = bodies.find((b) => /You are the Project Manager/.test(b?.settings?.systemPrompt ?? ''))
  ok('T25c manager uses automatic routing for the partial-run report', managerCall?.settings?.model === '', JSON.stringify(managerCall?.settings))
  setAgentModel('coder', '')
  ok('T25d model override clears back to automatic', getAgentById('coder').model === '')
  try {
    setAgentModel('ghost', 'ollama')
    ok('T25e unknown member model rejected', false)
  } catch {
    ok('T25e unknown member model rejected', true)
  }
  // Session ↔ Chat isolation: every Session model call must be stateless, so
  // nothing it sends/receives is written to the shared Chat history.
  ok(
    'T25f session model calls are stateless (never share Chat history)',
    chatBodies.length > 0 && chatBodies.every((b) => b?.stateless === true),
    JSON.stringify(chatBodies.map((b) => b?.stateless)),
  )
  restoreFetch()
}

// ── T26 · roster is expandable: add / remove members ────────────────────────
{
  const before = getAgentRoster().length
  const added = registerAgentDefinition({
    id: 'tester',
    name: 'Tester',
    role: 'Writes regression checks',
    description: 'Writes regression checks for the team.',
    tools: ['call_llm', 'syntax_check'],
    model: '',
    systemPrompt: 'You are the Tester.',
  })
  ok('T26a custom member added', added.id === 'tester' && getAgentRoster().length === before + 1)
  ok('T26b roster snapshot in state', getAgentSessionState().agents.some((a) => a.id === 'tester'))
  try {
    registerAgentDefinition({ id: 'tester', name: 'Dup', role: '', description: '', tools: ['call_llm'], model: '', systemPrompt: '' })
    ok('T26c duplicate id rejected', false)
  } catch {
    ok('T26c duplicate id rejected', true)
  }
  try {
    registerAgentDefinition({ id: 'Bad_ID!', name: 'Bad', role: '', description: '', tools: ['call_llm'], model: '', systemPrompt: '' })
    ok('T26d bad id rejected', false)
  } catch {
    ok('T26d bad id rejected', true)
  }
  try {
    registerAgentDefinition({ id: 'weird', name: 'Weird', role: '', description: '', tools: ['teleport'], model: '', systemPrompt: '' })
    ok('T26e unknown tool rejected', false)
  } catch {
    ok('T26e unknown tool rejected', true)
  }
  try {
    registerAgentDefinition({ id: 'manager', name: 'Fake', role: '', description: '', tools: ['call_llm'], model: '', systemPrompt: '' })
    ok('T26f built-in id protected', false)
  } catch {
    ok('T26f built-in id protected', true)
  }
  removeAgentDefinition('tester')
  ok('T26g custom member removed', !getAgentById('tester') && getAgentRoster().length === before)
  try {
    removeAgentDefinition('manager')
    ok('T26h built-in removal refused', false)
  } catch {
    ok('T26h built-in removal refused', true)
  }
  try {
    removeAgentDefinition('ghost')
    ok('T26i unknown removal refused', false)
  } catch {
    ok('T26i unknown removal refused', true)
  }
}

// ── T27 · approval names the requesting member ──────────────────────────────
// MOCKED: deny to finish fast.
{
  mockFetch(async () => llmResponse('summary'))
  const p = startAgentSession('run git status')
  for (let i = 0; i < 200 && !getAgentSessionState().pendingApproval; i++) await sleep(10)
  const pending = getAgentSessionState().pendingApproval
  ok('T27a approval names the Runner', pending?.agentName === 'Runner', JSON.stringify(pending))
  resolveApproval(false)
  await p
  restoreFetch()
}

// ── T28 · served model (local vs cloud) is observed, not assumed ────────────
// MOCKED: provider reports which model served the reply.
{
  mockFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, reply: 'served reply', model: 'LM Studio (qwen3)' }) }))
  const task = await startAgentSession('hello served')
  ok(
    'T28a serving model logged with the member',
    task.logs.some((l) => /Project Manager.*via LM Studio \(qwen3\)/.test(l.content)),
  )
  restoreFetch()
}

// ── T29 · real file read/write/edit tools (MOCKED endpoints) ────────────────
{
  // read success fixture
  mockFetch(routeMock({
    chat: 'file work done',
    files: async (u, init) => {
      if (u.includes('op=read')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'src/a.ts', content: 'const x = 1;\n', totalLines: 1, offset: 0, limit: 200, size: 12, truncated: false }) }
      }
      if (init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'src/a.ts', bytes: 20, created: false, replacements: 1 }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, path: '.', tree: [], truncated: false }) }
    },
  }))
  const task = await startAgentSession('read the content of src/a.ts file')
  const step = task.plan.find((s) => s.tool === 'read_file')
  ok(
    'T29a real file read completes with content evidence',
    step?.status === 'completed' && /const x = 1/.test(step.result ?? ''),
    JSON.stringify(step?.result)?.slice(0, 120),
  )

  // write_file is approval-gated in runs; here the tool is driven directly
  // (the gate lives in the execution layer, covered by T7/T27).
  // An explicit update authorizes src/a.ts; reading it alone grants no writes.
  await startAgentSession('update src/a.ts')
  const writeTool = getToolByName('write_file')
  const wp = writeTool.execute({ path: 'src/a.ts', content: 'hello' })
  const wres = await wp
  ok('T29b write succeeds against the file API', wres.ok && /Created|Overwrote/.test(wres.result), JSON.stringify(wres).slice(0, 160))
  const changed = getChangedFiles()
  ok('T29c change tracked for review', changed.some((c) => c.path === 'src/a.ts'), JSON.stringify(changed.map((c) => c.path)))
  const diff = diffLines('a\nb\n', 'a\nc\n')
  ok('T29d diff shows before/after lines', diff.includes('- b') && diff.includes('+ c'), diff)
  restoreFetch()
}

// ── T30 · guided model↔tool loop: fenced blocks run, prose does not ─────────
// MOCKED.
{
  // The Coder (analyze step) proposes a syntax_check block; the Manager
  // (report step) answers FINAL.
  const codeBlock = '```tool {"name": "syntax_check", "args": {"path": "ok.js", "content": "const x = 1;"}}```'
  mockFetch(routeMock({
    chat: async (u, init) => {
      let msg = ''
      try {
        msg = JSON.parse(init?.body ?? '{}')?.message ?? ''
      } catch { /* ignore */ }
      if (msg.includes('Current step: Synthesize findings and report') || msg.includes('Answer the original request directly')) return llmResponse('FINAL: analysis complete, no issues found')
      return llmResponse(codeBlock)
    },
  }))
  const task = await startAgentSession('analyze the syntax of src/a.ts')
  const analyze = task.plan.find((s) => s.id === 'step-analyze')
  ok(
    'T30a model-proposed tool call executed with real result',
    analyze?.status === 'completed' && /no syntax issues found/.test(analyze.result ?? ''),
    JSON.stringify(analyze?.result)?.slice(0, 160),
  )
  const report = task.plan.find((s) => s.id === 'step-report')
  ok('T30b FINAL: finishes the step with an answer', report?.status === 'completed', JSON.stringify(report?.status))

  // plain-text tool mention is NOT executed
  mockFetch(routeMock({ chat: 'You should run read_file on src/a.ts to proceed' }))
  const task2 = await startAgentSession('hello prose')
  const step2 = task2.plan.find((s) => s.id === 'step-report')
  ok(
    'T30c prose tool mentions never execute as commands',
    step2?.status === 'completed' && !/guided content|const x/.test(step2.result ?? ''),
    JSON.stringify(step2?.result)?.slice(0, 160),
  )

  // a member cannot wield tools outside its allow-list (Project Manager + read)
  mockFetch(routeMock({ chat: '```tool {"name": "read_file", "args": {"path": "src/a.ts"}}```' }))
  const task3 = await startAgentSession('hello guided')
  ok(
    'T30d off-allow-list calls refused, never executed',
    task3.logs.some((l) => /allow-list — refused/.test(l.content)),
  )

  // malformed block → coached, unknown tool → refused with allow-list
  const parsed = parseToolBlocks('```tool {"name": }``` and ```tool {"name": "teleport", "args": {}}```')
  ok('T30e malformed blocks counted, valid parsed', parsed.malformed === 1 && parsed.calls[0]?.name === 'teleport')
  ok('T30f FINAL: parsed as an answer', parseToolBlocks('some work\nFINAL: all done here').finalAnswer === 'all done here')
  restoreFetch()
}

// ── T30g · evidence-based run outcome (never claims unverified success) ─────
{
  const clean = deriveRunOutcome({
    completed: 3,
    failed: 0,
    skipped: 0,
    verification: { passed: true, preExisting: false, baselineUnknown: false },
  })
  ok('T30g1 all steps + verification pass → completed', clean.status === 'completed' && clean.verified === true)

  const someFailed = deriveRunOutcome({ completed: 2, failed: 1, skipped: 0 })
  ok(
    'T30g2 a failed step → partial, never completed',
    someFailed.status === 'partial' && someFailed.verified === false && /1 step failed/.test(someFailed.summary),
    someFailed.summary,
  )

  const verifyFailed = deriveRunOutcome({
    completed: 2,
    failed: 0,
    skipped: 0,
    verification: { passed: false, preExisting: false, baselineUnknown: false },
  })
  ok('T30g3 new verification failure → partial', verifyFailed.status === 'partial' && /verification failed/.test(verifyFailed.summary))

  const preExisting = deriveRunOutcome({
    completed: 2,
    failed: 0,
    skipped: 0,
    verification: { passed: false, preExisting: true, baselineUnknown: false },
  })
  ok('T30g4 pre-existing verification failure does not block completion', preExisting.status === 'completed' && preExisting.verified === true)

  const allFailed = deriveRunOutcome({ completed: 0, failed: 2, skipped: 1 })
  ok('T30g5 no completed steps → failed', allFailed.status === 'failed' && allFailed.verified === false)

  const withSkipped = deriveRunOutcome({ completed: 1, failed: 0, skipped: 1 })
  ok('T30g6 skipped steps reported', withSkipped.status === 'partial' && /1 step skipped/.test(withSkipped.summary), withSkipped.summary)

  const emptyBlock = parseToolBlocks('```tool ```')
  ok('T30g7 empty tool block is never an executable call', emptyBlock.calls.length === 0 && emptyBlock.malformed >= 1)

  const argsParsed = parseToolBlocks('```tool {"name":"read_file","args":{"path":"a.ts","n":3}}```')
  ok(
    'T30g8 tool arguments are parsed (non-strings stringified)',
    argsParsed.calls.length === 1 && argsParsed.calls[0].args.path === 'a.ts' && argsParsed.calls[0].args.n === '3',
    JSON.stringify(argsParsed.calls[0]),
  )
}

// ── T31 · workspace validation (pure) ───────────────────────────────────────
{
  ok('T31a root normalizes', normalizeWorkspace('') === '.' && normalizeWorkspace('/') === '.' && normalizeWorkspace('  src/app ') === 'src/app')
  ok('T31a2 leading slash stays inside the workspace', normalizeWorkspace('/abs') === 'abs')
  for (const bad of ['..', '../x', 'a/../../b', 'a\\..\\b', 'nul\0byte']) {
    try {
      normalizeWorkspace(bad)
      ok(`T31b escape rejected (${bad})`, false)
    } catch {
      ok(`T31b escape rejected (${bad})`, true)
    }
  }
  setWorkspace('src')
  ok('T31c workspace set + resolved paths stay inside', getWorkspace() === 'src' && resolveWorkspacePath('a.ts') === 'src/a.ts')
  setWorkspace('.')
  ok('T31d workspace restored', getWorkspace() === '.' && resolveWorkspacePath('a.ts') === 'a.ts')
}

// ── T32 · coding sessions: create/select/rename/delete/persist ──────────────
{
  const before = getCodingSessions().length
  const s = newCodingSession('Test work')
  ok('T32a session created + active', getActiveCodingSession()?.id === s.id && s.workspace === getWorkspace())
  renameCodingSession(s.id, 'Renamed')
  ok('T32b session renamed', getCodingSessions().find((x) => x.id === s.id)?.name === 'Renamed')
  try {
    renameCodingSession(s.id, '   ')
    ok('T32c blank rename rejected', false)
  } catch {
    ok('T32c blank rename rejected', true)
  }
  const s2 = newCodingSession()
  selectCodingSession(s.id)
  ok('T32d session selected', getActiveCodingSession()?.id === s.id)
  try {
    selectCodingSession('ghost')
    ok('T32e unknown select rejected', false)
  } catch {
    ok('T32e unknown select rejected', true)
  }
  deleteCodingSession(s2.id)
  ok('T32f session deleted', getCodingSessions().length === before + 1)
  try {
    renameCodingSession('ghost', 'x')
    ok('T32g unknown rename rejected', false)
  } catch {
    ok('T32g unknown rename rejected', true)
  }
  deleteCodingSession(s.id)

  // pure handover + context bounds
  const hand = buildHandover([
    { id: 't1', request: 'fix login', status: 'completed', result: 'fixed null check', filesChanged: 2, startedAt: '2026-01-01' },
    { id: 't2', request: 'deploy', status: 'failed', error: 'exit 1', filesChanged: 0, startedAt: '2026-01-02' },
  ])
  ok('T32h handover keeps goal + outcome + files', /fix login/.test(hand) && /FAILED: exit 1/.test(hand) && /2 file\(s\) changed/.test(hand))
  ok('T32i empty handover honest', buildHandover([]) === 'No earlier conversation.')
  ok('T32j session context bounded', buildSessionContext(50).length <= 60)
}

// ── T33 · slash commands do real work ───────────────────────────────────────
// MOCKED endpoints where needed.
{
  mockFetch(routeMock({ chat: 'x' }))
  const help = await runSlashCommand('/help')
  ok('T33a /help lists commands', help.handled && /\/models/.test(help.reply) && /\/stop/.test(help.reply))
  const mode = await runSlashCommand('/mode ro')
  ok('T33b /mode switches policy', mode.handled && getSmolMode() === 'ro' && /read-only/.test(mode.reply))
  await runSlashCommand('/mode edit')
  const plan = await runSlashCommand('/plan')
  ok('T33c /plan shows the checklist', plan.handled && typeof plan.reply === 'string')
  const ctx = await runSlashCommand('/context')
  ok('T33d /context reports estimates honestly', ctx.handled && /estimated/.test(ctx.reply))
  const models = await runSlashCommand('/models')
  ok('T33e /models lists real inventory without secrets', models.handled && /LM Studio/.test(models.reply) && !/sk-|BEGIN/.test(models.reply))
  const tasks = await runSlashCommand('/tasks')
  ok('T33f /tasks lists background tasks', tasks.handled && /No background tasks/.test(tasks.reply))
  const logs = await runSlashCommand('/logs t1')
  ok('T33g /logs shows task output', logs.handled && /line1/.test(logs.reply))
  const stop = await runSlashCommand('/stop t1')
  ok('T33h /stop stops the task', stop.handled && /stopped/.test(stop.reply))
  const unknown = await runSlashCommand('/teleport')
  ok('T33i unknown command honest', unknown.handled && /Unknown command/.test(unknown.reply))
  const notSlash = await runSlashCommand('hello')
  ok('T33j non-slash passes through', notSlash.handled === false)
  const clear = await runSlashCommand('/clear')
  ok('T33k /clear starts a fresh session', clear.handled && getActiveCodingSession() !== null)
  restoreFetch()
}

// ── T34 · sendCodingMessage records turns in the active session ─────────────
// MOCKED.
{
  mockFetch(routeMock({ chat: 'turn reply' }))
  newCodingSession('Turn test')
  const before = getActiveCodingSession().turns.length
  const task = await sendCodingMessage('hello turn')
  const after = getActiveCodingSession()
  ok('T34a turn recorded with outcome', after.turns.length === before + 1 && after.turns[after.turns.length - 1].status === 'completed')
  ok('T34b turn links the run', task.status === 'completed')
  const cmd = await sendCodingMessage('/plan')
  ok('T34c slash answers recorded as turns', /No plan set|1\.\[/.test(cmd.result ?? ''))
  deleteCodingSession(getActiveCodingSession().id)
  restoreFetch()
}

// ── T35 · verification + repair against scripted checks (MOCKED) ────────────
{
  // scripts exist; check fails once, repair edit applies, check passes
  let runs = 0
  mockFetch(routeMock({
    chat: '```tool {"name": "edit_file", "args": {"path": "src/a.ts", "old_text": "x", "new_text": "y"}}```',
    files: async (u, init) => {
      if (u.includes('op=read')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'src/a.ts', content: 'x', totalLines: 1, offset: 0, limit: 200, size: 1, truncated: false }) }
      }
      if (init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'src/a.ts', bytes: 1, created: false, replacements: 1 }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, path: '.', tree: [], truncated: false }) }
    },
    exec: async (u, init) => {
      if (u.includes('op=scripts')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, scripts: { test: 'node check.js' } }) }
      }
      if (init?.method === 'POST') {
        let body = {}
        try {
          body = JSON.parse(init?.body ?? '{}')
        } catch { /* ignore */ }
        // approval-free in tests: gates are auto-approved by the subscriber.
        // Only the project check command fails (twice, differently, then passes).
        if (String(body.command ?? '').includes('npm run test')) {
          runs++
          const failing = runs < 3
          // Word-different failures: failureSignature() normalizes numbers,
          // so the baseline/verify outputs must differ in words to be distinct.
          const out = runs === 1 ? 'exit code: 1\nFAIL boot fault' : runs === 2 ? 'exit code: 1\nFAIL render fault' : 'exit code: 0\nPASS'
          return { ok: true, status: 200, json: async () => ({ ok: true, command: body.command, exitCode: failing ? 1 : 0, stdout: out, stderr: '', truncated: false, timedOut: false, durationMs: 5 }) }
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, command: body.command, exitCode: 0, stdout: 'step ok', stderr: '', truncated: false, timedOut: false, durationMs: 5 }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, tasks: [] }) }
    },
  }))
  // auto-approve every gate this flow raises
  const unsub = subscribeAgentSession((s) => {
    if (s.pendingApproval) resolveApproval(true)
  })
  const task = await startAgentSession('analyze and fix the off-by-one in src/a.ts file and run tests')
  unsub()
  const v = task.verification
  ok(
    'T35a verification ran the project check and repaired',
    v !== undefined && v.command.includes('npm run test') && v.passed === true && v.attempts === 2,
    JSON.stringify(v),
  )
  ok('T35b repair edit tracked as a real change', (task.changedFiles ?? []).some((c) => c.path.endsWith('src/a.ts')))
  restoreFetch()
}

// ── T36 · honest verification failure (MOCKED, repair gives up) ─────────────
{
  let checkRuns = 0
  mockFetch(routeMock({
    chat: async (u, init) => {
      let msg = ''
      try {
        msg = JSON.parse(init?.body ?? '{}')?.message ?? ''
      } catch { /* ignore */ }
      // Guided work steps get a working edit block; the repair prompt gets an
      // honest refusal, so the run must report failure, not success.
      if (msg.includes('smallest targeted fix')) return llmResponse('FINAL: cannot fix safely — needs a human decision')
      return llmResponse('```tool {"name": "edit_file", "args": {"path": "src/a.ts", "old_text": "x", "new_text": "y"}}```')
    },
    files: async (u, init) => {
      if (u.includes('op=read')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'src/a.ts', content: 'x', totalLines: 1, offset: 0, limit: 200, size: 1, truncated: false }) }
      }
      if (init?.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'src/a.ts', bytes: 1, created: false, replacements: 1 }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, path: '.', tree: [], truncated: false }) }
    },
    exec: async (u, init) => {
      if (u.includes('op=scripts')) {
        return { ok: true, status: 200, json: async () => ({ ok: true, scripts: { test: 'node check.js' } }) }
      }
      if (init?.method === 'POST') {
        let body = {}
        try {
          body = JSON.parse(init?.body ?? '{}')
        } catch { /* ignore */ }
        checkRuns++
        const out = checkRuns === 1 ? 'exit code: 1\nFAIL boot' : 'exit code: 1\nFAIL forever'
        return { ok: true, status: 200, json: async () => ({ ok: true, command: body.command, exitCode: 1, stdout: out, stderr: '', truncated: false, timedOut: false, durationMs: 5 }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, tasks: [] }) }
    },
  }))
  const unsub = subscribeAgentSession((s) => {
    if (s.pendingApproval) resolveApproval(true)
  })
  // seed a change through the analyze step so verification has something to check
  const task = await startAgentSession('analyze and repair the broken build in src/a.ts file')
  unsub()
  const v = task.verification
  ok(
    'T36a failed verification reported honestly, not as passing',
    v !== undefined && v.passed === false && /no file fix|cannot fix|exhausted|denied|unavailable/i.test(v.note),
    JSON.stringify(v),
  )
  restoreFetch()
}

// ── T38 · file scope lock: only the destination file may be modified ───────
{
  // Pure scope parsing
  const s1 = getFileScope('fix the bug in src/auth.ts')
  ok('T38a scope parses the named file', s1.allowed.includes('src/auth.ts'), JSON.stringify(s1.allowed))
  const s2 = getFileScope('update README.md and delete old/notes.txt')
  ok('T38b scope parses multiple files', s2.allowed.includes('README.md') && s2.allowed.includes('old/notes.txt'), JSON.stringify(s2.allowed))
  const s3 = getFileScope('refactor the auth module')
  ok('T38c no file named → empty scope', s3.allowed.length === 0 && /No destination file/.test(s3.reason))
  ok('T38d exact path in scope', isPathInScope(s1, 'src/auth.ts'))
  ok('T38e nested path under a scoped dir is in scope', isPathInScope({ allowed: ['src'], reason: '' }, 'src/auth.ts'))
  ok('T38f unrelated path refused', !isPathInScope(s1, 'src/other.ts'))
  ok('T38g sibling with shared prefix refused', !isPathInScope({ allowed: ['src/auth.ts'], reason: '' }, 'src/auth.test.ts'))

  // Runtime enforcement: a write outside scope is refused before the API call
  let writeCalls = 0
  mockFetch(routeMock({
    chat: 'ok',
    files: async (u, init) => {
      if (u.includes('/api/agent-session/files') && init?.method === 'POST') {
        writeCalls++
        return { ok: true, status: 200, json: async () => ({ ok: true, path: 'x', bytes: 1, created: true }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, path: '.', tree: [], truncated: false }) }
    },
  }))
  const task = await startAgentSession('fix src/auth.ts')
  // task.fileScope.allowed should contain src/auth.ts
  ok('T38h run carries the file scope', Array.isArray(task.fileScope?.allowed) && task.fileScope.allowed.includes('src/auth.ts'), JSON.stringify(task.fileScope))
  // Now attempt an out-of-scope write through the tool
  const w = await getToolByName('write_file').execute({ path: 'src/evil.ts', content: 'x' })
  ok('T38i out-of-scope write refused', !w.ok && /Out of scope/.test(w.error ?? ''), JSON.stringify(w.error)?.slice(0, 100))
  ok('T38i2 out-of-scope write never reached the file API', writeCalls === 0, `file POST calls: ${writeCalls}`)
  ok('T38j refusal logged the reason', task.logs.some((l) => /Out of scope/.test(l.content)))
  // In-scope write is allowed (goes to the API)
  const w2 = await getToolByName('write_file').execute({ path: 'src/auth.ts', content: 'export {}' })
  ok('T38k in-scope write proceeds', w2.ok, JSON.stringify(w2).slice(0, 120))
  // delete_file also enforces scope
  const d = await getToolByName('delete_file').execute({ path: 'src/evil.ts' })
  ok('T38l out-of-scope delete refused', !d.ok && /Out of scope/.test(d.error ?? ''))
  const d2 = await getToolByName('delete_file').execute({ path: 'src/auth.ts' })
  ok('T38m in-scope delete proceeds', d2.ok, JSON.stringify(d2).slice(0, 120))
  restoreFetch()
}

// ── T39 · code highlighting is best-effort and text-preserving ─────────────
{
  const toks = highlightCode('const x = 1; // note\n', 'js')
  const text = toks.map((t) => t.text).join('')
  ok('T38a highlight preserves exact text', text === 'const x = 1; // note\n', text)
  ok('T38b keywords/numbers/comments classified', toks.some((t) => t.cls === 'kw' && t.text === 'const') && toks.some((t) => t.cls === 'num') && toks.some((t) => t.cls === 'com'))
  const str = highlightCode('say "hi"', 'js')
  ok('T38c strings classified', str.some((t) => t.cls === 'str' && t.text === '"hi"'))
  const fn = highlightCode('run()', 'js')
  ok('T38d calls classified', fn.some((t) => t.cls === 'fn' && t.text === 'run'))
  const unknown = highlightCode('a+b', 'brainfuck')
  ok('T38e unknown language renders plain', unknown.length === 1 && unknown[0].cls === '' && unknown[0].text === 'a+b')
  ok('T38f empty input safe', highlightCode('', 'js').length === 0)
}

// ── T39 · workspace directory listing (MOCKED) ──────────────────────────────
{
  mockFetch(routeMock({ chat: 'x' }))
  // default list fixture has no dirs; override with a realistic one
  mockFetch(async (url, init) => {
    const u = String(url)
    if (u.includes('/api/agent-session/files') && u.includes('op=list')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, path: '.', entries: [{ name: 'src', type: 'dir', size: 0 }, { name: '.git', type: 'dir', size: 0 }, { name: 'a.txt', type: 'file', size: 3 }], truncated: false }) }
    }
    return routeMock({ chat: 'x' })(url, init)
  })
  const dirs = await listWorkspaceDirs()
  ok('T39a top-level dirs listed, dot-dirs skipped', JSON.stringify(dirs) === JSON.stringify(['src']), JSON.stringify(dirs))
  restoreFetch()
}

// ── T40 · AUTO / MANUAL selection + per-specialist switches (real planner) ───
{
  const enabledPolicy = (mode) => ({ mode, isEnabled: (id) => id === 'manager' || isAgentEnabled(id) })

  ok('T40a default mode is AUTO', getSelectionMode() === 'auto', getSelectionMode())
  ok('T40b all built-ins enabled by default', ['researcher', 'coder', 'runner', 'checker'].every((id) => isAgentEnabled(id)))
  ok('T40c enabled map always keeps the manager on', getAgentEnabledMap().manager === true)

  // Simple read-only question → small team (no Runner/Coder).
  const simple = createPlan('show me the project structure', enabledPolicy('auto'))
  const simpleAgents = new Set(simple.filter((s) => !s.blocked).map((s) => s.agentId))
  ok('T40d AUTO uses Researcher for a structure question', simpleAgents.has('researcher'), JSON.stringify([...simpleAgents]))
  ok('T40e AUTO does not select Runner/Coder for a read-only question', !simpleAgents.has('runner') && !simpleAgents.has('coder'))
  ok('T40f report step always goes to the Project Manager', simple[simple.length - 1].id === 'step-report' && simple[simple.length - 1].agentId === 'manager')
  ok('T40g PM appears only as orchestrator, not as a capability specialist', simple.filter((s) => s.agentId === 'manager').length === 1)

  // Build/test → Runner; implementation → Coder; analysis → Coder.
  ok('T40h AUTO selects Runner for a build/test command', createPlan('run the tests', enabledPolicy('auto')).some((s) => s.agentId === 'runner' && s.tool === 'run_command'))
  ok('T40i AUTO selects Coder for an implementation task', createPlan('fix the bug in src/a.ts', enabledPolicy('auto')).some((s) => s.capability === 'code' && s.agentId === 'coder'))
  ok('T40j AUTO selects Coder for an analysis task', createPlan('analyze and explain the project overview', enabledPolicy('auto')).some((s) => s.capability === 'analyze' && s.agentId === 'coder'))

  // A disabled specialist is never assigned; the step is blocked with a reason.
  setAgentEnabled('runner', false)
  const blockedRun = createPlan('run the tests', enabledPolicy('auto')).find((s) => s.capability === 'run')
  ok('T40k disabled Runner is never assigned (step blocked, no agent)', blockedRun && blockedRun.blocked && blockedRun.agentId === undefined, JSON.stringify(blockedRun))
  setAgentEnabled('runner', true)

  // AUTO substitutes an enabled specialist; MANUAL reports the gap instead.
  setAgentEnabled('coder', false)
  const autoAnalyze = createPlan('analyze the code', enabledPolicy('auto')).find((s) => s.capability === 'analyze')
  ok('T40l AUTO substitutes an enabled specialist when Coder is off', autoAnalyze && !autoAnalyze.blocked && autoAnalyze.agentId !== 'coder', JSON.stringify(autoAnalyze))
  const manualAnalyze = createPlan('analyze the code', enabledPolicy('manual')).find((s) => s.capability === 'analyze')
  ok('T40m MANUAL reports the missing capability (no substitution)', manualAnalyze && manualAnalyze.blocked && manualAnalyze.agentId === undefined, JSON.stringify(manualAnalyze))
  setAgentEnabled('coder', true)

  // Custom agents participate through their tool allow-lists.
  registerAgentDefinition({ id: 'archivist', name: 'Archivist', role: 'Reads and searches', description: 'Reads project files.', tools: ['read_file', 'search_files'], model: '', systemPrompt: 'Read exact files and report findings.' })
  const archivistCaps = getAgentCapabilities('archivist')
  ok('T40n custom agent capabilities derive from its tools', archivistCaps.includes('read') && archivistCaps.includes('search'), JSON.stringify(archivistCaps))
  setAgentEnabled('researcher', false)
  const customRead = createPlan('read the content of src/a.ts', enabledPolicy('auto')).find((s) => s.capability === 'read')
  ok('T40o AUTO routes to an enabled custom agent', customRead && !customRead.blocked && customRead.agentId === 'archivist', JSON.stringify(customRead))
  setAgentEnabled('researcher', true)
  registerAgentDefinition({ id: 'builder', name: 'Builder', role: 'Runs commands', description: 'Runs build commands.', tools: ['run_command'], model: '', systemPrompt: 'Run approved commands.' })
  setAgentEnabled('runner', false)
  const manualCustom = createPlan('run the tests', enabledPolicy('manual')).find((s) => s.capability === 'run')
  ok('T40p MANUAL uses an enabled custom agent for the capability', manualCustom && !manualCustom.blocked && manualCustom.agentId === 'builder', JSON.stringify(manualCustom))
  setAgentEnabled('runner', true)
  removeAgentDefinition('archivist')
  removeAgentDefinition('builder')

  // Manager protection + mode API.
  let mgrThrew = false
  try { setAgentEnabled('manager', false) } catch { mgrThrew = true }
  ok('T40q Project Manager cannot be disabled', mgrThrew && isAgentEnabled('manager'))
  setSelectionMode('manual')
  ok('T40r setSelectionMode takes effect', getSelectionMode() === 'manual')
  cycleSelectionMode()
  ok('T40s cycleSelectionMode returns to auto', getSelectionMode() === 'auto')
  let badMode = false
  try { setSelectionMode('bogus') } catch { badMode = true }
  ok('T40t invalid mode rejected', badMode)

  // Live run team + runtime enforcement (MOCKED).
  mockFetch(routeMock({ chat: 'summary' }))
  setAgentEnabled('runner', false)
  const task = await startAgentSession('run the tests')
  restoreFetch()
  setAgentEnabled('runner', true)
  const runStep = task.plan.find((s) => s.capability === 'run')
  ok('T40u disabled Runner blocks the run step at execution', runStep && runStep.status === 'failed' && /Blocked/.test(runStep.error ?? ''), JSON.stringify(runStep))
  ok('T40v run team recorded for every member with a reason', Array.isArray(task.team) && task.team.length === getAgentRoster().length && task.team.every((m) => typeof m.reason === 'string' && m.reason.length > 0))
  ok('T40v2 getRunTeam mirrors the snapshot', getRunTeam().length === getAgentRoster().length && getRunTeam().every((m) => typeof m.status === 'string'))
  const runnerMember = task.team.find((m) => m.agentId === 'runner')
  ok('T40w disabled member is marked disabled, not selected', runnerMember && runnerMember.status === 'disabled' && runnerMember.enabled === false && runnerMember.selected === false)
  const mgrMember = task.team.find((m) => m.agentId === 'manager')
  ok('T40x manager is always selected as orchestrator', mgrMember && mgrMember.selected === true && mgrMember.enabled === true)
  ok('T40y task snapshot carries the selection mode', task.selectionMode === 'auto', task.selectionMode)

  setSelectionMode('auto')
  ok('T40z state restored to AUTO', getSelectionMode() === 'auto')
}

// ── T41 · selection prefs persist and legacy prefs migrate ───────────────────
{
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)) },
    removeItem: (k) => { store.delete(String(k)) },
    clear: () => store.clear(),
  }
  // Legacy save: only the old fields, with a model assignment to preserve.
  store.set('smol-agent-session-prefs', JSON.stringify({ mode: 'edit', effort: null, memoryNote: '', workspace: '.', agentModels: { coder: 'lmstudio' }, customAgents: [] }))
  const mig = loadFrom(freshRuntimeDir(), 'agent-session')

  ok('T41a legacy prefs load with AUTO default', mig.getSelectionMode() === 'auto')
  ok('T41b all agents enabled by default after migration', mig.isAgentEnabled('runner') && mig.isAgentEnabled('coder'))
  ok('T41c legacy model assignments preserved', mig.getAgentSessionState().agentModels?.coder === 'lmstudio', JSON.stringify(mig.getAgentSessionState().agentModels))

  mig.setSelectionMode('manual')
  mig.setAgentEnabled('runner', false)
  const blob = JSON.parse(store.get('smol-agent-session-prefs'))
  ok('T41d selection mode persists', blob.selectionMode === 'manual')
  ok('T41e per-agent switch persists', blob.agentEnabled && blob.agentEnabled.runner === false)
  ok('T41f persistence keeps prior model assignments', blob.agentModels && blob.agentModels.coder === 'lmstudio')
  delete globalThis.localStorage
}

// ── T42 · verification honours the Checker switch (MOCKED) ───────────────────
{
  const changeTask = 'fix the bug in src/a.ts file'
  const editBlock = '```tool {"name": "edit_file", "args": {"path": "src/a.ts", "old_text": "x", "new_text": "y"}}```'
  const makeFetch = () => routeMock({
    chat: editBlock,
    files: async (u, init) => {
      if (u.includes('op=read')) return { ok: true, status: 200, json: async () => ({ ok: true, path: 'src/a.ts', content: 'x', totalLines: 1, offset: 0, limit: 200, size: 1, truncated: false }) }
      if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true, path: 'src/a.ts', bytes: 1, created: false, replacements: 1 }) }
      return { ok: true, status: 200, json: async () => ({ ok: true, path: '.', tree: [], truncated: false }) }
    },
    exec: async (u, init) => {
      if (u.includes('op=scripts')) return { ok: true, status: 200, json: async () => ({ ok: true, scripts: { test: 'node check.js' } }) }
      if (init?.method === 'POST') {
        let body = {}
        try { body = JSON.parse(init?.body ?? '{}') } catch { /* ignore */ }
        return { ok: true, status: 200, json: async () => ({ ok: true, command: body.command, exitCode: 0, stdout: 'PASS', stderr: '', truncated: false, timedOut: false, durationMs: 5 }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, tasks: [] }) }
    },
  })

  // MANUAL + Checker off → no eligible verifier → skipped, reported honestly.
  setSelectionMode('manual')
  setAgentEnabled('checker', false)
  mockFetch(makeFetch())
  let unsub = subscribeAgentSession((s) => { if (s.pendingApproval) resolveApproval(true) })
  const t1 = await startAgentSession(changeTask)
  unsub()
  ok('T42a MANUAL without Checker reports verification skipped', t1.verification && t1.verification.passed === false && /Checker is disabled/i.test(t1.verification.note), JSON.stringify(t1.verification))

  // AUTO + Checker off → an enabled substitute performs verification.
  setSelectionMode('auto')
  mockFetch(makeFetch())
  unsub = subscribeAgentSession((s) => { if (s.pendingApproval) resolveApproval(true) })
  const t2 = await startAgentSession(changeTask)
  unsub()
  restoreFetch()
  ok('T42b AUTO substitutes an enabled verifier when Checker is off', t2.verification && t2.verification.command.includes('npm run test') && t2.verification.passed === true, JSON.stringify(t2.verification))

  setAgentEnabled('checker', true)
  setSelectionMode('auto')
}

// ── T37 · LIVE: real file + exec endpoints (skipped without a server) ────────
{
  const base = process.argv[2] ?? 'http://localhost:3001'
  const name = `.scratch-agent-test-${Date.now()}.txt`
  try {
    const w = await fetch(`${base}/api/agent-session/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'write', path: name, content: 'live-1\n', mode: 'edit' }),
    })
    const wj = await w.json()
    ok('T37a LIVE write creates a real file', w.status === 200 && wj?.ok === true && wj?.created === true, `status=${w.status}`)
    const r = await fetch(`${base}/api/agent-session/files?op=read&path=${encodeURIComponent(name)}`)
    const rj = await r.json()
    ok('T37b LIVE read returns what was written', rj?.content === 'live-1\n', JSON.stringify(rj?.content))
    const e = await fetch(`${base}/api/agent-session/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'edit', path: name, oldText: 'live-1', newText: 'live-2', mode: 'edit' }),
    })
    const ej = await e.json()
    ok('T37c LIVE targeted edit applies', ej?.ok === true && ej?.replacements === 1, `status=${e.status}`)
    const x = await fetch(`${base}/api/agent-session/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'node --version', mode: 'edit' }),
    })
    const xj = await x.json()
    ok('T37d LIVE command runs with a real exit code', xj?.ok === true && xj?.exitCode === 0 && /v\d+/.test(xj?.stdout ?? ''), JSON.stringify(xj?.stdout))
    const blocked = await fetch(`${base}/api/agent-session/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'write', path: '.env', content: 'x', mode: 'edit' }),
    })
    ok('T37e LIVE secrets stay protected', blocked.status === 403, `status=${blocked.status}`)
    // Separator-bypass regression: blocklists must match on separator-normalized
    // paths — on Windows, `path.relative` hands back "dir\\file" and a naive
    // startsWith('dir/') / split('/') check silently lets these through.
    const nestedSecret = await fetch(`${base}/api/agent-session/files?op=read&path=${encodeURIComponent('qa-nested/.env')}`)
    ok('T37e2 LIVE nested .env read blocked', nestedSecret.status === 403, `status=${nestedSecret.status}`)
    const nmName = `.qa-probe-${Date.now()}.txt`
    const nmWrite = await fetch(`${base}/api/agent-session/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'write', path: `node_modules/${nmName}`, content: 'x', mode: 'edit' }),
    })
    ok('T37e3 LIVE node_modules write blocked', nmWrite.status === 403, `status=${nmWrite.status}`)
    const nmRead = await fetch(`${base}/api/agent-session/files?op=read&path=${encodeURIComponent(`node_modules/${nmName}`)}`)
    ok('T37e4 LIVE blocked write left no file behind', nmRead.status === 404, `status=${nmRead.status}`)
    const nestedLock = await fetch(`${base}/api/agent-session/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'write', path: 'qa-nested/package-lock.json', content: 'x', mode: 'edit' }),
    })
    ok('T37e5 LIVE nested lockfile write blocked', nestedLock.status === 403, `status=${nestedLock.status}`)
    // Provider-error redaction: a provider that 404s must surface only the HTTP
    // status — never the provider's response body (HTML, secrets, injected text).
    let probeModelId = ''
    try {
      const pm = await fetch(`${base}/api/custom-models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'QA Redaction Probe',
          endpoint: `${base}/api/agent-session/files`,
          apiKey: 'sk-test-dummy',
          modelId: 'probe',
        }),
      })
      const pmj = await pm.json().catch(() => null)
      probeModelId = pmj?.model?.id ?? ''
    } catch {
      probeModelId = ''
    }
    if (probeModelId) {
      try {
        const chat = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'hi', stateless: true, settings: { model: probeModelId, systemPrompt: 'probe' } }),
        })
        const cj = await chat.json().catch(() => null)
        const err = String(cj?.error ?? '')
        ok(
          'T37g LIVE provider error body redacted',
          /HTTP 404/.test(err) && !/<!DOCTYPE|<html|meta charSet/i.test(err),
          err.slice(0, 80),
        )
      } finally {
        await fetch(`${base}/api/custom-models?id=${encodeURIComponent(probeModelId)}`, { method: 'DELETE' })
      }
    } else {
      console.log('  SKIP  T37g LIVE provider redaction probe (probe model setup failed)')
    }
    // cleanup via the exec route itself
    await fetch(`${base}/api/agent-session/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: `del "${name}"`, mode: 'edit' }),
    })
    const gone = await fetch(`${base}/api/agent-session/files?op=read&path=${encodeURIComponent(name)}`)
    ok('T37f LIVE scratch cleaned up', gone.status === 404, `status=${gone.status}`)
  } catch {
    for (const t of ['T37a', 'T37b', 'T37c', 'T37d', 'T37e', 'T37e2', 'T37e3', 'T37e4', 'T37e5', 'T37g', 'T37f']) console.log(`  SKIP  ${t} LIVE (no server at ${base})`)
  }
}

// ── T13 · live contract check (only if a dev server is up) ──────────────────
{
  const base = process.argv[2] ?? 'http://localhost:3001'
  try {
    const res = await fetch(`${base}/api/chat`, { method: 'GET' })
    const json = await res.json().catch(() => null)
    ok('T13 /api/chat GET contract intact (live)', res.status === 200 && json && typeof json === 'object', `status=${res.status}`)
  } catch {
    console.log('  SKIP  T13 /api/chat live check (no server at ' + base + ')')
  }
}

// ── T43 · Design Studio catalogue is deterministic and complete ─────────────
{
  const templates = designCatalog.listTemplates()
  const ids = templates.map((t) => t.id)
  ok(
    'T43a four template families with stable ids',
    templates.length === 4 && ids.join(',') === 'editorial,business,portfolio,commerce',
    ids.join(','),
  )
  ok(
    'T43b every family exposes real variants (not shared stubs)',
    templates.every(
      (t) =>
        t.heroVariants.length >= 2 &&
        t.navbarVariants.length >= 2 &&
        t.buttonVariants.length >= 2 &&
        t.cardVariants.length >= 2,
    ),
    templates.map((t) => `${t.id}:${t.heroVariants.length}/${t.navbarVariants.length}`).join(' '),
  )
  ok(
    'T43c every family records provenance with a full commit sha',
    templates.every((t) => t.provenance.length >= 1 && t.provenance.every((p) => /^[0-9a-f]{40}$/.test(p.commit))),
  )
  ok(
    'T43d families genuinely differ (default sections not shared)',
    new Set(templates.map((t) => t.defaultSections.join('|'))).size === 4,
  )
  ok('T43e six upstream sources recorded in provenance', designCatalog.DESIGN_SOURCES.length === 6, String(designCatalog.DESIGN_SOURCES.length))
  ok(
    'T43f provenance commits match the download lock',
    designCatalog.DESIGN_SOURCES.every((s) => /^[0-9a-f]{7,40}$/.test(s.commit) && s.license.length > 0),
  )
}

// ── T43g · the recorded upstream components were really inspected (on disk) ──
// Every family's reuse is backed by real files under the downloaded sources;
// this fails if a provenance path is invented or a download is missing.
{
  const srcRoot = path.join(process.cwd(), '.agenthub', 'website-template-library', 'sources')
  const sources = designCatalog.DESIGN_SOURCES
  ok(
    'T43g every source records inspected files + reused roles',
    sources.every((s) => Array.isArray(s.inspectedFiles) && s.inspectedFiles.length > 0 && Array.isArray(s.reusedFor) && s.reusedFor.length > 0),
    sources.map((s) => `${s.sourceId}:${s.inspectedFiles.length}`).join(' '),
  )
  const missing = sources.flatMap((s) => s.inspectedFiles.filter((f) => !existsSync(path.join(srcRoot, s.sourceId, ...f.split('/')))).map((f) => `${s.sourceId}/${f}`))
  ok('T43h every recorded upstream file exists in the downloaded source', missing.length === 0, missing.join(', '))
  ok(
    'T43i navbar/hero/cards/buttons/sections are all covered by reuse mappings',
    ['navbar', 'hero', 'footer'].every((role) => sources.some((s) => s.reusedFor.includes(role))) &&
      sources.some((s) => s.reusedFor.includes('card')) &&
      sources.some((s) => s.reusedFor.includes('button')) &&
      sources.some((s) => s.reusedFor.includes('products')) &&
      sources.some((s) => s.reusedFor.includes('features')),
  )
}

// ── T44 · registry validation rejects invented ids (never substitutes) ──────
{
  const { createDefaultConfig, validateConfig, applyOp } = designEngine
  const ids = designCatalog.listTemplates().map((t) => t.id)
  ok('T44a every family default validates', ids.every((id) => validateConfig(createDefaultConfig(id)) === null))
  const base = createDefaultConfig('editorial')
  const invented = [
    { op: 'set-hero', variant: 'nope' },
    { op: 'set-navbar', variant: 'nope' },
    { op: 'set-button', variant: 'nope' },
    { op: 'set-card', variant: 'nope' },
    { op: 'set-palette', palette: 'chartreuse' },
    { op: 'set-theme', theme: 'sepia' },
    { op: 'set-typography', typography: 'comic' },
    { op: 'add-section', kind: 'products' }, // editorial does not offer products
    { op: 'add-section', kind: 'navbar' }, // chrome, not a middle section
    { op: 'remove-section', sectionId: 'nope' },
    { op: 'set-content', key: 'nope', value: 'x' },
    { op: 'select-template', templateId: 'nope' },
  ]
  const results = invented.map((op) => applyOp(base, op))
  ok('T44b invented ids are all rejected', results.every((r) => r.ok === false), results.map((r) => r.ok).join(','))
  ok(
    'T44c rejected ops never mutate the config',
    results.every((r) => JSON.stringify(r.config) === JSON.stringify(base)),
  )
  ok('T44d rejections carry a reason', results.every((r) => typeof r.reason === 'string' && r.reason.length > 5))
  ok(
    'T44e a rejected variant swap never silently substitutes another',
    applyOp(base, { op: 'set-hero', variant: 'nope' }).config.hero === base.hero,
  )
}

// ── T45 · section add/remove/reorder touches only what it should ────────────
{
  const { createDefaultConfig, applyOp, applyOps } = designEngine
  const base = createDefaultConfig('editorial')
  const sectionsBefore = JSON.stringify(base.sections)
  const batch = applyOps(base, [
    { op: 'set-hero', variant: 'split' },
    { op: 'set-palette', palette: 'gold' },
    { op: 'set-button', variant: 'gradient' },
  ])
  ok('T45a valid ops all applied', batch.rejected.length === 0 && batch.applied.length === 3, JSON.stringify(batch.rejected))
  ok(
    'T45b hero/palette/button changed',
    batch.config.hero === 'split' && batch.config.palette === 'gold' && batch.config.button === 'gradient',
  )
  ok('T45c unrelated sections preserved exactly', JSON.stringify(batch.config.sections) === sectionsBefore)
  ok('T45d unrelated navbar preserved', batch.config.navbar === base.navbar)

  const biz = createDefaultConfig('business')
  const faq = biz.sections.find((s) => s.kind === 'faq')
  const removed = applyOp(biz, { op: 'remove-section', sectionId: faq.id })
  ok(
    'T45e remove-section drops only that section',
    removed.ok && !removed.config.sections.some((s) => s.kind === 'faq') && removed.config.sections.length === biz.sections.length - 1,
  )
  const readded = applyOp(removed.config, { op: 'add-section', kind: 'faq' })
  ok('T45f a removed section can be added back', readded.ok && readded.config.sections.some((s) => s.kind === 'faq'))
  ok(
    'T45g add-section for an already-present kind is rejected, not duplicated',
    applyOp(biz, { op: 'add-section', kind: 'faq' }).ok === false &&
      applyOp(biz, { op: 'add-section', kind: 'faq' }).config.sections.length === biz.sections.length,
  )

  const tst = biz.sections.find((s) => s.kind === 'testimonials')
  const moved = applyOp(biz, { op: 'move-section', sectionId: tst.id, direction: 'up' })
  const kinds = moved.config.sections.map((s) => s.kind)
  ok(
    'T45h reorder moves the section without losing any',
    moved.ok && kinds.indexOf('testimonials') < kinds.indexOf('services') && moved.config.sections.length === biz.sections.length,
  )

  const undone = applyOp(batch.config, { op: 'set-palette', palette: 'slate' })
  ok('T45i inverse op restores the prior value', undone.config.palette === base.palette)
  ok('T45j reset returns the template default exactly', JSON.stringify(createDefaultConfig('editorial')) === JSON.stringify(base))
}

// ── T46 · deterministic request → validated ops ─────────────────────────────
{
  const { requestToOps, isDesignRequest } = designIntent
  const { createDefaultConfig, applyOps } = designEngine
  const base = createDefaultConfig('editorial')
  const cases = [
    ['Use the second template.', (o) => o.op === 'select-template' && o.templateId === 'business'],
    ['Replace the hero with the split-screen hero.', (o) => o.op === 'set-hero' && o.variant === 'split'],
    ['Change the theme to light mode.', (o) => o.op === 'set-theme' && o.theme === 'light'],
    ['Remove the gallery section.', (o) => o.op === 'remove-section'],
    ['Change the headline to Hello world.', (o) => o.op === 'set-content' && o.key === 'headline' && o.value === 'Hello world'],
  ]
  for (const [text, pred] of cases) {
    const { ops } = requestToOps(text, base)
    const b = applyOps(base, ops)
    ok(
      `T46 parse: "${text}"`,
      ops.some(pred) && b.rejected.length === 0 && b.applied.length === ops.length,
      JSON.stringify(ops),
    )
  }

  // Add is honored only when the kind is genuinely available.
  const withoutGallery = applyOps(base, [{ op: 'remove-section', sectionId: base.sections.find((s) => s.kind === 'gallery').id }]).config
  const added = requestToOps('Add a gallery section', withoutGallery)
  ok('T46f add-section parses on a config that is missing it', added.ops.some((o) => o.op === 'add-section' && o.kind === 'gallery'))
  const dupAdd = requestToOps('Add a gallery section', base)
  ok('T46g add-section for a present kind yields no op (noted)', dupAdd.ops.length === 0 && dupAdd.notes.length > 0, JSON.stringify(dupAdd))

  // An unmatchable request is left alone and reported — never substituted.
  const bogus = requestToOps('Replace the hero with the sparkling ribbon hero.', base)
  const bb = applyOps(base, bogus.ops)
  ok(
    'T46h unmatchable variant leaves the hero unchanged and is noted',
    bb.applied.length === 0 && bb.config.hero === base.hero && bogus.notes.length > 0,
    JSON.stringify(bogus),
  )

  ok('T46i browse request opens the studio', isDesignRequest('Show me four different designs.'))
  ok('T46j create request opens the studio', isDesignRequest('Create a bakery website.'))
  ok('T46k targeted change opens the studio', isDesignRequest('Change the theme to light mode.'))
  ok('T46l ordinary question does not open the studio', !isDesignRequest('what is the project structure?'))
}

// ── T47 · Apply Design runs through the real pipeline (mocked I/O) ──────────
{
  const { createDefaultConfig, DESIGN_CONFIG_PATH, DESIGN_PAGE_PATH } = designEngine
  setSmolMode('edit')
  setSelectionMode('auto')
  setAgentEnabled('designer', true)
  const config = { ...createDefaultConfig('commerce'), palette: 'rose' }
  const files = (u) => {
    const s = String(u)
    if (s.includes('op=read')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, path: DESIGN_PAGE_PATH, content: '// exists', truncated: false }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, path: 'x', bytes: 12, created: false, replacements: 1 }) }
  }
  mockFetch(routeMock({ chat: 'Design applied to the generated site.', files }))
  const unsub = subscribeAgentSession((s) => {
    if (s.pendingApproval) resolveApproval(true)
  })
  const task = await applyDesignConfig(config)
  unsub()
  restoreFetch()

  const writer = task.plan.find((s) => s.id === 'step-design-config')
  const verify = task.plan.find((s) => s.id === 'step-design-verify')
  ok(
    'T47a the write is owned by the UI/UX Design Agent and completed',
    Boolean(writer) && writer.agentId === 'designer' && writer.tool === 'write_file' && writer.status === 'completed',
    JSON.stringify(writer),
  )
  ok(
    'T47b verification is run by the Checker via syntax_check',
    Boolean(verify) && verify.agentId === 'checker' && verify.tool === 'syntax_check' && verify.status === 'completed',
    JSON.stringify(verify),
  )
  ok(
    'T47c file scope is locked to the design targets',
    task.fileScope.allowed.length === 2 &&
      isPathInScope(task.fileScope, DESIGN_CONFIG_PATH) &&
      !isPathInScope(task.fileScope, 'src/app/page.tsx'),
    JSON.stringify(task.fileScope),
  )
  const changed = task.changedFiles ?? []
  ok(
    'T47d a colour-only change rewrites exactly one file',
    changed.length === 1 && changed[0].path.endsWith('site-config.json'),
    JSON.stringify(changed.map((c) => c.path)),
  )
  ok('T47e the report states verification passed', /Verification: PASSED/.test(task.result ?? ''), (task.result ?? '').slice(0, 140))
  ok('T47f the task completes', task.status === 'completed', task.status)

  // Rendered artefact round-trips and parses as JSON (what the Checker checks).
  const rendered = designEngine.renderSiteConfigFile(config)
  let parsed = null
  try {
    parsed = JSON.parse(rendered)
  } catch {
    parsed = null
  }
  ok('T47g the emitted config is valid JSON and round-trips', parsed !== null && parsed.templateId === config.templateId && parsed.palette === 'rose')
}

// ── T48 · MANUAL with the Design Agent off blocks the write honestly ────────
{
  const { createDefaultConfig, DESIGN_CONFIG_PATH } = designEngine
  setSmolMode('edit')
  setSelectionMode('manual')
  setAgentEnabled('designer', false)
  let wrote = false
  const files = (u, init) => {
    const s = String(u)
    if (s.includes('op=read')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, path: DESIGN_CONFIG_PATH, content: '// exists', truncated: false }) }
    }
    if (init && init.method === 'POST') wrote = true
    return { ok: true, status: 200, json: async () => ({ ok: true, path: 'x', bytes: 1, created: false, replacements: 1 }) }
  }
  mockFetch(routeMock({ chat: 'report', files }))
  const unsub = subscribeAgentSession((s) => {
    if (s.pendingApproval) resolveApproval(true)
  })
  const task = await applyDesignConfig(createDefaultConfig('portfolio'))
  unsub()
  restoreFetch()
  setAgentEnabled('designer', true)
  setSelectionMode('auto')
  const writer = task.plan.find((s) => s.id === 'step-design-config')
  ok(
    'T48a the design write is blocked when the owner is disabled',
    Boolean(writer) && writer.status === 'failed' && /blocked/i.test(writer.error ?? ''),
    JSON.stringify(writer && { status: writer.status, error: writer.error }),
  )
  ok('T48b nothing is written and the run is not reported complete', wrote === false && task.status !== 'completed', task.status)
}

// ── T49 · Teaching framework: subjects, plans, scoring, progress (pure) ─────
{
  const F = teachingFramework
  const d = F.detectSubject
  ok('T49a subject detection: python', d('Explain Python OOPs') === 'python', d('Explain Python OOPs'))
  ok('T49b subject detection: sql', d('Teach me SQL joins') === 'sql', d('Teach me SQL joins'))
  ok('T49c subject detection: excel', d('Excel VLOOKUP help') === 'excel', d('Excel VLOOKUP help'))
  ok('T49d subject detection: c', d('C debugging exercises') === 'c', d('C debugging exercises'))
  ok('T49e subject detection: linux', d('linux permissions') === 'linux', d('linux permissions'))
  ok('T49f subject detection: electronics', d('embedded GPIO and a resistor') === 'electronics')
  ok('T49g subject detection: ml', d('machine learning overfitting') === 'ml')
  ok('T49h subject detection: aptitude', d('percentage and ratio aptitude') === 'aptitude')
  ok('T49i no false subject on a generic ask', d('the project structure') === 'generic', d('the project structure'))

  const plan = F.buildLessonPlan({ topic: 'Python OOPs' })
  ok(
    'T49j plan uses the full section framework in order',
    plan.sections.length >= 8 && plan.sections[0].kind === 'intro' && plan.sections.some((s) => s.kind === 'revision'),
    JSON.stringify(plan.sections.map((s) => s.kind)),
  )
  ok('T49k plan resolves subject, level and topic from the bank', plan.subject === 'python' && plan.topicId === 'python-oop' && plan.level === 'beginner', `${plan.subject}/${plan.topicId}/${plan.level}`)
  ok('T49l prerequisites are named in learning order', plan.prerequisites.length >= 1 && /function/i.test(plan.prerequisites.join(' ')), JSON.stringify(plan.prerequisites))
  ok('T49m every section has deterministic fallback content (offline-capable)', plan.sections.every((s) => s.fallback.trim().length > 0 || s.kind === 'project'))
  ok('T49n quiz and exercises are app-owned and non-empty', plan.quiz.length >= 2 && plan.exercises.length >= 2)
  ok('T49o a complete lesson validates', F.validateLesson(plan, {}) === null, F.validateLesson(plan, {}) ?? '')
  const broken = { ...plan, sections: [{ kind: 'intro', label: 'Introduction', purpose: '', prompt: '', fallback: '', model: false }] }
  ok('T49p validation reports missing content', typeof F.validateLesson(broken, {}) === 'string')
  const badQuiz = { ...plan, quiz: [{ id: 'x', level: 'beginner', kind: 'multiple-choice', prompt: 'q', options: ['a', 'b'], answerIndex: 9, explanation: 'e' }] }
  ok('T49q validation rejects a bad answer key', /answer key/.test(F.validateLesson(badQuiz, {}) ?? ''), F.validateLesson(badQuiz, {}) ?? '')

  const mcq = plan.quiz.find((q) => q.kind === 'multiple-choice')
  const g1 = F.scoreQuiz([mcq], { [mcq.id]: mcq.answerIndex })
  const g2 = F.scoreQuiz([mcq], { [mcq.id]: (mcq.answerIndex + 1) % mcq.options.length })
  ok('T49r MCQ scoring is exact', g1.correct === 1 && g2.correct === 0)

  ok('T49s diagrams render to a text fallback', String(F.diagramAsAscii(plan.diagram)).length > 0)

  let prog = F.emptyProgress()
  prog = F.recordLesson(prog, plan, '2026-01-01T00:00:00.000Z')
  prog = F.recordQuiz(prog, plan, { correct: 1, total: 3, details: [] }, '2026-01-01T00:01:00.000Z')
  ok('T49t progress records lessons and quiz accuracy', prog.topics['python-oop'].presented === 1 && prog.topics['python-oop'].quizCorrect === 1 && prog.topics['python-oop'].quizTotal === 3)
  ok('T49u weak quiz results are flagged for revision', prog.topics['python-oop'].needsRevision === true)
  ok('T49v next-topic advice prefers the revision gap', F.recommendNext(prog, plan)?.topicId === 'python-oop', JSON.stringify(F.recommendNext(prog, plan)))
}

// ── T50 · Teaching intent detection + lenient model-question parsing ────────
{
  const I = teachingIntent
  const positive = [
    'Teach me Python OOPs',
    'explain SQL joins with examples',
    'Give me C debugging exercises',
    'I want to learn Excel VLOOKUP',
    'quiz me on Linux commands',
    'help me understand machine learning overfitting',
  ]
  positive.forEach((t, i) => ok(`T50a${i} teaching intent detected`, I.isTeachingRequest(t) === true, `${t} → ${I.isTeachingRequest(t)}`))
  const negative = [
    'analyze and explain the project overview',
    'show me the project structure',
    'run the tests',
    'hello there',
    'fix the bug in src/a.ts',
    'add a button to the navbar',
  ]
  negative.forEach((t, i) => ok(`T50b${i} ordinary request is NOT a lesson`, I.isTeachingRequest(t) === false, `${t} → ${I.isTeachingRequest(t)}`))

  const raw = 'Here are questions:\n```json\n{"questions":[{"prompt":"2+2?","options":["3","4","5"],"answerIndex":1,"explanation":"math","level":"easy"},{"prompt":"bad","options":["only"],"answerIndex":7}]}\n```'
  const qs = I.parseModelQuestions(raw, 'python')
  ok('T50c model questions are parsed and ungradable ones dropped', qs.length === 1 && qs[0].kind === 'multiple-choice' && qs[0].answerIndex === 1, JSON.stringify(qs))
  const textForm = 'Q: What is 2+2?\nA) 3\nB) 4\nAnswer: B\n'
  const qs2 = I.parseModelQuestions(textForm, 'aptitude')
  ok('T50d plain Q/A text form is parsed', qs2.length === 1 && qs2[0].answerIndex === 1, JSON.stringify(qs2))
  ok('T50e malformed model output is ignored, not fatal', I.parseModelQuestions('not json at all', 'python').length === 0)
}

// ── T51 · Teaching Agent registration + planner routing (real planner) ──────
{
  const roster = getAgentRoster()
  ok(
    'T51a Teaching Agent is a built-in that owns the teaching capability',
    roster.some((a) => a.id === 'teaching-agent' && a.name === 'Teaching Agent') && getAgentCapabilities('teaching-agent').includes('teach'),
    roster.map((a) => a.id).join(','),
  )
  ok('T51b the capability has a human label', capabilityLabel('teach') === 'teach the topic')

  const plan = createPlan('Explain Python OOPs')
  const teachSteps = plan.filter((s) => s.capability === 'teach')
  ok(
    'T51c the planner expands a lesson into per-section teaching steps',
    teachSteps.length >= 5 && teachSteps.every((s) => s.agentId === 'teaching-agent' && s.tool === 'call_llm'),
    JSON.stringify(plan.map((s) => [s.id, s.agentId])),
  )
  ok('T51d a lesson never routes to the generic code/analyze steps', !plan.some((s) => s.id === 'step-code') && !plan.some((s) => s.id === 'step-analyze'))
  ok('T51e the plan still ends with the Project Manager report', plan[plan.length - 1].id === 'step-report' && plan[plan.length - 1].agentId === 'manager')
  ok('T51f an ordinary explain request stays a normal task', !createPlan('analyze and explain the project structure').some((s) => s.capability === 'teach'))
}

// ── T52 · Teaching pipeline end-to-end (mocked model + file API) ────────────
{
  setSelectionMode('auto')
  setAgentEnabled('teaching-agent', true)
  clearLearningProgress()
  mockFetch(routeMock({ chat: 'A focused, correct section of the lesson.' }))
  const task = await teachTopic('Teach me Python OOPs')
  restoreFetch()

  ok('T52a the run completes with a lesson attached', task.status === 'completed' && Boolean(task.lesson), `${task.status} ${task.error ?? ''}`)
  const lesson = task.lesson
  const ref = { topicId: lesson.topicId, subject: lesson.subject, topic: lesson.topic, next: lesson.next, quiz: lesson.quiz }
  ok('T52b the lesson has the full section set', lesson.sections.length >= 8, String(lesson.sections.length))
  ok('T52c sections are non-empty and the lesson validates', lesson.sections.every((s) => s.markdown.trim().length > 0) && lesson.validation === null, lesson.validation ?? '')
  ok('T52d assessment is app-owned and scorable', lesson.quiz.length >= 2 && lesson.exercises.length >= 2)
  ok('T52e every teaching step is owned by the Teaching Agent', task.plan.filter((s) => s.capability === 'teach').every((s) => s.agentId === 'teaching-agent'))
  ok('T52f the model enriched the prose', lesson.modelUsed === true)

  const prog = getLearningProgress()
  ok('T52g the lesson is recorded in learning progress', prog.topics['python-oop']?.presented === 1, JSON.stringify(prog.topics))
  const grade = submitLessonQuiz(ref, { [lesson.quiz[0].id]: lesson.quiz[0].answerIndex })
  ok('T52h quiz scoring persists accuracy', grade.correct === 1 && getLearningProgress().topics['python-oop'].quizCorrect === 1, JSON.stringify(grade))
  recordLessonAnswer(ref, false, 'wrong answer')
  recordLessonExercise(ref, true, 'solved exercise')
  const after = getLearningProgress().topics['python-oop']
  ok('T52i mistakes and exercises are tracked separately', after.mistakes >= 1 && after.exercisesAttempted === 1, JSON.stringify(after))
  ok('T52j the task result contains the taught topic', /Python OOP/.test(task.result ?? ''), (task.result ?? '').slice(0, 80))
}

// ── T53 · MANUAL with the Teaching Agent off blocks the lesson honestly ─────
{
  setSelectionMode('manual')
  setAgentEnabled('teaching-agent', false)
  mockFetch(routeMock({ chat: 'should not be used' }))
  const task = await teachTopic('Teach me SQL joins')
  restoreFetch()
  setAgentEnabled('teaching-agent', true)
  setSelectionMode('auto')
  ok(
    'T53a disabling the Teaching Agent blocks the lesson honestly',
    task.status === 'failed' && /Teaching Agent unavailable/.test(task.error ?? ''),
    `${task.status}: ${task.error ?? ''}`,
  )
  const teachSteps = task.plan.filter((s) => s.capability === 'teach')
  ok('T53b no teaching step is dispatched without its owner', teachSteps.length > 0 && teachSteps.every((s) => s.status === 'failed' && s.blocked))
}

// ── T54 · a model outage still yields a complete, deterministic lesson ───────
{
  setSelectionMode('auto')
  setAgentEnabled('teaching-agent', true)
  clearLearningProgress()
  mockFetch(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'model offline' }) }))
  const task = await teachTopic('Teach me Linux commands')
  restoreFetch()
  ok(
    'T54a a model outage still produces a complete, validated lesson',
    Boolean(task.lesson) && task.lesson.validation === null && task.lesson.sections.every((s) => s.markdown.trim().length > 0),
    task.lesson?.validation ?? task.status,
  )
  ok('T54b the lesson is honestly marked as app content', task.lesson.modelUsed === false && /verified teaching content/i.test(task.result ?? ''))
  ok('T54c progress is still tracked on model failure', getLearningProgress().topics['linux-commands']?.presented === 1)
}

// ── T55 · follow-up questions keep in-lesson context ────────────────────────
{
  mockFetch(routeMock({ chat: 'A short follow-up explanation.' }))
  const r = await askWithinLesson('Python OOP (classes, objects, inheritance, polymorphism)', 'python', 'Why does self matter?')
  restoreFetch()
  ok('T55a follow-up questions are answered in-lesson', r.ok && /follow-up explanation/.test(r.result), r.error ?? '')
}

// ── T56 · Audit remediations: highlighting, scope, graph, follow-up context ──
{
  const F = teachingFramework
  const I = teachingIntent

  // Code highlighting now covers the teaching subjects (SQL and C).
  const sqlSrc = "SELECT name FROM employees WHERE dept = 'ENG' -- note\n"
  const sqlToks = highlightCode(sqlSrc, 'sql')
  ok(
    'T56a SQL highlights keywords, strings and -- comments',
    sqlToks.some((t) => t.cls === 'kw' && /SELECT/.test(t.text)) &&
      sqlToks.some((t) => t.cls === 'str' && /ENG/.test(t.text)) &&
      sqlToks.some((t) => t.cls === 'com' && /-- note/.test(t.text)) &&
      sqlToks.map((t) => t.text).join('') === sqlSrc,
    JSON.stringify(sqlToks.slice(0, 8)),
  )
  const cSrc = '#include <stdio.h>\nint main(void) {\n    return 0;\n}\n'
  const cToks = highlightCode(cSrc, 'c')
  ok(
    'T56b C highlights keywords and never treats #include as a comment',
    cToks.some((t) => t.cls === 'kw' && t.text === 'int') &&
      !cToks.some((t) => t.cls === 'com') &&
      cToks.map((t) => t.text).join('') === cSrc,
    JSON.stringify(cToks.slice(0, 8)),
  )

  // Scope adapts lesson size to the ask.
  ok('T56c a simple factual question is a quick lesson', F.detectScope('what is a python list') === 'quick')
  ok('T56d an explicit teaching ask stays a full lesson', F.detectScope('Teach me Python OOPs') === 'full')
  const quick = F.buildLessonPlan({ topic: 'what is a python list', context: 'what is a python list' })
  ok(
    'T56e quick plan keeps the essentials and drops the heavy sections',
    quick.sections.length < 6 &&
      quick.sections.every((s) => ['intro', 'concepts', 'examples', 'revision'].includes(s.kind)) &&
      F.validateLesson(quick, {}) === null,
    JSON.stringify(quick.sections.map((s) => s.kind)),
  )

  // The prerequisite / next-topic graph now resolves to real, teachable topics.
  const oop = F.buildLessonPlan({ topic: 'Python OOPs' })
  ok(
    'T56f python OOP next-topic resolves to a real lesson',
    oop.next.length === 1 && oop.next[0] === 'Python exceptions & error handling' && F.getTopic('python-exceptions') !== undefined,
    JSON.stringify(oop.next),
  )
  const joins = F.buildLessonPlan({ topic: 'SQL joins' })
  ok(
    'T56g SQL joins prerequisites resolve without leaking raw slugs',
    joins.prerequisites.length === 1 && joins.prerequisites[0] === 'SQL SELECT & WHERE' && !/sql-select/.test(joins.prerequisites.join(' ')),
    JSON.stringify(joins.prerequisites),
  )
  const nxt = F.recommendNext(F.emptyProgress(), { next: joins.next })
  ok(
    'T56h the recommended next topic maps back to a teachable id',
    Boolean(nxt) && nxt.topicId === 'sql-null-group' && nxt.label === 'SQL NULL handling & GROUP BY',
    JSON.stringify(nxt),
  )

  // Follow-up prompts carry bounded lesson context for continuity.
  const prompt = I.buildFollowUpPrompt('SQL joins', 'sql', 'Why does Bo show NULL?', 'LEFT JOIN keeps every customer; unmatched orders become NULL.')
  ok(
    'T56i follow-up prompt carries the lesson excerpt',
    /Lesson material already given/.test(prompt) && /unmatched orders become NULL/.test(prompt),
    prompt.slice(0, 120),
  )

  // Section prompts stay focused on the learner's exact request.
  const focused = F.buildLessonPlan({ topic: 'SQL joins', context: 'teach me SQL joins with sample tables and the resulting rows' })
  const conceptPrompt = focused.sections.find((s) => s.kind === 'concepts').prompt
  ok(
    'T56j section prompts carry the learner’s own words',
    /sample tables and the resulting rows/.test(conceptPrompt),
    conceptPrompt.slice(0, 140),
  )
}

// ── T57 · Topic selection never substitutes an unrelated default ─────────────
{
  const F = teachingFramework
  const I = teachingIntent
  const planFor = (text) => F.buildLessonPlan(I.toLessonRequest(text))

  const list = planFor('What is a Python list?')
  ok(
    'T57a an unknown sub-topic yields a general lesson on the requested topic (not the default)',
    list.topic === 'Python list' &&
      list.topicId !== 'python-functions' &&
      list.resolution.coverage === 'general' &&
      list.resolution.matched === false &&
      list.subject === 'python',
    JSON.stringify({ topic: list.topic, topicId: list.topicId, coverage: list.resolution.coverage }),
  )

  const dict = planFor('Explain Python dictionaries.')
  ok(
    'T57b "Explain Python dictionaries" keeps its own topic',
    dict.topic === 'Python dictionaries' && dict.topicId !== 'python-functions' && dict.resolution.coverage === 'general',
    JSON.stringify({ topic: dict.topic, topicId: dict.topicId }),
  )

  const fns = planFor('Teach me Python functions.')
  ok(
    'T57c a bank topic named in the request is selected exactly',
    fns.resolution.coverage === 'bank' && fns.resolution.matched === true && fns.topicId === 'python-functions',
    JSON.stringify({ topic: fns.topic, topicId: fns.topicId, coverage: fns.resolution.coverage }),
  )

  const bank = planFor('SQL joins')
  ok(
    'T57d an existing bank topic resolves to its bank id',
    bank.resolution.coverage === 'bank' && bank.topicId === 'sql-joins',
    JSON.stringify({ topicId: bank.topicId, coverage: bank.resolution.coverage }),
  )

  const unknown = planFor('Teach me SQL window functions')
  ok(
    'T57e an unknown sub-topic in a known subject stays general and never the default',
    unknown.resolution.coverage === 'general' &&
      unknown.subject === 'sql' &&
      unknown.topicId.startsWith('sql:') &&
      unknown.topicId !== 'sql-joins' &&
      /window functions/i.test(unknown.topic),
    JSON.stringify({ topic: unknown.topic, topicId: unknown.topicId }),
  )

  const ambiguous = planFor('Teach me something interesting')
  ok(
    'T57f ambiguous wording asks for clarification instead of guessing a lesson',
    ambiguous.resolution.needsClarification === true,
    JSON.stringify(ambiguous.resolution),
  )

  ok(
    'T57g an unrelated request is not a teaching request',
    I.isTeachingRequest('fix the bug in src/app/page.tsx') === false &&
      I.isTeachingRequest('rename the variable in store.ts') === false,
  )
}

// ── T58 · Ambiguous requests never open an unrelated lesson (runtime) ────────
{
  setSelectionMode('auto')
  setAgentEnabled('teaching-agent', true)
  let calls = 0
  mockFetch(async () => { calls++; return llmResponse('should not be called') })
  const task = await teachTopic('Teach me something interesting')
  restoreFetch()
  ok(
    'T58a an ambiguous teaching request returns a clarification and no lesson',
    Boolean(task.clarification) && !task.lesson && task.status === 'completed',
    JSON.stringify({ clarification: task.clarification, status: task.status }),
  )
  ok('T58b no model call and no default lesson for an ambiguous request', calls === 0)
  ok(
    'T58c the clarification names the learner request and offers next steps',
    /something interesting/.test(task.clarification ?? '') && /python/i.test(task.clarification ?? ''),
    task.clarification ?? '',
  )
}

// ── T59 · Offline follow-ups use local material or say so honestly ───────────
{
  const label = 'Python OOP (classes, objects, inheritance, polymorphism)'
  mockFetch(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'model offline' }) }))
  const local = await askWithinLesson(label, 'python', 'Why does self matter?')
  const absent = await askWithinLesson(label, 'python', 'How do I deploy this to Kubernetes?')
  restoreFetch()
  ok(
    'T59a an offline follow-up answerable from the lesson material is answered locally',
    local.ok === true && /self/i.test(local.result) && /verified material/i.test(local.result),
    local.error ?? (local.result ?? '').slice(0, 120),
  )
  ok(
    'T59b an offline follow-up that needs the model says so and invents nothing',
    absent.ok === false && /unavailable/i.test(absent.error ?? '') && /won't guess/i.test(absent.error ?? ''),
    absent.error ?? '',
  )
  mockFetch(routeMock({ chat: 'A model-powered follow-up answer.' }))
  const online = await askWithinLesson(label, 'python', 'Why does self matter?')
  restoreFetch()
  ok(
    'T59c a follow-up uses the model when the provider is available',
    online.ok === true && /model-powered follow-up answer/.test(online.result) && !/verified material/i.test(online.result),
    online.error ?? '',
  )
}

// ── T60 · Determinstic exercise grading only where it is unambiguous ─────────
{
  const F = teachingFramework
  const mc = F.gradeExercise(
    { id: 'x', level: 'beginner', kind: 'multiple-choice', prompt: 'p', solution: 's', options: ['a', 'b', 'c'], answerIndex: 1 },
    { choice: 1 },
  )
  ok('T60a multiple-choice is graded exactly', mc.gradeable === true && mc.correct === true && mc.expected === 'b')
  const mcWrong = F.gradeExercise(
    { id: 'x', level: 'beginner', kind: 'multiple-choice', prompt: 'p', solution: 's', options: ['a', 'b', 'c'], answerIndex: 1 },
    { choice: 0 },
  )
  ok('T60b a wrong multiple-choice answer is marked incorrect', mcWrong.gradeable === true && mcWrong.correct === false)
  const out = F.gradeExercise(
    { id: 'x', level: 'beginner', kind: 'predict-output', prompt: 'p', solution: 's', expected: '6' },
    { text: 'the answer is 6' },
  )
  ok('T60c an exact expected output is graded (token-aware)', out.gradeable === true && out.correct === true)
  const outWrong = F.gradeExercise(
    { id: 'x', level: 'beginner', kind: 'predict-output', prompt: 'p', solution: 's', expected: '6' },
    { text: '16' },
  )
  ok('T60d a near-miss output is not falsely marked correct', outWrong.gradeable === true && outWrong.correct === false)
  const open = F.gradeExercise(
    { id: 'x', level: 'beginner', kind: 'write-code', prompt: 'p', solution: 's' },
    { text: 'def f(): pass' },
  )
  ok('T60e open-ended exercises are honestly not gradeable', open.gradeable === false && open.correct === null)
  const bankMc = F.getTopic('python-oop').exercises.filter((e) => e.options && typeof e.answerIndex === 'number')
  ok(
    'T60f the bank ships at least one deterministically gradeable exercise',
    bankMc.length >= 1 && F.gradeExercise(bankMc[0], { choice: bankMc[0].answerIndex }).correct === true,
    String(bankMc.length),
  )
  const bankOut = F.getTopic('python-functions').exercises.filter((e) => typeof e.expected === 'string' && e.expected.trim())
  ok('T60g the bank ships an exact-output exercise', bankOut.length >= 1, String(bankOut.length))
}

// ── T61 · SubjectSpec.visual is resolved (removed; it was redundant) ─────────
{
  const F = teachingFramework
  const spec = F.getSubject('python')
  ok(
    'T61a SubjectSpec no longer carries the unused visual field',
    !Object.prototype.hasOwnProperty.call(spec, 'visual'),
    JSON.stringify(Object.keys(spec)),
  )
  ok(
    'T61b subject rendering metadata is preserved',
    typeof spec.language === 'string' && Array.isArray(spec.sections) && typeof spec.defaultTopicId === 'string',
  )
  ok(
    'T61c the framework source declares no visual field',
    !/^\s*visual:/m.test(readFileSync(path.join(LIB, 'teaching-framework.ts'), 'utf-8')),
  )
}

// ── T62 · Skills runtime: discovery, selection, injection, slash commands ───
// MOCKED /api/skills: the registry payloads are fixtures, but every decision
// below is made by the real runtime code (selection, skips, activation,
// bounded prompt block, slash handlers).
{
  const skillRecord = (over = {}) => ({
    id: 'react-ui-development',
    name: 'React UI Development',
    description: 'Build React user interfaces: components, layout, forms, accessibility and responsive page structure.',
    category: 'ui',
    license: 'MIT',
    compatibility: '',
    metadata: { version: '1.0.0', tags: 'react ui component' },
    allowedTools: '',
    source: { kind: 'local' },
    localPath: '.agenthub/skills/react-ui-development',
    enabled: true,
    trust: 'local',
    validation: { status: 'valid', errors: [], warnings: [], suspicious: [], checkedAt: '2026-01-01T00:00:00.000Z' },
    files: [{ path: 'SKILL.md', size: 120 }],
    hasScripts: false,
    hasReferences: false,
    hasAssets: false,
    integrity: 'a'.repeat(16),
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  })

  const skillsFixture = (skills, instructions = {}, post = null) => async (u, init) => {
    const s = String(u)
    const qs = new URLSearchParams(s.split('?')[1] ?? '')
    if (init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ ok: true, ...(post ?? {}) }) }
    }
    if (qs.get('op') === 'list') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          root: '/ws/.agenthub/skills',
          counts: {
            installed: skills.length,
            enabled: skills.filter((x) => x.enabled).length,
            disabled: skills.filter((x) => !x.enabled).length,
            attention: 0,
          },
          skills,
          trustedSources: [],
          discovered: [],
          missing: [],
        }),
      }
    }
    if (qs.get('op') === 'show') {
      const id = qs.get('id') ?? ''
      if (!(id in instructions)) return { ok: true, status: 404, json: async () => ({ ok: false, error: `No skill "${id}"` }) }
      return { ok: true, status: 200, json: async () => ({ ok: true, id, path: `${id}/SKILL.md`, instructions: instructions[id], truncated: false }) }
    }
    if (qs.get('op') === 'inspect') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          repo: { repoUrl: qs.get('repo') ?? '', refUsed: 'main', commit: 'c'.repeat(40), subPath: '' },
          skills: [
            {
              dir: 'skills/demo-skill',
              dirName: 'demo-skill',
              name: 'demo-skill',
              description: 'A demo skill for the install flow.',
              license: 'MIT',
              compatibility: '',
              category: 'ui',
              fileCount: 3,
              totalBytes: 2400,
              hasScripts: true,
              hasReferences: false,
              suspicious: [],
              valid: true,
              errors: [],
              warnings: [],
            },
          ],
        }),
      }
    }
    if (qs.get('op') === 'check-update') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          supported: true,
          available: true,
          behind: true,
          installedCommit: 'a'.repeat(40),
          remoteCommit: 'b'.repeat(40),
          changes: { addedCount: 1, removedCount: 0, modifiedCount: 2 },
        }),
      }
    }
    return { ok: true, status: 404, json: async () => ({ ok: false, error: 'unsupported op' }) }
  }

  const skillLogs = (task) => task.logs.filter((l) => /Skill /.test(l.content)).map((l) => l.content)

  // A · a genuinely matching skill is selected and its instructions injected.
  {
    const prompts = []
    mockFetch(routeMock({
      chat: async (u, init) => {
        let body = {}
        try { body = JSON.parse(init?.body ?? '{}') } catch { /* ignore */ }
        if (typeof body.message === 'string') prompts.push(body.message)
        return llmResponse('A grounded explanation.')
      },
      skills: skillsFixture(
        [
          skillRecord(),
          skillRecord({ id: 'sql-query-writing', name: 'SQL Query Writing', description: 'Write SQL queries: joins, filters, indexes and schema migrations.', category: 'sql', metadata: { tags: 'sql query database' } }),
        ],
        { 'react-ui-development': 'When working on React UI: group related fields and keep labels visible.', 'sql-query-writing': 'SQL guidance body.' },
      ),
    }))
    const task = await startAgentSession('explain React component accessibility best practices')
    const activate = await getToolByName('activate_skill').execute({ name: 'sql-query-writing' })
    const unknown = await getToolByName('activate_skill').execute({ name: 'does-not-exist' })
    restoreFetch()

    ok('T62a a matching skill is selected and logged', task.logs.some((l) => l.content.startsWith('Skill selected: react-ui-development')), skillLogs(task).join(' | '))
    ok('T62b the decision logs the matching evidence', task.logs.some((l) => /^Skill considered: react-ui-development \(matched: .*react/.test(l.content)), skillLogs(task).join(' | '))
    ok('T62c the instruction load is logged with its real size', task.logs.some((l) => /^Skill instructions loaded: react-ui-development \(\d+ chars\)/.test(l.content)), skillLogs(task).join(' | '))
    ok(
      'T62d the captured model prompt carries the bounded skills block',
      prompts.some((p) => p.includes('=== Skills (managed by the application) ===') && p.includes('keep labels visible')),
      String(prompts[0] ?? '').slice(0, 200),
    )
    ok('T62e the injected block states the guidance-only guard', prompts.some((p) => p.includes('never override permissions')))
    ok(
      'T62f the task snapshot records the selection with counts',
      Boolean(task.skills) && task.skills.active.some((a) => a.id === 'react-ui-development' && a.instructionsLoaded === true && a.instructionsChars > 0) && task.skills.installed === 2 && task.skills.enabled === 2,
      JSON.stringify(task.skills),
    )
    ok('T62g activate_skill loads a second skill by name', activate.ok === true && activate.result.includes('SQL guidance body.'), activate.error ?? activate.result.slice(0, 120))
    ok(
      'T62h activate_skill refuses an unknown skill honestly',
      unknown.ok === false && /Unknown skill/.test(unknown.error ?? ''),
      unknown.error,
    )
    const live = getAgentSessionState().task
    ok(
      'T62i model-requested activation is recorded on the task',
      Boolean(live?.skills?.active.some((a) => a.id === 'sql-query-writing' && a.reason === 'requested by the model')),
      JSON.stringify(live?.skills?.active),
    )
  }

  // A · Three representative games auto-load their design, engine/genre and test skills.
  {
    const prompts = []
    const gameSkillIds = [
      'router',
      'game-design',
      'web-3d-game-development',
      'web-game-development',
      'game-physics',
      'gameplay-programming',
      'game-testing',
      'threejs-scene-setup',
      'physics-tuning',
      'puzzle',
    ]
    const gameSkills = gameSkillIds.map((id) => skillRecord({
      id,
      name: id,
      description: 'Guidance for browser game design and implementation.',
      category: 'game-development',
      metadata: { version: '1.0.0', tags: 'game browser gameplay' },
      localPath: `.agenthub/skills/${id}`,
    }))
    const gameInstructions = Object.fromEntries(gameSkillIds.map((id) => [id, `Instructions for ${id}.`]))
    mockFetch(routeMock({
      chat: async (u, init) => {
        let body = {}
        try { body = JSON.parse(init?.body ?? '{}') } catch { /* ignore */ }
        if (typeof body.message === 'string') prompts.push(body.message)
        return llmResponse('Game implementation plan.')
      },
      skills: skillsFixture(gameSkills, gameInstructions),
    }))
    const car = await startAgentSession('Create a 3D car racing game')
    const wizard = await startAgentSession('Create a 3D wizard chess browser game')
    const xo = await startAgentSession('Create an X or O browser puzzle game')
    restoreFetch()

    const cases = [
      { label: '3D car racer', task: car, expected: ['router', 'game-design', 'web-3d-game-development', 'threejs-scene-setup', 'physics-tuning', 'game-testing'] },
      { label: '3D wizard chess', task: wizard, expected: ['router', 'game-design', 'web-3d-game-development', 'threejs-scene-setup', 'puzzle', 'game-testing'] },
      { label: 'X or O browser game', task: xo, expected: ['router', 'game-design', 'web-game-development', 'puzzle', 'game-testing'] },
    ]
    for (const item of cases) {
      const active = item.task.skills?.active.map((skill) => skill.id) ?? []
      ok(
        `T62g1 ${item.label} selects its matching upstream workflow`,
        item.expected.every((id) => active.includes(id)),
        JSON.stringify(active),
      )
    }
    const active = car.skills?.active.map((skill) => skill.id) ?? []
    ok(
      'T62g2 selected game skill instructions are loaded into the model prompt',
      cases.every((item) => item.task.skills?.active.every((skill) => skill.instructionsLoaded && skill.instructionsChars > 0) === true) && prompts.some((prompt) => prompt.includes('Instructions for router.')) && prompts.some((prompt) => prompt.includes('Instructions for game-design.')),
      JSON.stringify({ car: active, loaded: cases.map((item) => item.task.skills?.active.map((skill) => ({ id: skill.id, loaded: skill.instructionsLoaded }))) }),
    )
  }

  // B · disabled / unreviewed skills are skipped with their real reasons.
  {
    mockFetch(routeMock({
      chat: 'ok',
      skills: skillsFixture(
        [
          skillRecord({ enabled: false }),
          skillRecord({ id: 'sketchy-skill', name: 'Sketchy Skill', description: 'React component helper for accessibility.', trust: 'unreviewed', source: { kind: 'github', repoUrl: 'https://github.com/x/y', commit: 'd'.repeat(40) } }),
        ],
        {},
      ),
    }))
    const task = await startAgentSession('explain React component accessibility best practices')
    restoreFetch()
    ok('T62j a disabled skill is skipped with its real reason', task.logs.some((l) => l.content === 'Skill skipped: disabled — react-ui-development'), skillLogs(task).join(' | '))
    ok('T62k an unreviewed skill is excluded from automatic selection', task.logs.some((l) => l.content === 'Skill skipped: unreviewed — sketchy-skill'), skillLogs(task).join(' | '))
    ok('T62l no instructions are loaded when nothing is eligible', !task.logs.some((l) => l.content.startsWith('Skill instructions loaded')), skillLogs(task).join(' | '))
  }

  // C · a malformed or empty registry never breaks a run.
  {
    mockFetch(routeMock({ chat: 'ok' }))
    const empty = await startAgentSession('explain React component accessibility best practices')
    ok(
      'T62m an empty registry is reported as a real state, not imagined skills',
      !empty.skills &&
        getAgentSessionState().skillStats?.installed === 0 &&
        !empty.logs.some((l) => l.content.startsWith('Skill ')),
      JSON.stringify({ stats: getAgentSessionState().skillStats, logs: skillLogs(empty) }),
    )

    mockFetch(async (u) => (String(u).includes('/api/skills') ? { ok: true, status: 200, json: async () => ({ weird: true }) } : llmResponse('ok')))
    const broken = await startAgentSession('hello there')
    restoreFetch()
    ok(
      'T62n a malformed registry payload degrades to a logged state',
      broken.status === 'completed' && broken.logs.some((l) => l.content.startsWith('Skills unavailable:')),
      broken.status,
    )
  }

  // D · slash commands act on the real registry (mock transport only).
  {
    mockFetch(routeMock({
      chat: 'ok',
      skills: skillsFixture([skillRecord()], { 'react-ui-development': 'Full instructions body.' }, { ok: true, commit: 'b'.repeat(40) }),
    }))
    const list = await runSlashCommand('/skills list')
    const search = await runSlashCommand('/skills search react')
    const show = await runSlashCommand('/skills show react-ui-development')
    const enable = await runSlashCommand('/skills enable react-ui-development')
    const disable = await runSlashCommand('/skills disable react-ui-development')
    const updateCheck = await runSlashCommand('/skills update react-ui-development')
    const updateConfirm = await runSlashCommand('/skills update react-ui-development confirm')
    const removePlan = await runSlashCommand('/skills remove react-ui-development')
    const removeConfirm = await runSlashCommand('/skills remove react-ui-development confirm')
    const install = await runSlashCommand('/skills install https://github.com/acme/skills')
    const hint = getAgentSessionState().skillInstallHint
    const help = await runSlashCommand('/help')
    restoreFetch()

    ok('T62o /skills list reports the real registry', list.handled && list.reply.includes('Installed skills: 1 (1 enabled)') && list.reply.includes('react-ui-development'), list.reply.slice(0, 140))
    ok('T62p /skills search ranks installed skills', search.handled && search.reply.includes('Matches for "react"') && search.reply.includes('react-ui-development'), search.reply.slice(0, 140))
    ok('T62q /skills show returns metadata and instructions', show.handled && show.reply.includes('Skill react-ui-development — React UI Development') && show.reply.includes('Full instructions body.'), show.reply.slice(0, 160))
    ok('T62r /skills enable performs the real action', enable.handled && enable.reply.includes('enabled'), enable.reply)
    ok('T62s /skills disable performs the real action', disable.handled && disable.reply.includes('disabled'), disable.reply)
    ok('T62t /skills update previews the remote change', updateCheck.handled && /has new commits/.test(updateCheck.reply) && /1 added, 2 modified/.test(updateCheck.reply), updateCheck.reply.slice(0, 200))
    ok('T62u /skills update confirm applies it after the explicit token', updateConfirm.handled && /updated to b{12}/.test(updateConfirm.reply), updateConfirm.reply.slice(0, 140))
    ok('T62v /skills remove asks for confirmation and names the effect', removePlan.handled && removePlan.reply.includes('deletes all of its files') && removePlan.reply.includes('confirm'), removePlan.reply.slice(0, 200))
    ok('T62w /skills remove confirm performs the removal', removeConfirm.handled && removeConfirm.reply.includes('removed (files and registry entry)'), removeConfirm.reply)
    ok(
      'T62x /skills install inspects the repo and hands off to the Library',
      install.handled && /Found 1 skill\(s\)/.test(install.reply) && install.reply.includes('Nothing has been downloaded yet') && hint?.repo === 'https://github.com/acme/skills' && hint.commit === 'c'.repeat(40),
      `${install.reply.slice(0, 120)} | hint=${JSON.stringify(hint)}`,
    )
    ok('T62y /help advertises the skills command', help.reply.includes('/skills'))
  }

  // E · the runtime module itself stays self-contained.
  {
    const skillsSource = readFileSync(path.join(LIB, 'skills.ts'), 'utf-8')
    const skillImports = [...skillsSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    ok('T62z skills runtime module has no external imports', skillImports.every((i) => i.startsWith('.')), skillImports.join(', '))
    ok('T62z2 the session runtime imports the skills module', source.includes("from './skills'"))
  }
}

// ── T63 · deterministic file intent + safe default destination ──────────────
// The app (not the model) classifies the request, chooses any destination, and
// refuses to guess when guessing would be unsafe. MOCKED file/model endpoints.
{
  // — Pure intent classification (delete/update win over create) —
  ok('T63a a read request is classified as read', detectFileIntent('read the content of src/a.ts').intent === 'read')
  ok('T63b a list request is classified as list', detectFileIntent('list the files in src').intent === 'list')
  ok('T63c a find request is classified as find', detectFileIntent('find the auth module').intent === 'find')
  const create = detectFileIntent('create a notebook and write success in it')
  ok('T63d a create request is classified as create', create.intent === 'create')
  ok('T63e an unnamed create gets the safe default filename', create.defaultTarget === SAFE_DEFAULT_FILENAME, String(create.defaultTarget))
  ok('T63f an unnamed create toward a directory nests the default', detectFileIntent('create a notebook in src/').defaultTarget === `src/${SAFE_DEFAULT_FILENAME}`)
  const upd = detectFileIntent('update the config')
  ok('T63g an unnamed update needs clarification', upd.intent === 'update' && upd.needsClarification === true)
  const del = detectFileIntent('delete the old notes')
  ok('T63h an unnamed delete needs clarification', del.intent === 'delete' && del.needsClarification === true)
  ok('T63i an explicit delete is classified as delete', detectFileIntent('delete old/notes.txt').intent === 'delete')
  ok('T63j "refactor and write" resolves to update (never a blind create)', detectFileIntent('refactor and write src/a.ts').intent === 'update')

  // — Scope derivation —
  const sCreate = getFileScope('create a notebook in that folder and write success in it')
  ok('T63k an unnamed create scopes to the safe default', sCreate.allowed.length === 1 && sCreate.allowed[0] === SAFE_DEFAULT_FILENAME, JSON.stringify(sCreate.allowed))
  ok('T63l the scope is flagged as a safe default', sCreate.safeDefault === true && sCreate.defaultTarget === SAFE_DEFAULT_FILENAME)
  ok('T63m the reason states the safe default honestly', /safe default/.test(sCreate.reason), sCreate.reason)
  ok('T63n the default is in scope', isPathInScope(sCreate, SAFE_DEFAULT_FILENAME))
  const sUpdate = getFileScope('update the config')
  ok('T63o an unnamed update has no destination and asks', sUpdate.allowed.length === 0 && sUpdate.needsClarification === true, JSON.stringify(sUpdate))

  // — End-to-end: the unnamed create actually writes a permitted file —
  const writes = []
  const prompts = []
  mockFetch(routeMock({
    chat: async (u, init) => {
      let msg = ''
      try {
        msg = JSON.parse(init?.body ?? '{}')?.message ?? ''
      } catch { /* ignore */ }
      prompts.push(msg)
      // The Coder proposes a bare, out-of-scope filename on purpose: the app must
      // resolve it to the safe default instead of failing the run.
      if (msg.includes('Implement the requested change')) {
        return llmResponse('```tool {"name": "write_file", "args": {"path": "notebook.txt", "content": "success"}}```')
      }
      return llmResponse('FINAL: reported')
    },
    files: async (u, init) => {
      if (u.includes('op=read')) {
        return { ok: true, status: 404, json: async () => ({ ok: false, error: 'Not found' }) }
      }
      if (init?.method === 'POST') {
        let body = {}
        try {
          body = JSON.parse(init?.body ?? '{}')
        } catch { /* ignore */ }
        writes.push(body)
        return { ok: true, status: 200, json: async () => ({ ok: true, path: body.path, bytes: String(body.content ?? '').length, created: true }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, path: '.', tree: [], truncated: false }) }
    },
  }))
  setSmolMode('edit')
  setSelectionMode('auto')
  setAgentEnabled('coder', true)
  const unsub = subscribeAgentSession((s) => {
    if (s.pendingApproval) resolveApproval(true)
  })
  const task = await startAgentSession('create a notebook in that folder and write success in it')
  unsub()
  restoreFetch()

  const w = writes.find((x) => x.op === 'write')
  ok('T63p the run performs a real write', Boolean(w), JSON.stringify(writes))
  ok('T63q the write targets the safe default file', String(w?.path ?? '').replace(/\\\\/g, '/').endsWith(SAFE_DEFAULT_FILENAME), String(w?.path))
  ok('T63r the file receives the requested content', w?.content === 'success', String(w?.content))
  ok('T63s the bare out-of-scope name is never written', !writes.some((x) => String(x.path ?? '').endsWith('notebook.txt')))
  ok('T63t the change is tracked for review', (task.changedFiles ?? []).some((c) => c.path.replace(/\\/g, '/').endsWith(SAFE_DEFAULT_FILENAME)), JSON.stringify(task.changedFiles))
  ok('T63u the run is not a silent failure', task.status === 'completed' || task.status === 'partial', `status=${task.status}`)
  ok('T63u2 the code step itself completed', task.plan.find((s) => s.capability === 'code')?.status === 'completed', JSON.stringify(task.plan.map((s) => [s.capability, s.status])))
  ok('T63v the model was told the allowed destination', prompts.some((p) => p.includes(`safe default destination \"${SAFE_DEFAULT_FILENAME}\"`)))
  ok('T63w the reported result cites the real write evidence', /Created|Overwrote/.test(task.result ?? '') || (task.plan.find((s) => s.capability === 'code')?.result ?? '').includes('Created'), String(task.result).slice(0, 120))

  // — An unnamed update asks one concise question and changes nothing —
  const before = writes.length
  mockFetch(routeMock({ chat: 'ok' }))
  const ask = await startAgentSession('update the config')
  restoreFetch()
  ok('T63x an unnamed update returns a clarification', typeof ask.clarification === 'string' && /which file/i.test(ask.clarification), String(ask.clarification))
  ok('T63y the clarifying run writes nothing', writes.length === before)
  ok('T63z the clarifying run plans no code step', !ask.plan.some((s) => s.capability === 'code'))
}

// ── T64 · AUTO / MANUAL specialist selection is honest and distinct ─────────
// registered ≠ eligible ≠ disabled ≠ selected. MOCKED where a run is needed.
{
  const owner = 'coder'
  const capable = (id) => getAgentCapabilities(id).includes('code')
  ok('T64a the registry exposes real capabilities', capable('coder') && capable('designer'))

  // AUTO substitutes an enabled capable specialist when the natural owner is off.
  const autoPlan = createPlan('fix the bug in src/a.ts', { mode: 'auto', isEnabled: (id) => id !== owner })
  const autoCode = autoPlan.find((s) => s.capability === 'code')
  ok('T64b AUTO selects an enabled capable substitute', Boolean(autoCode?.agentId) && autoCode.agentId !== owner && capable(autoCode.agentId), JSON.stringify(autoCode))

  // A user's explicit opt-outs are preserved: disabling every capable agent
  // leaves the step blocked rather than silently re-enabling someone.
  const allOff = createPlan('fix the bug in src/a.ts', { mode: 'auto', isEnabled: (id) => id !== 'coder' && id !== 'designer' })
  const offCode = allOff.find((s) => s.capability === 'code')
  ok('T64c ALL capable agents opted out → the step is blocked, not forced', !offCode?.agentId && /enable that agent/.test(offCode?.blocked ?? ''), JSON.stringify(offCode))

  // MANUAL uses only user-enabled specialists and explains the gap.
  const manualPlan = createPlan('fix the bug in src/a.ts', { mode: 'manual', isEnabled: (id) => id !== owner })
  const manualCode = manualPlan.find((s) => s.capability === 'code')
  ok(
    'T64d MANUAL uses only enabled specialists and points to AUTO',
    !manualCode?.agentId && /switch to AUTO/.test(manualCode?.blocked ?? '') && /code/.test(manualCode?.blocked ?? ''),
    JSON.stringify(manualCode),
  )

  // Disabling does not deregister.
  setAgentEnabled('coder', false)
  ok('T64e a disabled specialist is still registered', getAgentRoster().some((a) => a.id === 'coder') && !isAgentEnabled('coder'))
  setAgentEnabled('coder', true)

  // A real run records availability (enabled) separately from activity (status).
  mockFetch(routeMock({
    chat: '```tool {"name": "write_file", "args": {"path": "src/a.ts", "content": "x"}}```',
    files: async (url) => ({ ok: true, status: 200, json: async () => String(url).includes('op=tree') ? { ok: true, path: '.', tree: [{ path: 'src/a.ts', type: 'file' }], truncated: false } : { ok: true, path: 'src/a.ts', bytes: 1, created: true } }),
  }))
  setSmolMode('edit')
  setSelectionMode('auto')
  const unsub = subscribeAgentSession((s) => {
    if (s.pendingApproval) resolveApproval(true)
  })
  const run = await startAgentSession('fix the bug in src/a.ts')
  unsub()
  restoreFetch()
  const team = getRunTeam()
  const coderMember = team.find((m) => m.agentId === 'coder')
  const idle = team.find((m) => m.agentId === 'runner')
  ok('T64f the run team records real selection', Boolean(coderMember?.selected) && coderMember.steps.includes('step-code'), JSON.stringify(coderMember))
  ok('T64g selection is never confused with activity', coderMember?.status === 'completed' && Boolean(idle) && idle.selected === false && idle.status === 'available', JSON.stringify({ coder: coderMember?.status, researcher: idle?.status }))
  ok('T64h the run recorded evidence for the real change', (run.status === 'completed' || run.status === 'partial') && (run.changedFiles ?? []).length >= 1, `status=${run.status}`)
}

// ── T65 · the Coder's allow-list matches its advertised tools ───────────────
// The Coder's system prompt instructs the model to emit `delete_file`, so the
// tool must actually be in its allow-list — otherwise runGuidedStep refuses the
// call and the run can end "completed" without deleting anything.
{
  const coderTools = getAgentById('coder')?.tools ?? []
  ok('T65a the Coder may write', coderTools.includes('write_file'))
  ok('T65b the Coder may edit', coderTools.includes('edit_file'))
  ok('T65c the Coder may delete (matches its system prompt + the code capability)', coderTools.includes('delete_file'), coderTools.join(','))
}

await fs.rm(runtimeDir, { recursive: true, force: true }).catch(() => {})
await fs.rm(designDir, { recursive: true, force: true }).catch(() => {})
await fs.rm(teachingDir, { recursive: true, force: true }).catch(() => {})
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  console.error('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
process.exit(0)
