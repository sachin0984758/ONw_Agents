import type { AgentConfig } from '../config/types.ts'
import type { ResolvedTarget } from '../providers/registry.ts'
import type { AgentEvent, EventSink, RunResult } from '../core/events.ts'
import { runAgent } from '../core/run.ts'
import type { RepoContext } from '../context/repo.ts'
import type { SkillIndex } from '../skills/discover.ts'
import type { SessionStore, StoredSession } from '../sessions/store.ts'
import { createGlyphs, defaultAnsi, type Ansi, type Glyphs } from '../utils/ansi.ts'
import { redactSecrets } from '../utils/redact.ts'
import { HeadlessApprovalBroker } from './brokers.ts'
import { formatEvidence } from './evidence.ts'

export interface HeadlessOptions {
  config: AgentConfig
  target: ResolvedTarget
  task: string
  session: StoredSession
  store: SessionStore
  skills: SkillIndex
  repo: RepoContext
  json: boolean
  quiet: boolean
  verbose: boolean
  noEvidence: boolean
  autoApprove: boolean
  signal: AbortSignal
}

export function exitCodeFor(result: Pick<RunResult, 'status'>): number {
  switch (result.status) {
    case 'completed':
      return 0
    case 'cancelled':
      return 3
    case 'partial':
      return 4
    case 'failed':
    default:
      return 1
  }
}

function summarizeToolArgs(name: string, args: Record<string, unknown>): string {
  if (name === 'run_command' && typeof args.command === 'string') return redactSecrets(args.command).slice(0, 160)
  if (typeof args.path === 'string') return args.path
  if (name === 'search_files' && typeof args.query === 'string') return `"${args.query}"`
  if (name === 'read_skill' && typeof args.name === 'string') return args.name
  if (name === 'set_plan' && Array.isArray(args.steps)) return `${args.steps.length} step(s)`
  return ''
}

class TextProgress {
  private readonly ansi: Ansi = defaultAnsi()
  private readonly glyphs: Glyphs
  private readonly quiet: boolean
  private readonly verbose: boolean
  private streamed = false
  private atLineStart = true

  constructor(quiet: boolean, verbose: boolean, ascii: boolean) {
    this.quiet = quiet
    this.verbose = verbose
    this.glyphs = createGlyphs(ascii)
  }

  private write(text: string): void {
    process.stderr.write(text)
    this.atLineStart = text.endsWith('\n')
  }

  private line(text: string): void {
    if (!this.atLineStart) this.write('\n')
    this.write(`${text}\n`)
  }

  handle(event: AgentEvent): void {
    if (this.quiet) return
    const ansi = this.ansi
    const g = this.glyphs
    switch (event.type) {
      case 'assistant_delta':
        // The final answer is printed once at the end; streaming raw deltas to
        // stderr would duplicate it.
        this.streamed = this.streamed || Boolean(event.text)
        break
      case 'tool_proposed': {
        const detail = summarizeToolArgs(event.name, event.args)
        this.line(`${ansi.cyan(g.bullet)} ${event.name}${detail ? ` ${ansi.gray(detail)}` : ''}`)
        break
      }
      case 'tool_result':
        this.line(`${ansi.green(g.ok)} ${ansi.gray(`${event.name} (${(event.durationMs / 1000).toFixed(2)}s)`)}`)
        if (this.verbose && event.content) {
          for (const line of event.content.split('\n').slice(0, 20)) this.write(`${ansi.gray(`  │ ${line}`)}\n`)
        }
        break
      case 'tool_error':
        this.line(`${ansi.red(g.fail)} ${event.name}: ${ansi.red(redactSecrets(event.error))}`)
        break
      case 'files_changed':
        this.line(`${ansi.magenta('✎')} ${event.path} ${ansi.gray(`(${event.change})`)}`)
        break
      case 'plan':
        this.line(ansi.bold('Plan:'))
        for (const step of event.steps) this.line(`  ${step.index + 1}. ${step.title}`)
        break
      case 'subagent_started':
        this.line(`${ansi.magenta('↳')} ${ansi.bold(`subagent ${event.label}`)} ${ansi.gray(`(${event.maxSteps} step budget)`)}`)
        break
      case 'subagent_progress':
        this.line(ansi.gray(`  ↳ ${redactSecrets(event.message)}`))
        break
      case 'subagent_completed':
        this.line(`${event.status === 'completed' ? ansi.green(g.ok) : ansi.yellow(g.warn)} ${ansi.gray(`subagent ${event.label}: ${event.status}`)}`)
        break
      case 'warning':
        this.line(`${ansi.yellow(g.warn)} ${ansi.yellow(redactSecrets(event.message))}`)
        break
      case 'error':
        this.line(`${ansi.red(g.fail)} ${ansi.red(redactSecrets(event.message))}`)
        break
      case 'run_cancelled':
        this.line(`${ansi.yellow(g.warn)} ${event.reason}`)
        break
      default:
        break
    }
  }
}

export async function runHeadless(opts: HeadlessOptions): Promise<number> {
  const progress = new TextProgress(opts.quiet, opts.verbose, opts.config.ascii)
  const broker = new HeadlessApprovalBroker(opts.autoApprove, (message) => {
    if (opts.quiet) return
    process.stderr.write(`\n${redactSecrets(message)}\n`)
  })

  const events: EventSink = (event) => {
    if (opts.json) {
      // One JSON object per line, always on stdout, never interleaved with
      // human-facing text. Approval notices go to stderr via the broker.
      process.stdout.write(`${JSON.stringify(event)}\n`)
      return
    }
    progress.handle(event)
  }

  let result: RunResult
  try {
    result = await runAgent({
      task: opts.task,
      config: opts.config,
      target: opts.target,
      session: opts.session,
      store: opts.store,
      skills: opts.skills,
      repo: opts.repo,
      events,
      broker,
      signal: opts.signal,
      resumed: opts.session.turns > 0 || opts.session.messages.length > 0,
    })
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err))
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({
          type: 'error',
          message,
          fatal: true,
        })}\n`,
      )
    } else {
      process.stderr.write(`${message}\n`)
    }
    return 1
  }

  if (opts.json) return exitCodeFor(result)

  if (result.text.trim()) {
    process.stdout.write(`${result.text.trimEnd()}\n`)
  } else if (!opts.quiet) {
    process.stderr.write('(the model produced no final text)\n')
  }

  if (!opts.noEvidence && !opts.quiet) {
    process.stderr.write(`\n${formatEvidence(result, opts.config.ascii)}\n`)
  } else if (result.status !== 'completed' && opts.quiet) {
    if (result.error) process.stderr.write(`${redactSecrets(result.error)}\n`)
    else process.stderr.write(`Run ${result.status}.\n`)
  }

  return exitCodeFor(result)
}
