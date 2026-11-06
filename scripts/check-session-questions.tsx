import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { runConversation, startTurn } from '../src/lib/agent-hub/session/runner'
import { parseSessionQuestion } from '../src/lib/agent-hub/session/questions'
import { SessionQuestionCard } from '../src/components/agent-hub/session-question-card'
import type { CodingConversation, SessionQuestion } from '../src/lib/agent-hub/session/types'

async function main() {
  let checks = 0
  for (const stage of ['requirements', 'design', 'plan'] as const) {
    const question: SessionQuestion = { stage, prompt: 'Which direction?', options: ['Use this approach', 'Revise it'], details: '## Proposed approach\n\nA compact dashboard.' }
    const conversation: CodingConversation = { version: 2, id: crypto.randomUUID(), title: 'Fixture', workspace: '.', mode: 'edit', model: 'fixture', effort: 'off', createdAt: '', updatedAt: '', turns: [], messages: [] }
    const turn = startTurn(conversation, 'Build a dashboard')
    let responses = 0
    let executions = 0
    await runConversation(conversation, turn, {
      system: '', tools: [{ name: 'ask_user', description: '', parameters: { type: 'object', properties: {} } }, { name: 'write_file', description: '', parameters: { type: 'object', properties: {} } }],
      respond: async () => { responses++; return { content: '', calls: [{ id: 'write', name: 'write_file', args: { path: 'test.txt', content: 'must not run' } }, { id: 'ask', name: 'ask_user', args: { ...question } }] } },
      execute: async () => { executions++; return { ok: true, output: '' } },
      approve: async () => { throw new Error('No approval should be requested while asking a question.') },
      save: async () => {}, emit: () => {},
    }, new AbortController().signal)
    assert.equal(responses, 1)
    assert.equal(executions, 0)
    assert.equal(turn.status, 'completed')
    assert.deepEqual(turn.items.find((item) => item.kind === 'question')?.question, question)
    assert.equal(conversation.messages.filter((message) => message.role === 'tool').length, 2, 'Every deferred call retains a protocol response')
    const restored = JSON.parse(JSON.stringify(turn))
    assert.deepEqual(restored.items.find((item: { kind: string }) => item.kind === 'question').question, question)
    const html = renderToStaticMarkup(<SessionQuestionCard question={question} disabled={false} answered={false} onAnswer={() => {}} />)
    assert.match(html, /type="radio"/)
    assert.match(html, /Something else/)
    assert.match(html, /Continue/)
    assert.match(html, /Proposed approach/)
    const answered = renderToStaticMarkup(<SessionQuestionCard question={question} disabled={false} answered onAnswer={() => {}} />)
    assert.match(answered, /fieldset disabled/)
    checks += 11
  }
  for (const invalid of [[], ['Only one'], ['Same', 'same'], ['A', 42], ['A', 'B', 'C', 'D', 'E']]) {
    assert.throws(() => parseSessionQuestion({ stage: 'design', prompt: 'Choose', options: invalid }))
    checks++
  }
  console.log(`${checks} session question checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
