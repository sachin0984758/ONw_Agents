#!/usr/bin/env node
// ─── Agent Session · real file operations, end to end ────────────────────────
// Proves the file pipeline against a REAL, disposable workspace on disk:
//
//   Sessions runtime (src/lib/agent-hub/agent-session.ts)
//        ↓ real tool calls
//   REAL files route (src/app/api/agent-session/files/route.ts)
//        ↓ real fs
//   a throwaway temp directory
//
// The ONLY thing mocked is the model's chat reply (a scripted ```tool``` block);
// the files route, the workspace resolution and the filesystem are real. The
// runtime's `fetch` is shimmed so relative `/api/...` URLs reach the real route
// handler in-process instead of over a socket. `AGENT_SESSION_WORKSPACE` points
// at the temp dir, so the live project workspace is never touched.
//
//   node scripts/check-agent-session-files-e2e.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs, mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const ROOT = process.cwd()

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

// ── Disposable environment ───────────────────────────────────────────────────
const wsDir = mkdtempSync(path.join(os.tmpdir(), 'agent-ws-'))
const dbDir = mkdtempSync(path.join(os.tmpdir(), 'agent-db-'))
process.env.AGENT_SESSION_WORKSPACE = wsDir
process.env.AGENT_HUB_DB_DIR = dbDir

const buildDir = mkdtempSync(path.join(ROOT, '.tmp-files-e2e-'))
const runtimeDir = mkdtempSync(path.join(os.tmpdir(), 'agent-session-e2e-'))

