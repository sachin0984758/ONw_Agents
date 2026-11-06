import assert from 'node:assert/strict'
import { computerModels, selectComputerModel, selectComputerVision } from '../src/lib/agent-hub/computer/model-selection'
import { computerTarget, prepareComputerModel } from '../src/lib/agent-hub/computer/model-runtime'
import type { LLMTarget, ProviderCheck } from '../src/lib/agent-hub/llm'

let passed = 0
const check = (label: string, result: unknown) => { assert.ok(result, label); passed++; console.log(`PASS ${label}`) }
const provider = (id: string, loaded: boolean): ProviderCheck => ({
  id, name: id, endpoint: id === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : 'http://127.0.0.1:11434/v1', port: 1234,
  available: true, loadedStateKnown: true, models: ['text-a', 'vision-b', 'embedding-c'],
  detailedModels: [
    { id: 'text-a', name: 'text-a', providerId: id, providerName: id, type: 'llm', loaded, isChatCompatible: true },
    { id: 'vision-b', name: 'vision-b', providerId: id, providerName: id, type: 'vlm', loaded: false, isChatCompatible: true },
    { id: 'embedding-c', name: 'embedding-c', providerId: id, providerName: id, type: 'embeddings', loaded: true, isChatCompatible: false },
  ],
})
async function main() {
  const lm = provider('lmstudio', false)
  const ollama = provider('ollama', true)
  check('disconnected providers cannot supply stale models', computerModels([{ ...lm, available: false }]).length === 0)
  const models = computerModels([lm, ollama])
  check('Automatic prefers a loaded chat model over an unloaded catalog entry', selectComputerModel(models)?.loaded)
  check('an arbitrary new local chat model is supported without a name allowlist', selectComputerModel([{ ...models[0], id: 'brand-new-model', loaded: true }])?.id === 'brand-new-model')
  check('embedding models are excluded from automatic and explicit selection', !selectComputerModel(models.filter((m) => !m.chat)) && !selectComputerModel(models, 'embedding-c'))
  check('a missing manual model never silently switches to another model', !selectComputerModel(models, 'removed-model'))
  check('when none is loaded an installed text model can be loaded on demand', selectComputerModel(computerModels([lm]))?.id === 'text-a')
  check('a vision chat model can also be the primary model', selectComputerModel(computerModels([lm]).filter((m) => m.vision))?.id === 'vision-b')
  const vision = { ...models.find((m) => m.vision)!, loaded: true }
  check('Automatic vision reuses a compatible loaded primary model', selectComputerVision([vision], 'auto', vision.id)?.id === vision.id)
  check('text models never receive screenshot grounding requests', !selectComputerVision(models, 'auto', 'text-a'))
  check('vision can be disabled or explicitly selected', !selectComputerVision([vision], '', vision.id) && selectComputerVision([vision], vision.id, 'text-a')?.id === vision.id)
  const picked = computerTarget([lm, ollama], '')
  check('runtime uses the same loaded-first policy as the interface', picked.endpoint.includes('11434') && picked.loaded)
  assert.throws(() => computerTarget([lm], 'embedding-c'))
  assert.throws(() => computerTarget([lm], 'removed-model'))
  assert.throws(() => computerTarget([{ ...lm, endpoint: 'https://example.com/v1' }], ''))
  check('unavailable, non-chat and remote targets are rejected', true)
  let calls = 0
  const loading = computerTarget([lm], '')
  const loader: typeof fetch = async (url, options) => {
    calls++
    assert.equal(String(url), 'http://127.0.0.1:1234/api/v1/models/load')
    assert.equal(options?.method, 'POST')
    assert.deepEqual(JSON.parse(String(options?.body)), { model: 'text-a' })
    return Response.json({ status: 'loaded', instance_id: 'text-a-instance' })
  }
  const loaded = await prepareComputerModel(loading, new AbortController().signal, loader)
  check('installed LM Studio model loads through the native API and its instance is used', calls === 1 && loaded.loaded && loaded.modelId === 'text-a-instance')
  await prepareComputerModel({ ...loading, loaded: true }, new AbortController().signal, loader)
  check('an already-loaded model triggers no additional load request', calls === 1)
  await prepareComputerModel(computerTarget([provider('ollama', false)], ''), new AbortController().signal, loader)
  check('Ollama uses inference loading and never calls the LM Studio load API', calls === 1)
  const old = await prepareComputerModel(loading, new AbortController().signal, async () => new Response('', { status: 404 }))
  check('older LM Studio falls back to just-in-time inference loading', old.modelId === 'text-a' && old.loaded === false)
  await assert.rejects(prepareComputerModel(loading, new AbortController().signal, async () => new Response('sensitive provider error', { status: 500 })), /HTTP 500/)
  check('load errors are reported without exposing provider response bodies', true)
  await assert.rejects(prepareComputerModel(loading, new AbortController().signal, async () => Response.json({ status: 'loading' })), /did not confirm/)
  check('a successful HTTP response alone does not claim a loaded model', true)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(prepareComputerModel(loading, cancelled.signal, loader))
  check('cancelling before load dispatch executes no request', calls === 1)
  await assert.rejects(prepareComputerModel({ ...loading, endpoint: 'http://192.168.1.9:1234/v1' } as LLMTarget, new AbortController().signal, loader), /loopback/)
  check('LAN and cloud loading cannot escape the local boundary', calls === 1)
  console.log(`\n${passed} Auto model checks passed.`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
