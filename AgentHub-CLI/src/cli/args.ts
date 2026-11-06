import type { PermissionMode, ShellKind, ThemeName } from '../config/types.ts'

export type Command = 'run' | 'doctor' | 'models' | 'skills' | 'sessions' | 'config' | 'memory' | 'backups' | 'help' | 'version'

export interface ParsedArgs {
  command: Command
  subcommand?: string
  rest: string[]
  task: string
  workspace?: string
  model?: string
  provider?: string
  permission?: PermissionMode
  print: boolean
  json: boolean
  yes: boolean
  resume?: string
  session?: string
  maxSteps?: number
  timeoutMs?: number
  appUrl?: string
  noMemory: boolean
  skillsDirs: string[]
  theme?: ThemeName
  color?: boolean
  ascii?: boolean
  shell?: ShellKind
  sessionsDir?: string
  backups?: boolean
  allowOutsideReads?: boolean
  allowCloud: boolean
  quiet: boolean
  verbose: boolean
  help: boolean
  version: boolean
  probe: boolean
  force: boolean
  user: boolean
  skill?: string
  dir?: string
  ref?: string
  repo?: string
  noEvidence: boolean
  dryRun: boolean
  review: boolean
  raw: string[]
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

const COMMANDS = new Set<Command>(['doctor', 'models', 'skills', 'sessions', 'config', 'memory', 'backups', 'help', 'version'])
const PERMISSIONS = new Set(['read-only', 'ask', 'auto', 'bypass'])
const THEMES = new Set(['auto', 'mono'])
const SHELLS = new Set(['auto', 'cmd', 'powershell', 'bash'])

function intValue(raw: string, name: string, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`${name} must be an integer between ${min} and ${max}.`)
  }
  return n
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: 'run',
    rest: [],
    task: '',
    print: false,
    json: false,
    yes: false,
    noMemory: false,
    skillsDirs: [],
    allowCloud: false,
    quiet: false,
    verbose: false,
    help: false,
    version: false,
    probe: false,
    force: false,
    user: false,
    noEvidence: false,
    dryRun: false,
    review: false,
    raw: [...argv],
  }

  let i = 0
  const positionals: string[] = []
  let stopOptions = false

  if (argv[0] && !argv[0].startsWith('-') && COMMANDS.has(argv[0] as Command)) {
    out.command = argv[0] as Command
    i = 1
    if ((out.command === 'skills' || out.command === 'sessions' || out.command === 'memory' || out.command === 'config' || out.command === 'backups') && argv[1] && !argv[1].startsWith('-')) {
      out.subcommand = argv[1]
      i = 2
    }
  }

  while (i < argv.length) {
    const arg = argv[i]!
    if (stopOptions) {
      positionals.push(arg)
      i++
      continue
    }
    if (arg === '--') {
      stopOptions = true
      i++
      continue
    }
    if (!arg.startsWith('-') || arg === '-') {
      // Allow global flags before the command, e.g. `agenthub --json doctor`.
      if (out.command === 'run' && positionals.length === 0 && COMMANDS.has(arg as Command)) {
        out.command = arg as Command
        i++
        if (
          (out.command === 'skills' || out.command === 'sessions' || out.command === 'memory' || out.command === 'config' || out.command === 'backups') &&
          argv[i] &&
          !argv[i]!.startsWith('-')
        ) {
          out.subcommand = argv[i]!
          i++
        }
        continue
      }
      positionals.push(arg)
      i++
      continue
    }

    const need = (name: string): string => {
      const value = argv[i + 1]
      if (value === undefined) throw new UsageError(`${name} requires a value.`)
      i += 1
      return value
    }

    switch (arg) {
      case '--workspace':
      case '-w':
        out.workspace = need(arg)
        break
      case '--model':
      case '-m':
        out.model = need(arg)
        break
      case '--provider':
        out.provider = need(arg)
        break
      case '--permission': {
        const value = need(arg)
        if (!PERMISSIONS.has(value)) throw new UsageError('--permission must be read-only, ask, auto or bypass.')
        out.permission = value as PermissionMode
        break
      }
      case '--print':
      case '-p':
        out.print = true
        break
      case '--json':
        out.json = true
        out.print = true
        break
      case '--yes':
      case '-y':
        out.yes = true
        break
      case '--resume':
        out.resume = need(arg)
        break
      case '--session':
        out.session = need(arg)
        break
      case '--max-steps':
        out.maxSteps = intValue(need(arg), '--max-steps', 1, 200)
        break
      case '--timeout': {
        const seconds = Number(need(arg))
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) {
          throw new UsageError('--timeout must be between 1 and 3600 seconds.')
        }
        out.timeoutMs = Math.round(seconds * 1000)
        break
      }
      case '--app-url':
        out.appUrl = need(arg)
        break
      case '--no-memory':
        out.noMemory = true
        break
      case '--skills-dir':
        out.skillsDirs.push(need(arg))
        break
      case '--theme': {
        const value = need(arg)
        if (!THEMES.has(value)) throw new UsageError('--theme must be auto or mono.')
        out.theme = value as ThemeName
        break
      }
      case '--no-color':
        out.color = false
        break
      case '--color':
        out.color = true
        break
      case '--ascii':
        out.ascii = true
        break
      case '--shell': {
        const value = need(arg)
        if (!SHELLS.has(value)) throw new UsageError('--shell must be auto, cmd, powershell or bash.')
        out.shell = value as ShellKind
        break
      }
      case '--sessions-dir':
        out.sessionsDir = need(arg)
        break
      case '--no-backups':
        out.backups = false
        break
      case '--allow-outside-reads':
        out.allowOutsideReads = true
        break
      case '--allow-cloud':
        out.allowCloud = true
        break
      case '--quiet':
      case '-q':
        out.quiet = true
        break
      case '--verbose':
      case '-v':
        out.verbose = true
        break
      case '--help':
      case '-h':
        out.help = true
        break
      case '--version':
      case '-V':
        out.version = true
        break
      case '--probe':
        out.probe = true
        break
      case '--force':
        out.force = true
        break
      case '--user':
        out.user = true
        break
      case '--skill':
        out.skill = need(arg)
        break
      case '--dir':
        out.dir = need(arg)
        break
      case '--ref':
        out.ref = need(arg)
        break
      case '--repo':
        out.repo = need(arg)
        break
      case '--no-evidence':
        out.noEvidence = true
        break
      case '--dry-run':
        out.dryRun = true
        break
      case '--review':
        out.review = true
        break
      default:
        throw new UsageError(`Unknown option: ${arg}`)
    }
    i++
  }

  if (out.command === 'run') {
    out.task = positionals.join(' ').trim()
    out.rest = positionals
  } else if (out.command === 'skills' || out.command === 'sessions' || out.command === 'memory' || out.command === 'config' || out.command === 'backups') {
    if (!out.subcommand && positionals.length > 0) {
      out.subcommand = positionals.shift()
    }
    out.rest = positionals
  } else {
    out.rest = positionals
  }

  if (out.command === 'version') out.version = true
  if (out.command === 'help') out.help = true
  return out
}
