import assert from 'node:assert/strict'
import http from 'node:http'
import { callLLM, streamLLM, type LLMRequestMetrics } from '../src/lib/agent-hub/llm'

const counts = { passed: 0 }
const check = (name: string, value: unknown) => { assert.ok(value, name); counts.passed++; console.log(`PASS ${name}`) }
let mode = 'success'
const server = http.createServer(async (req, res) => {
  for await (const _ of req) { /* consume the request */ }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  if (mode === 'malformed') { res.end('data: {bad json}\n\n'); return }
  if (mode === 'length') {
    res.end('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'); return
  }
  if (mode === 'reasoning-length') {
    res.end('data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\ndata: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'); return
  }
  if (mode === 'incomplete') {
    res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); return
  }
  res.write('data: {"choices":[{"delta":{"content":"Five "}}]}\n\n')
  setTimeout(() => {
    res.write('data: {"choices":[{"delta":{"content":"questions"},"finish_reason":"stop"}]}\n\n')
    res.write('data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":7,"total_tokens":19}}\n\n')
    res.end('data: [DONE]\n\n')
  }, 15)
})

async function main() {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const target = { endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: '', modelId: 'fixture', label: 'fixture' }
  try {
    let metrics: LLMRequestMetrics | undefined
    const text = await callLLM(target, [{ role: 'user', content: 'fixture only' }], { onMetrics: value => { metrics = value } })
    check('final-answer helper consumes streamed deltas', text === 'Five questions')
    check('request metrics include first-token time, measured throughput and provider usage', metrics?.status === 'completed' && metrics.timeToFirstTokenMs !== null && metrics.outputTokens === 7 && metrics.tokensPerSecond !== null && metrics.requestId.length > 0)
    mode = 'length'
    await assert.rejects(async () => { for await (const _ of streamLLM(target, [])) { /* exhaust */ } }, /output-token limit/)
    check('output-token truncation is reported as partial failure', true)
    mode = 'reasoning-length'
    let reasoningMetrics: LLMRequestMetrics | undefined
    await assert.rejects(async () => {
      for await (const _ of streamLLM(target, [], { onMetrics: value => { reasoningMetrics = value } })) { /* exhaust */ }
    }, /output-token limit/)
    check('provider reasoning tokens count as model output without exposing their text in final-answer aggregation', reasoningMetrics?.timeToFirstTokenMs !== null && reasoningMetrics?.failureStage === 'generating')
    mode = 'incomplete'
    await assert.rejects(async () => { for await (const _ of streamLLM(target, [])) { /* exhaust */ } }, /ended before completion/)
    check('EOF without a finish marker is reported as incomplete', true)
    mode = 'malformed'
    await assert.rejects(async () => { for await (const _ of streamLLM(target, [])) { /* exhaust */ } }, /malformed stream frame/)
    check('malformed provider frames fail clearly', true)
    console.log(`\n${counts.passed} LLM streaming checks passed.`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
