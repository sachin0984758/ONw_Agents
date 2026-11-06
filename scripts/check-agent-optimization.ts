import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-optimization-test-'))
  const oldDirectory = process.env.AGENT_HUB_DB_DIR
  process.env.AGENT_HUB_DB_DIR = temporary
  try {
    const { GET, POST } = await import('../src/app/api/agent-optimization/route')
    const req = (body: unknown, origin = 'http://localhost:3000') => new NextRequest('http://localhost:3000/api/agent-optimization', { method: 'POST', headers: { host: 'localhost:3000', origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const initial = await GET(new NextRequest('http://localhost:3000/api/agent-optimization', { headers: { host: 'localhost:3000' } }))
    const data = await initial.json()
    assert.equal(initial.status, 200)
    assert.equal(data.status.enabled, false)
    assert.deepEqual(data.status.improvements, [])
    assert.equal(data.status.revision, '6868817518876de8fd170c6a8354daca273b6191')
    console.log('PASS disabled by default with pinned official provenance and no fabricated improvements')
    assert.equal((await POST(req({ action: 'test', approved: true }, 'https://example.com'))).status, 403)
    console.log('PASS cross-origin experiment requests are rejected')
    assert.equal((await POST(req({ action: 'enable', approved: true }))).status, 400)
    assert.equal((await POST(req({ action: 'approve', approved: true }))).status, 400)
    assert.equal((await POST(req({ action: 'test', approved: false }))).status, 400)
    console.log('PASS enablement, adoption and unapproved experiments remain blocked')
    const rolledBack = await POST(req({ action: 'rollback' }))
    assert.equal(rolledBack.status, 200)
    assert.equal((await rolledBack.json()).status.enabled, false)
    assert.equal(JSON.parse(await fs.readFile(path.join(temporary, 'agent-optimization.json'), 'utf8')).enabled, false)
    console.log('PASS disabling and rollback persist without changing agent behavior')
  } finally {
    if (oldDirectory === undefined) delete process.env.AGENT_HUB_DB_DIR
    else process.env.AGENT_HUB_DB_DIR = oldDirectory
    if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('agenthub-optimization-test-')) await fs.rm(temporary, { recursive: true, force: true })
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
