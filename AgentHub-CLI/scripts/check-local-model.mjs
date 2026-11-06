import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../src/config/load.ts'
import { runAgent } from '../src/core/run.ts'
import { buildRepoContext } from '../src/context/repo.ts'
import { discoverProviders, resolveTarget } from '../src/providers/registry.ts'
import { SessionStore } from '../src/sessions/store.ts'
import { discoverSkills } from '../src/skills/discover.ts'
import { redactSecrets } from '../src/utils/redact.ts'
import { BackupStore } from '../src/core/backups.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Explicit live check. Never load, download, or switch a model. All write and
// approval tests are confined to an isolated workspace and AgentHub home.
const modelIndex = process.argv.indexOf('--model')
const requestedModel = modelIndex >= 0 ? process.argv[modelIndex + 1] : undefined
const extended = process.argv.includes('--extended')
const onlyIndex = process.argv.indexOf('--only')
const selectedChecks = onlyIndex >= 0 ? process.argv[onlyIndex + 1]?.split(',') : undefined
const selected = (name) => !selectedChecks || selectedChecks.includes(name)
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-live-validation-'))
const workspace = path.join(root, 'workspace')
const home = path.join(root, 'home')
await fs.mkdir(workspace)
const previousEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('AGENTHUB_')))
for (const key of Object.keys(previousEnvironment)) delete process.env[key]
process.env.AGENTHUB_HOME = home
const report = { status: 'RUNNING', evidenceRoot: root, model: null, checks: [] }
const resultsPath = path.join(root, 'results.json')

