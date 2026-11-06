import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { runAgent } from '../src/core/run.ts'
import { McpStdioClient } from '../src/mcp/client.ts'
import { PolicyEngine } from '../src/policy/engine.ts'
import { SessionStore } from '../src/sessions/store.ts'
import type { AgentEvent } from '../src/core/events.ts'
import { runSubagentTool } from '../src/tools/subagent.ts'
import type { ToolContext } from '../src/tools/types.ts'
import {
  ApprovingBroker,
  MockProvider,
  emptySkills,
  mockTarget,
  removeDir,
  repoContext,
  tempDir,
  testConfig,
  textResponse,
  toolResponse,
} from './helpers.ts'

const MCP_SERVER = `
import readline from 'node:readline'
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
const tools = [
  {
    name: 'echo',
    description: 'Echo text back',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false
    }
  },
  {
    name: 'readonly',
    description: 'A tool that declares itself read-only',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'environment',
    description: 'Report the two test environment variables',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
]
function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
}
rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.method === 'initialize') {
    send({ id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  } else if (msg.method === 'notifications/initialized') {
    // no response
  } else if (msg.method === 'tools/list') {
    send({ id: msg.id, result: { tools } })
  } else if (msg.method === 'tools/call') {
    const name = msg.params?.name
    const args = msg.params?.arguments ?? {}
    if (name === 'echo') {
      if (typeof args.text !== 'string') {
        send({ id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'text is required' }] } })
      } else {
        send({ id: msg.id, result: { content: [{ type: 'text', text: 'echo:' + args.text }] } })
      }
    } else if (name === 'environment') {
      send({ id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({
        ambient: process.env.AGENTHUB_TEST_TOKEN ?? null,
        explicit: process.env.AGENTHUB_TEST_EXPLICIT_TOKEN ?? null
      }) }] } })
    } else {
      send({ id: msg.id, result: { content: [{ type: 'text', text: 'readonly-ok' }] } })
    }
  } else if (msg.method === 'hang') {
    // Keep the request outstanding until the client closes the process.
  } else if (msg.id !== undefined) {
    send({ id: msg.id, error: { code: -32601, message: 'method not found' } })
  }
})
`

test('MCP child filters ambient credentials but keeps explicitly configured server variables', async () => {
  const fixture = await tempDir('agenthub-mcp-env-')
  const script = path.join(fixture, 'server.mjs')
  const ambientName = 'AGENTHUB_TEST_TOKEN'
  const previousAmbient = process.env[ambientName]
  process.env[ambientName] = 'ambient-secret-value'
  let client: McpStdioClient | undefined
  try {
    await fs.writeFile(script, MCP_SERVER, 'utf8')
    client = await McpStdioClient.connect({
      id: 'environment-fixture',
      command: process.execPath,
      args: [script],
      env: { AGENTHUB_TEST_EXPLICIT_TOKEN: 'explicit-secret-value' },
      timeoutMs: 5_000,
    }, new AbortController().signal)
    const result = await client.callTool('environment', {})
    assert.deepEqual(result.content, [{
      type: 'text',
      text: JSON.stringify({ ambient: null, explicit: 'explicit-secret-value' }),
    }])
  } finally {
    client?.close()
    if (previousAmbient === undefined) delete process.env[ambientName]
    else process.env[ambientName] = previousAmbient
    await removeDir(fixture)
  }
})

test('closing an MCP client promptly rejects pending requests and clears their timers', async () => {
  const fixture = await tempDir('agenthub-mcp-close-')
  let client: McpStdioClient | undefined
  try {
    const script = path.join(fixture, 'server.mjs')
    await fs.writeFile(script, MCP_SERVER, 'utf8')
    client = await McpStdioClient.connect({
      id: 'close-fixture',
      command: process.execPath,
      args: [script],
      timeoutMs: 5_000,
    }, new AbortController().signal)
    const pending = client.request('hang', {}, 30_000)
    const rejected = assert.rejects(pending, /connection is closed/)
    client.close()
    await rejected
    await assert.rejects(client.request('after-close', {}, 100), /connection is closed/)
    client.close()
  } finally {
    client?.close()
    await removeDir(fixture)
  }
})

test('subagent tool forwards its per-call cancellation signal', async () => {
  const controller = new AbortController()
  let received: AbortSignal | undefined
  const ctx = {
    signal: controller.signal,
    ledger: { addChanged: () => undefined, addCommand: () => undefined },
    spawnSubagent: async (options: { signal?: AbortSignal }) => {
      received = options.signal
      return { status: 'completed', sessionId: 'child', steps: 1, durationMs: 1, text: 'Done.', changedFiles: [], commands: [] }
    },
  } as unknown as ToolContext
  const result = await runSubagentTool.run({ task: 'Check one thing' }, ctx)
  assert.equal(result.ok, true)
  assert.equal(received, controller.signal)
})

