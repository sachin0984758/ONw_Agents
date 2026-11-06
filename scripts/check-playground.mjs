#!/usr/bin/env node
// ── Playground checks ────────────────────────────────────────────────────────
//   node scripts/check-playground.mjs
//
// Runs the REAL playground API route (src/app/api/playground/route.ts), the
// real store / prompt / registry / starter modules and the suggestion
// extractors against:
//   · a temp DB dir (its own playground.json — never the real db/)
//   · an in-process OpenAI-compatible mock provider on 127.0.0.1:1234
//     (skipped when the port is already taken by a real LM Studio)
//
// Coverage map (the 16 requested test areas):
//   1  route/navigation wiring           9  model selection / local provider
//   2  editor + highlighting wiring     10  offline / unreachable provider
//   3  language registry & switching    11  AI-estimated labels
//   4  SQL modes + sample schema        12  non-execution guarantees
//   5  Excel grid + formula bar         13  no cloud fallback / no fabrication
//   6  analysis actions per mode        14  long content / context limits
//   7  apply suggestion + undo          15  responsive contract
//   8  session save/load/rename/delete  16  isolation from other app state
//   ·  + store caps, sanitisation, corrupt quarantine, prompt contract
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(path.join(ROOT, 'package.json'))

let pass = 0
let fail = 0
let skipped = 0
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
function skip(name, why) {
  skipped++
  console.log(`  SKIP  ${name} — ${why}`)
}
function section(name) {
  console.log(`\n── ${name} ──`)
}

// ── 1. Harness: transpile the real modules, isolate the DB ──────────────────

const BUILD_DIR = path.join(ROOT, '.tmp-playground-check')
const DB_DIR = path.join(os.tmpdir(), `playground-db-${process.pid}-${Date.now()}`)
const MODULES = {
  'request-origin': 'src/lib/agent-hub/request-origin.ts',
  'db-path': 'src/lib/agent-hub/db-path.ts',
  'fs-atomic': 'src/lib/agent-hub/fs-atomic.ts',
  'chat-settings': 'src/lib/agent-hub/chat-settings.ts',
  'llm': 'src/lib/agent-hub/llm.ts',
  'usage-events': 'src/lib/agent-hub/usage-events.ts',
  'custom-models': 'src/lib/agent-hub/custom-models.ts',
  'playground-types': 'src/lib/agent-hub/playground-types.ts',
  'playground-languages': 'src/lib/agent-hub/playground-languages.ts',
  'playground-starters': 'src/lib/agent-hub/playground-starters.ts',
  'playground-prompts': 'src/lib/agent-hub/playground-prompts.ts',
  'playground-store': 'src/lib/agent-hub/playground-store.ts',
  'playground-extract': 'src/components/agent-hub/playground/playground-extract.ts',
  'split-layout': 'src/components/agent-hub/playground/split-layout.ts',
  'playground-feedback': 'src/lib/agent-hub/playground-feedback.ts',
  'roadmap-library': 'src/lib/agent-hub/roadmap-library.ts',
  'token-usage': 'src/lib/agent-hub/token-usage.ts',
  'seed-agents': 'src/lib/agent-hub/seed-agents.ts',
  'seed-sessions': 'src/lib/agent-hub/seed-sessions.ts',
  'seed-models': 'src/lib/agent-hub/seed-models.ts',
  'seed-graph': 'src/lib/agent-hub/seed-graph.ts',
  'seed-changes': 'src/lib/agent-hub/seed-changes.ts',
  'seed-workflow': 'src/lib/agent-hub/seed-workflow.ts',
  'seed': 'src/lib/agent-hub/seed.ts',
  'normalize': 'src/lib/agent-hub/normalize.ts',
  'state-file': 'src/lib/agent-hub/state-file.ts',
  route: 'src/app/api/playground/route.ts',
}

process.env.AGENT_HUB_DB_DIR = DB_DIR
delete process.env.AGENT_SESSION_CLOUD_FALLBACK

await fs.rm(BUILD_DIR, { recursive: true, force: true })
await fs.mkdir(BUILD_DIR, { recursive: true })
await fs.mkdir(DB_DIR, { recursive: true })
// Synthetic fixture graphs make these checks independent of a user's private
// roadmap cache and prove that the library honours the selected durable DB.
const node = (id, label, y, href = '', type = 'topic') => ({ id, label, y, x: 0, href, type })
const analystFixture = {
  slug: 'data-analyst', title: 'Data Analyst', description: 'Synthetic branch fixture',
  nodes: [node('intro', 'Introduction', 0), node('sql', 'Learn SQL', 1, 'https://roadmap.sh/sql'), node('excel', 'Excel', 2), node('tableau', 'Tableau', 3), ...Array.from({ length: 101 }, (_, i) => node(`spacer-${i}`, 'layout spacer', i + 4, '', 'vertical'))],
  edges: ['sql', 'excel', 'tableau'].map((to) => ({ from: 'intro', to, style: 'solid' })),
}
await fs.mkdir(path.join(DB_DIR, 'roadmaps'))
await fs.writeFile(path.join(DB_DIR, 'roadmaps', 'data-analyst.json'), JSON.stringify(analystFixture))
await fs.writeFile(path.join(DB_DIR, 'roadmaps', 'sql.json'), JSON.stringify({ slug: 'sql', title: 'SQL', description: 'Synthetic SQL fixture', nodes: [node('sql-intro', 'Introduction', 0), node('select', 'SELECT', 1)], edges: [{ from: 'sql-intro', to: 'select', style: 'solid' }] }))
await fs.writeFile(path.join(DB_DIR, 'roadmaps', 'index.json'), JSON.stringify({ roadmaps: [{ slug: 'sql', title: 'SQL', description: 'Fixture' }, { slug: 'data-analyst', title: 'Data Analyst', description: 'Fixture' }] }))
for (const [name, rel] of Object.entries(MODULES)) {
  const src = await fs.readFile(path.join(ROOT, rel), 'utf-8')
  const out = ts.transpileModule(src.replace(/@\/lib\/agent-hub\//g, './'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  await fs.writeFile(path.join(BUILD_DIR, `${name}.js`), out, 'utf-8')
}

const { NextRequest } = req('next/server')
const route = req(path.join(BUILD_DIR, 'route.js'))
const store = req(path.join(BUILD_DIR, 'playground-store.js'))
const prompts = req(path.join(BUILD_DIR, 'playground-prompts.js'))
const languages = req(path.join(BUILD_DIR, 'playground-languages.js'))
const starters = req(path.join(BUILD_DIR, 'playground-starters.js'))
const types = req(path.join(BUILD_DIR, 'playground-types.js'))
const extract = req(path.join(BUILD_DIR, 'playground-extract.js'))
const feedbackLib = req(path.join(BUILD_DIR, 'playground-feedback.js'))
const splitLayout = req(path.join(BUILD_DIR, 'split-layout.js'))
const roadmapLibrary = req(path.join(BUILD_DIR, 'roadmap-library.js'))

const readSource = (rel) => fs.readFile(path.join(ROOT, rel), 'utf-8')

async function get(resource = 'sessions', init = {}) {
  const url = `http://localhost/api/playground?resource=${resource}`
  const res = await route.GET(new NextRequest(url, { ...init, headers: { Host: 'localhost', ...init.headers } }))
  let json = null
  try {
    json = await res.json()
  } catch {
    /* empty */
  }
  return { status: res.status, json }
}

async function post(body, init = {}) {
  const { headers = {}, ...rest } = init
  const res = await route.POST(
    new NextRequest('http://localhost/api/playground', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'localhost', ...headers },
      body: JSON.stringify(body),
      ...rest,
    }),
  )
  let json = null
  try {
    json = await res.json()
  } catch {
    /* empty */
  }
  return { status: res.status, json }
}

