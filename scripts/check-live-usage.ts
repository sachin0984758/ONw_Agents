import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import type { LLMTarget } from '../src/lib/agent-hub/llm'

async function main() {
  const temporary = await fs.mkdtemp(path.join(tmpdir(), 'agenthub-usage-'))
  process.env.AGENT_HUB_DB_DIR = temporary
  const { readState, recordServerUsage } = await import('../src/lib/agent-hub/state-file')
  const { createModelResponder } = await import('../src/lib/agent-hub/session/model')
  const { modelActivity } = await import('../src/lib/agent-hub/usage-events')
  const { GET } = await import('../src/app/api/usage/route')
  const { useHub } = await import('../src/lib/agent-hub/store')
  const { ledgerTotals, emptyLedger } = await import('../src/lib/agent-hub/token-usage')
  const { cpuUtilization } = await import('../src/lib/agent-hub/cpu-sample')
  const requests: Array<Record<string, unknown>> = []
  let passed = 0
  const check = (label: string, value: unknown) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`) }
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw); requests.push(body)
    if (body.model === 'error') { response.writeHead(500).end('provider details must stay private'); return }
    if (body.model === 'retry' && body.tools) { response.writeHead(400).end(); return }
    if (body.model === 'estimate') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { content: 'An actual answer.' }, finish_reason: 'stop' }] })); return }
    response.setHeader('Content-Type', 'text/event-stream')
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'USAGE_OK' }, finish_reason: null }] })}\n\n`)
    response.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 7, total_tokens: 107 } })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const target = (model = 'reported'): LLMTarget => ({ endpoint: `http://127.0.0.1:${port}`, apiKey: '', modelId: model, label: `Fixture · ${model}` })
  const messages = [{ role: 'user' as const, content: 'Reply with a short answer.' }]
  const cancellation = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const forbidden = await GET(new NextRequest('http://localhost/api/usage', { headers: { host: 'localhost', origin: 'https://example.com' } }))
    check('cross-origin usage stream is rejected', forbidden.status === 403)
    const stream = await GET(new NextRequest('http://localhost/api/usage', { signal: cancellation.signal }))
    check('usage endpoint is an uncached SSE stream', stream.headers.get('content-type') === 'text/event-stream' && stream.headers.get('cache-control')?.includes('no-cache'))
    reader = stream.body!.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    check('stream restores the durable ledger on connection', JSON.parse(first.slice(6)).ledger.records.length === 0)
    const before = (await readState()).updatedAt
    const reply = await createModelResponder(target(), 'off', { source: 'Auto' })(messages, [], () => {}, new AbortController().signal)
    check('real HTTP responder returns its answer', reply.content === 'USAGE_OK')
    check('session and Auto requests ask the provider for stream usage', (requests[0].stream_options as { include_usage?: boolean })?.include_usage === true)
    let state = await readState()
    check('provider input/output are persisted exactly once', state.tokenUsage.records.length === 1 && ledgerTotals(state.tokenUsage).input === 100 && ledgerTotals(state.tokenUsage).output === 7 && !state.tokenUsage.records[0].estimated)
    check('a token write advances the dashboard timestamp', Date.parse(state.updatedAt) > Date.parse(before))
    let updates = ''; let activeSeen = false; let ledgerSeen = false; let idleSeen = false
    while (!ledgerSeen || !idleSeen) {
      const chunk = await reader.read(); updates += new TextDecoder().decode(chunk.value)
      const frames = updates.split('\n\n'); updates = frames.pop() || ''
      for (const frame of frames) if (frame.startsWith('data: ')) {
        const value = JSON.parse(frame.slice(6)); activeSeen ||= value.active.length === 1; idleSeen ||= value.active.length === 0; ledgerSeen ||= value.ledger?.records.length === 1
      }
    }
    check('SSE pushes inference start, usage, and completion without polling', activeSeen && ledgerSeen && idleSeen)
    await createModelResponder(target('estimate'), 'off')(messages, [], () => {}, new AbortController().signal)
    state = await readState()
    check('missing provider usage is explicitly marked estimated', state.tokenUsage.records.length === 2 && state.tokenUsage.records[1].estimated && state.tokenUsage.records[1].output > 0)
    const tools = [{ name: 'test', description: 'test', parameters: { type: 'object' as const, properties: {} } }]
    await createModelResponder(target('retry'), 'off')(messages, tools, () => {}, new AbortController().signal)
    state = await readState()
    check('native-tool compatibility retry records one successful generation', requests.filter((value) => value.model === 'retry').length === 2 && state.tokenUsage.records.length === 3)
    await assert.rejects(createModelResponder(target('error'), 'off')(messages, [], () => {}, new AbortController().signal), /HTTP 500/)
    check('failed requests do not fabricate token records or leak active status', (await readState()).tokenUsage.records.length === 3 && modelActivity().length === 0)
    const cancelled = new AbortController(); cancelled.abort()
    await assert.rejects(createModelResponder(target(), 'off')(messages, [], () => {}, cancelled.signal))
    check('pre-dispatch cancellation records no tokens and clears activity', (await readState()).tokenUsage.records.length === 3 && modelActivity().length === 0)
    await Promise.all(Array.from({ length: 12 }, () => recordServerUsage({ input: 10, output: 2, model: 'Concurrent fixture' })))
    state = await readState()
    check('concurrent token writes are serialized without losing records', state.tokenUsage.records.length === 15)
    const oldState = { ...state, updatedAt: '2026-10-12T00:00:00Z', tokenUsage: emptyLedger() }
    useHub.setState({ state: oldState })
    useHub.getState().hydrateIfNewer({ ...oldState, tokenUsage: state.tokenUsage })
    check('a newer ledger hydrates even when the dashboard timestamp is unchanged', useHub.getState().state.tokenUsage.records.length === 15)
    useHub.getState().applyTokenUsage({ records: [], days: [], updatedAt: '2020-01-01T00:00:00Z' })
    check('an older model response cannot roll totals back to zero', useHub.getState().state.tokenUsage.records.length === 15)
    useHub.getState().applyTokenUsage({ ...state.tokenUsage, records: state.tokenUsage.records.slice(0, -1) })
    check('out-of-order responses with the same timestamp cannot lose a record', useHub.getState().state.tokenUsage.records.length === 15)
    check('CPU uses recent delta instead of lifetime average', cpuUtilization({ idle: 925, total: 1100 }, { idle: 900, total: 1000 }) === 75)
    check('CPU counter resets and empty time windows are rejected', cpuUtilization({ idle: 0, total: 0 }, { idle: 900, total: 1000 }) === null && cpuUtilization({ idle: 1, total: 2 }, { idle: 1, total: 2 }) === null)
    const { callLLM } = await import('../src/lib/agent-hub/llm')
    const priorCalls = ledgerTotals((await readState()).tokenUsage).requests
    const chatReply = await callLLM(target(), messages)
    const afterChat = (await readState()).tokenUsage
    check('shared Chat/Playground/teaching inference records its exact usage', chatReply === 'USAGE_OK' && afterChat.records.at(-1)?.input === 100 && afterChat.records.at(-1)?.output === 7)
    check('a shared model generation is counted once', ledgerTotals(afterChat).requests === priorCalls + 1)
    await callLLM(target(), messages); await callLLM(target(), messages)
    check('separate repair attempts count as separate generations', ledgerTotals((await readState()).tokenUsage).requests === priorCalls + 3 && modelActivity().length === 0)
    console.log(`\n${passed} live usage checks passed. All records used an isolated temporary database.`)
  } finally {
    cancellation.abort(); await reader?.cancel().catch(() => {})
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()))
    if (path.resolve(temporary).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(temporary).startsWith('agenthub-usage-')) await fs.rm(temporary, { recursive: true, force: true })
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
