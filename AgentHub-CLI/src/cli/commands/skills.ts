import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentConfig } from '../../config/types.ts'
import { discoverSkills, findSkill, type SkillEntry, type SkillIndex } from '../../skills/discover.ts'
import { staticCheck, type StaticCheck } from '../../skills/static-check.ts'
import { checkInstalledCompat, checkRepoCompat, probeApp, summarizeReport } from '../../skills/compat.ts'
import { installSkill, rollbackSkill, updateSkill } from '../../skills/install.ts'
import { ensureDir, resolveInside } from '../../utils/fsx.ts'
import { createGlyphs, defaultAnsi, type Ansi } from '../../utils/ansi.ts'
import type { ParsedArgs } from '../args.ts'
import { UsageError } from '../args.ts'

function overallVerdict(report: unknown): string | null {
  if (!report || typeof report !== 'object') return null
  const value = (report as Record<string, unknown>).overall
  return typeof value === 'string' ? value : null
}

function verdictSymbol(check: StaticCheck, ansi: Ansi, glyphs: ReturnType<typeof createGlyphs>): string {
  switch (check.verdict) {
    case 'compatible':
      return ansi.green(glyphs.ok)
    case 'needs-review':
      return ansi.yellow(glyphs.warn)
    case 'incompatible':
      return ansi.red(glyphs.fail)
    case 'not-verified':
      return ansi.gray('?')
  }
}

function printCheck(check: StaticCheck, ansi: Ansi, glyphs: ReturnType<typeof createGlyphs>, verbose: boolean): void {
  const print = (line = '') => process.stdout.write(`${line}\n`)
  print(`${verdictSymbol(check, ansi, glyphs)} ${ansi.bold(check.name)} — ${check.verdict}`)
  print(`  format: ${check.format}`)
  if (check.declaredTools.length > 0) {
    for (const tool of check.declaredTools) {
      const mark = tool.available ? ansi.green(glyphs.ok) : ansi.red(glyphs.fail)
      print(`  ${mark} tool ${tool.declared}${tool.mappedTo ? ansi.gray(` → ${tool.mappedTo}`) : ansi.gray(' → unavailable')}`)
    }
  }
  if (check.missingCapabilities.length > 0) {
    print(`  ${ansi.red('missing capabilities')}: ${check.missingCapabilities.join(', ')}`)
  }
  if (check.capabilitiesObserved.length > 0 && verbose) {
    print(`  ${ansi.gray('observed:')} ${check.capabilitiesObserved.join(', ')}`)
  }
  for (const warning of check.warnings) print(`  ${ansi.yellow(glyphs.warn)} ${warning}`)
  for (const warning of check.security) print(`  ${ansi.yellow(glyphs.warn)} security: ${warning}`)
  if (check.scripts.length > 0) {
    print(`  ${ansi.yellow(glyphs.warn)} scripts present (never executed automatically): ${check.scripts.slice(0, 10).join(', ')}`)
  }
  print(`  ${ansi.gray(check.limitation)}`)
}

function printEntry(entry: SkillEntry, ansi: Ansi, glyphs: ReturnType<typeof createGlyphs>): void {
  const print = (line = '') => process.stdout.write(`${line}\n`)
  const flags = [
    entry.valid ? ansi.green('valid') : ansi.red('invalid'),
    ansi.gray(entry.source),
    entry.scripts.length > 0 ? ansi.yellow(`${entry.scripts.length} script(s)`) : null,
    entry.security.length > 0 ? ansi.yellow(`${entry.security.length} warning(s)`) : null,
    entry.shadowedBy ? ansi.gray('shadowed') : null,
  ].filter(Boolean)
  print(`${entry.valid && !entry.shadowedBy ? glyphs.ok : glyphs.fail} ${ansi.bold(entry.name)}  ${flags.join(' · ')}`)
  print(`  ${entry.description || '(no description)'}`)
  if (!entry.valid) for (const error of entry.errors) print(`  ${ansi.red(error)}`)
  if (entry.shadowedBy) print(ansi.gray(`  shadowed by ${entry.shadowedBy}`))
}

