#!/usr/bin/env node
// ── Chat message normalization checks ────────────────────────────────────────
//   node scripts/check-chat-normalize.mjs
//
// Proves that chat-types.normalizeHistory() turns legacy agent-runner entries
// (internal Project-Manager prompts, raw ```tool blocks, tool results/errors)
// into a compact tool-activity group and a normal final answer — and never
// surfaces internal instructions as ordinary conversation. Pure logic: it
// transpiles the real module and exercises it, so no provider/server is needed.

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
    failures.push(`${name}${detail ? ` - ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

const buildDir = await fs.mkdtemp(path.join(ROOT, '.tmp-chat-normalize-'))
let normalizeHistory
try {
  const src = await fs.readFile(path.join(ROOT, 'src', 'lib', 'agent-hub', 'chat-types.ts'), 'utf-8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  await fs.writeFile(path.join(buildDir, 'chat-types.js'), out)
  const require = createRequire(pathToFileURL(path.join(ROOT, 'package.json')).href)
  ;({ normalizeHistory } = require(path.join(buildDir, 'chat-types.js')))

  const toolBlock = (name, args) => '```tool ' + JSON.stringify({ name, args }) + '```'
  const PM_PROMPT =
    'You are the Project Manager of an agent team. Plan the work, delegate to specialists.\n' +
    'Proposed call: call_llm {"prompt":"hello","agent":"manager"}\n' +
    'Reply with exactly ONE fenced block ```tool {"name": "...", "args": {...}}``` to run a tool.'

  // ── 1. Degenerate inputs ──
  ok('N1 non-array input returns []', Array.isArray(normalizeHistory(null)) && normalizeHistory(null).length === 0)
  ok('N2 undefined input returns []', normalizeHistory(undefined).length === 0)
  ok('N3 junk entries are skipped', normalizeHistory([null, 42, { role: 'user' }]).length === 1)

  // ── 2. Normal chat turns are preserved ──
  const plain = normalizeHistory([
    { role: 'user', content: 'hi', time: 't1' },
    { role: 'assistant', content: 'Hello! How can I help?', time: 't2' },
  ])
  ok('N4 plain pair preserved', plain.length === 2 && plain[0].role === 'user' && plain[1].role === 'assistant')
  ok('N5 plain messages keep kind chat', plain.every((m) => m.kind === 'chat'))
  ok('N6 plain messages get stable ids', plain.every((m) => typeof m.id === 'string' && m.id.length > 0))

  // ── 3. Legacy agent-runner leakage is folded into one activity group ──
  const legacy = [
    { role: 'user', content: 'hi', time: 't1' },
    { role: 'assistant', content: 'Hello! How can I help?', time: 't2' },
    { role: 'user', content: 'which model is this', time: 't3' },
    { role: 'assistant', content: 'I am GPT-4, a large language model by OpenAI.', time: 't4' },
    { role: 'user', content: PM_PROMPT, time: 't5' },
    { role: 'assistant', content: toolBlock('call_llm', { prompt: 'hello', agent: 'manager' }), time: 't6' },
    { role: 'user', content: 'hello', time: 't7' },
    { role: 'assistant', content: toolBlock('call_llm', { prompt: 'hello', agent: 'manager' }), time: 't8' },
    {
      role: 'user',
      content: PM_PROMPT + '\n\nResult of call_llm:\n' + toolBlock('call_llm', { prompt: 'hello' }),
      time: 't9',
    },
    { role: 'assistant', content: toolBlock('plan', {}), time: 't10' },
    {
      role: 'user',
      content: PM_PROMPT + '\n\nError: invalid arguments for plan: Action is required. Fix them and retry, or FINAL:.',
      time: 't11',
    },
    { role: 'assistant', content: toolBlock('plan', {}), time: 't12' },
    {
      role: 'user',
      content:
        'Task: hello\n\nVerified step results from the team:\ncall_llm: some evidence\n\n' +
        'As Project Manager, write a concise final report of what the team actually accomplished.',
      time: 't13',
    },
    {
      role: 'assistant',
      content: 'FINAL: The team completed the task:\n\n```python\ndef hello():\n    print("hi")\n```',
      time: 't14',
    },
  ]
  const norm = normalizeHistory(legacy)
  ok('N7 leaked runner collapses to 6 messages', norm.length === 6, `got ${norm.length}`)
  ok(
    'N8 first four are normal chat',
    norm.slice(0, 4).every((m) => m.kind === 'chat'),
  )
  ok('N9 runner becomes one tool_activity group', norm[4].kind === 'tool_activity' && Array.isArray(norm[4].activity))
  ok('N10 activity records the tool calls', norm[4].activity.some((s) => s.label === 'Tool call: call_llm'))
  ok(
    'N11 activity records the failed plan call',
    norm[4].activity.some((s) => s.status === 'failed' && /plan/i.test(`${s.label} ${s.detail ?? ''}`)),
  )
  ok('N12 final answer is a normal chat message', norm[5].kind === 'chat' && norm[5].role === 'assistant')
  ok('N13 FINAL: prefix is stripped', norm[5].content.startsWith('The team completed'), norm[5].content.slice(0, 40))
  ok('N14 code fence preserved in the answer', norm[5].content.includes('```python'))

  // ── 4. Internal instructions never surface as conversation ──
  const chatContents = norm.filter((m) => m.kind === 'chat').map((m) => m.content).join('\n')
  ok('N15 no "Project Manager" prompt in any chat message', !/You are the Project Manager/.test(chatContents))
  ok('N16 no raw tool block in any chat message', !/```tool/.test(chatContents))
  const activityLabels = norm
    .filter((m) => m.kind === 'tool_activity')
    .flatMap((m) => m.activity.map((s) => `${s.label} ${s.detail ?? ''}`))
    .join('\n')
  ok('N17 activity labels never expose the internal prompt', !/You are the Project Manager/.test(activityLabels))

  // ── 5. Empty / malformed tool blocks are failures, never user-visible text ──
  const emptyBlock = normalizeHistory([{ role: 'assistant', content: '```tool ```', time: 't' }])
  ok('N18 empty tool block becomes a failed activity step', emptyBlock[0].kind === 'tool_activity' && emptyBlock[0].activity[0].status === 'failed')

  // ── 6. Already-typed entries round-trip (idempotence) ──
  const typed = normalizeHistory([
    { id: 'a', role: 'assistant', content: '', time: 't', kind: 'tool_activity', activity: [{ label: 'X', status: 'completed' }] },
    { id: 'b', role: 'user', content: 'yo', time: 't', kind: 'chat' },
  ])
  ok('N19 typed tool_activity preserved', typed[0].kind === 'tool_activity' && typed[0].activity[0].label === 'X')
  ok('N20 typed chat keeps its id', typed[1].id === 'b')
  const again = normalizeHistory(norm)
  ok(
    'N21 normalization is idempotent',
    again.length === norm.length && again.map((m) => m.kind).join(',') === norm.map((m) => m.kind).join(','),
  )
} catch (err) {
  fail++
  failures.push(`threw: ${err && err.stack ? err.stack : err}`)
  console.log(`  FAIL  threw - ${err && err.message ? err.message : err}`)
} finally {
  await fs.rm(buildDir, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
