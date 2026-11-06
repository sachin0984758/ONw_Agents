import assert from 'node:assert/strict'
import test from 'node:test'
import { SSEBuilder, OpenAICompatProvider } from '../src/providers/openai.ts'
import { createServer } from 'node:http'
import { ProviderError } from '../src/providers/types.ts'

function event(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

test('SSE builder streams text, assembles tool calls and reads usage', () => {
  const builder = new SSEBuilder()
  const chunks: string[] = []
  builder.feed(event({ choices: [{ delta: { content: 'Hel' } }] }), (text) => chunks.push(text))
  builder.feed(
    event({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: 'read_file', arguments: '{"path":' },
              },
            ],
          },
        },
      ],
    }),
  )
  builder.feed(
    event({
      choices: [
        {
          delta: { content: 'lo', tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 5 },
    }),
    (text) => chunks.push(text),
  )
  builder.feed('data: [DONE]\n\n')
  const result = builder.finish()
  assert.equal(result.content, 'Hello')
  assert.deepEqual(chunks, ['Hel', 'lo'])
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0]?.function.name, 'read_file')
  assert.equal(result.toolCalls[0]?.function.arguments, '{"path":"a.txt"}')
  assert.deepEqual(result.usage, { input: 11, output: 5 })
  assert.equal(result.finishReason, 'tool_calls')
  assert.equal(result.done, true)
})

test('SSE builder handles CRLF and multiple data lines', () => {
  const builder = new SSEBuilder()
  builder.feed('event: message\r\ndata: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\n')
  const result = builder.finish()
  assert.equal(result.content, 'ok')
})

test('SSE builder rejects malformed events without hiding the cause', () => {
  const builder = new SSEBuilder()
  assert.throws(
    () => builder.feed('data: {"choices": [}\n\n'),
    (err: unknown) => err instanceof ProviderError && err.code === 'BAD_STREAM',
  )
})

test('SSE builder surfaces provider stream errors', () => {
  const builder = new SSEBuilder()
  assert.throws(
    () => builder.feed(event({ error: { message: 'model overloaded' } })),
    (err: unknown) => err instanceof ProviderError && /model overloaded/.test(err.message),
  )
})

test('LM Studio discovery uses the loaded context instead of the model maximum', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: req.url === '/v1/models' ? [{ id: 'local' }, { id: 'unloaded' }] : [
      { id: 'local', state: 'loaded', max_context_length: 1_048_576, loaded_context_length: 11_264 },
      { id: 'unloaded', state: 'not-loaded', max_context_length: 32_768 },
    ] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const provider = new OpenAICompatProvider({ id: 'lmstudio', kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${address.port}/v1` })
    const models = await provider.listModels(new AbortController().signal)
    assert.equal(models.find((model) => model.id === 'local')?.contextLength, 11_264)
    assert.equal(models.find((model) => model.id === 'unloaded')?.contextLength, 32_768)
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})
