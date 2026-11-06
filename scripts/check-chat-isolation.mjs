#!/usr/bin/env node
// ── Chat ↔ Session isolation checks ──────────────────────────────────────────
//   node scripts/check-chat-isolation.mjs
//
// Proves that /api/chat keeps TWO distinct behaviours and that the Agent
// Session and the Chat page therefore never share messages:
//
//   default    → reads + writes the shared db/chat-history.json (Chat page)
//   stateless  → touches NOTHING shared (the Agent Session runtime)
//
// It runs the REAL route module (src/app/api/chat/route.ts) against a mock
// LLM endpoint, so no provider (LM Studio/Ollama/cloud) is required. The only
// substituted pieces are the provider HTTP endpoint and `next/server`'s
// NextResponse.json (contract-identical), documented below.
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

const CHAT_MODEL_ID = 'mock-model'
let emptyMcqAttempts = 0
let repairMcqAttempts = 0
const mockMcqReply = [
  '## Test Topic — MCQ Test',
  '5 questions · Beginner level · 1 mark each',
  ...Array.from({ length: 5 }, (_, index) => [
    `Question ${index + 1}. Which choice is correct for test question ${index + 1}?`,
    '- A) Choice one', '- B) Choice two', '- C) Choice three', '- D) Choice four',
    '```answer', 'Correct: B. Explanation: Choice two is correct.', '```',
  ].join('\n')),
].join('\n\n')

// ── 1. Mock LLM provider (records every request it receives) ─────────────────
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
    if (body.model === 'not-ready-model') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'PRIVATE_PROVIDER_ERROR_BODY' }))
      return
    }
    const systemMessage = body.messages?.find((message) => message.role === 'system')?.content ?? ''
    if (/Generate exactly 5 questions/.test(systemMessage)) {
      const lastUser = body.messages?.filter((message) => message.role === 'user').at(-1)?.content ?? ''
      const repairing = /Your previous draft did not meet the interactive quiz format/.test(lastUser)
      const repairTest = /REPAIR_TEST/.test(body.messages?.map((message) => message.content).join('\n') ?? '')
      let content
      if (repairTest && repairing) {
        repairMcqAttempts++
        content = mockMcqReply
      } else if (repairTest) {
        content = 'Question 1. Incomplete draft?\n- A) One\n- B) Two'
      } else {
        emptyMcqAttempts++
        content = emptyMcqAttempts === 1 ? '' : mockMcqReply
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'mock reply' } }] }))
  })
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const providerPort = mock.address().port
const providerEndpoint = `http://127.0.0.1:${providerPort}/v1`

// ── 2. Isolated db dir (set before the route module resolves DB_DIR) ─────────
const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-iso-db-'))
const historyFile = path.join(dbDir, 'chat-history.json')
process.env.AGENT_HUB_DB_DIR = dbDir
await fs.writeFile(
  path.join(dbDir, 'custom-models.json'),
  JSON.stringify([
    {
      id: CHAT_MODEL_ID,
      name: 'Mock',
      endpoint: providerEndpoint,
      apiKey: '',
      modelId: 'mock-model',
      createdAt: new Date().toISOString(),
    },
  ]),
  'utf-8',
)

