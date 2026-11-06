import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { RepoContext } from '../context/repo.ts'
import type { ToolContext, ToolResult } from '../tools/types.ts'
import { resolveInside } from '../utils/fsx.ts'
import { fingerprint } from './journal.ts'

export interface VerificationReport {
  ok: boolean
  checkedFiles: string[]
  checks: Array<{ name: string; ok: boolean }>
  concerns: string[]
}

/** Evidence checks run independently of the model's final completion statement. */
export async function verifyChanges(ctx: ToolContext, repo: RepoContext, execute: (name: string, args: Record<string, unknown>) => Promise<ToolResult>): Promise<VerificationReport> {
  const report: VerificationReport = { ok: true, checkedFiles: [], checks: [], concerns: [] }
  const files = ctx.ledger.changedFiles()
  const failed = (message: string) => { report.ok = false; report.concerns.push(message) }
  const run = async (name: string, args: Record<string, unknown>, label: string) => {
    ctx.signal.throwIfAborted()
    const result = await execute(name, args)
    report.checks.push({ name: label, ok: result.ok })
    if (!result.ok) failed(`${label}: ${result.error ?? 'failed'}`)
  }
  if (repo.isGit) {
    // Limit diff inspection to AgentHub's recorded files, preserving unrelated work.
    for (const file of files.slice(0, 50)) await run('git_diff', { path: file.path }, `diff ${file.path}`)
  }
  const codeChanged = files.some((file) => /\.(?:[cm]?[jt]sx?|py|rs|go|java|cs|cpp|c|h|json)$/i.test(file.path))
  let scripts = repo.scripts
  let manager = repo.packageManager
  // Refresh tooling after a newly generated/edited manifest, with the normal read policy.
  if (files.some((file) => file.path === 'package.json')) {
    const manifest = await resolveInside(ctx.workspace, 'package.json')
    const auth = await ctx.authorize({ kind: 'fs.read', path: manifest, display: 'package.json' }, 'verification')
    if (!auth.ok) failed(`Cannot discover verification scripts: ${auth.reason}`)
    else {
      const stat = await fs.stat(manifest)
      if (stat.size > 1024 * 1024) failed('Manifest exceeds verification size limit.')
      else {
        try {
          const pkg = JSON.parse(await fs.readFile(manifest, 'utf8')) as { scripts?: Record<string, string>; packageManager?: string }
          scripts = pkg.scripts ?? {}
          manager = pkg.packageManager?.split('@')[0] || manager || 'npm'
        } catch { failed('Generated package.json is invalid JSON.') }
      }
    }
  }
  if (codeChanged) {
    const known = ['typecheck', 'lint', 'test'].filter((name) => typeof scripts[name] === 'string')
    if (known.length && ['npm', 'pnpm', 'yarn', 'bun'].includes(manager ?? '')) {
      for (const name of known) await run('run_command', { command: `${manager} run ${name}`, cwd: '.', reason: `Automatic verification after AgentHub file edits: ${name}` }, name)
    } else failed('Code changed but no supported test, lint or typecheck scripts were discovered. Verify the changes manually.')
  }
  for (const file of files) {
    ctx.signal.throwIfAborted()
    const abs = await resolveInside(ctx.workspace, file.path)
    const auth = await ctx.authorize({ kind: 'fs.read', path: abs, display: file.path }, 'verification')
    if (!auth.ok) { failed(`Cannot inspect ${file.path}: ${auth.reason}`); continue }
    try {
      const stat = await fs.stat(abs)
      if (!stat.isFile() || stat.size > 5 * 1024 * 1024) { failed(`Cannot verify bounded file contents: ${file.path}`); continue }
      const content = await fs.readFile(abs)
      if (!file.expectedHash || fingerprint(content) !== file.expectedHash) { failed(`File no longer matches the recorded AgentHub write: ${file.path}`); continue }
      if (path.extname(file.path).toLowerCase() === '.json') {
        try { JSON.parse(content.toString('utf8')) } catch { failed(`Invalid JSON output: ${file.path}`); continue }
      }
      report.checkedFiles.push(file.path)
    } catch (err) { failed(`File verification failed for ${file.path}: ${(err as Error).message}`) }
  }
  report.concerns.push('These checks verify recorded operations and available project checks; they do not prove every part of the user request was semantically fulfilled.')
  return report
}
