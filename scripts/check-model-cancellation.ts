import assert from 'node:assert/strict'
import http from 'node:http'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { callLLM, streamLLM } from '../src/lib/agent-hub/llm'

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-model-cancel-'))
  process.env.AGENT_HUB_DB_DIR = fixture
  const connections: Array<{ closed: Promise<void> }> = []
  let refuseStream = false
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    connections.push({ closed: new Promise<void>((resolve) => res.once('close', resolve)) })
    if (body.stream && refuseStream) { res.writeHead(400); res.end('{}'); return }
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"choices":[')
    }
    // Deliberately never finish: only the caller's cancellation releases this.
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const target = { endpoint: `http://127.0.0.1:${port}/v1`, apiKey: '', modelId: 'cancel-fixture', label: 'Fixture' }
  let passed = 0
  const check = (name: string, value: unknown) => { assert.ok(value, name); passed++; console.log(`PASS ${name}`) }
  const deadline = <T,>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Cancellation did not release the provider connection.')), 2000); timer.unref() })])
  const accepted = async (count: number) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (connections.length >= count) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('Provider did not receive the fixture request.')
  }
  try {
    const nonstream = new AbortController()
    const pending = callLLM(target, [{ role: 'user', content: 'test' }], { signal: nonstream.signal })
    await deadline(accepted(1)); nonstream.abort()
    await assert.rejects(pending)
    await deadline(connections[0].closed)
    check('non-stream cancellation closes a real HTTP provider connection', true)

    const iterator = streamLLM(target, [{ role: 'user', content: 'test' }])
    check('stream yields the provider delta', (await iterator.next()).value?.type === 'delta')
    await iterator.return()
    await deadline(connections[1].closed)
    check('leaving an iterator closes its upstream SSE body', true)

    refuseStream = true
    const fallback = new AbortController()
    const fallbackIterator = streamLLM(target, [{ role: 'user', content: 'test' }], { signal: fallback.signal })
    const next = fallbackIterator.next()
    await deadline(accepted(4)); fallback.abort()
    await assert.rejects(next)
    await deadline(connections[3].closed)
    check('non-stream fallback preserves cancellation', true)
    refuseStream = false

    await fs.writeFile(path.join(fixture, 'custom-models.json'), JSON.stringify([{ id: 'custom-cancel', name: 'Cancellation fixture', ...target, createdAt: new Date().toISOString() }]))
    const chat = await import('../src/app/api/chat/route')
    const chatResponse = await chat.POST(new NextRequest('http://localhost/api/chat', { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, body: JSON.stringify({ message: 'test', stateless: true, stream: true, settings: { model: 'custom-cancel' } }) }))
    const reader = chatResponse.body!.getReader()
    check('Chat route forwards the real first SSE frame', new TextDecoder().decode((await reader.read()).value).includes('first'))
    await reader.cancel()
    await deadline(connections[4].closed)
    check('cancelling the Chat response aborts the provider', true)
    check('cancelled Chat does not invent completed chat history', !(await fs.readdir(fixture)).some((name) => /^chat-history|chat-threads/.test(name)))
    const { readState } = await import('../src/lib/agent-hub/state-file')
    const usage = (await readState()).tokenUsage
    check('partial generations are metered as estimates, never fabricated provider counts', usage.records.length > 0 && usage.records.every((record) => record.estimated === true))

    const playground = await import('../src/app/api/playground/route')
    const aborted = new AbortController()
    const analysis = playground.POST(new NextRequest('http://localhost/api/playground', { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, signal: aborted.signal, body: JSON.stringify({ action: 'analyze', actionId: 'explain', mode: 'code', languageId: 'python', code: 'print(1)', model: 'custom-cancel', level: 'beginner' }) }))
    await deadline(accepted(6)); aborted.abort()
    const cancelled = await analysis
    await deadline(connections[5].closed)
    check('Playground disconnect aborts its provider and returns no invented answer', cancelled.status === 502 && (await cancelled.json()).ok === false)
    console.log(`\n${passed} model cancellation checks passed.`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    assert.equal(path.dirname(fixture), os.tmpdir())
    await fs.rm(fixture, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
