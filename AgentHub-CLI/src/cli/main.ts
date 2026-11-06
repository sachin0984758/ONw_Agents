import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseArgs, UsageError, type ParsedArgs } from './args.ts'
import { USAGE } from './help.ts'
import { VERSION } from '../version.ts'
import { ConfigError, type CliOverrides } from '../config/types.ts'
import { loadConfig } from '../config/load.ts'
import type { AgentConfig } from '../config/types.ts'
import { discoverProviders, isLocalUrl, resolveTarget, NoModelError, type ResolvedTarget } from '../providers/registry.ts'
import { discoverSkills } from '../skills/discover.ts'
import { buildRepoContext } from '../context/repo.ts'
import { SessionStore, type StoredSession } from '../sessions/store.ts'
import { redactSecrets } from '../utils/redact.ts'
import { setColorOverride } from '../utils/ansi.ts'
import { runDoctor } from './doctor.ts'
import { runModelsCommand } from './commands/models.ts'
import { runSkillsCommand } from './commands/skills.ts'
import { runSessionsCommand } from './commands/sessions.ts'
import { runConfigCommand } from './commands/config.ts'
import { runMemoryCommand } from './commands/memory.ts'
import { runBackupsCommand } from './commands/backups.ts'
import { runHeadless } from './headless.ts'
import { runTui } from './tui.ts'

export function cliOverrides(args: ParsedArgs): CliOverrides {
  return {
    workspace: args.workspace,
    model: args.model,
    provider: args.provider,
    permissionMode: args.permission,
    maxSteps: args.maxSteps,
    timeoutMs: args.timeoutMs,
    appUrl: args.appUrl,
    noMemory: args.noMemory,
    skillsDirs: args.skillsDirs.length > 0 ? args.skillsDirs : undefined,
    autoApprove: args.yes,
    theme: args.theme,
    color: args.color,
    ascii: args.ascii,
    shell: args.shell,
    sessionsDir: args.sessionsDir,
    backups: args.backups,
    allowOutsideReads: args.allowOutsideReads,
    allowCloud: args.allowCloud ? true : undefined,
    quiet: args.quiet,
    verbose: args.verbose,
  }
}

