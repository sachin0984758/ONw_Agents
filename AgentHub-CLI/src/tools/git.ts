import { spawn } from 'node:child_process'
import path from 'node:path'
import { displayPath, resolveInside } from '../utils/fsx.ts'
import { optionalBoolean, optionalNumber, optionalString } from './validate.ts'
import type { AgentTool, ToolContext, ToolResult } from './types.ts'

const MAX_GIT_OUTPUT = 120 * 1024

interface GitResult {
  code: number | null
  stdout: string
  stderr: string
}

function runGit(args: string[], cwd: string, signal: AbortSignal, timeoutMs = 30_000): Promise<GitResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_PAGER: 'cat',
        PAGER: 'cat',
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      child.kill()
    }, timeoutMs)
    const onAbort = () => child.kill()
    signal.addEventListener('abort', onAbort, { once: true })
    const cap = (s: string, chunk: string) => (s.length >= MAX_GIT_OUTPUT ? s : s + chunk).slice(0, MAX_GIT_OUTPUT)
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = cap(stdout, chunk.toString('utf8'))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = cap(stderr, chunk.toString('utf8'))
    })
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr })
    }
    child.on('error', (err) => {
      stderr += err.message
      finish(127)
    })
    child.on('close', (code) => finish(code))
  })
}

async function ensureRepo(ctx: ToolContext): Promise<string | null> {
  const result = await runGit(['rev-parse', '--show-toplevel'], ctx.workspace, ctx.signal, 10_000)
  if (result.code !== 0) {
    return `Not a git repository (or git is unavailable): ${(result.stderr || result.stdout).trim() || 'git rev-parse failed'}`
  }
  return null
}

