// Opt-in real local-model check. All session persistence uses a temporary DB.
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import type { SessionTurn } from '../src/lib/agent-hub/session/types'

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-live-questions-'))
  process.env.AGENT_HUB_DB_DIR = path.join(fixture, 'db')
  process.env.AGENT_SESSION_WORKSPACE = fixture
  const { detectLocalProviders } = await import('../src/lib/agent-hub/llm')
  const providers = await detectLocalProviders()
  const model = providers.flatMap((provider) => provider.available ? provider.detailedModels : []).find((model) => model.loaded && model.isChatCompatible)
  assert.ok(model, 'A chat-compatible local model must already be loaded')
  const api = await import('../src/app/api/agent-session/conversations/route')
  const post = (body: Record<string, unknown>) => api.POST(new NextRequest('http://localhost/api/agent-session/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'localhost' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) }))
  const created = await post({ action: 'create', model: model.id, effort: 'off' })
  assert.equal(created.status, 200)
  const { conversation } = await created.json()
  const results: Array<{ stage: string; status: string; agent?: string; options: string[] }> = []
  let message = '/website dashboard'
  for (const stage of ['requirements', 'design', 'plan']) {
    const response = await post({ action: 'send', id: conversation.id, text: message })
    assert.equal(response.status, 200)
    const stream = await response.text()
    const events = stream.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)))
    const turn: SessionTurn = events.filter((event) => event.type === 'turn').at(-1)?.turn
    assert.ok(turn, 'Expected a streamed turn')
    assert.equal(turn.agent?.id, 'website', 'A plain-text choice must retain the selected agent')
    assert.equal(turn.status, 'completed')
    const question = turn.items.find((item) => item.kind === 'question')?.question
    assert.ok(question, `Expected a clickable ${stage} question`)
    assert.equal(question.stage, stage)
    assert.equal(turn.changes.length, 0, 'Clarification never writes files')
    results.push({ stage, status: turn.status, agent: turn.agent?.id, options: question.options })
    console.log(`PASS live ${stage}: ${question.prompt}`)
    message = stage === 'requirements'
      ? `Answer to ${question.prompt}: ${question.options[0]}. Use a new single-page personal task dashboard, React, mock data, three summary cards, a task list, a light theme and blue accents. These are my requirements; show the proposed design for confirmation next.`
      : `Answer to ${question.prompt}: Use this design. Show the implementation checklist and ask whether to proceed with the plan. Workspace access will be configured after planning.`
  }
  const evidence = path.resolve('.verification/session-questions-live.json')
  await fs.mkdir(path.dirname(evidence), { recursive: true })
  await fs.writeFile(evidence, JSON.stringify({ model: model.id, checkedAt: new Date().toISOString(), results, fixture }, null, 2))
  console.log(`PASS live flow with ${model.id}; evidence: ${evidence}`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
