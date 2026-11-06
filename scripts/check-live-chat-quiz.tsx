import { splitInteractiveQuizzes } from '../src/components/agent-hub/chat-view'

const baseUrl = process.env.AGENTHUB_TEST_URL ?? 'http://localhost:3000'
async function main() {
  const historyResponse = await fetch(`${baseUrl}/api/chat`)
  if (!historyResponse.ok) throw new Error(`Chat history request failed: HTTP ${historyResponse.status}`)
  const historyData = await historyResponse.json() as { messages?: Array<{ role: string; content: string }> }
  const history = (historyData.messages ?? []).slice(-20).map(({ role, content }) => ({ role, content }))
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'give 5 mcq',
      chatTitle: 'Data Science & AI Agents',
      history,
      stateless: true,
      stream: false,
      settings: {
        // Let the route choose the model that is actually loaded. Hard-coding a
        // merely-installed LM Studio model caused this check to fail before
        // exercising quiz generation.
        model: '',
        systemPrompt: 'You are the built-in assistant of AgentHub. Be helpful and concise.',
        teachMode: false,
        thinking: false,
        effort: 'medium',
      },
    }),
    signal: AbortSignal.timeout(180_000),
  })
  const result = await response.json() as { ok?: boolean; reply?: string; error?: string }
  if (!response.ok || !result.ok || !result.reply) throw new Error(result.error || `Quiz request failed: HTTP ${response.status}`)

  const segments = splitInteractiveQuizzes(result.reply)
  const quizzes = segments.filter((segment) => segment.type === 'quiz').map((segment) => segment.type === 'quiz' ? segment.quiz : null)
  console.log(`Model generated ${quizzes.length} interactive question card(s).`)
  console.log(`Title: ${quizzes[0]?.title ?? '(missing)'}`)
  console.log(`Choices per question: ${quizzes.map((quiz) => quiz?.options.length ?? 0).join(', ')}`)
  console.log(`Answer keys with explanations: ${quizzes.filter((quiz) => quiz?.correctLetter && quiz.explanation).length}/${quizzes.length}`)
  if (quizzes.length !== 5 || !quizzes.every((quiz) => quiz?.correctLetter && quiz.explanation)) {
    console.log(`Model reply preview:\n${result.reply.slice(0, 5000)}`)
  }

  if (quizzes.length !== 5) throw new Error(`Expected 5 interactive MCQs, received ${quizzes.length}.`)
  if (!quizzes[0]?.title) throw new Error('The generated quiz is missing its topic title.')
  if (!quizzes.every((quiz) => quiz?.options.length === 4 && quiz.correctLetter && quiz.explanation)) {
    throw new Error('At least one MCQ is missing choices, a correct answer, or an explanation.')
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
