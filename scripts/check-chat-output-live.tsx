import { mkdir, writeFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown, splitInteractiveQuizzes } from '../src/components/agent-hub/chat-view'

const output = '.verification/chat-output'
const cases = [
  { name: 'normal-mcq', message: 'Give exactly 2 beginner MCQs about Python lists. Each has 4 choices, a correct answer and a brief explanation. Include inline code in a choice.', settings: {} },
  { name: 'mixed-code-markdown', message: 'In under 120 words explain Python lists: one heading, a 3-line Python code fence, a two-column Markdown table with two rows, a short bullet list, and one inline code example.', settings: {} },
  { name: 'teach', message: 'Teach Python list indexing briefly. Include a small Python code example and exactly 2 practice MCQs with four options and hidden answers plus explanations. Keep it under 250 words.', settings: { teachMode: true } },
  { name: 'advanced', message: 'Teach Python list indexing in Advanced mode. Start Step 1 only, use a simple analogy and ask me to confirm before proceeding. Keep it under 100 words.', settings: { advancedTeachMode: true } },
]

async function main() {
  await mkdir(output, { recursive: true })
  const results: Array<{ name: string; passed: boolean; checks?: Record<string, boolean>; model?: string; error?: string }> = []
  for (const item of cases) {
    console.log(`Checking local model: ${item.name}`)
    try {
      const response = await fetch('http://127.0.0.1:3000/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: item.message, history: [], stateless: true, stream: true, settings: { model: 'flint', thinking: false, effort: 'medium', ...item.settings } }),
        signal: AbortSignal.timeout(300_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      let firstDelta = true
      let data: { reply?: string; model?: string } = {}
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        pending += decoder.decode(chunk.value, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const event = JSON.parse(line.slice(6))
          if (event.type === 'delta' && firstDelta) { console.log(`Receiving ${item.name} output`); firstDelta = false }
          if (event.type === 'error') throw new Error(event.error || event.message || 'Stream failed')
          if (event.type === 'done') data = event
        }
      }
      if (!data.reply) throw new Error('Stream ended without a completed answer')
      const reply = String(data.reply)
      const html = renderToStaticMarkup(createElement(Markdown, { content: reply }))
      const quizzes = splitInteractiveQuizzes(reply).flatMap((segment) => segment.type === 'quiz' ? [segment.quiz] : [])
      const checks: Record<string, boolean> = item.name.includes('mcq') || item.name === 'teach'
        ? { twoQuestions: quizzes.length === 2, fourChoicesAndKeys: quizzes.every((q) => q.options.length === 4 && Boolean(q.correctLetter) && Boolean(q.explanation)), radioControls: (html.match(/type="radio"/g) ?? []).length === 8, hiddenAnswers: !html.includes('Correct answer:') }
        : item.name === 'advanced'
          ? { firstStep: /Step\s*1\b/i.test(reply), noLaterStep: !/Step\s*[2-5]\s*[:—-]/i.test(reply), confirmation: reply.includes('?') }
          : { codeBlock: html.includes('data-code-block="python"'), table: html.includes('<table>'), list: html.includes('<ul>'), heading: /<h[1-6]>/.test(html) }
      await writeFile(`${output}/${item.name}.md`, reply)
      await writeFile(`${output}/${item.name}.html`, html)
      const passed = Object.values(checks).every(Boolean)
      results.push({ name: item.name, passed, checks, model: data.model })
      console.log(`${passed ? 'PASS' : 'FAIL'} ${item.name}: ${JSON.stringify(checks)}`)
    } catch (error) {
      results.push({ name: item.name, passed: false, error: String(error) })
      console.log(`FAIL ${item.name}: ${String(error)}`)
    }
    await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1
}
void main()
