import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { computerRequest } from '../src/lib/agent-hub/computer/bridge'

async function main() {
  let stopped = false
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const part of request) raw += part
    const body = JSON.parse(raw)
    if (body.name !== 'control.stop') return // Simulate a busy native action.
    stopped = true
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const global = globalThis as typeof globalThis & { agentHubComputerBridge?: unknown }
  const previous = global.agentHubComputerBridge
  global.agentHubComputerBridge = { port: address.port, token: 'test-only-token', child: { exitCode: null } }
  try {
    await assert.rejects(() => computerRequest('desktop.type_text', {}, AbortSignal.timeout(80)))
    assert.ok(stopped, 'transport cancellation must send native Stop, not just abandon HTTP')
    console.log('PASS aborted native transport sends an independent Stop request')
  } finally {
    global.agentHubComputerBridge = previous
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