function transpile(name, outName = name) {
  const src = require('fs').readFileSync(path.join(ROOT, 'src', 'lib', 'agent-hub', `${name}.ts`), 'utf-8')
  const out = ts.transpileModule(src.replace(/@\/lib\/agent-hub\//g, './'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const outputPath = path.join(runtimeDir, `${outName}.js`)
  require('fs').mkdirSync(path.dirname(outputPath), { recursive: true })
  require('fs').writeFileSync(outputPath, out)
}

try {
  // ── Build the REAL files route and its server workspace/policy dependencies.
  for (const name of ['request-origin', 'db-path', 'runtime-policy', 'fs-atomic', 'session/workspaces', 'workspace-result', 'workspace-files']) {
    const src = await fs.readFile(path.join(ROOT, 'src', 'lib', 'agent-hub', `${name}.ts`), 'utf-8')
    const out = ts.transpileModule(src.replace(/@\/lib\/agent-hub\//g, './'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    await fs.mkdir(path.dirname(path.join(buildDir, `${name}.js`)), { recursive: true })
    await fs.writeFile(path.join(buildDir, `${name}.js`), out)
  }
  let routeSrc = await fs.readFile(path.join(ROOT, 'src', 'app', 'api', 'agent-session', 'files', 'route.ts'), 'utf-8')
  routeSrc = routeSrc.replace(/@\/lib\/agent-hub\//g, './')
  const routeOut = ts.transpileModule(routeSrc, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  await fs.writeFile(path.join(buildDir, 'route.js'), routeOut)
  const { NextRequest } = require('next/server')
  const route = require(path.join(buildDir, 'route.js'))

  // ── Build the real runtime ─────────────────────────────────────────────────
  for (const name of ['design-catalog', 'design-engine', 'design-intent', 'teaching-bank', 'teaching-framework', 'teaching-intent', 'skills', 'usage-sync', 'session/file-intent', 'session/outcome', 'session/highlighting', 'session/transport', 'agent-session']) {
    transpile(name)
  }
  const agent = require(path.join(runtimeDir, 'agent-session.js'))
  const { startAgentSession, subscribeAgentSession, resolveApproval, configureAgentSession, setSmolMode, setSelectionMode, setAgentEnabled } = agent

  configureAgentSession({ stepDelayMs: 0 })

  // ── Real HTTP-free bridge to the route ─────────────────────────────────────
  async function callRoute(method, relUrl, jsonBody) {
    const init = method === 'GET'
      ? { method, headers: { Host: 'localhost' } }
      : { method, headers: { 'content-type': 'application/json', Host: 'localhost' }, body: JSON.stringify(jsonBody) }
    const req = new NextRequest(`http://localhost${relUrl}`, init)
    const res = method === 'GET' ? await route.GET(req) : await route.POST(req)
    let json = null
    try {
      json = await res.clone().json()
    } catch {
      json = null
    }
    return { status: res.status, json, res }
  }

  // Recorders for what the runtime actually sent to the real route.
  const fileResponses = []
  const chatPrompts = []
  let currentToolBlock = 'FINAL: reported'
  let modelReply = null

  const realFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const s = typeof input === 'string' ? input : input?.url ?? String(input)
    if (s.startsWith('/api/agent-session/files')) {
      const method = (init?.method ?? 'GET').toUpperCase()
      const body = init?.body ? JSON.parse(init.body) : undefined
      const r = await callRoute(method, s, body)
      fileResponses.push({ method, url: s, body, status: r.status, json: r.json })
      return r.res
    }
    if (s.startsWith('/api/chat')) {
      let msg = ''
      try {
        msg = JSON.parse(init?.body ?? '{}')?.message ?? ''
      } catch {
        /* ignore */
      }
      chatPrompts.push(msg)
      const reply = modelReply ? await modelReply(msg, init) : msg.includes('Implement the requested change') ? currentToolBlock : 'FINAL: reported'
      return new Response(JSON.stringify({ ok: true, reply }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (s.startsWith('/api/skills')) {
      return new Response(JSON.stringify({ ok: true, root: '', counts: { installed: 0, enabled: 0, disabled: 0, attention: 0 }, skills: [], trustedSources: [], discovered: [], missing: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (s.startsWith('/api/agent-session/exec')) {
      const method = (init?.method ?? 'GET').toUpperCase()
      const payload = method === 'GET'
        ? { ok: true, tasks: [], scripts: {} }
        : { ok: true, command: 'x', exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, durationMs: 1 }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (s.startsWith('/api/agent-session/models')) {
      return new Response(JSON.stringify({ ok: true, local: [], cloud: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  async function runTask(request, toolBlock) {
    currentToolBlock = toolBlock
    setSmolMode('edit')
    setSelectionMode('auto')
    setAgentEnabled('coder', true)
    const before = fileResponses.length
    const unsub = subscribeAgentSession((s) => {
      if (s.pendingApproval) resolveApproval(true)
    })
    const task = await startAgentSession(request)
    unsub()
    return { task, calls: fileResponses.slice(before) }
  }

  const readFileOnDisk = (rel) => fs.readFile(path.join(wsDir, rel), 'utf-8')
  const existsOnDisk = async (rel) => {
    try {
      await fs.stat(path.join(wsDir, rel))
      return true
    } catch {
      return false
    }
  }

  console.log('\nAgent Session · real file operations (disposable workspace)\n')
  console.log(`  workspace: ${wsDir}\n`)

  // ── Part A · the REAL route against the REAL filesystem ────────────────────
  {
    const w = await callRoute('POST', '/api/agent-session/files', { op: 'write', path: 'direct.md', content: 'hello', mode: 'edit' })
    ok('A1 route write creates a real file', w.status === 200 && w.json?.ok === true && w.json?.created === true, `status=${w.status}`)
    ok('A2 the bytes are really on disk', (await readFileOnDisk('direct.md')) === 'hello')

    const r = await callRoute('GET', '/api/agent-session/files?op=read&path=direct.md')
    ok('A3 route read returns the written bytes', r.status === 200 && r.json?.content === 'hello', JSON.stringify(r.json?.content))

    const e = await callRoute('POST', '/api/agent-session/files', { op: 'edit', path: 'direct.md', oldText: 'hello', newText: 'world', mode: 'edit' })
    ok('A4 route edit applies one replacement', e.status === 200 && e.json?.replacements === 1, `status=${e.status}`)
    ok('A5 the edit persisted to disk', (await readFileOnDisk('direct.md')) === 'world')

    const l = await callRoute('GET', '/api/agent-session/files?op=list&path=.')
    ok('A6 list shows the real file', l.status === 200 && Array.isArray(l.json?.entries) && l.json.entries.some((x) => x.name === 'direct.md'), JSON.stringify(l.json?.entries))

    const d = await callRoute('POST', '/api/agent-session/files', { op: 'delete', path: 'direct.md', mode: 'edit' })
    ok('A7 route delete removes the file', d.status === 200 && d.json?.deleted === true, `status=${d.status}`)
    ok('A8 the file is really gone', (await existsOnDisk('direct.md')) === false)

    // Safety, for real: escape, secrets, protected dirs, and the mode gate.
    const esc = await callRoute('POST', '/api/agent-session/files', { op: 'write', path: '../escaped.txt', content: 'x', mode: 'edit' })
    ok('A9 a path escaping the workspace is refused', esc.status === 400 && /escapes/.test(String(esc.json?.error)), `status=${esc.status} ${esc.json?.error}`)
    ok('A10 nothing was written outside the workspace', (await existsOnDisk('../escaped.txt')) === false)

    const env = await callRoute('POST', '/api/agent-session/files', { op: 'write', path: '.env', content: 'x', mode: 'edit' })
    ok('A11 writing a secret file is refused', env.status === 403, `status=${env.status}`)
    const nm = await callRoute('POST', '/api/agent-session/files', { op: 'write', path: 'node_modules/x', content: 'x', mode: 'edit' })
    ok('A12 writing into node_modules is refused', nm.status === 403, `status=${nm.status}`)
    const dbFile = await callRoute('POST', '/api/agent-session/files', { op: 'write', path: 'db/notes.json', content: 'x', mode: 'edit' })
    ok('A13 writing into db is refused', dbFile.status === 403, `status=${dbFile.status}`)
    const noMode = await callRoute('POST', '/api/agent-session/files', { op: 'write', path: 'nomode.md', content: 'x' })
    ok('A14 writes without edit mode are refused', noMode.status === 403, `status=${noMode.status}`)
    const readEnv = await callRoute('GET', '/api/agent-session/files?op=read&path=.env')
    ok('A15 reading a secret file is refused', readEnv.status === 403, `status=${readEnv.status}`)
  }

  // ── Part B · the runtime drives the REAL route + filesystem ────────────────
  {
    // B1 — create notebook.md and write "success"
    const { task } = await runTask(
      'create a file called notebook.md and write success in it, then read it back',
      '```tool {"name": "write_file", "args": {"path": "notebook.md", "content": "success"}}```',
    )
    ok('B1a the run completed', task.status === 'completed' || task.status === 'partial', `status=${task.status}`)
    ok('B1b notebook.md really exists on disk', await existsOnDisk('notebook.md'))
    ok('B1c notebook.md really contains "success"', (await readFileOnDisk('notebook.md')).includes('success'), JSON.stringify(await readFileOnDisk('notebook.md').catch(() => null)))
    ok('B1d the change is tracked for review', (task.changedFiles ?? []).some((c) => c.path.replace(/\\/g, '/').endsWith('notebook.md')), JSON.stringify(task.changedFiles))
    ok('B1e the reported result cites the real write', /Created|Overwrote/.test(task.result ?? '') || JSON.stringify(task.plan).includes('Created'), String(task.result).slice(0, 120))
    const readBack = task.plan.find((s) => s.capability === 'read')
    ok('B1f create-then-read uses the named file after creation', readBack?.status === 'completed' && /success/.test(readBack.result ?? '') && task.plan.indexOf(readBack) > task.plan.findIndex((s) => s.capability === 'code'), JSON.stringify(readBack))
  }

  {
    // B2 — read it back through the runtime (deterministic read step → real route)
    const { task, calls } = await runTask('read notebook.md and show me its contents', 'FINAL: reported')
    const readCall = calls.find((c) => c.url.includes('op=read'))
    ok('B2a the runtime issued a real read', Boolean(readCall), JSON.stringify(calls.map((c) => c.url)))
    ok('B2b the read returned the on-disk content', readCall?.status === 200 && readCall?.json?.content?.includes('success'), JSON.stringify(readCall?.json?.content))
    const readStep = task.plan.find((s) => s.capability === 'read')
    ok('B2c the read step surfaced the real contents', /success/.test(String(readStep?.result ?? '')), String(readStep?.result).slice(0, 120))
  }

  {
    // B3 — update the file through the runtime
    const { task } = await runTask(
      'update notebook.md and add a line that says updated',
      '```tool {"name": "edit_file", "args": {"path": "notebook.md", "old_text": "success", "new_text": "success\\nupdated"}}```',
    )
    const onDisk = await readFileOnDisk('notebook.md')
    ok('B3a the edit completed', task.status === 'completed' || task.status === 'partial', `status=${task.status}`)
    ok('B3b the update persisted to disk', onDisk.includes('updated') && onDisk.includes('success'), JSON.stringify(onDisk))
  }

  {
    // B4 — delete the file through the runtime
    const { task } = await runTask('delete notebook.md', '```tool {"name": "delete_file", "args": {"path": "notebook.md"}}```')
    ok('B4a the delete completed', task.status === 'completed' || task.status === 'partial', `status=${task.status}`)
    ok('B4b the file is really gone from disk', (await existsOnDisk('notebook.md')) === false)
  }

  {
    // B5 — an unnamed create lands on the deterministic safe default
    const { task } = await runTask(
      'create a notebook and write success in it',
      '```tool {"name": "write_file", "args": {"path": "anything.txt", "content": "success"}}```',
    )
    ok('B5a the run completed', task.status === 'completed' || task.status === 'partial', `status=${task.status}`)
    ok('B5b the safe default notebook.md was created', (await existsOnDisk('notebook.md')) === true)
    ok('B5c the model-named file was NOT created', (await existsOnDisk('anything.txt')) === false)
    ok('B5d the stored content is the requested content', (await readFileOnDisk('notebook.md')).includes('success'))
    // tidy for the escape test
    await fs.rm(path.join(wsDir, 'notebook.md'), { force: true })
  }

  {
    // B6 — the runtime refuses to write outside the request's file scope
    const before = fileResponses.length
    const { task } = await runTask(
      'create a file called escape.txt and write x in it',
      '```tool {"name": "write_file", "args": {"path": "../escape.txt", "content": "x"}}```',
    )
    const writes = fileResponses.slice(before).filter((c) => c.method === 'POST' && c.body?.op === 'write')
    const escapedOutside = await fs
      .stat(path.join(wsDir, '..', 'escape.txt'))
      .then(() => true)
      .catch(() => false)
    ok('B6a the out-of-scope write was not performed', writes.length === 0, JSON.stringify(writes.map((w) => w.body)))
    ok('B6b nothing escaped the workspace on disk', escapedOutside === false)
    ok('B6c the run did not claim success', task.status !== 'completed' || writes.length === 0)
  }

  // ── Part C · complete workflow, with real files and scripted model actions ──
  {
    const fixtureFiles = ['root.txt', '.hidden', 'src/a.ts', 'deep/a/b/c/d/e/f/nested.ts', 'node_modules/pkg/index.js', '.next/generated.js']
    for (const rel of fixtureFiles) {
      const abs = path.join(wsDir, 'count-fixture', rel)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, 'fixture')
    }
    const count = await callRoute('GET', '/api/agent-session/files?op=count&path=count-fixture')
    ok('C1 recursive count includes deep, hidden, dependency and build files', count.json?.exact === true && count.json?.files === 6, JSON.stringify(count.json))
    const source = await callRoute('GET', '/api/agent-session/files?op=count&path=count-fixture&includeGenerated=false')
    ok('C2 excluding generated directories is explicit', source.json?.files === 4 && source.json?.exact === true)
    const extension = await callRoute('GET', '/api/agent-session/files?op=count&path=count-fixture&extension=ts')
    ok('C3 extension filter counts both shallow and deep matches', extension.json?.files === 2)
    const shallow = await callRoute('GET', '/api/agent-session/files?op=count&path=count-fixture&recursive=false')
    ok('C4 a nonrecursive request counts direct files only', shallow.json?.files === 2)
    const escape = await callRoute('GET', '/api/agent-session/files?op=count&path=../')
    ok('C5 count cannot escape the workspace', escape.status === 400)
    const notDirectory = await callRoute('GET', '/api/agent-session/files?op=count&path=count-fixture/root.txt')
    ok('C6 count rejects a file as the directory', notDirectory.status === 400)
    const emptyDir = path.join(wsDir, 'empty-count')
    await fs.mkdir(emptyDir)
    const empty = await callRoute('GET', '/api/agent-session/files?op=count&path=empty-count')
    ok('C7 an empty directory returns an exact zero', empty.json?.files === 0 && empty.json?.exact === true)
    let modelCalls = 0
    modelReply = async () => { modelCalls++; throw new Error('Provider is offline') }
    const countRun = await startAgentSession('give me the count of the files in count-fixture/')
    ok('C8 file-count task answers the actual number without a model', countRun.status === 'completed' && /There are 6 files/.test(countRun.result ?? '') && modelCalls === 0, JSON.stringify({ status: countRun.status, result: countRun.result, modelCalls }))
    ok('C9 planner selects counting rather than the capped structure listing', countRun.plan.some((s) => s.tool === 'count_files') && !countRun.plan.some((s) => s.tool === 'get_project_structure'))
    agent.setWorkspace('count-fixture')
    for (const phrase of ['how many file are there in here', 'how many files are there in there?', 'count files in this folder', 'count files in the current directory', 'count files in this project']) {
      const here = await startAgentSession(phrase)
      ok(`D1 current-workspace reference: ${phrase}`, here.status === 'completed' && /There are 6 files/.test(here.result ?? ''), here.result)
    }
    const src = await startAgentSession('count files in the folder src')
    ok('D2 an explicit folder name remains scoped', src.status === 'completed' && /There is 1 file/.test(src.result ?? ''), src.result)
    await fs.mkdir(path.join(wsDir, 'count-fixture', 'here'))
    await fs.writeFile(path.join(wsDir, 'count-fixture', 'here', 'literal.txt'), 'literal folder')
    const quoted = await startAgentSession('count files in "here"')
    ok('D3 a quoted folder named here is treated literally', quoted.status === 'completed' && /There is 1 file/.test(quoted.result ?? ''), quoted.result)
    for (const phrase of ['what can u do', 'What can you do?', 'help', 'what are your capabilities']) {
      const help = await startAgentSession(phrase)
      ok(`D4 capability help works with the model offline: ${phrase}`, help.status === 'completed' && /Count real files/.test(help.result ?? '') && /approval/.test(help.result ?? '') && !help.changedFiles?.length, help.result)
    }
    ok('D5 count and capability help never called the unavailable model', modelCalls === 0, `calls=${modelCalls}`)
    agent.setWorkspace('.')
    modelReply = null
  }

  {
    await fs.mkdir(path.join(wsDir, 'feature'))
    await fs.writeFile(path.join(wsDir, 'feature', 'counter.js'), 'const count = 0;\n')
    const actions = [
      { name: 'read_file', args: { path: 'feature/counter.js' } },
      { name: 'edit_file', args: { path: 'feature/counter.js', old_text: 'count = 0', new_text: 'count = 1' } },
      { name: 'read_file', args: { path: 'feature/counter.js' } },
      { name: 'write_file', args: { path: 'feature/result.js', content: 'console.log(1);\n' } },
      { name: 'syntax_check', args: { path: 'feature/result.js', content: 'console.log(1);\n' } },
    ]
    let turn = 0
    let sawPriorEvidence = false
    modelReply = async (message) => {
      sawPriorEvidence ||= message.includes('Observed results from earlier steps') && message.includes('counter.js')
      return turn < actions.length ? '```tool ' + JSON.stringify(actions[turn++]) + '```' : 'FINAL: Updated the counter to 1 and added result.js.'
    }
    agent.newCodingSession('Workflow verification')
    const approvals = []
    const unsub = subscribeAgentSession((s) => { if (s.pendingApproval) { approvals.push(s.pendingApproval.tool); resolveApproval(true) } })
    const task = await agent.sendCodingMessage('create a counter app in feature/')
    unsub()
    ok('C10 agent can inspect, edit, reread, write, check, and finish beyond three turns', task.plan.find((s) => s.capability === 'code')?.status === 'completed' && turn === actions.length && /Updated the counter/.test(task.result ?? ''), JSON.stringify({ status: task.status, turn, result: task.result }))
    ok('C11 edits to both files really persisted', (await readFileOnDisk('feature/counter.js')).includes('count = 1') && (await readFileOnDisk('feature/result.js')).includes('console.log(1)'))
    ok('C12 prior-step evidence reaches the coding model', sawPriorEvidence)
    ok('C13 every mutation still passes the approval gate', approvals.includes('edit_file') && approvals.includes('write_file'), approvals.join(','))
    const stored = agent.getActiveCodingSession().turns.at(-1)
    ok('C14 activity and file diffs survive in session history', stored.logs?.some((l) => l.type === 'tool') && stored.changedFiles?.length === 2)
    ok('C15 follow-up context includes the actual previous answer and files', agent.buildSessionContext().includes('Updated the counter') && agent.buildSessionContext().includes('feature/result.js'))

    modelReply = async () => 'FINAL: I have implemented everything.'
    const noChange = await startAgentSession('create a dashboard app in feature/')
    ok('C16 an unsupported completion claim is not accepted', noChange.status !== 'completed' && !noChange.changedFiles?.length && noChange.plan.some((s) => s.capability === 'code' && s.status === 'failed'), JSON.stringify({ status: noChange.status, plan: noChange.plan.map((s) => [s.id, s.status]) }))

    modelReply = async () => { throw new Error('Provider is offline') }
    const read = await startAgentSession('read feature/counter.js and show the content')
    ok('C17 unavailable report generation preserves the real file contents', read.status === 'partial' && /count = 1/.test(read.result ?? '') && !/^Completed \d/.test(read.result ?? ''), read.result)
    const beforeReadOnlyWrite = fileResponses.length
    const refused = await agent.getToolByName('write_file').execute({ path: 'feature/counter.js', content: 'unauthorized' })
    ok('C19 naming a file in an inspection request does not authorize edits', !refused.ok && !fileResponses.slice(beforeReadOnlyWrite).some((c) => c.method === 'POST') && (await readFileOnDisk('feature/counter.js')).includes('count = 1'))
    ok('C20 asking how to build an app does not start editing it', agent.getFileScope('Explain how to create an app').allowed.length === 0 && !agent.createPlan('Explain how to create an app').some((s) => s.capability === 'code'))
    agent.configureAgentSession({ llmTimeoutMs: 50, maxRetries: 0 })
    let aborted = false
    modelReply = async (message, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true })
    })
    const timedOut = await startAgentSession('hello')
    ok('C18 a model timeout aborts its request and reports failure', aborted && timedOut.status === 'failed' && /timed out/.test(timedOut.error ?? ''))
    agent.resetAgentSessionConfig()
    configureAgentSession({ stepDelayMs: 0 })
    modelReply = null
  }

  globalThis.fetch = realFetch
} finally {
  rmSync(buildDir, { recursive: true, force: true })
  rmSync(runtimeDir, { recursive: true, force: true })
  rmSync(wsDir, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  console.error('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