// ── 2. In-process mock provider (LM Studio port, OpenAI-compatible) ─────────

const providerRequests = []
function startMockProvider() {
  return new Promise((resolve) => {
    const srv = http.createServer((request, res) => {
      if (request.url.includes('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
        return
      }
      if (request.method === 'POST' && request.url.includes('/chat/completions')) {
        let body = ''
        request.on('data', (c) => (body += c))
        request.on('end', () => {
          providerRequests.push(body)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: '## Reply\n\n```python\nprint("suggested")\n```\n\nPLAYGROUND-OK',
                  },
                },
              ],
            }),
          )
        })
        return
      }
      res.writeHead(404)
      res.end()
    })
    srv.once('error', () => resolve(null))
    srv.listen(1234, '127.0.0.1', () => resolve(srv))
  })
}

// ── 3. Registry, actions, labels ────────────────────────────────────────────

section('Language registry, actions and non-execution labels (areas 3, 4, 6, 11)')

{
  const ids = languages.PLAYGROUND_LANGUAGES.map((l) => l.id)
  for (const required of ['python', 'c', 'cpp', 'java', 'javascript', 'typescript', 'sql', 'html', 'css', 'go', 'rust', 'php', 'csharp', 'bash', 'powershell', 'json', 'yaml', 'excel-formulas']) {
    ok(`registry contains ${required}`, ids.includes(required))
  }
  ok('no duplicate language ids', new Set(ids).size === ids.length)
  ok(
    'no Format action is offered anywhere (no verified local formatter)',
    languages.PLAYGROUND_LANGUAGES.every((l) => l.formatter === false),
  )
  const modes = new Set(['code', 'sql', 'markup', 'excel'])
  ok('every language maps to a known mode', languages.PLAYGROUND_LANGUAGES.every((l) => modes.has(l.mode)))
  ok('SQL registry entry uses sql mode', languages.playgroundLanguage('sql').mode === 'sql')
  ok('Excel entry uses excel mode', languages.playgroundLanguage('excel-formulas').mode === 'excel')
  ok('unknown language falls back safely', languages.playgroundLanguage('nope').id === 'python')

  const code = languages.actionsForMode('code').map((a) => a.id)
  for (const a of ['explain', 'review', 'find-bugs', 'hint', 'improve', 'predict-output']) {
    ok(`code mode offers ${a}`, code.includes(a))
  }
  ok('code mode offers NO run/execute/compile action', !code.some((a) => /run|exec|compile/i.test(a)))
  const sql = languages.actionsForMode('sql').map((a) => a.id)
  for (const a of ['explain', 'review', 'find-bugs', 'hint', 'predict-result']) {
    ok(`sql mode offers ${a}`, sql.includes(a))
  }
  const excel = languages.actionsForMode('excel').map((a) => a.id)
  for (const a of ['explain-formula', 'find-errors', 'suggest-correction', 'explain-dataset', 'hint', 'generate-questions']) {
    ok(`excel mode offers ${a}`, excel.includes(a))
  }
  ok('excel mode offers NO code-run action', !excel.some((a) => /run|exec|compile/i.test(a)))
  ok('predict-output is flagged estimated', languages.playgroundAction('predict-output').estimated === true)
  ok('predict-result is flagged estimated', languages.playgroundAction('predict-result').estimated === true)
  ok('improve may yield a suggestion', languages.playgroundAction('improve').suggests === true)
  ok('suggest-correction may yield a formula suggestion', languages.playgroundAction('suggest-correction').suggests === true)
  ok('unknown action resolves to undefined', languages.playgroundAction('execute') === undefined)

  const L = types.ANALYSIS_LABELS
  ok(
    'code non-execution label is exact',
    L.code === 'AI analysis only — code is not executed.',
    L.code,
  )
  ok(
    'sql non-execution label is exact',
    L.sql === 'Queries are analyzed but not executed. Results shown by AI are estimates.',
    L.sql,
  )
  ok(
    'excel non-execution label is exact',
    L.excel ===
      'Formula analysis only — recalculation is not performed unless a verified calculation engine is explicitly integrated.',
    L.excel,
  )
  ok('markup label states no rendering/execution', /not rendered or executed/.test(L.markup))
}

// ── 4. Starters, schema, workbooks ──────────────────────────────────────────

section('Deterministic starters, SQL schema, Excel workbooks (areas 3, 4, 5)')

