// Opt-in acceptance against an already-running, isolated production instance.
// Requires AGENTHUB_TEST_URL and a fresh AGENT_HUB_DB_DIR on that server.
// Uses the already-loaded local model; never loads models or enables Auto.
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { splitInteractiveQuizzes } from '../src/lib/agent-hub/quiz-parser'

const base = process.env.AGENTHUB_TEST_URL
if (!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Set AGENTHUB_TEST_URL to the isolated loopback server.')
const evidence = path.resolve('.verification/finalization')
const requestTimeoutMs = Math.min(600000, Math.max(30000, Number(process.env.AGENTHUB_LIVE_TIMEOUT_MS) || 180000))
const results: Array<{ name: string; status: 'PASS' | 'FAIL'; detail: string; durationMs: number }> = []
const responses: Record<string, unknown> = {}
async function run(name: string, test: () => Promise<string | void>) {
  console.log(`RUN ${name}`)
  const started = Date.now()
  try { results.push({ name, status: 'PASS', detail: await test() || '', durationMs: Date.now() - started }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, status: 'FAIL', detail: String(error), durationMs: Date.now() - started }); console.log(`FAIL ${name}: ${error}`) }
  await fs.writeFile(path.join(evidence, 'live-results.json'), JSON.stringify({ base, requestTimeoutMs, results, responses }, null, 2))
}
async function api(endpoint: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + endpoint, { method, headers: { origin: base!, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(requestTimeoutMs) })
  const data = await response.json()
  assert.equal(response.ok, true, JSON.stringify(data).slice(0, 600))
  return data
}
const settings = { model: '', thinking: false, systemPrompt: 'Answer precisely and briefly.' }
async function chat(name: string, message: string, extraSettings: Record<string, unknown> = {}) {
  const data = await api('/api/chat', { message, stateless: true, stream: false, history: [], settings: { ...settings, ...extraSettings } })
  assert.ok(data.ok && data.reply)
  responses[name] = data
  return data
}
async function main() {
  await fs.mkdir(evidence, { recursive: true })
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-live-'))
  let chatId: string | undefined
  let sessionId: string | undefined
  try {
    await run('loaded local model discovery', async () => {
      const models = await api('/api/runtime/models')
      assert.ok(models.loaded?.length > 0 && models.onlineProviders.includes('LM Studio'))
      responses.discovery = models
      return models.loaded.map((model: { id: string }) => model.id).join(', ')
    })
    await run('streamed document answer, tokens and persisted history', async () => {
      chatId = (await api('/api/chat/conversations', {})).conversation.id
      const bytes = Buffer.from('The verification code is ATTACHMENT_READY.', 'utf8')
      const response = await fetch(base + '/api/chat', { method: 'POST', headers: { origin: base!, 'content-type': 'application/json' }, body: JSON.stringify({ chatId, message: 'Read the attached document. Reply only with its verification code.', stream: true, settings, attachments: [{ name: 'verification.txt', mime: 'text/plain', size: bytes.length, dataBase64: bytes.toString('base64') }] }), signal: AbortSignal.timeout(requestTimeoutMs) })
      assert.ok(response.ok && response.headers.get('content-type')?.includes('text/event-stream'))
      const text = await response.text()
      const events = text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)))
      const done = events.find((event) => event.type === 'done')
      responses.streaming = events
      assert.ok(done?.reply.includes('ATTACHMENT_READY'), text.slice(-600))
      assert.ok(done.usage?.totalTokens > 0 && done.tokenUsage)
      const stored = await api('/api/chat?chatId=' + chatId)
      assert.ok(stored.messages.length === 2 && stored.messages[1].content.includes('ATTACHMENT_READY'))
      return `SSE completed; ${done.usage.totalTokens} tokens; two messages persisted.`
    })
    await run('five interactive MCQs with complete answer keys', async () => {
      const data = await chat('quiz', 'Give exactly 5 short beginner Python MCQs with 4 choices each, hidden correct answers and short explanations. No introduction.')
      const quizzes = splitInteractiveQuizzes(data.reply).flatMap((segment) => segment.type === 'quiz' ? [segment.quiz] : [])
      assert.equal(quizzes.length, 5)
      assert.ok(quizzes.every((question) => question.options.length === 4 && question.correctLetter && question.explanation))
      return 'Five renderable and locally scoreable questions.'
    })
    await run('Advanced teaching starts at Step 1 and waits', async () => {
      const data = await chat('advanced', 'Teach me what a Python variable is, for a beginner writing a shopping list program. Step 1 only, under 60 words, then ask whether I understand.', { advancedTeachMode: true })
      assert.match(data.reply, /Step\s*1/i)
      assert.doesNotMatch(data.reply, /Step\s*[2-5]\s*[:—-]/i)
      assert.match(data.reply, /\?/)
      return 'Representative Step 1 gate verified; the entire five-step live course is not covered here.'
    })
    for (const [actionId, code, expected] of [['predict-output', 'print(2 + 3)', /5/], ['find-bugs', 'print(1 / 0)', /zero|ZeroDivision|divis/i]] as const) {
      await run('Playground ' + actionId + ' with local inference', async () => {
        const data = await api('/api/playground', { action: 'analyze', actionId, mode: 'code', languageId: 'python', level: 'beginner', code, problemStatement: 'Give one short sentence. Identify the answer or error only.', model: '' })
        responses[actionId] = data
        assert.match(data.text, expected)
        if (actionId === 'predict-output') assert.equal(data.estimated, true)
        assert.ok(data.usage?.totalTokens > 0)
        return data.model
      })
    }
    await run('opted-in local roadmap starts at Introduction with branch choices', async () => {
      const roadmap = await api('/api/playground?resource=roadmap&slug=data-analyst&enabled=true')
      assert.ok(roadmap.roadmap.nodes.length > 100 && roadmap.roadmap.nodes.every((node: { href: string }) => !node.href))
      const data = await api('/api/playground', { action: 'analyze', actionId: 'roadmap', mode: 'code', languageId: 'python', level: 'beginner', code: '', problemStatement: '', model: '', roadmapEnabled: true, roadmapSlug: 'data-analyst', roadmapHistory: [], roadmapReply: '' })
      responses.roadmap = data
      assert.equal(data.roadmapTopicLabel, 'Introduction')
      assert.ok(['Learn SQL', 'Excel', 'Tableau'].every((choice) => data.text.includes(choice)))
      assert.doesNotMatch(data.text, /https?:\/\//i)
      return 'Actual cached graph and one real model lesson; SQL/Excel traversal has separate deterministic coverage.'
    })
    await run('coding session selected folder, real tools and local model', async () => {
      await fs.writeFile(path.join(fixture, 'proof.txt'), 'SESSION_TOOLS_READY')
      const selected = await api('/api/agent-session/workspaces', { action: 'select', path: fixture })
      const created = await api('/api/agent-session/conversations', { action: 'create', workspaceId: selected.workspace.id, workspace: '.', mode: 'ro', model: '', effort: 'off', localOnly: true })
      sessionId = created.conversation.id
      await api('/api/agent-session/conversations', { action: 'settings', id: sessionId, workspaceAccess: 'read', mode: 'ro', model: '', effort: 'off' })
      const response = await fetch(base + '/api/agent-session/conversations', { method: 'POST', headers: { origin: base!, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'send', id: sessionId, text: 'Use read_file to read proof.txt, then reply with only its contents.' }), signal: AbortSignal.timeout(requestTimeoutMs) })
      const text = await response.text()
      responses.sessionEvents = text
      const stored = await api('/api/agent-session/conversations?id=' + sessionId)
      const turn = stored.conversation.turns.at(-1)
      assert.equal(turn.status, 'completed', text.slice(-1000))
      assert.ok(turn.items.some((item: { name: string; status: string }) => item.name === 'read_file' && item.status === 'completed'))
      assert.ok(turn.items.some((item: { kind: string; text: string }) => item.kind === 'assistant' && item.text.includes('SESSION_TOOLS_READY')))
      return 'Real model tool call, fixture bytes and persisted turn verified.'
    })
  } finally {
    if (sessionId) {
      await api('/api/agent-session/conversations', { action: 'stop', id: sessionId })
      // Stop acknowledges cancellation immediately; the run still needs to
      // settle and persist its final state before the delete guard can allow it.
      let stopped = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (!(await api('/api/agent-session/conversations?id=' + sessionId)).running) { stopped = true; break }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.ok(stopped, 'Test session did not finish stopping; preserved its fixture for diagnosis.')
      await api('/api/agent-session/conversations', { action: 'delete', id: sessionId })
    }
    if (chatId) await api('/api/chat/conversations?id=' + chatId, undefined, 'DELETE')
    assert.equal(path.dirname(fixture), os.tmpdir())
    await fs.rm(fixture, { recursive: true, force: true })
  }
  console.log(`${results.filter((result) => result.status === 'PASS').length}/${results.length} live workflows passed.`)
  if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
