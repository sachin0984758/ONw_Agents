import assert from 'node:assert/strict'
import { runConversation, startTurn } from '../src/lib/agent-hub/session/runner'
import type { CodingConversation, ToolOutcome } from '../src/lib/agent-hub/session/types'

// Deterministic runner tests: model replies are fixtures, not live inference.
async function exercise(request: string, outcome: ToolOutcome = { ok: true, output: 'Component found.' }) {
  const conversation: CodingConversation = {
    version: 2, id: crypto.randomUUID(), title: 'Completion regression', workspace: '.',
    mode: 'edit', model: 'fixture', effort: 'off', createdAt: '', updatedAt: '', turns: [], messages: [],
  }
  const turn = startTurn(conversation, request)
  let replies = 0
  await runConversation(conversation, turn, {
    system: 'Fixture',
    tools: [{ name: 'search_ui_components', description: 'Fixture search', parameters: { type: 'object', properties: {} } }],
    respond: async () => ++replies === 1
      ? { content: '', calls: [{ id: 'search', name: 'search_ui_components', args: {} }] }
      : { content: 'Here is the observed result.', calls: [] },
    execute: async () => outcome,
    approve: async () => { throw new Error('A read should not request approval.') },
    save: async () => {}, emit: () => {},
  }, new AbortController().signal)
  return { turn, replies }
}

async function main() {
  let passed = 0
  for (const constraint of [
    'Do not edit files.', "Don't edit files.", 'Don’t write files.',
    'Never update files.', 'You must not add files.', 'You should not create files.',
    'Do not write or edit files.', 'Do not edit, update or add files.',
    'Do not run code or write anything.', 'Never execute commands and edit files.',
    'Do not run scripts, write files or update code.',
  ]) {
    const { turn, replies } = await exercise(`Search the local UI component catalog. ${constraint}`)
    assert.equal(turn.status, 'completed', constraint)
    assert.equal(replies, 2, 'A completed read must not trigger implementation coaching')
    passed++
  }
  for (const request of ['Fix the composer. Do not edit tests.', 'Do not edit tests, but update the composer.', 'Create a component.']) {
    const { turn, replies } = await exercise(request)
    assert.equal(turn.status, 'partial', 'Actual implementation still needs change evidence')
    assert.equal(replies, 4, 'Unfulfilled implementation retains bounded coaching')
    passed++
  }
  const failed = await exercise('Search the catalog. Do not edit files.', { ok: false, output: 'Catalog unavailable.' })
  assert.equal(failed.turn.status, 'partial', 'A failed tool must not become completed')
  passed++
  console.log(`${passed} completion checks passed`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
