import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { splitInteractiveQuizzes } from '../src/components/agent-hub/chat-view'
import { parseChatDiagram } from '../src/components/agent-hub/chat-diagram'

const base = process.env.AGENTHUB_TEST_URL ?? 'http://localhost:3000'
const outDir = path.resolve('.verification/teaching-ui')
const report: Array<{ name: string; reply: string }> = []
const settings = { model: process.env.AGENTHUB_TEST_MODEL ?? '', thinking: false, effort: 'medium' }
const firstRequest = 'Teach me how AI agents choose and use permitted tools. Begin Advanced Step 1 only, with a simple analogy and one small diagram. Keep the prose under 100 words and wait for my confirmation.'
async function ask(name: string, message: string, options: Record<string, unknown>) {
  const saved = process.argv.includes('--resume') ? report.find((item) => item.name === name) : undefined
  if (saved) { console.log(`Rechecking saved live ${name}…`); return saved.reply }
  console.log(`Running live ${name}…`)
  const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, stream: false, ...options }), signal: AbortSignal.timeout(300_000) })
  const data = await response.json() as { ok?: boolean; reply?: string; error?: string }
  if (!response.ok || !data.ok || !data.reply) throw new Error(data.error || `HTTP ${response.status}`)
  report.push({ name, reply: data.reply })
  await writeFile(path.join(outDir, 'model-responses.json'), JSON.stringify(report, null, 2))
  return data.reply
}
function check(name: string, condition: boolean) {
  if (!condition) throw new Error(name)
  console.log(`PASS ${name}`)
}
function quiz(reply: string) { return splitInteractiveQuizzes(reply).flatMap((segment) => segment.type === 'quiz' ? [segment.quiz] : []) }
function diagrams(reply: string) { return [...reply.matchAll(/```diagram\s*([\s\S]*?)```/g)].map((match) => parseChatDiagram(match[1])).filter(Boolean) }
async function verifyGates(first: string) {
  const confused = await ask('Advanced confused learner', 'No, I am still confused. Explain Step 1 with a different analogy in under 80 words. Do not continue yet.', { stateless: true, history: [{ role: 'user', content: firstRequest }, { role: 'assistant', content: first }], settings: { ...settings, advancedTeachMode: true } })
  check('a confused learner stays on Step 1', /Step\s*1\b/i.test(confused) && !/Step\s*[2-5]\s*[:—-]/i.test(confused))
  const vague = await ask('Advanced vague topic', 'Teach me something advanced.', { stateless: true, history: [], settings: { ...settings, advancedTeachMode: true } })
  check('a vague topic asks clarifying questions before Step 1', !/Step\s*1\s*[:—-]/i.test(vague) && (vague.match(/\?/g) ?? []).length >= 2)
}
async function finishSteps(first: string, second: string) {
  const history = [{ role: 'user', content: firstRequest }, { role: 'assistant', content: first }, { role: 'user', content: 'Yes, continue to Step 2.' }, { role: 'assistant', content: second }]
  const thirdRequest = 'Yes, I understand. Continue to Step 3 only: the three-sentence stakeholder script, then ask for confirmation.'
  const third = await ask('Advanced Step 3', thirdRequest, { stateless: true, history, settings: { ...settings, advancedTeachMode: true } })
  const numberedSentences = [...third.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)].map((match) => match[1])
  const script = (numberedSentences.length ? numberedSentences.join(' ') : third.replace(/^\s*#{1,6}.*$/gm, '').split(/\n+/).filter((line) => !line.includes('?') && !line.trim().endsWith(':')).join(' ')).replace(/\*+/g, '')
  check('Step 3 gives exactly three script sentences and waits', /Step\s*3\b/i.test(third) && (script.match(/[.!](?:\s|$)/g) ?? []).length === 3 && third.includes('?') && !/Step\s*[45]\s*[:—-]/i.test(third))
  history.push({ role: 'user', content: thirdRequest }, { role: 'assistant', content: third })
  const fourthRequest = 'Yes, continue to Step 4 only. Give the three methods with when-to-use criteria and an actionable first step for each. Include a small methods diagram; keep prose under 220 words, then wait.'
  const fourth = await ask('Advanced Step 4', fourthRequest, { stateless: true, history, settings: { ...settings, advancedTeachMode: true } })
  const fourthText = fourth.replace(/\*+/g, '')
  check('Step 4 gives three actionable methods, a diagram and a confirmation gate', /Step\s*4\b/i.test(fourth) && (fourthText.match(/when(?:\s+to\s+use)?\s*:/gi) ?? []).length >= 3 && (fourthText.match(/(?:step\s*1|first step)\s*:/gi) ?? []).length >= 3 && diagrams(fourth).length > 0 && fourth.includes('?') && !/Step\s*5\s*[:—-]/i.test(fourth))
  history.push({ role: 'user', content: fourthRequest }, { role: 'assistant', content: fourth })
  const fifth = await ask('Advanced Step 5', 'Yes, continue to Step 5. Audit second-order consequences, counter-incentives, one severe edge case and mitigation. Finish with three advanced scenario MCQs about these methods, using hidden answers and explanations. Keep the audit prose under 160 words.', { stateless: true, history, settings: { ...settings, advancedTeachMode: true } })
  const questions = quiz(fifth)
  check('Step 5 completes the audit with three scored scenario MCQs', /Step\s*5\b/i.test(fifth) && /consequen|ripple|second.order/i.test(fifth) && /incentiv/i.test(fifth) && /edge.case/i.test(fifth) && /mitigat|prevent/i.test(fifth) && questions.length === 3 && questions.every((question) => question.correctLetter && question.explanation && question.options.length === 4))
}
async function verifyPractice(first: string, second: string) {
  const practice = await ask('Advanced current-step practice', 'Give 3 MCQ on AI agents and tool permissions using only the material taught so far. Do not advance the lesson.', { stateless: true, history: [{ role: 'user', content: firstRequest }, { role: 'assistant', content: first }, { role: 'user', content: 'Yes, I understand. Continue to Step 2 only, under 100 words.' }, { role: 'assistant', content: second }], settings: { ...settings, advancedTeachMode: true } })
  const questions = quiz(practice)
  check('Advanced produces three scored questions about the current material without advancing', questions.length === 3 && questions.every((question) => question.correctLetter && question.explanation && question.options.length === 4 && /tool|permission|authoriz|restrict/i.test(question.prompt)) && !/Step\s*[3-5]\s*[:—-]|\bRAG\b|retriev|multi-agent/i.test(practice))
}
async function main() {
  await mkdir(outDir, { recursive: true })
  if (process.argv.includes('--guards-only') || process.argv.includes('--finish-steps') || process.argv.includes('--practice-only')) {
    const previous = JSON.parse(await readFile(path.join(outDir, 'model-responses.json'), 'utf8')) as typeof report
    report.push(...previous)
    const first = previous.find((item) => item.name === 'Advanced Step 1')?.reply
    if (!first) throw new Error('Run the full live teaching check before --guards-only')
    if (process.argv.includes('--finish-steps') || process.argv.includes('--practice-only')) {
      const second = previous.find((item) => item.name === 'Advanced confirmation')?.reply
      if (!second) throw new Error('The saved Step 2 response is missing')
      if (process.argv.includes('--practice-only')) await verifyPractice(first, second)
      else await finishSteps(first, second)
    } else await verifyGates(first)
    return
  }
  const created = await fetch(`${base}/api/chat/conversations`, { method: 'POST' }).then((response) => response.json()) as { conversation: { id: string } }
  const id = created.conversation.id
  await writeFile(path.join(outDir, 'test-conversation-id.txt'), id)
  const request = 'Teach me AI Agents as a focused visual module. Give only the detailed architecture diagram from the supplied guide and its exact three foundational MCQs. Keep all seven architecture nodes and the original question/option wording. Use a diagram JSON fence and hidden answer fences with explanations. Do not output the full guide or reveal answers in prose.'
  const taught = await ask('Teach visual module', request, { chatId: id, settings: { ...settings, teachMode: true } })
  await fetch(`${base}/api/chat/conversations`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, title: 'Verification: AI Agents diagrams and quiz' }) })
  check('Teach generates a valid connected architecture diagram', diagrams(taught).some((diagram) => (diagram?.nodes?.length ?? 0) >= 7 && (diagram?.edges?.length ?? 0) >= 6))
  const questions = quiz(taught)
  check('Teach generates the exact three scored MCQs with B, C, B keys and explanations', questions.length === 3 && questions.map((question) => question.correctLetter).join('') === 'BCB' && questions.every((question) => question.options.length === 4 && Boolean(question.explanation)))

  const first = await ask('Advanced Step 1', firstRequest, { stateless: true, history: [], settings: { ...settings, advancedTeachMode: true } })
  check('Advanced starts at Step 1 with a rendered diagram and no later step', /Step\s*1\b/i.test(first) && !/Step\s*[2-5]\s*[:—-]/i.test(first) && diagrams(first).length > 0)
  await verifyGates(first)
  const history = [{ role: 'user', content: firstRequest }, { role: 'assistant', content: first }]
  const second = await ask('Advanced confirmation', 'Yes, I understand. Continue to Step 2 only, under 100 words.', { stateless: true, history, settings: { ...settings, advancedTeachMode: true } })
  check('Advanced moves to Step 2 after confirmation and stops there', /Step\s*2\b/i.test(second) && !/Step\s*[3-5]\s*[:—-]/i.test(second))
  await verifyPractice(first, second)
  await finishSteps(first, second)
  console.log(`Live teaching checks passed. Test conversation: ${id}`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