test('MCP integration lists and calls a real stdio server through the central policy', async () => {
  const workspace = await tempDir('agenthub-mcp-ws-')
  const home = await tempDir('agenthub-mcp-home-')
  const fixture = await tempDir('agenthub-mcp-fixture-')
  try {
    const script = path.join(fixture, 'server.mjs')
    await fs.writeFile(script, MCP_SERVER, 'utf8')
    const config = testConfig(workspace, home, {
      permissionMode: 'ask',
      maxSteps: 5,
      mcpServers: [
        {
          id: 'fixture',
          command: process.execPath,
          args: [script],
          timeoutMs: 10_000,
        },
      ],
    })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'mcp',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'ask',
    })
    const events: AgentEvent[] = []
    const broker = new ApprovingBroker()
    const provider = new MockProvider((_request, index) => {
      if (index === 0) return toolResponse('mcp_list', { server: 'fixture' })
      if (index === 1) return toolResponse('mcp_call', { server: 'fixture', tool: 'echo', arguments: { text: 'hello' } })
      return textResponse('MCP work finished.')
    })
    const result = await runAgent({
      task: 'Use the configured MCP server',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => events.push(event),
      broker,
      signal: new AbortController().signal,
    })
    assert.equal(result.status, 'completed', result.error ?? 'Subagent task did not complete')
    assert.equal(broker.requests.length, 1, 'mcp_list must not prompt and mcp_call must prompt once')
    assert.equal(broker.requests[0]?.tool, 'mcp_call')
    assert.equal(broker.requests[0]?.action.kind, 'mcp.call')
    const callResult = events.find((event) => event.type === 'tool_result' && event.name === 'mcp_call')
    assert.ok(callResult && callResult.type === 'tool_result')
    assert.match(callResult.content, /echo:hello/)
    assert.ok(events.some((event) => event.type === 'tool_progress'))
    assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'mcp_list' && /echo/.test(event.content)))
  } finally {
    await removeDir(workspace)
    await removeDir(home)
    await removeDir(fixture)
  }
})

test('MCP validates arguments before approval and reports connection failures safely', async () => {
  const workspace = await tempDir('agenthub-mcp-ws-')
  const home = await tempDir('agenthub-mcp-home-')
  const fixture = await tempDir('agenthub-mcp-fixture-')
  try {
    const script = path.join(fixture, 'server.mjs')
    await fs.writeFile(script, MCP_SERVER, 'utf8')
    const config = testConfig(workspace, home, {
      permissionMode: 'ask',
      maxSteps: 6,
      mcpServers: [{ id: 'fixture', command: process.execPath, args: [script], timeoutMs: 10_000 }],
    })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'mcp invalid',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'ask',
    })
    const events: AgentEvent[] = []
    const broker = new ApprovingBroker()
    const provider = new MockProvider((_request, index) => {
      if (index === 0) return toolResponse('mcp_call', { server: 'fixture', tool: 'echo', arguments: {} })
      if (index === 1) return toolResponse('mcp_list', { server: 'missing' })
      return textResponse('Handled failures.')
    })
    await runAgent({
      task: 'Try invalid MCP calls',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => events.push(event),
      broker,
      signal: new AbortController().signal,
    })
    assert.equal(broker.requests.length, 0, 'schema-invalid calls must not reach approval')
    const errors = events.filter((event) => event.type === 'tool_error')
    assert.ok(errors.some((event) => event.type === 'tool_error' && /missing required property/.test(event.error)))
    assert.ok(errors.some((event) => event.type === 'tool_error' && /No MCP server named/.test(event.error)))

    const broken = testConfig(workspace, home, {
      permissionMode: 'ask',
      maxSteps: 4,
      mcpServers: [{ id: 'broken', command: 'agenthub-definitely-not-a-command', args: [], timeoutMs: 3000 }],
    })
    const brokenStore = new SessionStore(broken)
    const brokenSession = brokenStore.create({
      task: 'broken mcp',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'ask',
    })
    const brokenEvents: AgentEvent[] = []
    const brokenProvider = new MockProvider((_request, index) => {
      if (index === 0) return toolResponse('mcp_list', { server: 'broken' })
      return textResponse('Connection failed safely.')
    })
    const brokenResult = await runAgent({
      task: 'Try a broken MCP server',
      config: broken,
      target: mockTarget(brokenProvider),
      session: brokenSession,
      store: brokenStore,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => brokenEvents.push(event),
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })
    assert.equal(brokenResult.status, 'partial', 'a final model response must not hide an MCP connection failure')
    assert.ok(brokenResult.limitations.some((item) => /tool call\(s\) failed/i.test(item)))
    assert.ok(brokenEvents.some((event) => event.type === 'tool_error' && /failed to start|ENOENT|exited/i.test(event.error)))
  } finally {
    await removeDir(workspace)
    await removeDir(home)
    await removeDir(fixture)
  }
})