// ── 3. Build the real route + its runtime deps into a temp dir ──────────────
// The temp dir lives UNDER the repo root so `require('next/server')` resolves
// from node_modules. `@/lib/agent-hub/*` aliases are rewritten to siblings.
const buildDir = await fs.mkdtemp(path.join(ROOT, '.tmp-chat-iso-'))
try {
  for (const name of ['model-preference', 'model-preference-server', 'model-routing', 'task-guidance', 'request-origin', 'chat-control', 'chat-store', 'chat-quiz', 'advanced-lesson', 'db-path', 'fs-atomic', 'custom-models', 'chat-settings', 'chat-types', 'usage-events', 'llm', 'teach-prompt', 'token-usage', 'seed-agents', 'seed-sessions', 'seed-models', 'seed-graph', 'seed-changes', 'seed-workflow', 'seed', 'normalize', 'state-file', 'attachments', 'document-extract']) {
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
  const { NextRequest } = require('next/server')
  const route = require(path.join(buildDir, 'route.js'))
  const store = require(path.join(buildDir, 'chat-store.js'))
  const controls = require(path.join(buildDir, 'chat-control.js'))
  await store.writeHistory([
    { id: 'edit-user', role: 'user', content: 'original', time: new Date().toISOString(), kind: 'chat' },
    { id: 'edit-reply', role: 'assistant', content: 'old reply', time: new Date().toISOString(), kind: 'chat' },
  ])
  const editRequest = () => new NextRequest('http://localhost/api/chat', { method: 'PATCH', headers: { host: 'localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: 'legacy', messageId: 'edit-user', content: 'changed message' }) })
  controls.beginChatControl('legacy')
  ok('edit refuses to modify a running conversation', (await route.PATCH(editRequest())).status === 400 && (await store.readHistory()).length === 2)
  controls.finishChatControl('legacy')
  ok('edit returns conversation to the selected turn', (await route.PATCH(editRequest())).status === 200 && (await store.readHistory()).length === 0)
  const editBackups = await fs.readdir(path.join(dbDir, 'chat-edit-history'))
  ok('edit backs up the original conversation branch', JSON.parse(await fs.readFile(path.join(dbDir, 'chat-edit-history', editBackups[0]), 'utf8')).messages.length === 2)
  await store.clearHistory()

  async function post(body) {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost' },
      body: JSON.stringify(body),
    })
    const res = await route.POST(req)
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  async function postStream(body) {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Host: 'localhost' },
      body: JSON.stringify({ ...body, stream: true }),
    })
    const res = await route.POST(req)
    return { status: res.status, text: await res.text() }
  }
  const readHistory = async () => {
    try {
      return await fs.readFile(historyFile, 'utf-8')
    } catch {
      return null
    }
  }

  // ── A · default (Chat page / machine API) still persists ──────────────────
  await fs.rm(historyFile, { force: true })
  const a = await post({ message: 'hello from chat', settings: { model: CHAT_MODEL_ID } })
  const histA = JSON.parse((await readHistory()) ?? '[]')
  ok('A1 default POST succeeds', a.status === 200 && a.json?.ok === true, `status=${a.status}`)
  ok('A2 default POST reports persisted:true', a.json?.persisted === true && a.json?.stateless === false)
  ok(
    'A3 default POST writes the shared Chat history (2 records)',
    Array.isArray(histA) && histA.length === 2 && histA[0].content === 'hello from chat' && histA[0].role === 'user',
    `records=${histA.length}`,
  )

  // ── B · stateless (Agent Session) must not touch the shared history ───────
  const beforeB = await readHistory()
  const b = await post({ message: 'session internal prompt', settings: { model: CHAT_MODEL_ID }, stateless: true })
  const afterB = await readHistory()
  ok('B1 stateless POST succeeds', b.status === 200 && b.json?.ok === true, `status=${b.status}`)
  ok('B2 stateless POST reports persisted:false', b.json?.persisted === false && b.json?.stateless === true)
  ok('B3 stateless POST leaves Chat history byte-identical', beforeB === afterB)

  // ── C · stateless never CREATES the history file ─────────────────────────
  await fs.rm(historyFile, { force: true })
  await post({ message: 'another session turn', settings: { model: CHAT_MODEL_ID }, stateless: true })
  ok('C1 stateless POST never creates Chat history', (await readHistory()) === null)

  // ── D · context isolation: stateless ignores Chat, honours caller history ─
  await fs.writeFile(
    historyFile,
    JSON.stringify([
      { role: 'user', content: 'CHAT_SECRET_MARKER', time: new Date().toISOString() },
      { role: 'assistant', content: 'ack', time: new Date().toISOString() },
    ]),
    'utf-8',
  )
  const d1 = await post({ message: 'session prompt', settings: { model: CHAT_MODEL_ID }, stateless: true })
  const seenD1 = (received.at(-1)?.messages ?? []).map((m) => m.content).join('\n')
  ok('D1 stateless POST does NOT read Chat history', !seenD1.includes('CHAT_SECRET_MARKER'))
  ok('D2 stateless POST still sends the caller message', seenD1.includes('session prompt'))
  ok('D3 stateless POST left the seeded Chat history untouched', (await readHistory())?.includes('CHAT_SECRET_MARKER') === true)
  ok('D4 stateless call reached the provider', d1.status === 200)

  await post({
    message: 'session follow-up',
    settings: { model: CHAT_MODEL_ID },
    stateless: true,
    history: [{ role: 'user', content: 'CALLER_CONTEXT' }],
  })
  const seenD5 = (received.at(-1)?.messages ?? []).map((m) => m.content).join('\n')
  ok('D5 stateless POST honours caller-supplied history', seenD5.includes('CALLER_CONTEXT'))
  ok('D6 stateless POST still excludes Chat history alongside caller history', !seenD5.includes('CHAT_SECRET_MARKER'))

  // ── E · default DOES read Chat history (regression guard) ────────────────
  await post({ message: 'chat follow-up', settings: { model: CHAT_MODEL_ID } })
  const seenE = (received.at(-1)?.messages ?? []).map((m) => m.content).join('\n')
  ok('E1 default POST includes Chat history as context', seenE.includes('CHAT_SECRET_MARKER'))

  // ── F · validation/safety unchanged for both modes ───────────────────────
  const empty = await post({ message: '   ', stateless: true })
  ok('F1 stateless still rejects an empty message', empty.status === 400)

  // ── G · GET normalization + real connection status ───────────────────────
  const gRaw = await route.GET(new NextRequest('http://localhost/api/chat', { headers: { Host: 'localhost' } }))
  const gJson = await gRaw.json()
  ok('G1 GET returns an ok envelope with a messages array', gJson?.ok === true && Array.isArray(gJson?.messages))

  const gStatus = await route.GET(
    new NextRequest(`http://localhost/api/chat?resource=status&model=${CHAT_MODEL_ID}`, { headers: { Host: 'localhost' } }),
  )
  const gsJson = await gStatus.json()
  ok(
    'G2 status probes and reports the configured provider connected',
    gsJson?.ok === true && gsJson?.connected === true,
    JSON.stringify(gsJson),
  )
  ok('G3 status reports the real model id', gsJson?.modelId === 'mock-model', gsJson?.modelId)

  // ── H · teach mode selects the built-in teaching preset ──────────────────
  await post({ message: 'teach me', settings: { model: CHAT_MODEL_ID, teachMode: true }, stateless: true })
  const seenH = (received.at(-1)?.messages ?? []).find((m) => m.role === 'system')?.content ?? ''
  ok(
    'H1 teach mode injects the built-in teaching prompt',
    seenH.includes('MASTER PROMPT') && seenH.includes('RENDERING CONTRACT'),
  )
  await post({
    message: 'normal',
    settings: { model: CHAT_MODEL_ID, systemPrompt: 'CUSTOM_PROMPT_MARKER' },
    stateless: true,
  })
  const seenH2 = (received.at(-1)?.messages ?? []).find((m) => m.role === 'system')?.content ?? ''
  ok('H2 non-teach mode still uses the user system prompt', seenH2.includes('CUSTOM_PROMPT_MARKER') && !seenH2.includes('MASTER PROMPT'))

  await post({ message: 'short answer', settings: { model: CHAT_MODEL_ID, responseDepth: 'concise', thinking: false }, stateless: true })
  const concisePrompt = received.at(-1)?.messages?.find((m) => m.role === 'system')?.content ?? ''
  ok('H2j concise response depth is added to the system prompt', concisePrompt.includes('Response depth preference (concise)') && concisePrompt.includes('Preserve required formats'))
  await post({ message: 'teach this deeply', settings: { model: CHAT_MODEL_ID, responseDepth: 'comprehensive', thinking: false }, stateless: true })
  const comprehensivePrompt = received.at(-1)?.messages?.find((m) => m.role === 'system')?.content ?? ''
  ok('H2k comprehensive response depth adds useful coverage without changing thinking mode', comprehensivePrompt.includes('Response depth preference (comprehensive)') && !comprehensivePrompt.includes('thinking effort'))
  await post({ message: 'default depth', settings: { model: CHAT_MODEL_ID }, stateless: true })
  const standardPrompt = received.at(-1)?.messages?.find((m) => m.role === 'system')?.content ?? ''
  ok('H2l omitted response depth gets the balanced standard instruction', standardPrompt.includes('Response depth preference (standard)') && standardPrompt.includes('balanced response length'))
  await post({ message: 'invalid depth', settings: { model: CHAT_MODEL_ID, responseDepth: 'verbose' }, stateless: true })
  const invalidDepthPrompt = received.at(-1)?.messages?.find((m) => m.role === 'system')?.content ?? ''
  ok('H2m invalid response depth safely falls back to standard', invalidDepthPrompt.includes('Response depth preference (standard)'))
  await post({ message: 'explain this carefully', settings: { model: CHAT_MODEL_ID, responseDepth: 'detailed', thinking: true, effort: 'low' }, stateless: true })
  const detailedThinkingPrompt = received.at(-1)?.messages?.find((m) => m.role === 'system')?.content ?? ''
  ok('H2n prompt-guided thinking preserves the independent response-depth instruction', detailedThinkingPrompt.includes('Response depth preference (detailed)') && detailedThinkingPrompt.includes('effort: low'))

  await post({ message: 'Teach me AI Agents', settings: { model: CHAT_MODEL_ID, teachMode: true }, stateless: true })
  const teachGuidePrompt = received.at(-1)?.messages?.[0]?.content ?? ''
  ok('H2a Teach receives the supplied AI Agents architecture and exact three-question reference', teachGuidePrompt.includes('SOURCE REFERENCE') && teachGuidePrompt.includes('Agent Runtime / Orchestrator') && teachGuidePrompt.includes('Which mechanism should actually enforce a file-delete restriction?'))
  await post({ message: 'Teach me SQL joins', settings: { model: CHAT_MODEL_ID, teachMode: true }, stateless: true })
  const sqlTeachPrompt = received.at(-1)?.messages?.[0]?.content ?? ''
  ok('H2b another teaching topic gets diagram support without the unrelated AI Agents reference', sqlTeachPrompt.includes('fenced\n   "diagram"') && !sqlTeachPrompt.includes('SOURCE REFERENCE'))
  await post({ message: 'Teach me AI Agents', settings: { model: CHAT_MODEL_ID, advancedTeachMode: true }, stateless: true })
  const advancedPrompt = received.at(-1)?.messages?.[0]?.content ?? ''
  ok('H2c0 Advanced response budget is bounded on the non-streaming route too', received.at(-1)?.max_tokens === 3000)
  ok('H2c Advanced selects its five-step framework plus the same visual and quiz contract', advancedPrompt.includes('FIVE-STEP TUTORING') && advancedPrompt.includes('RENDERING CONTRACT') && advancedPrompt.includes('presses Submit Quiz') && advancedPrompt.includes('SOURCE REFERENCE') && !advancedPrompt.includes('# MASTER PROMPT'))
  ok('H2d Advanced keeps its confirmation gates and three-sentence step while adding final scenario practice', advancedPrompt.includes('Advance exactly one step only after') && advancedPrompt.includes('exactly three jargon-free sentences') && advancedPrompt.includes('three-question scenario-based MCQ'))
  const stepHistory = [{ role: 'user', content: 'Teach me AI agents' }, { role: 'assistant', content: '## Step 1: The Simplified Concept\nAn agent uses allowed tools. Do you understand?' }]
  await post({ message: 'Yes, continue', history: stepHistory, settings: { model: CHAT_MODEL_ID, advancedTeachMode: true }, stateless: true })
  const advancedTurn = received.at(-1)?.messages ?? []
  ok('H2e an advanced continuation preserves the current step and explicit learner confirmation', advancedTurn.some((turn) => turn.content.includes('## Step 1:')) && advancedTurn.at(-1)?.content === 'Yes, continue')
  await post({ message: 'give 3 mcq on AI agents', settings: { model: CHAT_MODEL_ID, advancedTeachMode: true }, stateless: true })
  ok('H2f an Advanced quiz uses advanced scenarios instead of being forced to beginner difficulty', received.at(-1)?.messages?.[0]?.content.includes('3 questions · Advanced level') && received.at(-1)?.messages?.[0]?.content.includes('realistic scenarios and tradeoffs'))
  await post({ message: 'Teach AI Agents with an architecture diagram and three MCQs', settings: { model: CHAT_MODEL_ID, teachMode: true }, stateless: true })
  ok('H2g a lesson containing a diagram and quiz is not replaced by a quiz-only response', !received.at(-1)?.messages?.[0]?.content.includes('Return only the complete quiz'))
  await post({ message: 'give three mcq on AI agents', settings: { model: CHAT_MODEL_ID }, stateless: true })
  ok('H2h spelled question counts are honored', received.at(-1)?.messages?.[0]?.content.includes('Generate exactly 3 questions'))
  await post({ message: 'give 3 mcq on AI agents using what we covered so far', history: [{ role: 'assistant', content: 'STALE_UNRELATED_LESSON' }, ...stepHistory], settings: { model: CHAT_MODEL_ID, advancedTeachMode: true }, stateless: true })
  const scopedPractice = received.at(-1)?.messages ?? []
  ok('H2i Advanced practice retains the current lesson without stale topics or the full-guide reference', scopedPractice.some((turn) => turn.content.includes('## Step 1:')) && !scopedPractice.some((turn) => /STALE_UNRELATED_LESSON|SOURCE REFERENCE/.test(turn.content)) && scopedPractice[0]?.content.includes('practice-only turn'))

  // ── H3 · ordinary MCQ requests get a compact interactive quiz contract ───
  const quizHistory = [
    { role: 'user', content: 'OLD_CONTEXT_MARKER' },
    ...Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `Old chat turn ${index}` })),
    { role: 'assistant', content: 'If you want me to review the completed quiz for the **TOPIC_MARKER — MCQ Test**, paste your answers.' },
  ]
  const quizStream = await postStream({
    message: 'give 5 mcq',
    chatTitle: 'Steps to learn Data Science',
    settings: { model: CHAT_MODEL_ID, systemPrompt: 'CUSTOM_PROMPT_MARKER', thinking: false },
    stateless: true,
    history: quizHistory,
  })
  const quizEvents = quizStream.text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5).trim()))
  const quizDone = quizEvents.find((event) => event.type === 'done')
  const firstQuizRequest = received.at(-2)
  const retryQuizRequest = received.at(-1)
  const firstQuizContext = (firstQuizRequest?.messages ?? []).map((item) => item.content).join('\n')
  const firstQuizSystem = firstQuizRequest?.messages?.find((item) => item.role === 'system')?.content ?? ''
  ok('H3a an MCQ request injects the mandatory answer-block format and chat topic in normal Chat mode', firstQuizSystem.includes('Generate exactly 5 questions') && firstQuizSystem.includes('For EVERY question, add one answer block') && firstQuizSystem.includes('about the established topic “Data Science”') && firstQuizSystem.includes('no more than 18 words'))
  ok('H3b an explicit chat topic excludes stale quiz history that could change the subject', !firstQuizContext.includes('OLD_CONTEXT_MARKER') && !firstQuizContext.includes('TOPIC_MARKER') && firstQuizContext.includes('Data Science'))
  ok('H3c an empty first model reply is retried and the streamed response contains all five questions', quizStream.status === 200 && quizDone?.reply === mockMcqReply && (quizDone.reply.match(/^Question \d+\./gm) ?? []).length === 5, `status=${quizStream.status}; replies=${quizDone?.reply ? 'present' : 'missing'}`)
  ok('H3d the empty-reply retry adds an explicit recovery instruction', retryQuizRequest?.messages?.[0]?.content?.includes('previous attempt returned no user-visible answer') === true)
  const grading = await post({ message: 'Score my MCQ answers', settings: { model: CHAT_MODEL_ID }, stateless: true })
  const gradingSystem = (received.at(-1)?.messages ?? []).find((item) => item.role === 'system')?.content ?? ''
  ok('H3e grading submitted answers does not trigger quiz generation', grading.status === 200 && !gradingSystem.includes('Generate exactly 5 questions'))
  const repairStream = await postStream({ message: 'REPAIR_TEST give 5 mcq on Data Science', settings: { model: CHAT_MODEL_ID }, stateless: true })
  const repairEvents = repairStream.text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5).trim()))
  const repaired = repairEvents.find((event) => event.type === 'done')
  ok('H3f a malformed local-model quiz is repaired once before completion', repairStream.status === 200 && repairMcqAttempts === 1 && repaired?.reply === mockMcqReply)
  ok('H3g the streaming client receives a replace event for the corrected quiz', repairEvents.some((event) => event.type === 'replace' && event.text === mockMcqReply))

  // ── I · separate persistent conversations never share context/history ──
  const threadsDir = path.join(dbDir, 'chat-threads')
  await fs.mkdir(threadsDir, { recursive: true })
  const ids = [crypto.randomUUID(), crypto.randomUUID()]
  for (const id of ids) {
    await fs.writeFile(path.join(threadsDir, `${id}.json`), JSON.stringify({
      id, title: 'New chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [],
    }))
  }
  const legacyBefore = await readHistory()
  const i1 = await post({ chatId: ids[0], message: 'FIRST_CHAT_MARKER', settings: { model: CHAT_MODEL_ID } })
  const i2 = await post({ chatId: ids[1], message: 'SECOND_CHAT_MARKER', settings: { model: CHAT_MODEL_ID } })
  const secondContext = (received.at(-1)?.messages ?? []).map((m) => m.content).join('\n')
  const firstThread = JSON.parse(await fs.readFile(path.join(threadsDir, `${ids[0]}.json`), 'utf8'))
  const secondThread = JSON.parse(await fs.readFile(path.join(threadsDir, `${ids[1]}.json`), 'utf8'))
  ok('I1 both independent conversations persist', i1.status === 200 && i2.status === 200 && firstThread.messages.length === 2 && secondThread.messages.length === 2)
  ok('I2 each conversation has only its own messages', firstThread.messages[0].content === 'FIRST_CHAT_MARKER' && secondThread.messages[0].content === 'SECOND_CHAT_MARKER')
  ok('I3 second model call excludes first conversation context', !secondContext.includes('FIRST_CHAT_MARKER') && secondContext.includes('SECOND_CHAT_MARKER'))
  ok('I4 legacy history remains untouched', legacyBefore === await readHistory())
  const threadGet = await route.GET(new NextRequest(`http://localhost/api/chat?chatId=${ids[0]}`, { headers: { Host: 'localhost' } }))
  const threadBody = await threadGet.json()
  ok('I5 GET selects the requested conversation', threadBody.messages?.[0]?.content === 'FIRST_CHAT_MARKER')
  const invalidId = await route.GET(new NextRequest('http://localhost/api/chat?chatId=../escape', { headers: { Host: 'localhost' } }))
  ok('I6 invalid conversation ids are rejected', invalidId.status === 400)


  // An unloaded model rejected by the provider gets actionable, nonretryable
  // guidance. Keep provider error bodies private and leave history untouched.
  const llmModule = require(path.join(buildDir, 'llm.js'))
  const originalResolveTarget = llmModule.resolveTarget
  const beforeNotReady = await readHistory()
  try {
    llmModule.resolveTarget = async () => ({ endpoint: providerEndpoint, apiKey: '', modelId: 'not-ready-model', label: 'Mock local model', loaded: false, isChatCompatible: true })
    const notReady = await post({ message: 'hello', settings: { model: CHAT_MODEL_ID }, stateless: true })
    ok('J1 unloaded-model refusal returns recovery guidance', notReady.status === 503 && notReady.json?.code === 'MODEL_NOT_READY' && /Load a chat model/.test(notReady.json?.error ?? ''), JSON.stringify(notReady.json))
    ok('J2 unloaded-model refusal tells the session not to retry', notReady.json?.retryable === false)
    ok('J3 provider error body remains private', !JSON.stringify(notReady.json).includes('PRIVATE_PROVIDER_ERROR_BODY'))
    ok('J4 failed session request leaves Chat history unchanged', beforeNotReady === await readHistory())
    llmModule.resolveTarget = async () => ({ endpoint: providerEndpoint, apiKey: '', modelId: 'not-ready-model', label: 'Mock local model', loaded: true, isChatCompatible: true })
    const loadedError = await post({ message: 'hello', settings: { model: CHAT_MODEL_ID }, stateless: true })
    ok('J5 a loaded-model error is not mislabeled as missing a model', loadedError.status === 500 && !/Load a chat model/.test(loadedError.json?.error ?? '') && !JSON.stringify(loadedError.json).includes('PRIVATE_PROVIDER_ERROR_BODY'))
  } finally {
    llmModule.resolveTarget = originalResolveTarget
  }
} finally {
  mock.close()
  await fs.rm(buildDir, { recursive: true, force: true }).catch(() => {})
  await fs.rm(dbDir, { recursive: true, force: true }).catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) {
  console.error('\nFAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