function body(ctx: ToolContext, command: string, result: GitResult): ToolResult {
  const parts = [`$ git ${command}`, `exit: ${result.code ?? 'unknown'}`]
  if (result.stdout.trim()) parts.push(result.stdout.trimEnd())
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trimEnd()}`)
  const content = parts.join('\n')
  if (result.code === 0) return { ok: true, content, truncated: content.length >= MAX_GIT_OUTPUT }
  return { ok: false, content, error: `git ${command} exited with code ${result.code ?? 'unknown'}.`, truncated: content.length >= MAX_GIT_OUTPUT }
}

export const gitStatusTool: AgentTool = {
  name: 'git_status',
  description: 'Show the repository branch and working-tree status (read-only).',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  async run(_input, ctx): Promise<ToolResult> {
    const auth = await ctx.authorize({ kind: 'git.read', command: 'status' }, 'git_status')
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    const repoError = await ensureRepo(ctx)
    if (repoError) return { ok: false, content: '', error: repoError }
    const result = await runGit(['status', '--porcelain=v1', '-b'], ctx.workspace, ctx.signal)
    return body(ctx, 'status', result)
  },
}

export const gitDiffTool: AgentTool = {
  name: 'git_diff',
  description: 'Show a unified diff of unstaged (or staged) changes (read-only).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Optional path relative to the workspace.' },
      staged: { type: 'boolean', description: 'Show staged changes instead of unstaged.' },
    },
    required: [],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const staged = optionalBoolean(input, 'staged') ?? false
    const rel = optionalString(input, 'path', { max: 1000 })
    const args = ['diff', '--no-color', '--no-ext-diff']
    if (staged) args.push('--staged')
    let display = staged ? 'diff --staged' : 'diff'
    if (rel) {
      const abs = await resolveInside(ctx.workspace, rel)
      args.push('--', displayPath(ctx.workspace, abs))
      display += ` -- ${displayPath(ctx.workspace, abs)}`
    }
    const auth = await ctx.authorize({ kind: 'git.read', command: 'diff' }, 'git_diff')
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    const repoError = await ensureRepo(ctx)
    if (repoError) return { ok: false, content: '', error: repoError }
    const result = await runGit(args, ctx.workspace, ctx.signal)
    const out = body(ctx, display, result)
    if (out.ok && !result.stdout.trim()) out.content = `$ git ${display}\n(no changes)`
    return out
  },
}

export const gitLogTool: AgentTool = {
  name: 'git_log',
  description: 'Show recent commits (read-only).',
  parameters: {
    type: 'object',
    properties: { count: { type: 'integer', description: 'Number of commits (default 10, max 50).', minimum: 1, maximum: 50 } },
    required: [],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const count = optionalNumber(input, 'count', { min: 1, max: 50, integer: true }) ?? 10
    const auth = await ctx.authorize({ kind: 'git.read', command: 'log' }, 'git_log')
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    const repoError = await ensureRepo(ctx)
    if (repoError) return { ok: false, content: '', error: repoError }
    const result = await runGit(['log', '--oneline', '--decorate', '-n', String(count)], ctx.workspace, ctx.signal)
    return body(ctx, `log -n ${count}`, result)
  },
}

export const gitBranchTool: AgentTool = {
  name: 'git_branch',
  description: 'List local branches and mark the current branch (read-only).',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  async run(_input, ctx): Promise<ToolResult> {
    const auth = await ctx.authorize({ kind: 'git.read', command: 'branch' }, 'git_branch')
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    const repoError = await ensureRepo(ctx)
    if (repoError) return { ok: false, content: '', error: repoError }
    const result = await runGit(['branch', '--format=%(HEAD) %(refname:short)'], ctx.workspace, ctx.signal)
    return body(ctx, 'branch --list', result)
  },
}

const SAFE_COMMIT_REF = /^(?:HEAD(?:~\d+|\^\d+)?|[0-9a-f]{7,40}|[A-Za-z0-9][A-Za-z0-9._/-]{0,127})$/i

export const gitShowTool: AgentTool = {
  name: 'git_show',
  description: 'Show a commit summary and changed-file statistics (read-only).',
  parameters: {
    type: 'object',
    properties: { commit: { type: 'string', description: 'Commit hash, branch/tag name, or HEAD~N.' } },
    required: ['commit'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const commit = optionalString(input, 'commit', { max: 128 })?.trim() ?? ''
    if (!SAFE_COMMIT_REF.test(commit)) {
      return { ok: false, content: '', error: 'Invalid commit reference. Use a commit hash, branch/tag name, or HEAD~N.' }
    }
    const auth = await ctx.authorize({ kind: 'git.read', command: `show ${commit}` }, 'git_show')
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    const repoError = await ensureRepo(ctx)
    if (repoError) return { ok: false, content: '', error: repoError }
    const result = await runGit(['show', '--stat', '--oneline', '--no-renames', '--no-ext-diff', '--no-color', commit], ctx.workspace, ctx.signal)
    return body(ctx, `show ${commit}`, result)
  },
}

export const gitStageTool: AgentTool = {
  name: 'git_stage',
  description: 'Stage specific workspace paths after user approval. Never stages the whole repository implicitly.',
  parameters: {
    type: 'object',
    properties: { paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 } },
    required: ['paths'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const raw = input.paths
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50 || raw.some((p) => typeof p !== 'string' || !p.trim())) {
      return { ok: false, content: '', error: 'Provide 1 to 50 non-empty workspace paths to stage.' }
    }
    const paths: string[] = []
    try {
      for (const rel of raw as string[]) {
        const abs = await resolveInside(ctx.workspace, rel)
        paths.push(displayPath(ctx.workspace, abs))
      }
    } catch (err) {
      return { ok: false, content: '', error: (err as Error).message }
    }
    const unique = [...new Set(paths)]
    if (unique.includes('.')) return { ok: false, content: '', error: 'Refusing to stage the workspace root. Supply explicit paths.' }
    const repoError = await ensureRepo(ctx)
    if (repoError) return { ok: false, content: '', error: repoError }
    const literalPaths = unique
    const preview = await runGit(['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-color', '--stat', '--', ...literalPaths], ctx.workspace, ctx.signal)
    const detail = [`Stage these workspace paths?`, ...unique.map((p) => `- ${p}`), preview.stdout.trim() ? `\nUnstaged diff summary:\n${preview.stdout.trim()}` : ''].filter(Boolean).join('\n')
    const auth = await ctx.authorize({ kind: 'git.write', command: `git add -- ${unique.join(' ')}` }, 'git_stage', detail)
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    const result = await runGit(['--literal-pathspecs', 'add', '--', ...unique], ctx.workspace, ctx.signal)
    const summary = result.code === 0 ? await runGit(['--literal-pathspecs', 'diff', '--cached', '--no-ext-diff', '--no-color', '--stat', '--', ...literalPaths], ctx.workspace, ctx.signal) : null
    const response = body(ctx, `add -- ${unique.join(' ')}`, result)
    if (response.ok && summary?.stdout.trim()) response.content += `\nStaged changes:\n${summary.stdout.trim()}`
    return response
  },
}

export const gitCommitTool: AgentTool = {
  name: 'git_commit',
  description: 'Create a commit from currently staged changes after explicit user approval. Does not push.',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string', description: 'Commit message (1–500 characters).' } },
    required: ['message'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const message = optionalString(input, 'message', { max: 500 })?.trim() ?? ''
    if (!message) return { ok: false, content: '', error: 'A non-empty commit message is required.' }
    const repoError = await ensureRepo(ctx)
    if (repoError) return { ok: false, content: '', error: repoError }
    const repoRootResult = await runGit(['rev-parse', '--show-toplevel'], ctx.workspace, ctx.signal)
    const repoRoot = repoRootResult.stdout.trim()
    if (repoRootResult.code !== 0 || !repoRoot) return { ok: false, content: '', error: 'Could not determine the Git repository root.' }
    const stagedPaths = await runGit(['diff', '--cached', '--name-only', '-z'], ctx.workspace, ctx.signal)
    if (stagedPaths.code !== 0) return body(ctx, 'diff --cached --name-only', stagedPaths)
    const outsideWorkspace: string[] = []
    for (const stagedPath of stagedPaths.stdout.split('\0').filter(Boolean)) {
      try {
        await resolveInside(ctx.workspace, path.resolve(repoRoot, stagedPath))
      } catch {
        outsideWorkspace.push(stagedPath)
      }
    }
    if (outsideWorkspace.length > 0) {
      return {
        ok: false,
        content: '',
        error: `Refusing to commit: staged changes include paths outside the workspace (${outsideWorkspace.slice(0, 10).join(', ')}). Unstage or review them separately.`,
      }
    }
    const staged = await runGit(['diff', '--cached', '--no-ext-diff', '--no-color', '--stat'], ctx.workspace, ctx.signal)
    if (staged.code !== 0) return body(ctx, 'diff --cached --stat', staged)
    if (!staged.stdout.trim()) return { ok: false, content: '', error: 'There are no staged changes to commit.' }
    const detail = `Commit message: ${message}\n\nStaged changes:\n${staged.stdout.trim()}\n\nGit commit hooks may run with your user permissions.`
    const auth = await ctx.authorize({ kind: 'git.write', command: `git commit -m ${message}` }, 'git_commit', detail)
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    const result = await runGit(['commit', '-m', message], ctx.workspace, ctx.signal)
    return body(ctx, `commit -m ${message}`, result)
  },
}

export const gitTools: AgentTool[] = [gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitShowTool, gitStageTool, gitCommitTool]

export { runGit, ensureRepo }