test('MCP policy is read-only aware and central', () => {
  const workspace = 'C:\\workspace'
  const readOnly = testConfig(workspace, 'C:\\home', { permissionMode: 'read-only' })
  const engine = new PolicyEngine(readOnly)
  assert.equal(engine.evaluate({ kind: 'mcp.call', server: 's', tool: 'write', readOnly: false }).decision, 'deny')
  assert.equal(engine.evaluate({ kind: 'mcp.call', server: 's', tool: 'read', readOnly: true }).decision, 'allow')
  const ask = new PolicyEngine(testConfig(workspace, 'C:\\home', { permissionMode: 'ask' }))
  assert.equal(ask.evaluate({ kind: 'mcp.call', server: 's', tool: 'write', readOnly: false }).decision, 'ask')
  const bypass = new PolicyEngine(testConfig(workspace, 'C:\\home', { permissionMode: 'bypass' }))
  assert.equal(bypass.evaluate({ kind: 'mcp.call', server: 's', tool: 'write', readOnly: false }).decision, 'allow')
})

test('read-only mode denies a side-effecting MCP call through the agent loop and allows a declared read-only tool', async () => {
  const workspace = await tempDir('agenthub-mcp-ro-ws-')
  const home = await tempDir('agenthub-mcp-ro-home-')
  const fixture = await tempDir('agenthub-mcp-ro-fixture-')
  try {
    const script = path.join(fixture, 'server.mjs')
    await fs.writeFile(script, MCP_SERVER, 'utf8')
    const config = testConfig(workspace, home, {
      permissionMode: 'read-only',
      maxSteps: 5,
      mcpServers: [{ id: 'fixture', command: process.execPath, args: [script], timeoutMs: 10_000 }],
    })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'read-only mcp',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'read-only',
    })
    const events: AgentEvent[] = []
    const broker = new ApprovingBroker()
    const provider = new MockProvider((_request, index) => {
      if (index === 0) return toolResponse('mcp_call', { server: 'fixture', tool: 'echo', arguments: { text: 'blocked' } })
      if (index === 1) return toolResponse('mcp_call', { server: 'fixture', tool: 'readonly', arguments: {} })
      return textResponse('Read-only MCP complete.')
    })
    const result = await runAgent({
      task: 'Try MCP in read-only mode',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => events.push(event),
      broker,
      signal: new AbortController().signal,
    })
    assert.equal(broker.requests.length, 0, 'read-only denials must not prompt')
    assert.ok(
      events.some((event) => event.type === 'tool_error' && event.name === 'mcp_call' && /read-only/i.test(event.error)),
      'the side-effecting call must be denied',
    )
    const allowed = events.find((event) => event.type === 'tool_result' && event.name === 'mcp_call')
    assert.ok(allowed && allowed.type === 'tool_result')
    assert.match(allowed.content, /readonly-ok/)
    assert.ok(result.status === 'completed' || result.status === 'partial')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
    await removeDir(fixture)
  }
})

test('a subagent runs independently, is visible, and merges its evidence into the parent', async () => {
  const workspace = await tempDir('agenthub-sub-ws-')
  const home = await tempDir('agenthub-sub-home-')
  try {
    const config = testConfig(workspace, home, { permissionMode: 'auto', maxSteps: 6 })
    const store = new SessionStore(config)
    const session = store.create({
      task: 'parent task',
      workspace,
      provider: 'mock',
      model: 'mock-model',
      permissionMode: 'auto',
    })
    const provider = new MockProvider((request) => {
      const lastUser = [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? ''
      if (lastUser === 'child task') {
        if (request.messages.some((message) => message.role === 'tool')) return textResponse('Child finished.')
        return toolResponse('write_file', { path: 'child.txt', content: 'from child\n' })
      }
      if (lastUser === 'parent task') {
        if (request.messages.some((message) => message.role === 'tool')) return textResponse('Parent finished.')
        return toolResponse('run_subagent', { task: 'child task', label: 'worker', max_steps: 3 })
      }
      return textResponse('unexpected')
    })
    const events: AgentEvent[] = []
    const result = await runAgent({
      task: 'parent task',
      config,
      target: mockTarget(provider),
      session,
      store,
      skills: emptySkills(),
      repo: repoContext(workspace),
      events: (event) => events.push(event),
      broker: new ApprovingBroker(),
      signal: new AbortController().signal,
    })
    assert.equal(result.status, 'completed', result.error ?? 'Parent agent did not complete')
    assert.equal(result.text, 'Parent finished.')
    assert.equal(await fs.readFile(path.join(workspace, 'child.txt'), 'utf8'), 'from child\n')
    assert.ok(result.changedFiles.some((file) => file.path === 'child.txt'), 'child evidence must be merged into the parent ledger')
    assert.ok(events.some((event) => event.type === 'subagent_started' && event.label === 'worker'))
    assert.ok(events.some((event) => event.type === 'subagent_completed' && event.status === 'completed'))
    const sessions = await store.list(10)
    assert.ok(sessions.some((item) => item.title === 'child task'), 'the child must have its own persisted session')
  } finally {
    await removeDir(workspace)
    await removeDir(home)
  }
})
