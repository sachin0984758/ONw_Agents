import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { gitBranchTool, gitCommitTool, gitShowTool, gitStageTool } from '../src/tools/git.ts'
import type { ToolContext } from '../src/tools/types.ts'
import { removeDir, tempDir } from './helpers.ts'

const exec = promisify(execFile)

test('Git inspection works and stage/commit mutations require approval', async () => {
  const workspace = await tempDir('agenthub-git-tools-')
  try {
    await exec('git', ['init', '-q'], { cwd: workspace })
    await exec('git', ['config', 'user.name', 'AgentHub Test'], { cwd: workspace })
    await exec('git', ['config', 'user.email', 'agenthub@example.invalid'], { cwd: workspace })
    await fs.writeFile(path.join(workspace, 'sample.txt'), 'sample\n', 'utf8')
    await exec('git', ['add', 'sample.txt'], { cwd: workspace })
    await exec('git', ['commit', '-q', '-m', 'Initial sample'], { cwd: workspace })

    const actions: string[] = []
    let mutationApproved = false
    const ctx = {
      workspace,
      signal: new AbortController().signal,
      authorize: async (action: { command?: string; kind?: string }) => {
        actions.push(action.command ?? '')
        return action.kind !== 'git.write' || mutationApproved
          ? { ok: true, reason: 'allowed' }
          : { ok: false, reason: 'The user denied this action.' }
      },
    } as unknown as ToolContext

    const branches = await gitBranchTool.run({}, ctx)
    assert.equal(branches.ok, true, branches.error)
    assert.match(branches.content, /\* (main|master)/)

    const shown = await gitShowTool.run({ commit: 'HEAD' }, ctx)
    assert.equal(shown.ok, true, shown.error)
    assert.match(shown.content, /Initial sample/)
    assert.match(shown.content, /sample\.txt/)

    const beforeRootStage = actions.length
    const rootStage = await gitStageTool.run({ paths: ['.'] }, ctx)
    assert.equal(rootStage.ok, false)
    assert.match(rootStage.error ?? '', /workspace root/)
    assert.equal(actions.length, beforeRootStage, 'root staging must be rejected before approval')

    await fs.writeFile(path.join(workspace, 'sample.txt'), 'updated\n', 'utf8')
    const deniedStage = await gitStageTool.run({ paths: ['sample.txt'] }, ctx)
    assert.equal(deniedStage.ok, false)
    const notStaged = await exec('git', ['diff', '--cached', '--quiet'], { cwd: workspace }).then(() => true, () => false)
    assert.equal(notStaged, true, 'a denied stage request must not stage the file')

    mutationApproved = true
    const staged = await gitStageTool.run({ paths: ['sample.txt'] }, ctx)
    assert.equal(staged.ok, true, staged.error)
    assert.match(staged.content, /Staged changes/)
    mutationApproved = false
    const deniedCommit = await gitCommitTool.run({ message: 'Denied commit' }, ctx)
    assert.equal(deniedCommit.ok, false)
    const unchangedLog = await exec('git', ['log', '-1', '--format=%s'], { cwd: workspace })
    assert.equal(unchangedLog.stdout.trim(), 'Initial sample')
    mutationApproved = true
    const committed = await gitCommitTool.run({ message: 'Approved update' }, ctx)
    assert.equal(committed.ok, true, committed.error)
    assert.match((await exec('git', ['log', '-1', '--format=%s'], { cwd: workspace })).stdout.trim(), /^Approved update$/)

    const beforeInvalid = actions.length
    const invalid = await gitShowTool.run({ commit: '--output=outside.txt' }, ctx)
    assert.equal(invalid.ok, false)
    assert.match(invalid.error ?? '', /Invalid commit reference/)
    assert.equal(actions.length, beforeInvalid, 'invalid refs must be rejected before authorization or execution')
    assert.equal(await fs.readFile(path.join(workspace, 'sample.txt'), 'utf8'), 'updated\n')
    assert.equal(await fs.stat(path.join(workspace, 'outside.txt')).then(() => true, () => false), false)
  } finally {
    await removeDir(workspace)
  }
})

test('Git commit refuses pre-staged changes outside a nested workspace', async () => {
  const repository = await tempDir('agenthub-git-parent-')
  const workspace = path.join(repository, 'workspace')
  try {
    await fs.mkdir(workspace, { recursive: true })
    await exec('git', ['init', '-q'], { cwd: repository })
    await exec('git', ['config', 'user.name', 'AgentHub Test'], { cwd: repository })
    await exec('git', ['config', 'user.email', 'agenthub@example.invalid'], { cwd: repository })
    await fs.writeFile(path.join(workspace, 'inside.txt'), 'before\n', 'utf8')
    await fs.writeFile(path.join(repository, 'outside.txt'), 'before\n', 'utf8')
    await exec('git', ['add', '.'], { cwd: repository })
    await exec('git', ['commit', '-q', '-m', 'Initial'], { cwd: repository })
    await fs.writeFile(path.join(repository, 'outside.txt'), 'user staged this\n', 'utf8')
    await exec('git', ['add', 'outside.txt'], { cwd: repository })

    let commitAuthorizationCalls = 0
    const ctx = {
      workspace,
      signal: new AbortController().signal,
      authorize: async (action: { command?: string; kind?: string }) => {
        if (action.kind === 'git.write' && action.command?.startsWith('git commit')) commitAuthorizationCalls++
        return { ok: true, reason: 'approved' }
      },
    } as unknown as ToolContext
    const result = await gitCommitTool.run({ message: 'Must not include outside change' }, ctx)
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /outside the workspace/)
    assert.equal(commitAuthorizationCalls, 0, 'outside-workspace changes must be detected before requesting approval')
    assert.equal((await exec('git', ['log', '-1', '--format=%s'], { cwd: repository })).stdout.trim(), 'Initial')
    assert.equal((await exec('git', ['diff', '--cached', '--name-only'], { cwd: repository })).stdout.trim(), 'outside.txt')
  } finally {
    await removeDir(repository)
  }
})
