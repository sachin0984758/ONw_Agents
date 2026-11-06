import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { autoModelMaxTokens, compactAutoTranscript, computerModelOutput } from '../src/lib/agent-hub/computer/model-context'
import type { ModelMessage } from '../src/lib/agent-hub/session/types'
import { autoResultText } from '../src/lib/agent-hub/computer/presentation'
import type { AutoTask } from '../src/lib/agent-hub/computer/protocol'

let passed = 0
const check = (name: string, value: unknown) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`) }
async function main() {
  check('ordinary tasks retain the compact response budget', autoModelMaxTokens('Open Notepad') === 1024)
  check('100-line drafting requests get enough output budget', autoModelMaxTokens('open note pad and type any story of 100 lines') === 4096)
  check('long word-count requests get the larger bounded output budget', autoModelMaxTokens('Write 500 words in a new document') === 4096)
  const snapshot = { snapshot_id: 'current', elements: [
    { id: 'current:0', control_type: 'Pane', name: '', patterns: [] },
    { id: 'current:1', control_type: 'Document', name: 'Editor', text: 'online', focused: true, bounds: [1, 2, 3, 4], text_rects: [[1, 2, 3, 4]], patterns: ['value'] },
  ], image: 'image bytes' }
  const compact = JSON.parse(computerModelOutput(snapshot))
  check('compact observation retains exact editable target, bounds, focus and readback', compact.snapshot_id === 'current' && compact.elements[0].id === 'current:1' && compact.elements[0].text === 'online' && compact.elements[0].focused && compact.elements[0].bounds.length === 4)
  check('screenshots, repeated geometry and unnamed layout panes stay out of model context', !compact.image && compact.elements.length === 1 && !compact.elements[0].text_rects && !compact.elements[0].patterns)
  const messages: ModelMessage[] = [{ role: 'system', content: 'Permissions stay enforced.' }, { role: 'user', content: 'Type online in a new tab.' }]
  for (let i = 0; i < 40; i++) messages.push(
    { role: 'assistant', content: '', tool_calls: [{ id: `call-${i}`, type: 'function', function: { name: 'desktop_inspect_window', arguments: '{"handle":1}' } }] },
    { role: 'tool', tool_call_id: `call-${i}`, content: JSON.stringify({ ok: true, verified: false, result: { snapshot_id: `s-${i}`, text: 'x'.repeat(5000) } }) },
  )
  const original = JSON.stringify(messages)
  const reduced = compactAutoTranscript(messages)
  check('long single-turn Auto history stays bounded', JSON.stringify(reduced).length < 9000)
  check('original request and permission instructions survive', reduced[0] === messages[0] && reduced[1] === messages[1])
  check('latest tool call and reply remain paired and unmodified', reduced.at(-2) === messages.at(-2) && reduced.at(-1) === messages.at(-1))
  check('old snapshot ids are not presented as fresh targets', !JSON.stringify(reduced).includes('s-38') && JSON.stringify(reduced).includes('s-39'))
  check('unverified outcomes remain explicitly unverified', reduced[2].content.includes('verified=false'))
  check('full audit evidence is not mutated by model compaction', JSON.stringify(messages) === original)
  const task = { phase: 'completed', result: '{"action":"done"}', events: [{ action: 'desktop.type_text', phase: 'verifying', ok: true, verified: true, output: '{"verified":true,"actual_text":"online"}' }] } as AutoTask
  check('completion marker becomes a receipt backed by actual editor text', autoResultText(task) === 'Typed "online" and verified it by reading the editor text back.')
  check('unverified input never becomes a verified completion receipt', !autoResultText({ ...task, events: [{ ...task.events[0], verified: false }] }).includes('Typed'))
  check('failure messages are preserved', autoResultText({ ...task, phase: 'failed', result: 'Permission denied' }) === 'Permission denied')

  const directory = await mkdtemp(path.join(tmpdir(), 'auto-context-test-'))
  const previousDb = process.env.AGENT_HUB_DB_DIR
  process.env.AGENT_HUB_DB_DIR = directory
  const originalFetch = globalThis.fetch
  let mode = 'sse-context'
  let requests = 0
  globalThis.fetch = async (_input, init) => {
    requests++
    const body = JSON.parse(String(init?.body))
    check('Auto response budget is passed to the provider', body.max_tokens === 1024)
    const error = mode === 'generic' ? { message: 'private prompt should not leak' } : { type: 'exceed_context_size_error', message: 'request exceeds the available context size' }
    return mode === 'http-context' ? Response.json({ error }, { status: 400 }) : new Response(`data: ${JSON.stringify({ error })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  try {
    const { createModelResponder } = await import('../src/lib/agent-hub/session/model')
    const respond = () => createModelResponder({ endpoint: 'http://127.0.0.1:1234/v1', apiKey: '', modelId: 'fixture', label: 'fixture' }, 'off', { maxTokens: 1024 })(messages.slice(0, 2), [], () => {}, new AbortController().signal)
    await assert.rejects(respond(), { name: 'ModelContextLimitError' }); check('HTTP 200 SSE provider errors are not blank successful answers', true)
    mode = 'http-context'; const before = requests
    await assert.rejects(respond(), { name: 'ModelContextLimitError' }); check('context failure is not retried as unsupported tools', requests === before + 1)
    mode = 'generic'
    await assert.rejects(respond(), (error: Error) => error.message.includes('generation error') && !error.message.includes('private prompt')); check('untrusted error contents are not exposed', true)
  } finally {
    globalThis.fetch = originalFetch
    if (previousDb === undefined) delete process.env.AGENT_HUB_DB_DIR; else process.env.AGENT_HUB_DB_DIR = previousDb
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep))
    await rm(directory, { recursive: true, force: true })
  }
  console.log(`\n${passed} Auto context and provider-error checks passed.`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
