import assert from 'node:assert/strict'
import test from 'node:test'
import { compactMessages, trimMessages } from '../src/context/budget.ts'
import type { ChatMessage } from '../src/providers/types.ts'
import { defaultAnsi, setColorOverride } from '../src/utils/ansi.ts'
import { looksLikeSecret, redactHistory, redactSecrets } from '../src/utils/redact.ts'

test('secret redaction masks common token shapes and private keys', () => {
  const text = [
    'key sk-abcdefghijklmnopqrstuvwx',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'api_key = "0123456789abcdef"',
    '-----BEGIN RSA PRIVATE KEY-----',
    'not-a-real-key',
    '-----END RSA PRIVATE KEY-----',
    'normal text stays',
  ].join('\n')
  const redacted = redactSecrets(text)
  assert.ok(!redacted.includes('sk-abcdefghijklmnopqrstuvwx'))
  assert.ok(!redacted.includes('abcdefghijklmnopqrstuvwxyz'))
  assert.ok(!redacted.includes('0123456789abcdef'))
  assert.ok(!redacted.includes('not-a-real-key'))
  assert.ok(redacted.includes('***REDACTED***'))
  assert.ok(redacted.includes('normal text stays'))
  assert.equal(looksLikeSecret('sk-abcdefghijklmnopqrstuvwx'), true)
  assert.equal(looksLikeSecret('a normal sentence about code'), false)
})

test('terminal history redacts recognizable secrets before persistence', () => {
  const entries = redactHistory(['use token=0123456789abcdef for local testing', 'ordinary command'])
  assert.match(entries[0] ?? '', /token=\*\*\*REDACTED\*\*\*/)
  assert.equal(entries[1], 'ordinary command')
})

test('context trimming evicts old tool output and keeps the system prompt and task', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'tool', tool_call_id: 'call_1', content: 'x'.repeat(20_000) },
    { role: 'user', content: 'the original task' },
    { role: 'assistant', content: 'y'.repeat(4_000) },
    { role: 'user', content: 'recent question' },
    { role: 'assistant', content: 'recent answer' },
  ]
  const result = trimMessages(messages, 2_000)
  assert.equal(result.messages[0]?.role, 'system')
  assert.equal(result.messages[0]?.content, 'system prompt')
  assert.ok(result.messages.some((m) => m.content === 'the original task'))
  assert.ok(result.evictedChars > 0)
  assert.ok(result.estimated <= 2_000 || result.overBudget)
  const tool = result.messages.find((m) => m.role === 'tool')
  if (tool) assert.ok(String(tool.content).length < 20_000)
})

test('compaction keeps the system prompt and never starts the tail with a tool result', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'old task' },
    { role: 'assistant', content: 'old answer' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'orphan candidate' },
    { role: 'user', content: 'new question' },
    { role: 'assistant', content: 'new answer' },
  ]
  const compacted = compactMessages(messages, 2)
  assert.equal(compacted[0]?.role, 'system')
  assert.equal(compacted[0]?.content, 'system prompt')
  assert.notEqual(compacted[1]?.role, 'tool')
  assert.ok(compacted.some((m) => m.content === 'new answer'))
})

test('trimming after several tool calls preserves the current user task as well as the original task', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'protected system' },
    { role: 'user', content: 'the first task' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'the current task must survive' },
  ]
  for (let index = 0; index < 5; index++) {
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id: `call_${index}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: `call_${index}`, content: 'x'.repeat(4000) })
  }
  const trimmed = trimMessages(messages, 1500)
  assert.ok(trimmed.messages.some((message) => message.content === 'the current task must survive'))
  assert.ok(trimmed.messages.some((message) => message.content === 'the first task'))
})

test('colour can be forced off and on, then returned to automatic', () => {
  try {
    setColorOverride(false)
    assert.equal(defaultAnsi().enabled, false)
    setColorOverride(true)
    assert.equal(defaultAnsi().enabled, true)
  } finally {
    setColorOverride(undefined)
  }
})
