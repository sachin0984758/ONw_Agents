#!/usr/bin/env node
// ─── Verification Suite for AgentHub Chat ──────────────────────────────────────
// Tests A through F as specified in Task Section 8:
//   Test A: 'hi'
//   Test B: 'give any code'
//   Test C: 'which model is this'
//   Test D: 'Explain a Python for loop with an example'
//   Test E: Consecutive messages (chronological order, stable IDs, no duplicates)
//   Test F: Provider failure simulation (accurate error state, no fake reply)
// ─────────────────────────────────────────────────────────────────────────────

// Args: [baseURL] [dbDir]   (dbDir must match the server's AGENT_HUB_DB_DIR)
// Run against an ISOLATED instance so live db/ state is never touched, e.g.:
//   NEXT_DIST_DIR=.next-iso AGENT_HUB_DB_DIR=<tmp> npx next dev -p 3101 &
//   node scripts/verify-verification-suite.mjs http://localhost:3101 <tmp>
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.argv[2] ?? 'http://localhost:3000'

let totalTests = 0
let passedTests = 0
const results = []

function record(name, pass, details) {
  totalTests++
  if (pass) passedTests++
  results.push({ name, pass, details })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`)
  if (details) {
    console.log(`       ${details.replace(/\n/g, '\n       ')}`)
  }
}

async function sendSSE(message, options = {}) {
  const userMsgId = options.userMsgId || `test-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const assistantMsgId = options.assistantMsgId || `test-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  const body = {
    message,
    stream: true,
    userMsgId,
    assistantMsgId,
    settings: options.settings || { model: options.model || '' },
  }

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    return { ok: false, status: res.status, error: errText }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let thinking = ''
  let reply = ''
  let doneData = null
  let streamError = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const rawJson = line.slice(6).trim()
        if (!rawJson) continue
        try {
          const parsed = JSON.parse(rawJson)
          if (parsed.type === 'thinking') {
            thinking += parsed.text
          } else if (parsed.type === 'delta') {
            reply += parsed.text
          } else if (parsed.type === 'done') {
            doneData = parsed
          } else if (parsed.type === 'error') {
            streamError = parsed.error
          }
        } catch {
          // ignore malformed line
        }
      }
    }
  }

  return {
    ok: !streamError,
    status: 200,
    thinking,
    reply: doneData ? doneData.reply : reply,
    doneData,
    streamError,
    userMsgId,
    assistantMsgId,
  }
}

async function getHistory() {
  const res = await fetch(`${BASE}/api/chat`)
  const json = await res.json()
  return json.messages || []
}

async function clearHistory() {
  await fetch(`${BASE}/api/chat`, { method: 'DELETE' })
}

async function run() {
  console.log('Starting Verification Suite on', BASE)
  console.log('='.repeat(70))

  // Clear before starting
  await clearHistory()

  // ───────────────────────────────────────────────────────────────────────────
  // TEST A: 'hi'
  // Expected: A natural greeting from the configured text-chat model, with no
  // internal prompts or 'AI tutor' canned branding.
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- Executing Test A: "hi" ---')
  const resA = await sendSSE('hi')
  const replyA = resA.reply || ''
  const hasNoTutor = !replyA.toLowerCase().includes('ai tutor') && !replyA.toLowerCase().includes('agent helper here on agenthub')
  const hasNoInternalPrompt = !replyA.includes('Runtime environment:') && !replyA.includes('buildExplainSystemPrompt') && !replyA.includes('intent hint')
  const isNaturalGreeting = replyA.length > 5 && resA.ok

  record('Test A: Natural greeting received', isNaturalGreeting, `Reply (${replyA.length} chars):\n"${replyA.slice(0, 200)}..."`)
  record('Test A: No canned tutor or internal prompt leakage', hasNoTutor && hasNoInternalPrompt, `Canned tutor absent: ${hasNoTutor}, Internal prompt absent: ${hasNoInternalPrompt}`)

  // ───────────────────────────────────────────────────────────────────────────
  // TEST B: 'give any code'
  // Expected: Short valid code example, formatted correctly, no unnecessary tools.
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- Executing Test B: "give any code" ---')
  const resB = await sendSSE('give any code')
  const replyB = resB.reply || ''
  const hasCodeBlock = replyB.includes('```')
  const isCleanCode = resB.ok && hasCodeBlock && !replyB.includes('<tool_call>')

  record('Test B: Valid formatted code block returned', isCleanCode, `Code block present: ${hasCodeBlock}\nSnippet:\n${replyB.slice(0, 250)}...`)

  // ───────────────────────────────────────────────────────────────────────────
  // TEST C: 'which model is this'
  // Expected: Accurate identification from the live provider/model metadata
  // (the id the server actually resolved), never a hardcoded/foreign model.
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- Executing Test C: "which model is this" ---')
  const statusForC = await (await fetch(`${BASE}/api/chat?resource=status`)).json().catch(() => ({}))
  const expectedModelId = String(statusForC.modelId || '').toLowerCase()
  const resC = await sendSSE('which model is this')
  const replyC = resC.reply || ''
  const lowerC = replyC.toLowerCase()
  const mentionsResolved =
    (expectedModelId && lowerC.includes(expectedModelId)) ||
    lowerC.includes('qwen') ||
    lowerC.includes('lm studio')
  const noFalseModelClaim = !/\bgpt-4\b|\bgpt4\b|\bclaude\b|\bgemini\b/.test(lowerC)

  record(
    'Test C: Accurate model identification (from live metadata)',
    mentionsResolved && noFalseModelClaim,
    `resolved model id: ${expectedModelId || '(unknown)'}\nmentions resolved: ${mentionsResolved}, no false claim: ${noFalseModelClaim}\n"${replyC.slice(0, 250)}..."`,
  )

  // ───────────────────────────────────────────────────────────────────────────
  // TEST D: 'Explain a Python for loop with an example'
  // Expected: Structured explanation with readable paragraphs and formatted code block.
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- Executing Test D: "Explain a Python for loop with an example" ---')
  const resD = await sendSSE('Explain a Python for loop with an example')
  const replyD = resD.reply || ''
  const hasForLoopCode = replyD.includes('```') && (replyD.includes('for ') || replyD.includes('in range') || replyD.includes('print'))
  const hasExplanationText = replyD.length > 150

  record('Test D: Structured explanation + code example', hasForLoopCode && hasExplanationText, `Length: ${replyD.length} chars, Code present: ${replyD.includes('```')}\nSample:\n${replyD.slice(0, 300)}...`)

  // ───────────────────────────────────────────────────────────────────────────
  // TEST E: Consecutive messages (order, no duplicates, stable IDs)
  // Expected: Messages appear in chronological order without duplicate assistant replies.
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- Executing Test E: Consecutive messages & history order ---')
  const resE1 = await sendSSE('What is 2 + 2?')
  const resE2 = await sendSSE('And what is that multiplied by 10?')
  record('Test E: Consecutive model requests succeed', resE1.ok && resE2.ok, `First=${resE1.status}, second=${resE2.status}`)

  const history = await getHistory()
  console.log(`Current history message count: ${history.length}`)

  // Verify chronology: each message should have a valid timestamp and ids should match
  let chronological = true
  let noDuplicates = true
  const seenIds = new Set()

  for (let i = 0; i < history.length; i++) {
    const msg = history[i]
    if (seenIds.has(msg.id)) {
      noDuplicates = false
    }
    seenIds.add(msg.id)
    if (i > 0) {
      const prevTime = new Date(history[i - 1].time).getTime()
      const currTime = new Date(msg.time).getTime()
      if (currTime < prevTime) chronological = false
    }
  }

  // Check alternating user/assistant roles
  let alternatingRoles = true
  for (let i = 0; i < history.length; i++) {
    const expectedRole = i % 2 === 0 ? 'user' : 'assistant'
    if (history[i].role !== expectedRole) alternatingRoles = false
  }

  // Guard against vacuous passes: E must see real exchanges, otherwise
  // chronological/duplicate/alternation checks are trivially true over [].
  const hasEnoughTurns = history.length >= 4

  record('Test E: Chronological order preserved', hasEnoughTurns && chronological, `Turns: ${history.length}, Chronological: ${chronological}`)
  record('Test E: No duplicate message IDs in persisted history', hasEnoughTurns && noDuplicates, `All ${history.length} messages have unique IDs`)
  record('Test E: Strict user/assistant turn alternation', hasEnoughTurns && alternatingRoles, `Turn alternation: ${alternatingRoles} over ${history.length} turns`)

  // Clean output: no raw protocol/instruction leakage in any persisted message.
  const leaked = history.some(
    (m) =>
      typeof m.content === 'string' &&
      (m.content.includes('{"blocks"') ||
        m.content.includes('Runtime environment:') ||
        m.content.includes('intent hint') ||
        m.content.includes('(empty reply')),
  )
  record(
    'Test E: No raw protocol / internal instruction leakage',
    !leaked,
    leaked ? 'leak detected in persisted history' : 'clean',
  )

  // ───────────────────────────────────────────────────────────────────────────
  // TEST F: Simulate provider failure
  // Expected: a visible, accurate error and NO fake successful reply.
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n--- Executing Test F: Provider failure simulation ---')
  const historyBeforeF = await getHistory()

  // Scenario 1: an unknown model id must fail loudly (no silent switch).
  const resFUnknown = await sendSSE('Hello unknown model', {
    settings: { model: `no-such-model-${Date.now()}` },
  })
  const unknownFailsHonest =
    !resFUnknown.ok &&
    (resFUnknown.status >= 400 || resFUnknown.streamError || String(resFUnknown.error || '').includes('not found'))

  record(
    'Test F1: Unknown model id fails loudly (no silent switch)',
    unknownFailsHonest,
    `Status: ${resFUnknown.status}, Error: ${resFUnknown.error || resFUnknown.streamError || '(none)'}`,
  )

  // Scenario 2: an incompatible embedding model is rejected before any call.
  const resFIncompatible = await sendSSE('Hello embedding model', {
    settings: { model: 'text-embedding-nomic-embed-text-v1.5' },
  })
  const incompatibleFailsHonest =
    !resFIncompatible.ok &&
    (resFIncompatible.status === 400 || String(resFIncompatible.error || '').includes('incompatible'))

  record(
    'Test F2: Incompatible embedding model rejected (400, no fake reply)',
    incompatibleFailsHonest,
    `Status: ${resFIncompatible.status}, Error: ${resFIncompatible.error || resFIncompatible.streamError || '(none)'}`,
  )

  // Neither failure may have appended a fake assistant turn.
  const historyAfterF = await getHistory()
  record(
    'Test F3: No fake assistant reply persisted on failure',
    historyAfterF.length === historyBeforeF.length,
    `before=${historyBeforeF.length} after=${historyAfterF.length}`,
  )

  console.log('\n' + '='.repeat(70))
  console.log(`Verification Suite Complete: ${passedTests}/${totalTests} PASSED`)
  console.log('='.repeat(70))

  if (passedTests < totalTests) {
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('Fatal error running verification suite:', err)
  process.exit(1)
})