function isLocalProvider(target: ResolvedTarget): boolean {
  return isLocalUrl(target.providerConfig.baseUrl)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function stderr(line: string): void {
  process.stderr.write(`${line}\n`)
}

function fail(message: string, code = 2): number {
  stderr(message)
  return code
}

async function resolveSession(
  args: ParsedArgs,
  store: SessionStore,
  config: AgentConfig,
  target: ResolvedTarget,
  task: string,
): Promise<StoredSession> {
  if (args.resume && args.session) {
    throw new UsageError('Use either --resume or --session, not both.')
  }
  if (args.resume) {
    const session = args.resume === 'last' ? await store.latest() : await store.load(args.resume)
    if (!session) throw new UsageError('No previous session was found to resume.')
    if (session.workspace && session.workspace !== config.workspace) {
      stderr(
        `Warning: session ${session.id} was recorded in ${session.workspace}. Tools will use the current workspace ${config.workspace}. Nothing is replayed.`,
      )
    }
    return session
  }
  if (args.session) {
    const session = await store.load(args.session)
    if (session.workspace && session.workspace !== config.workspace) {
      stderr(
        `Warning: session ${session.id} was recorded in ${session.workspace}. Tools will use the current workspace ${config.workspace}. Nothing is replayed.`,
      )
    }
    return session
  }
  return store.create({
    task,
    workspace: config.workspace,
    provider: target.providerConfig.id,
    model: target.model,
    permissionMode: config.permissionMode,
  })
}

export async function runCli(argv: string[]): Promise<number> {
  let args: ParsedArgs
  try {
    args = parseArgs(argv)
  } catch (err) {
    if (err instanceof UsageError) {
      stderr(`agenthub: ${err.message}`)
      stderr('Run `agenthub --help` for usage.')
      return 2
    }
    throw err
  }

  if (args.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }

  let config: AgentConfig
  try {
    config = await loadConfig({ cwd: process.cwd(), cli: cliOverrides(args) })
  } catch (err) {
    if (err instanceof ConfigError) {
      stderr(err.message)
      return 2
    }
    return fail(`agenthub: ${(err as Error).message}`, 2)
  }

  setColorOverride(config.color)
  if (args.review) {
    config.permissionMode = 'read-only'
    config.autoApprove = false
    args.yes = false
    args.print = !args.json
    args.task = `Review current workspace changes for logic, security, performance, validation, error handling, unintended side effects and maintainability. Cite files and evidence. Separate confirmed findings from possible concerns. Do not modify files or approve changes merely because an agent generated them.\n${args.task}`
  }

  const controller = new AbortController()
  let interrupts = 0
  const onSignal = (): void => {
    interrupts++
    if (interrupts === 1) {
      stderr('Cancelling… (press Ctrl+C again to exit immediately)')
      controller.abort()
      return
    }
    process.exit(130)
  }

  try {
    switch (args.command) {
      case 'doctor':
        process.on('SIGINT', onSignal)
        return await runDoctor(config, {
          json: args.json,
          probe: args.probe,
          signal: controller.signal,
        })
      case 'models':
        process.on('SIGINT', onSignal)
        return await runModelsCommand(config, args, controller.signal)
      case 'skills':
        process.on('SIGINT', onSignal)
        return await runSkillsCommand(config, args, controller.signal)
      case 'sessions':
        return await runSessionsCommand(config, args)
      case 'config':
        return await runConfigCommand(config, args)
      case 'memory':
        return await runMemoryCommand(config, args)
      case 'backups':
        return await runBackupsCommand(config, args)
      default:
        break
    }

    // A plain run.
    let task = args.task
    if (task === '-') task = (await readStdin()).trim()
    else if (!task && (args.print || args.json) && !process.stdin.isTTY) task = (await readStdin()).trim()

    if (!task) {
      if (args.print || args.json) {
        return fail('No task was provided. Pass a task argument or pipe text on stdin.', 2)
      }
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return fail('Interactive mode needs a terminal. Use --print <task> or --json <task> for automation.', 2)
      }
    }
    if (args.print && !task) {
      return fail('No task was provided for --print.', 2)
    }

    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)

    const discovery = await discoverProviders(config, controller.signal)
    let target: ResolvedTarget
    try {
      target = resolveTarget(config, discovery)
    } catch (err) {
      if (err instanceof NoModelError) {
        stderr(`agenthub: ${err.message}`)
        if (err.detail) stderr(err.detail)
        stderr('')
        stderr('Run `agenthub doctor` for a full diagnosis, and start LM Studio or Ollama first.')
        return 1
      }
      throw err
    }

    if (!isLocalProvider(target) && !config.allowCloud) {
      stderr(
        `agenthub: refusing to send project content to a non-local endpoint (${target.providerConfig.baseUrl}).`,
      )
      stderr('Cloud use must be explicit. Re-run with --allow-cloud or set allowCloud in the user config.')
      return 2
    }

    const store = new SessionStore(config)
    let session: StoredSession
    try {
      session = await resolveSession(args, store, config, target, task)
    } catch (err) {
      if (err instanceof UsageError) return fail(`agenthub: ${err.message}`, 2)
      return fail(`agenthub: could not load the session: ${(err as Error).message}`, 2)
    }

    const [skills, repo] = await Promise.all([discoverSkills(config), buildRepoContext(config)])

    if (args.print || args.json) {
      return await runHeadless({
        config,
        target,
        task,
        session,
        store,
        skills,
        repo,
        json: args.json,
        quiet: args.quiet || config.quiet,
        verbose: args.verbose || config.verbose,
        noEvidence: args.noEvidence,
        autoApprove: args.yes,
        signal: controller.signal,
      })
    }

    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    return await runTui({
      config,
      target,
      store,
      session,
      skills,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') return 3
    stderr(`agenthub: ${redactSecrets(err instanceof Error ? err.message : String(err))}`)
    return 1
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let code: number
  try {
    code = await runCli(argv)
  } catch (err) {
    stderr(`agenthub: ${(err as Error).stack ?? (err as Error).message}`)
    code = 1
  }
  process.exitCode = code
  // Keep stdout writes flushed before the event loop drains.
  await new Promise<void>((resolve) => {
    if (process.stdout.writableLength === 0) resolve()
    else process.stdout.write('', () => resolve())
  })
  if (process.stdin.isTTY && process.stdin.readable) process.stdin.pause()
}

function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(entry).href
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  await main()
}