function printIndex(index: SkillIndex, config: AgentConfig, ansi: Ansi, glyphs: ReturnType<typeof createGlyphs>): void {
  const print = (line = '') => process.stdout.write(`${line}\n`)
  for (const dir of index.dirs) {
    print(`${dir.exists ? glyphs.ok : ansi.gray('–')} ${dir.path}${dir.exists ? '' : ansi.gray(' (missing)')}`)
  }
  if (index.entries.length === 0) {
    print('')
    print('No skills installed.')
    return
  }
  print('')
  for (const entry of index.entries) printEntry(entry, ansi, glyphs)
  if (index.warnings.length > 0) {
    print('')
    for (const warning of index.warnings) print(`${ansi.yellow(glyphs.warn)} ${warning}`)
  }
  print('')
  print(
    ansi.gray(
      `${index.entries.filter((e) => e.valid && !e.shadowedBy).length} active, ${index.invalid.length} invalid. Skills are instructions only; scripts are never executed automatically.`,
    ),
  )
}

async function removeSkill(config: AgentConfig, name: string): Promise<string> {
  const index = await discoverSkills(config)
  const entry = findSkill(index, name)
  if (!entry) throw new Error(`No installed skill named "${name}".`)
  const root = path.dirname(entry.dir)
  if (config.skillsDirs.some((dir) => path.resolve(dir) === path.resolve(entry.dir))) {
    throw new Error(`"${name}" is a skills root directory, not an installable skill. Remove it manually if intended.`)
  }
  const target = await resolveInside(root, path.basename(entry.dir))
  const backupRoot = path.join(config.home, 'backups', 'skills')
  await ensureDir(backupRoot)
  const backup = path.join(backupRoot, `${path.basename(entry.dir)}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  try {
    await fs.rename(target, backup)
  } catch {
    await fs.cp(target, backup, { recursive: true, errorOnExist: false })
    await fs.rm(target, { recursive: true, force: true })
  }
  // Keep the install metadata honest.
  const metaFile = path.join(root, '.agenthub-installed.json')
  try {
    const raw = await fs.readFile(metaFile, 'utf8')
    const data = JSON.parse(raw) as Record<string, unknown>
    if (data[entry.name]) {
      delete data[entry.name]
      await fs.writeFile(metaFile, JSON.stringify(data, null, 2), 'utf8')
    }
  } catch {
    // Metadata is optional.
  }
  return backup
}

export async function runSkillsCommand(config: AgentConfig, args: ParsedArgs, signal: AbortSignal): Promise<number> {
  const ansi = defaultAnsi()
  const glyphs = createGlyphs(config.ascii)
  const print = (line = '') => process.stdout.write(`${line}\n`)
  const sub = args.subcommand ?? 'list'

  if (sub === 'list') {
    const index = await discoverSkills(config)
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            dirs: index.dirs,
            entries: index.entries.map((e) => ({
              name: e.name,
              description: e.description,
              dir: e.dir,
              source: e.source,
              valid: e.valid,
              errors: e.errors,
              warnings: e.warnings,
              security: e.security,
              scripts: e.scripts,
              files: e.files.length,
              shadowedBy: e.shadowedBy ?? null,
            })),
            warnings: index.warnings,
          },
          null,
          2,
        )}\n`,
      )
      return 0
    }
    print(ansi.bold('Skills'))
    printIndex(index, config, ansi, glyphs)
    return 0
  }

  if (sub === 'inspect') {
    const name = args.rest[0]
    if (!name) throw new UsageError('Usage: agenthub skills inspect <name>')
    const index = await discoverSkills(config)
    const entry = findSkill(index, name)
    if (!entry) {
      print(`${ansi.red(glyphs.fail)} No active skill named "${name}".`)
      if (index.entries.length > 0) print(ansi.gray(`Available: ${index.entries.filter((e) => !e.shadowedBy).map((e) => e.name).join(', ')}`))
      return 1
    }
    const check = staticCheck(entry)
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            entry: {
              name: entry.name,
              description: entry.description,
              dir: entry.dir,
              source: entry.source,
              valid: entry.valid,
              errors: entry.errors,
              warnings: entry.warnings,
              security: entry.security,
              scripts: entry.scripts,
              files: entry.files,
              sizeBytes: entry.sizeBytes,
              meta: entry.meta,
              bodyPreview: entry.body.slice(0, 4000),
            },
            check,
          },
          null,
          2,
        )}\n`,
      )
      return 0
    }
    print(ansi.bold(`Skill: ${entry.name}`))
    print(`  ${entry.description}`)
    print(`  source: ${entry.source} · ${entry.dir}`)
    print(`  files: ${entry.files.length} · ${(entry.sizeBytes / 1024).toFixed(1)} KB`)
    if (entry.meta?.license) print(`  license: ${entry.meta.license}`)
    if (entry.meta?.version) print(`  version: ${entry.meta.version}`)
    print('')
    printCheck(check, ansi, glyphs, true)
    if (entry.files.length > 0) {
      print('')
      print('Files:')
      for (const file of entry.files.slice(0, 40)) print(`  ${file.kind.padEnd(7)} ${file.rel}`)
      if (entry.files.length > 40) print(ansi.gray(`  … ${entry.files.length - 40} more`))
    }
    print('')
    print(ansi.bold('Instructions preview'))
    const preview = entry.body.split('\n').slice(0, 60).join('\n')
    print(preview || '(empty)')
    if (entry.body.split('\n').length > 60) print(ansi.gray('… preview truncated; inspect SKILL.md for the full text'))
    return 0
  }

  if (sub === 'check') {
    if (args.repo) {
      const app = await probeApp(config.appUrl, signal)
      if (!app.ok) {
        const message = `The AgentHub app is not reachable at ${config.appUrl} (${app.error ?? 'unknown error'}).\nThe repository compatibility scan is implemented by the app's scanner; start the app or pass --app-url.`
        if (args.json) process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`)
        else print(`${ansi.red(glyphs.fail)} ${message}`)
        return 1
      }
      const result = await checkRepoCompat(
        config.appUrl,
        args.repo,
        { ref: args.ref, dir: args.dir, probe: args.probe },
        signal,
      )
      if (args.json) {
        const overall = overallVerdict(result.report)
        process.stdout.write(
          `${JSON.stringify(
            {
              ok: result.ok && overall !== 'incompatible',
              source: 'agenthub-app',
              url: result.url,
              report: result.report ?? null,
              multiple: result.multiple ?? false,
              candidates: result.candidates ?? null,
              error: result.error ?? null,
            },
            null,
            2,
          )}\n`,
        )
        return result.ok && overall !== 'incompatible' ? 0 : 1
      }
      if (!result.ok) {
        print(`${ansi.red(glyphs.fail)} ${result.error ?? 'Compatibility scan failed.'}`)
        if (result.candidates?.length) {
          print('Multiple skills found; choose one with --dir:')
          for (const candidate of result.candidates) print(`  - ${candidate.name} (${candidate.dir})`)
        }
        return 1
      }
      if (result.multiple) {
        print(ansi.bold('Multiple skills were found in that repository.'))
        for (const candidate of result.candidates ?? []) print(`  - ${candidate.name} (${candidate.dir})`)
        print('')
        print(ansi.gray('Re-run with --dir <directory> to scan one skill. Nothing was installed.'))
        return 0
      }
      print(ansi.bold(`Compatibility report (AgentHub app: ${config.appUrl})`))
      print(summarizeReport(result.report))
      print('')
      print(ansi.gray('Report produced by the existing AgentHub compatibility scanner; it was not re-implemented here.'))
      return overallVerdict(result.report) === 'incompatible' ? 1 : 0
    }

    const index = await discoverSkills(config)
    const names = args.rest
    let entries: SkillEntry[]
    if (names.length > 0) {
      entries = []
      for (const name of names) {
        const entry = findSkill(index, name)
        if (!entry) {
          print(`${ansi.red(glyphs.fail)} No active skill named "${name}".`)
          return 1
        }
        entries.push(entry)
      }
    } else {
      entries = index.entries.filter((e) => !e.shadowedBy)
    }
    if (entries.length === 0) {
      if (args.json) process.stdout.write(`${JSON.stringify({ ok: true, checks: [] }, null, 2)}\n`)
      else print('No skills installed; nothing to check.')
      return 0
    }
    const checks = entries.map((entry) => ({ entry, check: staticCheck(entry) }))
    const appReport = names.length === 1 && entries[0] ? await tryAppInstalledReport(config, entries[0].name, signal) : null
    const ok = checks.every((c) => c.check.verdict !== 'incompatible')
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok,
            checks: checks.map((c) => ({
              ...c.check,
              name: c.entry.name,
              source: c.entry.source,
              dir: c.entry.dir,
            })),
            appReport,
            limitation:
              'Static checks only. Functional compatibility requires running the skill through a real model and tool path.',
          },
          null,
          2,
        )}\n`,
      )
      return ok ? 0 : 1
    }
    print(ansi.bold('Skills check (static)'))
    print('')
    for (const { check } of checks) {
      printCheck(check, ansi, glyphs, args.verbose)
      print('')
    }
    if (appReport) {
      print(ansi.bold('AgentHub app report (same skill name in the app registry)'))
      print(summarizeReport(appReport.report))
      print('')
    }
    print(ansi.gray('Static checks do not prove functional compatibility. Use `agenthub skills check --repo <url>` for the app scanner, then run a real task.'))
    return ok ? 0 : 1
  }

  if (sub === 'install') {
    const source = args.rest[0]
    if (!source) throw new UsageError('Usage: agenthub skills install <path|url> [--ref ref] [--dir subdir] [--skill name] [--force] [--user]')
    const logs: string[] = []
    const result = await installSkill(config, {
      source,
      ref: args.ref,
      dir: args.dir,
      skill: args.skill,
      user: args.user,
      force: args.force,
      signal,
      log: (line) => {
        logs.push(line)
        if (!args.json && !args.quiet) print(ansi.gray(line))
      },
    })
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ...result, logs }, null, 2)}\n`)
      return result.ok ? 0 : 1
    }
    if (!result.ok) {
      print(`${ansi.red(glyphs.fail)} ${result.error}`)
      if (result.candidates?.length) {
        print('Candidates:')
        for (const candidate of result.candidates) print(`  - ${candidate.name} (${candidate.dir})`)
        print('Re-run with --skill <name>.')
      }
      for (const warning of result.warnings) print(`${ansi.yellow(glyphs.warn)} ${warning}`)
      return 1
    }
    for (const name of result.installed) print(`${ansi.green(glyphs.ok)} installed ${ansi.bold(name)} → ${result.targetRoot}`)
    if (result.commit) print(ansi.gray(`  commit: ${result.commit}`))
    for (const warning of result.warnings) print(`${ansi.yellow(glyphs.warn)} ${warning}`)
    print(ansi.gray('  No scripts were executed and no package manager was invoked.'))
    return 0
  }

  if (sub === 'update') {
    const name = args.rest[0]
    if (!name) throw new UsageError('Usage: agenthub skills update <name> [--ref ref] [--dir subdir] [--user] [--dry-run] [--force]')
    const logs: string[] = []
    const result = await updateSkill(config, {
      name,
      ref: args.ref,
      dir: args.dir,
      user: args.user,
      force: args.force,
      dryRun: args.dryRun,
      signal,
      log: (line) => {
        logs.push(line)
        if (!args.json && !args.quiet) print(ansi.gray(line))
      },
    })
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ...result, logs }, null, 2)}\n`)
      return result.ok ? 0 : 1
    }
    if (!result.ok) {
      print(`${ansi.red(glyphs.fail)} ${result.error ?? 'Skill update failed.'}`)
      for (const warning of result.warnings) print(`${ansi.yellow(glyphs.warn)} ${warning}`)
      return 1
    }
    print(ansi.bold(`${args.dryRun ? 'Update preview' : 'Updated'} ${result.name}`))
    print(`  current revision: ${result.fromRevision ?? 'unknown'}`)
    print(`  proposed revision: ${result.toRevision ?? 'unknown'}`)
    if (result.commit) print(`  source commit: ${result.commit}`)
    print(`  compatibility: ${result.compatibility.checked ? (result.compatibility.overall ?? 'checked') : `not checked (${result.compatibility.error ?? 'app unavailable'})`}`)
    if (result.changes.length === 0) print('  changes: none (the installed copy already matches the source)')
    else {
      print(`  changes: ${result.changes.length}`)
      for (const change of result.changes.slice(0, 80)) {
        print(`    ${change.kind.padEnd(9)} ${change.path}${change.bytes !== undefined ? ansi.gray(` (${change.bytes} B)`) : ''}`)
      }
      if (result.changes.length > 80) print(ansi.gray(`    … ${result.changes.length - 80} more`))
    }
    print(ansi.gray('  Permission policy unchanged. Skill text cannot grant tools or permissions; scripts are never executed automatically.'))
    for (const warning of result.warnings) print(`${ansi.yellow(glyphs.warn)} ${warning}`)
    if (args.dryRun) print(ansi.gray('Dry run: nothing was installed or replaced.'))
    else if (result.backup) print(ansi.gray(`  Previous version backed up to ${result.backup}. Roll back with: agenthub skills rollback ${result.name} --yes`))
    return 0
  }

  if (sub === 'rollback') {
    const name = args.rest[0]
    if (!name) throw new UsageError('Usage: agenthub skills rollback <name> --yes')
    if (!args.yes && !args.force) {
      print(`${ansi.yellow(glyphs.warn)} Refusing to roll back "${name}" without confirmation. Re-run with --yes.`)
      return 2
    }
    const result = await rollbackSkill(config, name, signal)
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return result.ok ? 0 : 1
    }
    if (!result.ok) {
      print(`${ansi.red(glyphs.fail)} ${result.error ?? 'Rollback failed.'}`)
      return 1
    }
    print(`${ansi.green(glyphs.ok)} Rolled back ${name} from ${result.restoredFrom}`)
    if (result.backup) print(ansi.gray(`  The replaced version is at ${result.backup}`))
    return 0
  }

  if (sub === 'remove') {
    const name = args.rest[0]
    if (!name) throw new UsageError('Usage: agenthub skills remove <name> --yes')
    if (!args.yes && !args.force) {
      print(`${ansi.yellow(glyphs.warn)} Refusing to remove "${name}" without confirmation. Re-run with --yes.`)
      return 2
    }
    const backup = await removeSkill(config, name)
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, removed: name, backup }, null, 2)}\n`)
    } else {
      print(`${ansi.green(glyphs.ok)} Removed ${name}. A copy is at ${backup}`)
    }
    return 0
  }

  if (sub === 'help') {
    print('Usage: agenthub skills <list|inspect|check|install|update|rollback|remove>')
    print('  list                         List installed skills and warnings')
    print('  inspect <name>               Show metadata, files and security checks')
    print('  check [name...]              Static compatibility checks')
    print('  check --repo <url> [--ref]   Use the AgentHub app compatibility scanner')
    print('  install <path|url>           Install a local directory or a shallow git clone')
    print('  update <name> [--dry-run]    Re-check compatibility and update from the recorded source')
    print('  rollback <name> --yes        Restore the most recent update backup')
    print('  remove <name> --yes          Remove a skill (a backup is kept)')
    return 0
  }

  throw new UsageError(`Unknown skills subcommand: ${sub}`)
}

async function tryAppInstalledReport(
  config: AgentConfig,
  name: string,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof checkInstalledCompat>> | null> {
  const app = await probeApp(config.appUrl, signal)
  if (!app.ok) return null
  const result = await checkInstalledCompat(config.appUrl, name, {}, signal)
  return result.ok ? result : null
}
