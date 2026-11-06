import type { AgentConfig } from '../../config/types.ts'
import { BackupStore } from '../../core/backups.ts'
import type { ParsedArgs } from '../args.ts'
import { UsageError } from '../args.ts'

export async function runBackupsCommand(config: AgentConfig, args: ParsedArgs): Promise<number> {
  const store = new BackupStore(config)
  if (args.subcommand === 'prune') {
    const dryRun = args.dryRun || !args.yes
    const result = await store.prune(dryRun)
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun, ...result })}\n`)
    return 0
  }
  if (args.subcommand && args.subcommand !== 'list') throw new UsageError('Usage: agenthub backups [list|prune --dry-run|prune --yes]')
  process.stdout.write(`${JSON.stringify({ ok: true, entries: await store.list() })}\n`)
  return 0
}
