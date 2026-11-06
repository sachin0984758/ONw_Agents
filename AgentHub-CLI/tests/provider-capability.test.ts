import assert from 'node:assert/strict'
import test from 'node:test'
import { probeToolCalling } from '../src/providers/registry.ts'
import { MockProvider, mockTarget, toolResponse } from './helpers.ts'

test('tool support probe requires the requested tool with valid arguments', async () => {
  for (const [name, args] of [['wrong_tool', '{}'], ['get_clock', 'not json'], ['get_clock', '[]'],
    ['get_clock', '{"timezone":42}'], ['get_clock', '{"extra":"unsupported"}']] as const) {
    const response = toolResponse(name, {})
    response.toolCalls[0]!.function.arguments = args
    const probe = await probeToolCalling(mockTarget(new MockProvider(() => response)), new AbortController().signal)
    assert.equal(probe.status, 'inconclusive', `${name}: ${args}`)
  }
})

test('a valid native get_clock response proves the narrow tool probe', async () => {
  const probe = await probeToolCalling(mockTarget(new MockProvider(() => toolResponse('get_clock', { timezone: 'UTC' }))), new AbortController().signal)
  assert.equal(probe.status, 'supported')
})
