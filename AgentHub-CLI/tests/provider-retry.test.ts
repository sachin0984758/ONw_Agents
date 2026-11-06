import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { OpenAICompatProvider } from '../src/providers/openai.ts'
import { ProviderError } from '../src/providers/types.ts'
import type { ProviderConfig } from '../src/config/types.ts'

function providerConfig(port: number, timeoutMs = 5_000): ProviderConfig {
  return {
    id: 'retry-test',
    kind: 'openai-compatible',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    local: true,
    timeoutMs,
  }
}

const SSE = [
  'data: {"choices":[{"delta":{"content":"retried"},"finish_reason":null}]}',
  '',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
  '',
  'data: [DONE]',
  '',
  '',
].join('\n')

test('provider retries a retryable server error and then streams the answer', async () => {
  let hits = 0
  const server = createServer((_req, res) => {
    hits++
    if (hits < 3) {
      res.statusCode = 500
      res.setHeader('content-type', 'text/plain')
      res.end('temporary failure')
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'text/event-stream')
    res.end(SSE)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const provider = new OpenAICompatProvider(providerConfig(port))
    let streamed = ''
    const response = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      signal: new AbortController().signal,
      onText: (text) => {
        streamed += text
      },
    })
    assert.equal(hits, 3)
    assert.equal(response.content, 'retried')
    assert.equal(streamed, 'retried')
    assert.deepEqual(response.usage, { input: 3, output: 2 })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('provider does not retry authentication errors', async () => {
  let hits = 0
  const server = createServer((_req, res) => {
    hits++
    res.statusCode = 401
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: { message: 'invalid key sk-abcdefghijklmnopqrstuvwx' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const provider = new OpenAICompatProvider(providerConfig(port))
    await assert.rejects(
      () =>
        provider.chat({
          model: 'test-model',
          messages: [{ role: 'user', content: 'hello' }],
          signal: new AbortController().signal,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError)
        assert.equal(err.code, 'AUTH')
        assert.equal(err.retryable, false)
        assert.ok(!err.message.includes('sk-abcdefghijklmnopqrstuvwx'))
        return true
      },
    )
    assert.equal(hits, 1)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('provider retries a body timeout only before any stream output has been emitted', async () => {
  let hits = 0
  const server = createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    if (hits === 1) {
      res.flushHeaders()
      return
    }
    res.end(SSE)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const provider = new OpenAICompatProvider(providerConfig(port, 100))
    const response = await provider.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      signal: new AbortController().signal,
    })
    assert.equal(hits, 2)
    assert.equal(response.content, 'retried')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('provider does not retry a timeout after partial streaming output', async () => {
  let hits = 0
  const server = createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.flushHeaders()
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const provider = new OpenAICompatProvider(providerConfig(port, 180))
    let streamed = ''
    await assert.rejects(
      provider.chat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        signal: new AbortController().signal,
        onText: (delta) => { streamed += delta },
      }),
      (err: unknown) => err instanceof ProviderError && err.code === 'PARTIAL' && !err.retryable,
    )
    assert.equal(hits, 1)
    assert.equal(streamed, 'partial')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('provider marks a disconnected partial stream and does not replay it', async () => {
  let hits = 0
  const server = createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.flushHeaders()
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`)
    setTimeout(() => res.destroy(), 25)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const provider = new OpenAICompatProvider(providerConfig(port, 3_000))
    await assert.rejects(
      provider.chat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        signal: new AbortController().signal,
      }),
      (err: unknown) => err instanceof ProviderError && err.code === 'PARTIAL' && !err.retryable,
    )
    assert.equal(hits, 1)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('provider cancellation during streaming is prompt and is not retried', async () => {
  let hits = 0
  const server = createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.flushHeaders()
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const controller = new AbortController()
  try {
    const provider = new OpenAICompatProvider(providerConfig(port, 3_000))
    await assert.rejects(
      provider.chat({
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        signal: controller.signal,
        onText: () => controller.abort(),
      }),
      (err: unknown) => err instanceof ProviderError && err.code === 'ABORTED',
    )
    assert.equal(hits, 1)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('model discovery reports a timeout while reading the response body', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.flushHeaders()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const provider = new OpenAICompatProvider(providerConfig(port, 120))
    await assert.rejects(
      provider.listModels(new AbortController().signal),
      (err: unknown) => err instanceof ProviderError && err.code === 'TIMEOUT',
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