{
  for (const id of ['python', 'c', 'cpp', 'javascript', 'typescript', 'sql']) {
    ok(`${id} has at least one starter exercise`, starters.startersFor(id).length >= 1)
  }
  ok('every non-excel language has a starter (works fully offline)', languages.PLAYGROUND_LANGUAGES.filter((l) => l.mode !== 'excel').every((l) => starters.startersFor(l.id).length >= 1))
  ok('python has 3 difficulty starters', starters.startersFor('python').length >= 3)
  ok('sql has 3 practice starters (joins/group/window)', starters.startersFor('sql').length >= 3)
  ok('starter ids are unique', new Set(starters.STARTERS.map((s) => s.id)).size === starters.STARTERS.length)
  ok('every starter has a task and non-trivial code', starters.STARTERS.every((s) => s.problem.length > 40 && s.code.length > 40))
  ok(
    'starters never claim execution',
    starters.STARTERS.every((s) => !/\bhas been executed\b|\bcompiled successfully\b|\bwas run\b/i.test(s.problem + s.code)),
  )
  ok(
    'python starter contains the deliberate off-by-one bug',
    starters.firstStarter('python').code.includes('range(1, len(numbers))'),
  )
  const windowStarter = starters.startersFor('sql').find((s) => /OVER \(ORDER BY/.test(s.code))
  ok('a window-function SQL starter exists (SUM() OVER)', Boolean(windowStarter))

  const schema = starters.SQL_SAMPLE_SCHEMA
  ok('sample schema has 4 tables', schema.tables.length === 4)
  ok('every schema table has columns and >= 4 example rows', schema.tables.every((t) => t.columns.length >= 3 && t.rows.length >= 4))
  ok('schema note states no database exists', /no database is created/i.test(schema.note))
  ok('schemaDdlText emits real CREATE TABLE statements', starters.schemaDdlText().includes('CREATE TABLE customers'))
  ok('schema table dump includes header + rows', starters.schemaTableDump(schema.tables[0]).includes('name') && starters.schemaTableDump(schema.tables[0]).split('\n').length >= 5)

  const workbooks = starters.SAMPLE_WORKBOOKS
  ok('at least 2 sample workbooks ship', workbooks.length >= 2)
  ok('workbook cells store formulas as raw text (start with =)', workbooks.every((w) => Object.values(w.sheet.cells).some((v) => v.startsWith('='))))
  ok('sales workbook contains an XLOOKUP formula', Object.values(workbooks[0].sheet.cells).some((v) => v.includes('XLOOKUP')))
  ok('budget workbook contains an absolute reference', Object.values(workbooks[1].sheet.cells).some((v) => v.includes('$B$6')))
  const dump = starters.sheetDump(workbooks[0].sheet)
  ok('sheet dump exposes raw formula text (not computed values)', dump.includes('=SUM(E2:E6)'))
  ok('sheet dump is column-labelled', dump.split('\n')[0].includes('A') && dump.includes('Total revenue'))
}

// ── 5. Prompt builder contract ──────────────────────────────────────────────

section('Analysis prompt contract — analysis, never execution (areas 6, 12, 14)')

{
  const system = prompts.PLAYGROUND_SYSTEM_PROMPT
  ok('system prompt forbids execution claims', /Never claim or imply that code ran/.test(system))
  ok('system prompt defines the input as unexecuted', /has been run, compiled or calculated/.test(system))
  ok('system prompt requires estimates to be labelled', /AI estimate/.test(system))
  ok('system prompt demands one fenced replacement for suggestions', /ONE complete replacement/.test(system))
  ok('system prompt keeps hints partial', /Hints must not contain the full solution/.test(system))
  ok('Understand Anything concept graph is scoped to Roadmap lessons', /For Roadmap lessons only/.test(system) && /For other actions, answer directly/.test(system))
  ok('prediction prompts request brief visible calculations, not private chain of thought', /brief calculation/.test(system) && /Do not provide private chain-of-thought/.test(system))

  const base = {
    mode: 'code',
    languageId: 'python',
    actionId: 'explain',
    level: 'beginner',
    problemStatement: 'Find the bug',
    code: 'def f():\n    pass\n',
  }
  const explain = prompts.buildAnalysisMessages(base)
  ok('code prompt embeds the code in a python fence', explain.user.includes('```python') && explain.user.includes('def f()'))
  ok('code prompt states the code was not executed', /NOT been executed/.test(explain.user))
  ok('code prompt includes the practice task', explain.user.includes('Find the bug'))
  ok('code prompt includes the difficulty', /beginner/i.test(explain.user))

  ok('explanations request numbered steps', explain.user.includes('### Step 1'))
  const roadmap = prompts.buildAnalysisMessages({ ...base, actionId: 'roadmap' })
  const roadmapLesson = prompts.buildAnalysisMessages({
    ...base,
    actionId: 'roadmap',
    roadmapCurrentTopic: 'Introduction',
    roadmapPrerequisites: [],
    roadmapNextTopics: ['Learn SQL', 'Excel', 'Tableau'],
  })
  ok('roadmap prompt uses an Understand Anything graph approach', /Understand Anything/.test(roadmap.system) && /prerequisites, meaning, and next choices/.test(roadmap.system) && /supplied next-topic choices/.test(roadmap.user))
  ok('roadmap prompt scopes the lesson to the selected topic and graph branches', roadmapLesson.user.includes('Introduction') && roadmapLesson.user.includes('Learn SQL') && roadmapLesson.user.includes('one brief knowledge-check question'))
  ok('roadmap does not claim learner completion before confirmation', /Do not claim completion/.test(roadmapLesson.user))
  ok('roadmap lessons give self-contained do / avoid / completion guidance', /Do \/ avoid/.test(roadmapLesson.user) && /Ready when/.test(roadmapLesson.user) && /about 150 words/.test(roadmapLesson.user))
  ok('roadmap lesson prompt suppresses external roadmap links', /Never provide external roadmap links/.test(roadmap.system) && /never link to an external roadmap/i.test(roadmapLesson.user))
  const improve = prompts.buildAnalysisMessages({ ...base, actionId: 'improve' })
  ok('improve prompt asks for one fenced replacement', /ONE fenced code block/.test(improve.user))
  const predict = prompts.buildAnalysisMessages({ ...base, actionId: 'predict-output' })
  ok('predict-output prompt demands an AI-estimate label', /AI estimate/.test(predict.user) && /not executed/i.test(predict.user))
  ok('predict-output prompt bounds reasoning to a brief trace', /under 100 words/i.test(predict.user) && /do not claim the program was run/i.test(predict.user))
  const bugs = prompts.buildAnalysisMessages({ ...base, actionId: 'find-bugs' })
  ok('find-bugs prompt asks for one concise high-confidence finding', /only the most important high-confidence bug/i.test(bugs.user) && /no more than two short sentences/i.test(bugs.user))

  const sql = prompts.buildAnalysisMessages({
    mode: 'sql',
    languageId: 'sql',
    actionId: 'predict-result',
    level: 'advanced',
    problemStatement: 'Top customers',
    code: 'SELECT 1;',
    sqlDialect: 'sqlite',
    schemaText: 'CREATE TABLE customers (id INTEGER);',
  })
  ok('sql prompt includes dialect + schema text', sql.user.includes('sqlite') && sql.user.includes('CREATE TABLE customers'))
  ok('sql prompt marks query as not executed', /NOT been executed/.test(sql.user))

  const excel = prompts.buildAnalysisMessages({
    mode: 'excel',
    languageId: 'excel-formulas',
    actionId: 'explain-formula',
    level: 'intermediate',
    problemStatement: 'Explain the totals',
    code: '',
    sheetDump: 'A1\tB1\nTotal\t=SUM(B2:B6)',
    selectionAddress: 'B8',
    selectionValue: '=SUM(E2:E6)',
  })
  ok('excel prompt includes raw sheet text + selection', excel.user.includes('=SUM(B2:B6)') && excel.user.includes('B8'))
  ok('excel prompt states no recalculation happened', /no recalculation has happened/i.test(excel.user))

  let threwUnknown = false
  try {
    prompts.buildAnalysisMessages({ ...base, actionId: 'run-code' })
  } catch (err) {
    threwUnknown = err instanceof Error && /Unknown analysis action/.test(err.message)
  }
  ok('unknown action is rejected by the prompt builder', threwUnknown)

  let threwMismatch = false
  try {
    prompts.buildAnalysisMessages({ ...base, mode: 'excel', actionId: 'improve' })
  } catch (err) {
    threwMismatch = err instanceof Error && /does not apply/.test(err.message)
  }
  ok('mode/action mismatch is rejected', threwMismatch)

  const long = prompts.buildAnalysisMessages({ ...base, code: 'x'.repeat(30000) })
  ok('long content is clamped with an explicit truncation note', long.user.includes('truncated to 24000 characters'))
  ok('long content is actually shorter than the raw input', long.user.length < 30000)
}

section('Roadmap graph selection and opt-in contract')

{
  const resolved = await roadmapLibrary.resolveRoadmap('data-analyst')
  ok('Data Analyst roadmap is available from the local graph library', Boolean(resolved?.roadmap.nodes.length && resolved.roadmap.edges.length))
  ok('roadmap begins at Introduction when that topic exists', roadmapLibrary.roadmapStartingNode(resolved.roadmap)?.label === 'Introduction')
  ok('roadmap teaching context is self-contained and omits external URLs', !/https?:\/\//i.test(resolved.context) && !/roadmap\.sh/i.test(resolved.context))
  ok('a selected external branch resolves only to its locally cached roadmap', await roadmapLibrary.roadmapChoiceTarget('data-analyst', 'Learn SQL') === 'sql')
  ok('content-node projection filters visual layout spacers', roadmapLibrary.roadmapContentNodes(resolved.roadmap).every((node) => !['horizontal', 'vertical', 'paragraph', 'button'].includes(node.type)))
  ok('learner branch names resolve against actual graph nodes', roadmapLibrary.roadmapNodeForReply(resolved.roadmap, 'Excel')?.label.toLowerCase().includes('excel'))
  const overview = roadmapLibrary.roadmapTopicNeighborhood(resolved.roadmap, roadmapLibrary.roadmapStartingNode(resolved.roadmap).id)
  ok('roadmap neighborhood reports linked next topics', overview.next.length > 0)
  const intro = roadmapLibrary.roadmapStartingNode(resolved.roadmap)
  const introChoices = roadmapLibrary.roadmapLessonChoices(resolved.roadmap, intro.id)
  const lessonContext = roadmapLibrary.roadmapLessonContext(resolved.roadmap, intro.id, introChoices)
  ok('Data Analyst introduction offers SQL, Excel and Tableau branch choices', introChoices.join(', ') === 'Learn SQL, Excel, Tableau')
  ok('roadmap model context is limited to one lesson and its choices', lessonContext.length < 1200 && lessonContext.includes('Introduction') && lessonContext.includes('Learn SQL'))
  ok('focused lesson context contains no external URLs', !/https?:\/\//i.test(lessonContext) && !/roadmap\.sh/i.test(lessonContext))
}

// ── 6. Suggestion extraction ────────────────────────────────────────────────

section('Suggestion extraction (area 7)')

{
  ok('extracts a fenced code block', extract.extractCodeSuggestion('noise\n```python\nx = 1\ny = 2\n```\ntail') === 'x = 1\ny = 2')
  ok('extracts a fence without language', extract.extractCodeSuggestion('```\nplain\n```') === 'plain')
  ok('returns null when no fence exists', extract.extractCodeSuggestion('just prose, no code') === null)
  ok('ignores whitespace-only fences', extract.extractCodeSuggestion('```\n   \n```') === null)
  ok('extracts a formula from a fenced block', extract.extractFormulaSuggestion('fix:\n```\n=XLOOKUP(MAX(E2:E6),E2:E6,B2:B6)\n```') === '=XLOOKUP(MAX(E2:E6),E2:E6,B2:B6)')
  ok('extracts a bare formula line', extract.extractFormulaSuggestion('Use this instead:\n=SUM(A1:A9) please') === '=SUM(A1:A9)')
  ok('returns null when no formula exists', extract.extractFormulaSuggestion('no formula here') === null)
}

// ── 7. Store: round-trip, caps, sanitisation, quarantine, isolation ────────

section('Session store — CRUD, caps, sanitisation, isolation (areas 8, 14, 16)')

const sessionPayload = (id, extra = {}) => ({
  id,
  name: `Practice ${id}`,
  mode: 'code',
  languageId: 'python',
  level: 'intermediate',
  problemStatement: 'Find and fix the bug in the average function.',
  code: 'def average(numbers):\n    return sum(numbers) / len(numbers)\n',
  sheet: null,
  modelPreference: '',
  starterId: 'py-average-bug',
  starterCode: 'def average(numbers):\n    pass\n',
  starterSheet: null,
  feedback: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...extra,
})

{
  const file = store.playgroundStorePath()
  ok('store file is <db>/playground.json', file.endsWith(`${path.sep}playground.json`))
  ok('store file resolves inside the isolated temp DB', file.startsWith(DB_DIR))

  const a = await store.saveSession(sessionPayload('save-roundtrip-a'))
  ok('save returns ok with the stored session', a.ok === true && a.session.id === 'save-roundtrip-a')
  const roadmapState = {
    selectedSlug: 'data-analyst',
    conversationSlug: 'sql',
    currentTopicId: 'select-basics',
    currentTopicLabel: 'SELECT basics',
    completedTopics: { 'data-analyst': ['intro', 'excel'], sql: ['intro', 'select-basics'] },
    conversation: [
      { role: 'assistant', content: 'Learn the selected SQL topic.' },
      { role: 'user', content: 'I understand. Continue.' },
    ],
  }
  await store.saveSession(sessionPayload('roadmap-roundtrip', { roadmapProgress: roadmapState }))
  const roadmapLoaded = (await store.listSessions()).sessions.find((item) => item.id === 'roadmap-roundtrip')
  ok('roadmap lesson, topic and completion state survive save/load', JSON.stringify(roadmapLoaded?.roadmapProgress) === JSON.stringify(roadmapState))
  const roadmapSanitized = await store.saveSession(sessionPayload('roadmap-sanitize', { roadmapProgress: {
    ...roadmapState,
    selectedSlug: '../outside',
    completedTopics: { '../escape': ['good'], sql: ['valid', 'bad/id'] },
    conversation: [...roadmapState.conversation, { role: 'system', content: 'not a learner turn' }, { role: 'assistant', content: 'x'.repeat(5000) }],
  } }))
  const safeRoadmap = roadmapSanitized.session.roadmapProgress
  ok('roadmap progress drops invalid slugs, ids and roles and clamps message size', safeRoadmap?.selectedSlug === '' && !Object.hasOwn(safeRoadmap.completedTopics, '../escape') && safeRoadmap.completedTopics.sql.length === 1 && safeRoadmap.conversation.length === 3 && safeRoadmap.conversation[2].content.length === 4000)
  await new Promise((r) => setTimeout(r, 5))
  const b = await store.saveSession(sessionPayload('save-roundtrip-b'))
  ok('second save succeeds', b.ok === true)
  const list = await store.listSessions()
  ok('list returns saved sessions, newest first', list.sessions.length === 4 && list.sessions[0].id === 'save-roundtrip-b')
  ok('sessions carry createdAt/updatedAt ISO timestamps', /^\d{4}-\d{2}-\d{2}T/.test(list.sessions[0].createdAt) && /^\d{4}-\d{2}-\d{2}T/.test(list.sessions[0].updatedAt))

  const before = list.sessions.find((s) => s.id === 'save-roundtrip-a').createdAt
  const again = await store.saveSession(sessionPayload('save-roundtrip-a', { name: 'Renamed by save' }))
  ok('re-saving keeps the original createdAt', again.session.createdAt === before && again.session.name === 'Renamed by save')

  const renamed = await store.renameSession('save-roundtrip-a', 'New name')
  ok('rename updates the name', renamed.ok === true && renamed.session.name === 'New name')
  const renameMissing = await store.renameSession('no-such-id', 'x')
  ok('rename of a missing session fails cleanly', renameMissing.ok === false)

  const del = await store.deleteSession('save-roundtrip-b')
  ok('delete removes the session', del.ok === true && del.deleted === true)
  const delAgain = await store.deleteSession('save-roundtrip-b')
  ok('deleting twice is idempotent', delAgain.ok === true && delAgain.deleted === false)
  const afterDelete = await store.listSessions()
  ok('deleted session is gone from the list', !afterDelete.sessions.some((s) => s.id === 'save-roundtrip-b'))

  // Sanitisation: mode is derived from the language registry, not trusted.
  const lied = await store.saveSession(sessionPayload('mode-lie', { mode: 'excel', languageId: 'sql' }))
  ok('mode is derived from the language (payload lie corrected)', lied.session.mode === 'sql')
  const sheetOnSql = await store.saveSession(
    sessionPayload('sheet-drop', { languageId: 'python', sheet: { name: 'x', columns: 5, rows: 5, cells: { A1: 'keepme' } } }),
  )
  ok('sheet content is stored only as provided (sparse raw text)', sheetOnSql.session.sheet.cells.A1 === 'keepme')

  const longCode = await store.saveSession(sessionPayload('long-code', { code: 'y'.repeat(300000) }))
  ok('oversized code is clamped to the cap', longCode.session.code.length === types.PLAYGROUND_MAX_CODE_CHARS)
  const manyFeedback = await store.saveSession(
    sessionPayload('many-feedback', {
      feedback: Array.from({ length: 25 }, (_, i) => ({
        id: `fb-${i}`,
        actionId: 'explain',
        actionLabel: 'Explain',
        at: new Date().toISOString(),
        status: 'ok',
        text: `answer ${i}`,
      })),
    }),
  )
  ok('feedback history is capped at 20 entries', manyFeedback.session.feedback.length === types.PLAYGROUND_MAX_FEEDBACK)
  const weirdSheet = await store.saveSession(
    sessionPayload('weird-sheet', {
      languageId: 'excel-formulas',
      sheet: { name: '', columns: 999, rows: -4, cells: { '../evil': 'x', 'A1': 'ok', Z9: '' } },
    }),
  )
  ok(
    'sheet bounds are clamped and invalid addresses dropped',
    weirdSheet.session.sheet.columns <= 26 &&
      weirdSheet.session.sheet.rows >= 1 &&
      Object.keys(weirdSheet.session.sheet.cells).every((k) => /^[A-Z]{1,2}\d{1,3}$/.test(k)) &&
      weirdSheet.session.sheet.cells.A1 === 'ok',
  )
  const blank = await store.saveSession(sessionPayload('blank-name', { name: '   ' }))
  ok('blank name falls back to "Untitled practice"', blank.session.name === 'Untitled practice')
  const badId = await store.saveSession({ ...sessionPayload('ok-id'), id: '../etc/passwd' })
  ok('path-like session ids are rejected', badId.ok === false)
  const notObject = await store.saveSession('nope')
  ok('non-object payloads are rejected', notObject.ok === false)

  // Cap: at most 100 sessions are kept.
  for (let i = 0; i < 105; i++) {
    await store.saveSession(sessionPayload(`cap-${i}`))
  }
  const capped = await store.listSessions()
  ok('session count is capped at 100', capped.sessions.length === types.PLAYGROUND_MAX_SESSIONS)

  // Isolation: the playground only ever writes its own file.
  const files = await fs.readdir(DB_DIR)
  ok('practice writes add only playground.json beside the prepared roadmap fixture', files.sort().join(',') === 'playground.json,roadmaps')
  ok('practice storage leaves the cached roadmap bytes untouched', JSON.parse(await fs.readFile(path.join(DB_DIR, 'roadmaps', 'data-analyst.json'), 'utf8')).nodes.length === analystFixture.nodes.length)

  // Persisted shape on disk.
  const raw = JSON.parse(await fs.readFile(store.playgroundStorePath(), 'utf-8'))
  ok('store file has version/updatedAt/sessions shape', raw.version === 1 && typeof raw.updatedAt === 'string' && Array.isArray(raw.sessions))
  ok('stored sessions never contain a tools/messages field', raw.sessions.every((s) => !('tools' in s) && !('messages' in s)))
}

// ── 7b. Result selection: one current result, stale never adopted ──────────

section('Current result selection — latest action wins, history kept (areas 2, 13)')

{
  const mk = (id, actionId, label, at, text = 'ok') => ({
    id, actionId, actionLabel: label, at, status: 'ok', text,
  })

  // A completed request that has been superseded is stale and must be dropped.
  ok('a superseded (stale) result is detected', feedbackLib.isStaleResult(1, 2) === true && feedbackLib.isStaleResult(2, 2) === false)

  // Sequence: Predict output → Find bugs → Explain. The active result must
  // always be the response to the most recent completed request.
  const t0 = '2026-01-01T00:00:00.000Z'
  let entries = []
  entries = feedbackLib.prependFeedback(entries, mk('r1', 'predict-output', 'Predict output', t0))
  let activeId = 'r1'
  ok('after Predict output the active result is the prediction', feedbackLib.activeFeedback(entries, activeId).actionId === 'predict-output')
  entries = feedbackLib.prependFeedback(entries, mk('r2', 'find-bugs', 'Find bugs', '2026-01-01T00:00:05.000Z'))
  activeId = 'r2'
  ok('after Find bugs the active result replaces the prediction', feedbackLib.activeFeedback(entries, activeId).actionId === 'find-bugs')
  entries = feedbackLib.prependFeedback(entries, mk('r3', 'explain', 'Explain', '2026-01-01T00:00:10.000Z'))
  activeId = 'r3'
  const active = feedbackLib.activeFeedback(entries, activeId)
  ok('after Explain the active result is the explanation', active.actionId === 'explain')
  ok('earlier results are retained as history, newest first', entries.length === 3 && entries[0].id === 'r3' && entries[2].id === 'r1')
  ok('exactly one result is active at a time', feedbackLib.activeFeedback(entries, activeId).id === 'r3')

  // Selecting an older entry via the history menu shows that one — not a stack.
  ok('history selection shows the chosen older result', feedbackLib.activeFeedback(entries, 'r1').actionId === 'predict-output')

  // A stale response (older seq) must not be adopted even though it arrived.
  const staleSeq = 1
  const latestSeq = 2
  ok('a late response from a superseded request is rejected', feedbackLib.isStaleResult(staleSeq, latestSeq) === true)
  // Stale results are never recorded: the head still belongs to the newest.
  ok('the active result tracks its own action and timestamp', active.actionId === 'explain' && active.at === '2026-01-01T00:00:10.000Z')

  // Cap behaviour is unchanged (history, not the current view).
  let capped = []
  for (let i = 0; i < types.PLAYGROUND_MAX_FEEDBACK + 5; i++) {
    capped = feedbackLib.prependFeedback(capped, mk(`c${i}`, 'explain', 'Explain', t0))
  }
  ok('history stays capped at PLAYGROUND_MAX_FEEDBACK', capped.length === types.PLAYGROUND_MAX_FEEDBACK)

  // Empty history has no active result.
  ok('no entries → no active result', feedbackLib.activeFeedback([], null) === null)
}

// ── 8. API route: models, CRUD, analyze, errors ────────────────────────────

section('API route — sessions, models, analysis, offline behaviour (areas 1, 8, 9, 10, 11, 13)')

const providerOwned = { value: false }
let providerServer = null

{
  // CRUD over the real route.
  const save = await post({ action: 'save', session: sessionPayload('route-save', { name: 'Route practice' }) })
  ok('POST save returns the stored session', save.status === 200 && save.json?.ok === true && save.json.session.id === 'route-save')
  const list = await get('sessions')
  ok('GET sessions lists the saved practice', list.status === 200 && list.json.sessions.some((s) => s.id === 'route-save'))
  const rename = await post({ action: 'rename', id: 'route-save', name: 'Route renamed' })
  ok('POST rename works over the route', rename.status === 200 && rename.json.session.name === 'Route renamed')
  const del = await post({ action: 'delete', id: 'route-save' })
  ok('POST delete works over the route', del.status === 200 && del.json.deleted === true)

  const unknown = await post({ action: 'launch-missiles' })
  ok('unknown POST action is rejected', unknown.status === 400 && unknown.json?.ok === false)
  const badJson = await route.POST(
    new NextRequest('http://localhost/api/playground', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost' }, body: '{nope' }),
  )
  ok('invalid JSON body is rejected', badJson.status === 400)

  const evilGet = await get('sessions', { headers: { origin: 'https://evil.example' } })
  ok('cross-origin GET is rejected', evilGet.status === 403)
  const evilPost = await post({ action: 'delete', id: 'x' }, { headers: { origin: 'https://evil.example' } })
  ok('cross-origin POST is rejected', evilPost.status === 403)

  const roadmapOff = await post({ action: 'analyze', mode: 'code', languageId: 'python', actionId: 'roadmap', level: 'beginner', problemStatement: '', code: '', model: 'mock-model', roadmapEnabled: false })
  ok('roadmap tutor API refuses to run while Roadmap is off', roadmapOff.status === 409 && /Turn Roadmap on/.test(roadmapOff.json?.error ?? ''))
  const visualOff = await get('roadmap&slug=data-analyst')
  ok('roadmap visualization API refuses to load while Roadmap is off', visualOff.status === 409)
  const visualOn = await get('roadmap&slug=data-analyst&enabled=true')
  ok('enabled roadmap visualization returns the full local graph', visualOn.status === 200 && visualOn.json?.roadmap?.nodes?.length > 100 && visualOn.json?.roadmap?.edges?.length > 0)
  ok('visual graph payload contains no external node URLs', visualOn.json?.roadmap?.nodes?.every((node) => !node.href))

  // Baseline: does this machine have a real local provider? (offline checks
  // only make sense when there is none — and the mock port is free.)
  providerServer = await startMockProvider()
  providerOwned.value = Boolean(providerServer)
}

if (providerOwned.value) {
  const models = await get('models')
  ok('GET models returns the mock provider inventory', models.status === 200 && models.json.models.some((m) => m.id === 'mock-model' && m.kind === 'local'))
  ok('model inventory never exposes API keys', !JSON.stringify(models.json).includes('apiKey'))

  const analyze = await post({
    action: 'analyze',
    mode: 'code',
    languageId: 'python',
    actionId: 'improve',
    level: 'beginner',
    problemStatement: 'Fix the off-by-one bug.',
    code: 'def average(numbers):\n    return sum(numbers) / len(numbers)\n',
    model: 'mock-model',
  })
  ok('analyze returns the model response', analyze.status === 200 && analyze.json?.ok === true && analyze.json.text.includes('PLAYGROUND-OK'))
  ok('analyze reports which model answered', typeof analyze.json.model === 'string' && analyze.json.model.length > 0)
  ok('non-estimated action is not flagged estimated', analyze.json.estimated === false)
  const sent = providerRequests.length > 0 ? JSON.parse(providerRequests[providerRequests.length - 1]) : null
  ok('provider request carries exactly system+user messages', Array.isArray(sent?.messages) && sent.messages.length === 2 && sent.messages[0].role === 'system' && sent.messages[1].role === 'user')
  ok('provider request includes NO tools/functions (no execution surface)', sent && !('tools' in sent) && !('functions' in sent))
  ok('provider request streams internally while Playground returns a collected answer', sent?.stream === true && sent?.model === 'mock-model')
  ok('system prompt reaches the provider intact', sent.messages[0].content.includes('Never claim or imply that code ran'))

  const roadmapStart = await post({
    action: 'analyze', mode: 'code', languageId: 'python', actionId: 'roadmap', level: 'beginner',
    problemStatement: '', code: '', model: 'mock-model', roadmapEnabled: true, roadmapSlug: 'data-analyst', roadmapHistory: [], roadmapReply: '',
  })
  ok('roadmap starts only after explicit opt-in and chooses Introduction', roadmapStart.status === 200 && roadmapStart.json.roadmapTopicLabel === 'Introduction' && typeof roadmapStart.json.roadmapTopicId === 'string')
  ok('roadmap response always shows all local branch choices', ['Learn SQL', 'Excel', 'Tableau'].every((choice) => roadmapStart.json.text.includes(choice)))
  const roadmapRequest = providerRequests.length ? JSON.parse(providerRequests[providerRequests.length - 1]) : null
  const roadmapSqlChoice = await post({
    action: 'analyze', mode: 'code', languageId: 'python', actionId: 'roadmap', level: 'beginner',
    problemStatement: '', code: '', model: 'mock-model', roadmapEnabled: true, roadmapSlug: 'data-analyst',
    roadmapHistory: [{ role: 'assistant', content: roadmapStart.json.text }], roadmapReply: 'Learn SQL', roadmapCurrentTopicId: roadmapStart.json.roadmapTopicId,
  })
  ok('choosing Learn SQL switches teaching to the local SQL roadmap', roadmapSqlChoice.status === 200 && roadmapSqlChoice.json.roadmapSlug === 'sql' && Boolean(roadmapSqlChoice.json.roadmapTopicLabel))
  const roadmapExcelChoice = await post({
    action: 'analyze', mode: 'code', languageId: 'python', actionId: 'roadmap', level: 'beginner',
    problemStatement: '', code: '', model: 'mock-model', roadmapEnabled: true, roadmapSlug: 'data-analyst',
    roadmapHistory: [{ role: 'assistant', content: roadmapStart.json.text }], roadmapReply: 'Excel', roadmapCurrentTopicId: roadmapStart.json.roadmapTopicId,
  })
  ok('choosing Excel follows the matching topic in the local Data Analyst graph', roadmapExcelChoice.status === 200 && roadmapExcelChoice.json.roadmapSlug === 'data-analyst' && roadmapExcelChoice.json.roadmapTopicLabel === 'Excel')
  ok('roadmap generation sends a compact graph neighborhood, not the full roadmap', roadmapRequest?.messages?.[1]?.content.includes('Choices to offer after this lesson: Learn SQL · Excel · Tableau') && roadmapRequest.messages[1].content.length < 3000)
  ok('roadmap generation allows the bounded response budget for a concise local lesson', roadmapRequest?.max_tokens === 2800)

  const predict = await post({
    action: 'analyze',
    mode: 'code',
    languageId: 'python',
    actionId: 'predict-output',
    level: 'beginner',
    problemStatement: 'What would this print?',
    code: 'print("hi")\n',
    model: 'mock-model',
  })
  ok('predict-output response is flagged as an AI estimate', predict.json?.estimated === true)
  const predictRequest = providerRequests.length ? JSON.parse(providerRequests[providerRequests.length - 1]) : null
  ok('predict-output keeps a compact bounded response budget', predictRequest?.max_tokens === 1000)

  await post({
    action: 'analyze', mode: 'code', languageId: 'python', actionId: 'find-bugs', level: 'beginner',
    problemStatement: 'Name one high-confidence bug.', code: 'print(1 / 0)', model: 'mock-model',
  })
  const bugRequest = providerRequests.length ? JSON.parse(providerRequests[providerRequests.length - 1]) : null
  ok('find-bugs keeps enough bounded output for reliable local-model answers', bugRequest?.max_tokens === 3000)

  const sugg = extract.extractCodeSuggestion(analyze.json.text)
  ok('a suggestion can be extracted from the real response', sugg === 'print("suggested")')

  const mismatch = await post({
    action: 'analyze',
    mode: 'excel',
    languageId: 'excel-formulas',
    actionId: 'improve',
    level: 'beginner',
    problemStatement: '',
    code: '',
    model: 'mock-model',
  })
  ok('route rejects mode/action mismatch', mismatch.status === 400)

  const unknownAction = await post({ action: 'analyze', mode: 'code', languageId: 'python', actionId: 'run-it', level: 'beginner', problemStatement: '', code: 'x', model: 'mock-model' })
  ok('route rejects unknown analysis actions', unknownAction.status === 400)
} else {
  skip('provider-backed analyse/model checks', 'port 1234 already in use (real LM Studio or another process)')
}

{
  // Deterministic unreachable-model error: must never fabricate an answer and
  // must never silently fall back to another model.
  const ghost = await post({
    action: 'analyze',
    mode: 'code',
    languageId: 'python',
    actionId: 'explain',
    level: 'beginner',
    problemStatement: '',
    code: 'print(1)\n',
    model: 'definitely-not-a-real-model-xyz',
  })
  ok('unknown requested model fails loudly', ghost.status === 502 && ghost.json?.ok === false)
  ok('failure response contains NO fabricated text', !('text' in (ghost.json ?? {})))
  ok('failure message explains the situation', /not found on any reachable local provider/.test(ghost.json?.error ?? ''), ghost.json?.error)

  if (!providerOwned.value) {
    skip('provider-offline auto analyse', 'port 1234 unavailable')
  } else {
    // Close the mock and try again: no provider anywhere → clear error, no fabrication.
    await new Promise((resolve) => providerServer.close(resolve))
    const offline = await post({
      action: 'analyze',
      mode: 'code',
      languageId: 'python',
      actionId: 'explain',
      level: 'beginner',
      problemStatement: '',
      code: 'print(1)\n',
      model: '',
    })
    const hasRealProvider = offline.status === 200
    if (hasRealProvider) {
      skip('provider-offline auto analyse', 'a real local provider answered on this machine')
    } else {
      ok('offline analyse returns a clear failure', offline.status === 502 && offline.json?.ok === false)
      ok('offline failure fabricates no text', !('text' in (offline.json ?? {})))
      ok('offline failure tells the user what to do', /No LLM provider available|preserved|reached/i.test(offline.json?.error ?? ''), offline.json?.error)
    }
  }
}

// ── 8b. Split layout helpers — floors, clamps, persistence ─────────────────

section('Split layout helpers — floors, clamps, persistence')

{
  ok('default split keeps the editor dominant (~58 / 42)', splitLayout.DEFAULT_RESPONSE_SHARE === 0.42)
  ok('share clamps to the 25–62% range', splitLayout.clampResponseShare(-1) === 0.25 && splitLayout.clampResponseShare(2) === 0.62)
  ok('non-finite share falls back to the default', splitLayout.clampResponseShare(Number.NaN) === splitLayout.DEFAULT_RESPONSE_SHARE)
  ok('keyboard step is exact and stays clamped', splitLayout.stepResponseShare(0.42, 0.04) === 0.46 && splitLayout.stepResponseShare(0.6, 0.04) === 0.62 && splitLayout.stepResponseShare(0.3, -0.1) === 0.25)
  ok('side-by-side is a measured-width decision (820px workspace)', !splitLayout.isSideBySideWidth(0) && !splitLayout.isSideBySideWidth(819) && splitLayout.isSideBySideWidth(820))
  ok(
    'grid template floors BOTH panes (they can never go to zero or content-width)',
    splitLayout.splitGridTemplate(0.42) === 'minmax(340px, 58fr) 12px minmax(360px, 42fr)' &&
      splitLayout.splitGridTemplate(0.25) === 'minmax(340px, 75fr) 12px minmax(360px, 25fr)' &&
      splitLayout.splitGridTemplate(0.62) === 'minmax(340px, 38fr) 12px minmax(360px, 62fr)',
  )
  ok('pixel floors + divider fit under the threshold (no grid overflow possible)', splitLayout.MIN_EDITOR_PANE_PX + splitLayout.MIN_RESPONSE_PANE_PX + splitLayout.DIVIDER_COLUMN_PX <= splitLayout.SPLIT_SIDE_BY_SIDE_MIN)
  ok('storage helpers survive a missing window (SSR / Node)', splitLayout.loadResponseShare() === splitLayout.DEFAULT_RESPONSE_SHARE)
  ok('saving without storage is a safe no-op', splitLayout.saveResponseShare(0.5) === undefined)
  ok('external store read is stable across calls', splitLayout.getResponseShare() === splitLayout.getResponseShare())
  let notified = false
  const unsubscribe = splitLayout.subscribeResponseShare(() => {
    notified = true
  })
  splitLayout.saveResponseShare(0.5)
  unsubscribe()
  ok('saving notifies subscribers and updates the readable share', notified && splitLayout.getResponseShare() === 0.5)
  ok('server snapshot stays deterministic (default share)', splitLayout.getServerResponseShare() === splitLayout.DEFAULT_RESPONSE_SHARE)
}

// ── 9. Static non-execution sweep (code + UI contract) ─────────────────────

section('Static sweep — no execution, no run UI, responsive contract (areas 1, 2, 5, 7, 12, 15)')

{
  const sources = {
    view: await readSource('src/components/agent-hub/playground-view.tsx'),
    teachPrompt: await readSource('src/lib/agent-hub/teach-prompt.ts'),
    editor: await readSource('src/components/agent-hub/playground/code-editor.tsx'),
    langs: await readSource('src/components/agent-hub/playground/code-editor-langs.ts'),
    grid: await readSource('src/components/agent-hub/playground/excel-grid.tsx'),
    feedback: await readSource('src/components/agent-hub/playground/feedback-panel.tsx'),
    roadmapTutor: await readSource('src/components/agent-hub/playground/roadmap-tutor-panel.tsx'),
    roadmapVisual: await readSource('src/components/agent-hub/playground/roadmap-diorama.tsx'),
    route: await readSource('src/app/api/playground/route.ts'),
    store: await readSource('src/lib/agent-hub/playground-store.ts'),
    shell: await readSource('src/components/agent-hub/shell.tsx'),
    types: await readSource('src/lib/agent-hub/types.ts'),
  }
  const all = Object.values(sources).join('\n')
  const forbidden = ['child_process', 'execSync', 'execFile', 'spawn(', 'eval(', 'new Function', 'vm.runInThisContext', 'agent-session/exec', '/api/agent-session/exec']
  for (const token of forbidden) {
    ok(`no "${token}" anywhere in the playground sources`, !all.includes(token))
  }
  ok('no Run/Execute/Compile action button exists', !/data-action="(run|execute|compile)/.test(sources.view) && !/label: '(Run|Execute|Compile)'/.test(sources.view))

  ok('shell NAV links the Playground view', /id: 'playground'/.test(sources.shell) && /label: 'Playground'/.test(sources.shell))
  ok('shell renders <PlaygroundView />', sources.shell.includes('<PlaygroundView />'))
  ok('playground is a full-height view in the shell', sources.shell.includes("FULL_HEIGHT_VIEWS: ViewId[] = ['chat', 'sessions', 'playground']") || /FULL_HEIGHT_VIEWS[^\n]*playground/.test(sources.shell))
  ok('ViewId union includes playground', /'playground'/.test(sources.types))

  ok('editor is real CodeMirror (basicSetup import)', sources.editor.includes("import('codemirror')") && sources.editor.includes('basicSetup'))
  ok('editor exposes setValue with history control for undo', sources.editor.includes('Transaction.addToHistory.of(false)') && sources.view.includes('{ history: true }'))
  ok('editor loads per-language extensions lazily', sources.langs.includes("@codemirror/lang-python") && sources.langs.includes("@codemirror/lang-sql") && sources.langs.includes("@codemirror/lang-javascript"))
  ok('JSX/TSX highlighting enabled for JS/TS', sources.langs.includes('jsx: true, typescript: true'))
  ok('legacy stream modes used for C#/Bash/PowerShell', sources.langs.includes('legacy-modes/mode/clike') && sources.langs.includes('legacy-modes/mode/shell') && sources.langs.includes('legacy-modes/mode/powershell'))

  ok('toolbar exposes language/level/model selectors', sources.view.includes('data-testid="language-select"') && sources.view.includes('data-testid="level-select"') && sources.view.includes('data-testid="model-select"'))
  ok('toolbar shows the no-execution chip', sources.view.includes('AI practice · no code execution'))
  ok('SQL mode has a dialect selector and collapsible schema panel', sources.view.includes('data-testid="dialect-select"') && sources.view.includes('data-testid="schema-panel"') && sources.view.includes('Sample schema'))
  ok('Excel mode has a workbook selector and grid workspace', sources.view.includes('data-testid="workbook-select"') && sources.view.includes('data-testid="excel-workspace"'))
  ok('grid exposes formula bar + selected cell indicator', sources.grid.includes('data-testid="excel-formula-bar"') && sources.grid.includes('data-testid="excel-selected-cell"'))
  ok('grid renders column letters and row numbers', sources.grid.includes('colLetter(') && sources.grid.includes('row + 1'))
  ok('grid scrolls horizontally for wide sheets', sources.grid.includes('overflow-auto'))
  ok('apply-suggestion button contract exists', sources.feedback.includes('data-apply-suggestion'))
  ok('feedback has empty + busy states', sources.feedback.includes('data-testid="feedback-empty"') && sources.feedback.includes('data-testid="feedback-busy"'))
  ok('estimated entries render an "AI estimate — not executed" chip', sources.feedback.includes('AI estimate — not executed'))
  ok('analysis-only label rendered in feedback panel', sources.feedback.includes('ANALYSIS_LABELS[mode]'))
  ok('excel grid renders the formula-analysis-only label', sources.grid.includes('ANALYSIS_LABELS.excel'))
  ok('workspace always keeps the split layout', sources.view.includes('data-workspace-mode="split"') && !sources.view.includes('setWorkspaceMode'))
  ok('layout switcher is removed', !sources.view.includes('data-testid="workspace-mode-code"') && !sources.view.includes('data-testid="workspace-mode-response"'))
  ok('only the active result renders (no stacked cards)', sources.feedback.includes('data-testid="feedback-active"') && sources.feedback.includes('activeFeedback(entries, activeId)') && sources.feedback.includes('data-feedback-entry={active.id}'))
  ok('stale responses are superseded (sequence guard + AbortController)', sources.view.includes('requestSeqRef') && sources.view.includes('AbortController') && sources.view.includes('isStaleResult(') && /seq !== requestSeqRef\.current/.test(sources.view))
  ok('the active result records its action + latest response time', sources.feedback.includes('data-active-action={active.actionId}') && sources.feedback.includes('data-active-at={active.at}'))
  ok('earlier results stay reachable via a compact history menu', sources.feedback.includes('data-testid="feedback-history-toggle"') && sources.feedback.includes('data-testid="feedback-history"') && sources.feedback.includes('data-history-entry='))
  ok(
    'Split keeps editor + result side by side on wide, measured canvases',
    sources.view.includes("sideBySide ? 'grid' : 'flex flex-col'") &&
      sources.view.includes('gridTemplateColumns: splitGridTemplate(splitShare)') &&
      sources.view.includes("data-split-layout={sideBySide ? 'columns' : 'stacked'}") &&
      sources.view.includes('min-h-0 min-w-0 flex-col gap-2'),
  )
  ok('Save + Reset actions exist under the editor', sources.view.includes('data-testid="save-button"') && sources.view.includes('data-testid="reset-button"'))
  ok('roadmap toggle is opt-in and guards the tutor action', sources.view.includes('data-testid="roadmap-enabled-toggle"') && /spec\.id === 'roadmap' && !roadmapEnabled/.test(sources.view) && /spec\.id === 'roadmap' && !roadmapEnabled/.test(sources.view))
  ok('Teach mode uses Understand Anything concept relationships for arbitrary topics', sources.teachPrompt.includes('UNDERSTAND ANYTHING CONCEPT-GRAPH METHOD') && sources.teachPrompt.includes('For every topic'))
  ok('topic completion opens a Dioramas visual and allows continuing', sources.roadmapTutor.includes('data-testid="roadmap-complete-topic"') && sources.roadmapVisual.includes('data-testid="roadmap-diorama"') && sources.roadmapVisual.includes('data-testid="roadmap-continue-topic"'))
  ok('visual graph supports search, relationships and the do/avoid lesson guide without external links', sources.roadmapVisual.includes('roadmap-topic-search') && sources.roadmapVisual.includes('Prerequisites / incoming links') && sources.roadmapVisual.includes('roadmap-topic-guide') && !sources.roadmapVisual.includes('Open source link') && !sources.roadmapVisual.includes('target="_blank"'))
  ok('destructive actions use inline confirmation', sources.view.includes('data-testid="confirm-banner"') && sources.view.includes('Confirm'))
  ok('route imports no execution helpers', !/import[^\n]*(exec|spawn|child_process)/.test(sources.route))
  ok('store writes only its own file name', sources.store.includes("PLAYGROUND_FILE_NAME = 'playground.json'") && !sources.store.includes('agent-hub-state'))
}

// ── 10. Editor dependency contract ─────────────────────────────────────────

section('Editor dependency contract (area 2)')

{
  const pkg = JSON.parse(await readSource('package.json'))
  for (const dep of ['codemirror', '@codemirror/lang-python', '@codemirror/lang-sql', '@codemirror/lang-javascript', '@codemirror/legacy-modes', '@lezer/highlight', '@codemirror/view', '@codemirror/state']) {
    ok(`package.json depends on ${dep}`, Boolean(pkg.dependencies?.[dep]))
  }
  ok('react-syntax-highlighter stays output-only (not used in the editor)', !(await readSource('src/components/agent-hub/playground/code-editor.tsx')).includes('react-syntax-highlighter'))
}

// ── 11. Corrupt-store quarantine (last: it renames the store file) ─────────

section('Corrupt store quarantine')

{
  const file = store.playgroundStorePath()
  await fs.writeFile(file, '{ this is not json', 'utf-8')
  const result = await store.listSessions()
  ok('corrupt store is quarantined with a warning', result.sessions.length === 0 && /unreadable/.test(result.warning ?? ''))
  const entries = await fs.readdir(DB_DIR)
  ok('corrupt copy is kept for inspection', entries.some((n) => n.startsWith('playground.json.corrupt-')))
}

// ── Summary ─────────────────────────────────────────────────────────────────

// ── Cleanup ─────────────────────────────────────────────────────────────────

await fs.rm(BUILD_DIR, { recursive: true, force: true }).catch(() => {})
await fs.rm(DB_DIR, { recursive: true, force: true }).catch(() => {})

console.log(`\n${'─'.repeat(60)}`)
console.log(`Playground checks: ${pass} passed, ${fail} failed, ${skipped} skipped`)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  · ${f}`)
}
process.exitCode = fail > 0 ? 1 : 0
