import type { CommandEvidence, RunResult } from '../core/events.ts'
import { formatTokens } from '../utils/token.ts'

const TEST_RE = /\b(test|tests|vitest|jest|pytest|playwright|cypress|tsc|eslint|typecheck|lint)\b/i

export interface EvidenceSummary {
  changed: string[]
  commands: CommandEvidence[]
  tests: CommandEvidence[]
  passedTests: number
  failedTests: number
}

export function isTestCommand(command: string): boolean {
  return TEST_RE.test(command)
}

export function summarizeEvidence(result: Pick<RunResult, 'changedFiles' | 'commands'>): EvidenceSummary {
  const tests = result.commands.filter((c) => isTestCommand(c.command))
  return {
    changed: result.changedFiles.map((f) => `${f.path} (${f.change})`),
    commands: result.commands,
    tests,
    passedTests: tests.filter((t) => t.exitCode === 0 && !t.timedOut).length,
    failedTests: tests.filter((t) => t.exitCode !== 0 || t.timedOut).length,
  }
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}

function exitLabel(entry: CommandEvidence): string {
  if (entry.timedOut) return 'timed out'
  if (entry.exitCode === null) return 'no exit code'
  return `exit ${entry.exitCode}`
}

export function evidenceLines(result: RunResult, ascii = false): string[] {
  const summary = summarizeEvidence(result)
  const sep = ascii ? '-' : '·'
  const arrow = ascii ? '->' : '→'
  const lines: string[] = []
  if (summary.changed.length > 0) {
    lines.push(`Changed (${summary.changed.length}):`)
    for (const file of summary.changed) lines.push(`- ${file}`)
  } else {
    lines.push('Changed: no files')
  }
  if (summary.commands.length > 0) {
    lines.push(`Commands (${summary.commands.length}):`)
    for (const command of summary.commands) {
      lines.push(`- ${command.command} ${arrow} ${exitLabel(command)} ${sep} ${seconds(command.durationMs)}`)
    }
  } else {
    lines.push('Commands: none run')
  }
  if (summary.tests.length === 0) {
    lines.push('Tests: not run')
  } else if (summary.failedTests > 0) {
    lines.push(`Tests: ${summary.failedTests} failed, ${summary.passedTests} passed`)
  } else {
    lines.push(`Tests: ${summary.passedTests} passed, 0 failed`)
  }
  const usage = `${formatTokens(result.usage.input)} in / ${formatTokens(result.usage.output)} out${result.usageEstimated ? ' (estimated)' : ''}`
  lines.push(`Status: ${result.status} ${sep} ${result.steps} step(s) ${sep} ${seconds(result.durationMs)} ${sep} tokens ${usage}`)
  if (result.error) lines.push(`Error: ${result.error.split('\n')[0]}`)
  if (result.limitations.length > 0) {
    lines.push('Limitations:')
    for (const limitation of result.limitations) lines.push(`- ${limitation}`)
  }
  return lines
}

export function formatEvidence(result: RunResult, ascii = false): string {
  return ['--- evidence ---', ...evidenceLines(result, ascii)].join('\n')
}

export function statusLine(result: RunResult, ascii = false): string {
  const summary = summarizeEvidence(result)
  const sep = ascii ? '-' : '·'
  const test =
    summary.tests.length === 0
      ? 'tests not run'
      : summary.failedTests > 0
        ? `${summary.failedTests} test command(s) failed`
        : `${summary.passedTests} test command(s) passed`
  return `${result.status} ${sep} ${result.steps} step(s) ${sep} ${seconds(result.durationMs)} ${sep} ${test}`
}