try {
  const config = await loadConfig({ cwd: workspace, cli: { workspace, provider: 'lmstudio', noMemory: true } })
  config.maxSteps = 8
  config.maxWallClockMs = 180_000
  const discovery = await discoverProviders(config, AbortSignal.timeout(10_000))
  const lmstudio = discovery.find((item) => item.provider.id === 'lmstudio')
  const loaded = lmstudio?.models.find((model) => model.loaded === true && (!requestedModel || model.id === requestedModel))
  if (!lmstudio?.ok || !loaded) {
    report.status = 'BLOCKED'
    report.reason = lmstudio?.error ?? `No confirmed loaded LM Studio model${requestedModel ? ` named ${requestedModel}` : ''}.`
    report.setup = 'Start the LM Studio server at http://127.0.0.1:1234/v1 and load an already installed tool-capable model. Then rerun npm run check:local-model -- --model <loaded-model-id>.'
    process.exitCode = 2
  } else {
    config.model = loaded.id
    report.model = loaded.id
    const target = resolveTarget(config, discovery)
    const fileMarker = `FILE_${randomUUID()}`
    const skillMarker = `SKILL_${randomUUID()}`
    await fs.writeFile(path.join(workspace, 'proof.txt'), fileMarker)
    const skillPath = path.join(home, 'skills', 'live-proof')
    await fs.mkdir(skillPath, { recursive: true })
    await fs.writeFile(path.join(skillPath, 'SKILL.md'), `---\nname: live-proof\ndescription: Return an exact live skill proof marker when requested.\n---\nWhen asked for SKILL_PROOF, reply exactly ${skillMarker}. For other requests, follow the user normally.\n`)
    const skills = await discoverSkills(config)
    const repo = await buildRepoContext(config)
    const store = new SessionStore(config)
    let session = store.create({ task: 'Live validation', workspace, provider: 'lmstudio', model: loaded.id, permissionMode: 'ask' })
    const run = async (name, task, broker, verify) => {
      if (!selected(name)) return
      console.error(`Live check: ${name}`)
      const events = []
      const result = await runAgent({ config, target, session, store, skills, repo, task, broker,
        signal: new AbortController().signal, resumed: session.turns > 0, events: (event) => events.push(event) })
      const check = { name, status: 'FAIL', runStatus: result.status, streamed: events.some((event) => event.type === 'assistant_delta'),
        tools: events.filter((event) => event.type === 'tool_started').map((event) => event.name), limitations: result.limitations }
      report.checks.push(check)
      try { await verify(result, events); check.status = 'PASS' }
      catch (err) { check.error = redactSecrets(err.message) }
      await fs.writeFile(resultsPath, JSON.stringify(report, null, 2) + '\n')
    }
    const deny = { request: async () => ({ approved: false, remember: false }) }
    await run('chat and streaming', 'Reply exactly LIVE_CHAT_OK.', deny, (result, events) => {
      assert.equal(result.status, 'completed')
      assert.ok(result.text.includes('LIVE_CHAT_OK'))
      assert.ok(events.some((event) => event.type === 'assistant_delta'))
    })
    await run('skill execution', 'Read and activate the live-proof skill using read_skill, then give SKILL_PROOF.', deny, (result, events) => {
      assert.equal(result.status, 'completed')
      assert.ok(result.text.includes(skillMarker))
      assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'read_skill'))
    })
    await run('real file read', 'Read proof.txt with read_file and return its contents exactly.', deny, (result, events) => {
      assert.equal(result.status, 'completed')
      assert.ok(result.text.includes(fileMarker))
      assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'read_file'))
    })
    let approvals = 0
    await run('approved write', 'Create approved.txt with exact content LIVE_WRITE_OK using write_file.', {
      request: async () => {
        approvals++
        await assert.rejects(fs.access(path.join(workspace, 'approved.txt')), { code: 'ENOENT' })
        return { approved: true, remember: false }
      },
    }, async (result, events) => {
      assert.equal(result.status, 'completed')
      assert.ok(approvals > 0)
      assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'write_file'))
      assert.equal(await fs.readFile(path.join(workspace, 'approved.txt'), 'utf8'), 'LIVE_WRITE_OK')
    })
    let denials = 0
    await run('denied write', 'Create denied.txt using write_file. Stop if permission is denied.', {
      request: async () => { denials++; return { approved: false, remember: false } },
    }, async (result, events) => {
      assert.equal(result.status, 'partial')
      assert.ok(denials > 0)
      assert.ok(events.some((event) => event.type === 'tool_error' && event.name === 'write_file'))
      await assert.rejects(fs.access(path.join(workspace, 'denied.txt')), { code: 'ENOENT' })
    })
    await run('tool failure handling', 'Read missing-file.txt using read_file. Stop if it does not exist.', deny, (result, events) => {
      assert.equal(result.status, 'partial')
      assert.ok(events.some((event) => event.type === 'tool_error' && event.name === 'read_file'))
    })
    if (session.turns > 0) session = await store.load(session.id)
    const persistence = { name: 'session persistence and audit', status: 'PASS', sessionId: session.id }
    if (selected('session persistence and audit')) {
      try {
        assert.equal(session.turns, 6)
        assert.ok(session.activeSkills.includes('live-proof'))
        assert.ok(session.audit.some((entry) => entry.approval === 'approved'))
        assert.ok(session.audit.some((entry) => entry.approval === 'denied'))
      } catch (err) { persistence.status = 'FAIL'; persistence.error = redactSecrets(err.message) }
      report.checks.push(persistence)
    }
    if (extended) {
      config.maxWallClockMs = 180_000
      const approve = { request: async () => ({ approved: true, remember: false }) }
      const fresh = (task) => { session = store.create({ task, workspace, provider: 'lmstudio', model: loaded.id, permissionMode: 'ask' }) }
      if (selected('session recall without replay')) {
        fresh('Session recall')
        session = await store.load(persistence.sessionId)
        await run('session recall without replay', 'Return the exact contents of proof.txt from our conversation. Do not call tools.', deny, (result, events) => {
          assert.equal(result.status, 'completed')
          assert.ok(result.text.includes(fileMarker))
          assert.equal(events.some((event) => event.type === 'tool_started'), false)
        })
      }
      fresh('Shell approval')
      let commandApprovals = 0
      await run('approved shell command', 'Run exactly echo LIVE_COMMAND_OK with run_command and report its output.', {
        request: async () => { commandApprovals++; return { approved: true, remember: false } },
      }, (result) => {
        assert.equal(result.status, 'completed')
        assert.ok(commandApprovals > 0)
        assert.ok(result.commands.some((command) => /echo LIVE_COMMAND_OK/.test(command.command) && command.exitCode === 0))
        assert.ok(result.text.includes('LIVE_COMMAND_OK'))
      })
      fresh('Shell denial')
      let commandDenials = 0
      await run('denied shell command', 'Run echo DENIED_COMMAND using run_command. Stop if permission is denied.', {
        request: async () => { commandDenials++; return { approved: false, remember: false } },
      }, (result) => {
        assert.equal(result.status, 'partial')
        assert.ok(commandDenials > 0)
        assert.equal(result.commands.length, 0)
      })
      fresh('File edit')
      await fs.writeFile(path.join(workspace, 'edit.txt'), 'before\n')
      await run('file edit and backup', 'Use edit_file to replace before with after in edit.txt.', approve, async (result, events) => {
        assert.equal(result.status, 'completed')
        assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'edit_file'))
        assert.equal(await fs.readFile(path.join(workspace, 'edit.txt'), 'utf8'), 'after\n')
        const restored = await new BackupStore(config).restoreLast()
        assert.equal(restored.original, path.join(workspace, 'edit.txt'))
        assert.equal(await fs.readFile(path.join(workspace, 'edit.txt'), 'utf8'), 'before\n')
      })
      fresh('Search and list')
      const searchMarker = `SEARCH_${randomUUID()}`
      await fs.writeFile(path.join(workspace, 'search.txt'), `find-me-proof: ${searchMarker}`)
      await run('directory listing and search', 'Use list_dir, then search_files for find-me-proof. Return the matching line.', deny, (result, events) => {
        assert.equal(result.status, 'completed')
        for (const name of ['list_dir', 'search_files']) assert.ok(events.some((event) => event.type === 'tool_result' && event.name === name))
        assert.ok(result.text.includes(searchMarker))
      })
      fresh('Simple plan')
      await run('plan creation and completion', 'Use set_plan with one step: Return PLAN_OK. Mark that step completed with update_plan, then reply PLAN_OK.', deny, (result, events) => {
        assert.equal(result.status, 'completed')
        assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'set_plan'))
        assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'update_plan'))
        assert.equal(session.plan.length, 1)
        assert.equal(session.plan[0].status, 'completed')
      })
      fresh('Git inspection')
      await promisify(execFile)('git', ['init', '-q'], { cwd: workspace, windowsHide: true })
      await run('Git status inspection', 'Use git_status and report whether proof.txt is untracked. Do not stage or commit.', deny, (result, events) => {
        assert.equal(result.status, 'completed')
        assert.ok(events.some((event) => event.type === 'tool_result' && event.name === 'git_status' && event.content.includes('proof.txt')))
      })
      fresh('MCP integration')
      const mcpMarker = `MCP_${randomUUID()}`
      const mcpLog = path.join(home, 'mcp-calls.log')
      const mcpScript = path.join(home, 'mcp-proof.mjs')
      await fs.writeFile(mcpScript, `import readline from 'node:readline'; import fs from 'node:fs';
        const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
        rl.on('line',line=>{const m=JSON.parse(line);const send=result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
        if(m.method==='initialize')send({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'live-proof',version:'1'}});
        else if(m.method==='tools/list')send({tools:[{name:'get_proof',description:'Return the live proof marker.',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{},additionalProperties:false}}]});
        else if(m.method==='tools/call'){fs.appendFileSync(${JSON.stringify(mcpLog)},'called\\n');send({content:[{type:'text',text:${JSON.stringify(mcpMarker)}}]});}});`)
      config.mcpServers = [{ id: 'live-proof', command: process.execPath, args: [mcpScript], timeoutMs: 5_000 }]
      await run('real-model MCP discovery and call', 'Use mcp_list for live-proof, then mcp_call server live-proof tool get_proof. Return its result.', {
        request: async (request) => ({ approved: request.action.kind === 'mcp.call' && request.action.server === 'live-proof' && request.action.tool === 'get_proof', remember: false }),
      }, async (result, events) => {
        assert.equal(result.status, 'completed')
        for (const name of ['mcp_list', 'mcp_call']) assert.ok(events.some((event) => event.type === 'tool_result' && event.name === name))
        assert.ok(result.text.includes(mcpMarker))
        assert.match(await fs.readFile(mcpLog, 'utf8'), /called/)
      })
      config.mcpServers = []
      fresh('Subagent integration')
      await run('real-model subagent', 'Use run_subagent with the task: Read proof.txt using read_file and return its contents. Return the child result.', deny, (result, events) => {
        assert.equal(result.status, 'completed')
        assert.ok(events.some((event) => event.type === 'subagent_completed' && event.status === 'completed' && event.text.includes(fileMarker)))
        assert.ok(result.text.includes(fileMarker))
      })
      if (selected('live streaming cancellation')) {
        fresh('Cancellation')
        const cancellation = new AbortController()
        const events = []
        const cancelled = await runAgent({ config, target, session, store, skills, repo, task: 'Reply with a short greeting.',
          broker: deny, signal: cancellation.signal, events: (event) => {
            events.push(event)
            if (event.type === 'assistant_delta') cancellation.abort()
          } })
        const persisted = await store.load(session.id)
        report.checks.push({ name: 'live streaming cancellation', status: cancelled.status === 'cancelled' && persisted.status === 'cancelled' &&
          events.some((event) => event.type === 'assistant_delta') ? 'PASS' : 'FAIL', runStatus: cancelled.status })
      }
    }
    report.status = report.checks.length > 0 && report.checks.every((check) => check.status === 'PASS') ? 'PASS' : 'FAIL'
    if (report.status === 'FAIL') process.exitCode = 1
  }
} catch (err) {
  report.status = 'FAIL'
  report.error = redactSecrets(err.message)
  process.exitCode = 1
} finally {
  await fs.writeFile(resultsPath, JSON.stringify(report, null, 2) + '\n')
  for (const key of Object.keys(process.env).filter((key) => key.startsWith('AGENTHUB_'))) delete process.env[key]
  Object.assign(process.env, previousEnvironment)
  console.log(JSON.stringify(report, null, 2))
}
