import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentConfig } from '../../config/types.ts'
import { SessionStore } from '../../sessions/store.ts'
import { createGlyphs, defaultAnsi } from '../../utils/ansi.ts'
import { ensureDir } from '../../utils/fsx.ts'
import type { ParsedArgs } from '../args.ts'
import { UsageError } from '../args.ts'
import { ActionJournal } from '../../core/journal.ts'

export async function runSessionsCommand(config: AgentConfig, args: ParsedArgs): Promise<number> {
  const store = new SessionStore(config)
  const ansi = defaultAnsi()
  const glyphs = createGlyphs(config.ascii)
  const print = (line = '') => process.stdout.write(`${line}\n`)
  const sub = args.subcommand ?? 'list'
  if (sub === 'recover') {
    const id = args.rest[0] ?? 'last'
    const session = id === 'last' ? await store.latest() : await store.load(id)
    if (!session) throw new UsageError('No session to recover.')
    if (path.resolve(session.workspace) !== path.resolve(config.workspace)) throw new UsageError('Select the original workspace to inspect its recovery journal.')
    const result = await new ActionJournal(config, session.id).recover()
    print(args.json ? JSON.stringify({ ok: result.unresolved.length === 0, sessionId: session.id, ...result }) : `${result.observedApplied} write(s) match intended bytes; ${result.unresolved.length} unknown outcome(s). No actions replayed.\n${result.unresolved.join('\n')}`)
    return result.unresolved.length ? 1 : 0
  }

  if (sub === 'list') {
    const sessions = await store.list(50)
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, sessions }, null, 2)}\n`)
      return 0
    }
    if (sessions.length === 0) {
      print(`No sessions in ${store.dir}`)
      return 0
    }
    print(ansi.bold(`Sessions (${sessions.length})`))
    for (const session of sessions) {
      print(
        `${ansi.cyan(session.id)}  ${ansi.gray(session.updatedAt)}  ${ansi.gray(session.model || 'unknown model')}  ${session.status}`,
      )
      print(`  ${session.title}`)
    }
    print('')
    print(ansi.gray(`Resume with: agenthub --resume <id>   (or --resume last)  ·  ${store.dir}`))
    return 0
  }

  if (sub === 'show') {
    const id = args.rest[0] ?? 'last'
    let session
    try {
      session = id === 'last' ? await store.latest() : await store.load(id)
    } catch (err) {
      print(`${ansi.red(glyphs.fail)} ${(err as Error).message}`)
      return 1
    }
    if (!session) {
      print('No sessions found.')
      return 1
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, session }, null, 2)}\n`)
      return 0
    }
    print(ansi.bold(session.title))
    print(`  id: ${session.id}`)
    print(`  updated: ${session.updatedAt}`)
    print(`  workspace: ${session.workspace}`)
    print(`  model: ${session.provider} / ${session.model}`)
    print(`  status: ${session.status} · turns: ${session.turns}`)
    print(`  usage: ${session.usage.input ?? 'unknown'} in / ${session.usage.output ?? 'unknown'} out`)
    print('')
    const messages = session.messages.slice(-40)
    for (const message of messages) {
      const role = message.role === 'assistant' ? 'assistant' : message.role === 'tool' ? `tool:${message.name ?? '?'}` : message.role
      const content = (message.content ?? '').replace(/\s+/g, ' ').slice(0, 240)
      print(`${ansi.cyan(role.padEnd(14))} ${content}`)
      if (message.tool_calls?.length) {
        print(ansi.gray(`${' '.repeat(14)} → ${message.tool_calls.map((c) => c.function.name).join(', ')}`))
      }
    }
    if (session.messages.length > messages.length) print(ansi.gray(`… ${session.messages.length - messages.length} older message(s)`))
    return 0
  }

  if (sub === 'remove') {
    const id = args.rest[0]
    if (!id) throw new UsageError('Usage: agenthub sessions remove <id> --yes')
    if (!args.yes && !args.force) {
      print(`${ansi.yellow(glyphs.warn)} Refusing to remove a session without confirmation. Re-run with --yes.`)
      return 2
    }
    const session = id === 'last' ? await store.latest() : await store.load(id)
    if (!session) {
      print('Session not found.')
      return 1
    }
    const file = path.join(store.dir, `${session.id}.json`)
    const backupDir = path.join(config.home, 'backups', 'sessions')
    await ensureDir(backupDir)
    const backup = path.join(backupDir, `${session.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    await fs.copyFile(file, backup)
    await store.remove(session.id)
    if (args.json) process.stdout.write(`${JSON.stringify({ ok: true, removed: session.id, backup }, null, 2)}\n`)
    else print(`${ansi.green(glyphs.ok)} Removed ${session.id}. A copy is at ${backup}`)
    return 0
  }

  if (sub === 'help') {
    print('Usage: agenthub sessions <list|show|remove>')
    print('  list              List recent sessions')
    print('  show <id|last>    Show a session transcript (read-only)')
    print('  remove <id> --yes Remove a session (a backup is kept)')
    return 0
  }

  throw new UsageError(`Unknown sessions subcommand: ${sub}`)
}
