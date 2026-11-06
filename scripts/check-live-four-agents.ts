import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import type { SessionEvent, SessionTurn } from '../src/lib/agent-hub/session/types'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-four-agents-'))
  process.env.AGENT_HUB_DB_DIR = path.join(root, 'db')
  process.env.AGENT_SESSION_WORKSPACE = root
  const { detectLocalProviders } = await import('../src/lib/agent-hub/llm')
  const model = (await detectLocalProviders()).flatMap((p) => p.available ? p.detailedModels : []).find((m) => m.loaded && m.isChatCompatible)
  assert.ok(model, 'Load a local chat model first')
  const api = await import('../src/app/api/agent-session/conversations/route')
  const { registerWorkspace } = await import('../src/lib/agent-hub/session/workspaces')
  const post = (body: Record<string, unknown>) => api.POST(new NextRequest('http://localhost/api/agent-session/conversations', { method: 'POST', headers: { Host: 'localhost', 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(1_200_000) }))
  let cases = [
    { agent: 'game', file: 'index.html', prompt: 'Create a playable tic-tac-toe game in index.html, vanilla HTML/CSS/JavaScript, no dependencies. Two local players, nine clickable cells, alternating X/O, win and draw detection, visible status and a working Restart button. Keep it compact. The requirements, design and plan are approved: inspect folder, implement, read back the result. Proceed without more questions.' },
    { agent: 'website', file: 'index.html', prompt: 'Create a small responsive task dashboard in index.html with inline CSS and JavaScript, no dependencies: three summary cards and a list of mock tasks with checkboxes that update the completed count. Requirements, design and plan approved: inspect folder, implement, read back. Proceed without more questions.' },
    { agent: 'research', file: '', prompt: 'Read alpha.txt and beta.txt, compare their reported latency and accuracy, cite both file paths, and recommend the faster option. Explain the tradeoff in fewer than 150 words. This is local-file research, no web lookup or file edits needed. Proceed without questions.' },
    { agent: 'other', file: 'summary.md', prompt: 'Read notes.txt and create summary.md containing a concise checklist of its three action items, retaining the owners and deadlines. Requirements and plan are approved: read source, write summary, read it back. Proceed without questions.' },
  ]
  if (process.env.AGENTHUB_TEST_RACING === '1') cases = [{ agent: 'game', file: 'index.html', prompt: 'Create a playable compact 3D car racing prototype in index.html using Three.js from a public CDN. This is a new empty folder. Include a road, player car, arrow/A-D steering, forward movement, obstacles, collision/game-over, score and Restart. Use procedural geometry, no downloaded assets. Keep implementation short enough for one file. Requirements, design and plan are approved. Inspect folder, implement, read back. Proceed without questions. Clearly disclose the CDN requires internet. Do not claim browser testing unless performed.' }]
  if (process.env.AGENTHUB_TEST_AGENT) cases = cases.filter((test) => test.agent === process.env.AGENTHUB_TEST_AGENT)
  const results: unknown[] = []
  const evidence = path.resolve(process.env.AGENTHUB_TEST_RACING === '1' ? '.verification/racing-agent-live.json' : process.env.AGENTHUB_TEST_AGENT ? `.verification/${process.env.AGENTHUB_TEST_AGENT}-agent-retest.json` : '.verification/four-agents-live.json')
  for (const test of cases) {
    console.log(`START /${test.agent} with ${model.id}`)
    const folder = path.join(root, test.agent)
    await fs.mkdir(folder)
    await fs.writeFile(path.join(folder, 'alpha.txt'), 'Alpha: latency 120 ms; accuracy 94%.')
    await fs.writeFile(path.join(folder, 'beta.txt'), 'Beta: latency 80 ms; accuracy 90%.')
    await fs.writeFile(path.join(folder, 'notes.txt'), 'Mira: design review by Friday. Arun: fix login by Monday. Lee: update documentation by Tuesday.')
    const workspace = await registerWorkspace(folder)
    const created = await post({ action: 'create', workspaceId: workspace.id, model: model.id, effort: 'off' })
    const { conversation } = await created.json()
    assert.ok(conversation?.id)
    const settings = await post({ action: 'settings', id: conversation.id, workspaceAccess: test.file ? 'write' : 'read', mode: test.file ? 'edit' : 'ro' })
    assert.equal(settings.status, 200)
    let turn: SessionTurn | undefined
    let approvals = 0
    try {
      const response = await post({ action: 'send', id: conversation.id, text: `/${test.agent} ${test.prompt}` })
      assert.equal(response.status, 200)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const blocks = buffer.split('\n\n'); buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const line = block.split('\n').find((line) => line.startsWith('data: '))
          if (!line) continue
          const event: SessionEvent = JSON.parse(line.slice(6))
          if (event.type === 'turn') turn = event.turn
          if (event.type === 'approval' && event.approval) {
            const a = event.approval
            // Only approve the named output within this disposable registered folder.
            const approved = ['write_file', 'edit_file'].includes(a.name) && a.args.path === test.file && Boolean(test.file)
            console.log(`APPROVAL /${test.agent}: ${a.name} ${a.args.path} ${approved}`)
            const answer = await post({ action: 'approve', id: conversation.id, approvalId: a.id, approved })
            assert.equal(answer.status, 200)
            if (approved) approvals++
          }
        }
        if (chunk.done) break
      }
      const content = test.file ? await fs.readFile(path.join(folder, test.file), 'utf8').catch(() => '') : ''
      const answer = turn?.items.filter((i) => i.kind === 'assistant').map((i) => i.text).join('\n') ?? ''
      const tools = turn?.items.filter((i) => i.kind === 'tool').map((i) => ({ name: i.name, args: i.args, status: i.status, output: i.output }))
      const passed = turn?.status === 'completed' && turn.agent?.id === test.agent && (test.file ? content.length > 100 && approvals > 0 : /80/.test(answer) && /120/.test(answer) && /beta/i.test(answer) && /alpha\.txt/.test(answer) && /beta\.txt/.test(answer))
      results.push({ agent: test.agent, passed, status: turn?.status, folder, file: test.file, approvals, bytes: content.length, answer, tools, notices: turn?.items.filter((i) => i.kind === 'notice').map((i) => i.text) })
      console.log(`${passed ? 'PASS' : 'FAIL'} /${test.agent}: ${turn?.status}; ${content.length} bytes; ${approvals} approved actions`)
    } catch (error) { results.push({ agent: test.agent, passed: false, error: String(error), folder }); console.log(`FAIL /${test.agent}: ${error}`) }
    await fs.mkdir(path.dirname(evidence), { recursive: true })
    await fs.writeFile(evidence, JSON.stringify({ model: model.id, root, checkedAt: new Date().toISOString(), results }, null, 2))
  }
  console.log(`Evidence: ${evidence}`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
