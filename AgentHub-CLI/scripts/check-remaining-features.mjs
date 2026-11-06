import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../src/config/load.ts'
import { buildRepoContext } from '../src/context/repo.ts'
import { MemoryStore } from '../src/context/memory.ts'
import { runAgent } from '../src/core/run.ts'
import { ActionJournal } from '../src/core/journal.ts'
import { discoverProviders, resolveTarget } from '../src/providers/registry.ts'
import { CapabilityRegistry } from '../src/providers/capabilities.ts'
import { SessionStore } from '../src/sessions/store.ts'
import { discoverSkills } from '../src/skills/discover.ts'
import { redactSecrets } from '../src/utils/redact.ts'

// Real inference only, isolated side effects, no model loading or installation.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-remaining-live-'))
const workspace = path.join(root, 'workspace')
const home = path.join(root, 'home')
await fs.mkdir(workspace)
const saved = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('AGENTHUB_')))
for (const key of Object.keys(saved)) delete process.env[key]
process.env.AGENTHUB_HOME = home
const report = { date: '2026-11-01', status: 'RUNNING', evidenceRoot: root, model: null, checks: [] }
const save = () => fs.writeFile(path.join(root, 'results.json'), `${JSON.stringify(report, null, 2)}\n`)
try {
  const config = await loadConfig({ cwd: workspace, cli: { workspace, provider: 'lmstudio' } })
  config.maxSteps = 8; config.maxWallClockMs = 180000
  config.agentConcurrency = 2; config.maxAgents = 4
  const discovery = await discoverProviders(config, AbortSignal.timeout(10000))
  const loaded = discovery.find((item) => item.provider.id === 'lmstudio')?.models.find((model) => model.loaded === true)
  if (!loaded) throw new Error('BLOCKED: no confirmed loaded LM Studio model. Start the local server and load an already installed model.')
  config.model = loaded.id; report.model = loaded.id
  const target = resolveTarget(config, discovery)
  const store = new SessionStore(config)
  const skills = await discoverSkills(config)
  const marker = randomUUID()
  const reviewMarker = randomUUID()
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node --check index.js' } }))
  await fs.writeFile(path.join(workspace, 'a.txt'), `A_${marker}`)
  await fs.writeFile(path.join(workspace, 'b.txt'), `B_${marker}`)
  await fs.writeFile(path.join(workspace, 'bug.js'), `// REVIEW_${reviewMarker}\n// add must return the sum\nexport function add(a,b) { return a-b }\n`)
  const broker = { request: async (request) => ({ approved: request.tool === 'memory_extract' || request.tool === 'write_file' || (request.tool === 'run_command' && request.detail.includes('npm run test')), remember: false }) }
  const run = async (name, task, verify, options = {}) => {
    console.error(`Live check: ${name}`)
    const session = store.create({ task, workspace, provider: 'lmstudio', model: loaded.id, permissionMode: config.permissionMode })
    if (options.prepare) await options.prepare(session)
    const events = []
    const result = await runAgent({ config, target, session, store, skills, repo: await buildRepoContext(config), task, broker, signal: new AbortController().signal, events: (event) => events.push(event), role: options.role })
    const check = { name, status: 'FAIL', runStatus: result.status, tools: events.filter((e) => e.type === 'tool_started').map((e) => e.name), limitations: result.limitations, sessionId: session.id }
    try { await verify(result, events, session); check.status = 'PASS' }
    catch (err) { check.error = redactSecrets(err.message) }
    report.checks.push(check)
    await fs.writeFile(path.join(root, `${report.checks.length}-events.jsonl`), events.map((event) => JSON.stringify(event)).join('\n') + '\n')
    await save()
  }
  config.memoryAutoExtract = true
  await run('explicit automatic memory extraction', `remember fact: The project database proof is DATABASE_${marker}`, async (result, events) => {
    assert.ok(result.status === 'completed' || result.status === 'partial')
    assert.ok((await new MemoryStore(config).list()).some((entry) => entry.text === `The project database proof is DATABASE_${marker}`))
    const memoryApproval = events.find((event) => event.type === 'approval_requested' && event.tool === 'memory_extract')
    assert.ok(memoryApproval)
    assert.ok(events.some((event) => event.type === 'approval_resolved' && event.id === memoryApproval.id && event.approved))
  })
  config.memoryAutoExtract = false
  await run('fresh-session memory retrieval', 'What is the project database proof? Answer from saved project memory without tools.', (result) => {
    assert.equal(result.status, 'completed'); assert.ok(result.text.includes(`DATABASE_${marker}`))
  })
  await run('dependency-aware plan enforcement', 'Use set_plan with steps ["Inspect", "Verify"] and dependencies [[],[1]]. Then use update_plan to complete step 1 before completing step 2. Finish with PLAN_OK. No file changes.', (result, events, session) => {
    const failures = events.filter((event) => event.type === 'tool_error')
    const onlyBlockedEarlyStart = failures.length === 1 && failures[0].name === 'update_plan' && /dependenc(?:y|ies).*completed/i.test(failures[0].error)
    assert.ok(result.status === 'completed' || (result.status === 'partial' && onlyBlockedEarlyStart))
    assert.deepEqual(session.plan[1]?.dependsOn, [1])
    assert.ok(session.plan.every((step) => step.status === 'completed'))
    assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'set_plan'))
  })
  await run('post-edit automatic test verification', 'Use write_file to create index.js with exact content "export const answer = 42;". Then reply DONE. Do not run commands yourself; the runtime will verify the edit.', (result) => {
    assert.equal(result.status, 'completed')
    assert.ok(result.commands.some((command) => command.command === 'npm run test' && command.exitCode === 0))
    assert.equal(result.changedFiles[0]?.path, 'index.js')
  })
  config.permissionMode = 'read-only'; config.toolConcurrency = 2
  await run('specialized agent pool', 'Call run_agents once with two independent tasks: a researcher must read a.txt using read_file and return its exact contents; a reviewer must read b.txt using read_file and return its exact contents. Return both child results verbatim. Do not read the files in the parent.', (result, events) => {
    assert.equal(result.status, 'completed')
    assert.ok(result.text.includes(`A_${marker}`)); assert.ok(result.text.includes(`B_${marker}`))
    assert.equal(events.filter((event) => event.type === 'subagent_started').length, 2)
    assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'run_agents'))
  })
  await run('read-only code review', 'Read bug.js with read_file and review the add function against its comment. Return the proof marker from the file and one confirmed logic issue. Do not modify files.', (result) => {
    assert.equal(result.status, 'completed')
    assert.ok(result.text.includes(`REVIEW_${reviewMarker}`))
    assert.match(result.text, /subtract|a\s*-\s*b|difference|minus/i)
    assert.equal(result.changedFiles.length, 0)
  }, { role: 'reviewer' })
  await run('interrupted write recovery without replay', 'Reply exactly RECOVERY_OK without tools.', (result) => {
    assert.equal(result.status, 'completed')
    assert.ok(result.limitations.every((line) => !line.includes('unknown outcomes')))
  }, { prepare: async (session) => {
    await new ActionJournal(config, session.id).start('interrupted', 'write', 'write_file', { path: 'recovered.txt', content: 'RECOVERED' })
    await fs.writeFile(path.join(workspace, 'recovered.txt'), 'RECOVERED')
  } })
  const capabilities = await new CapabilityRegistry(home).get(target.providerConfig, target.model)
  report.checks.push({ name: 'observed provider capabilities persisted', status: capabilities.tools?.supported && capabilities.streaming?.supported ? 'PASS' : 'FAIL', capabilities })
  report.status = report.checks.every((check) => check.status === 'PASS') ? 'PASS' : 'FAIL'
  if (report.status !== 'PASS') process.exitCode = 1
} catch (err) {
  report.status = err.message.startsWith('BLOCKED:') ? 'BLOCKED' : 'ERROR'
  report.error = redactSecrets(err.message); process.exitCode = 2
} finally {
  await save()
  for (const key of Object.keys(process.env)) if (key.startsWith('AGENTHUB_')) delete process.env[key]
  Object.assign(process.env, saved)
}
console.log(JSON.stringify(report, null, 2))
