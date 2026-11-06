import type { ChangedFileEvidence, CommandEvidence } from './events.ts'

export class RunLedger {
  private readonly changed = new Map<string, ChangedFileEvidence>()
  private readonly commandList: CommandEvidence[] = []

  addChanged(entry: ChangedFileEvidence): void {
    const existing = this.changed.get(entry.path)
    if (existing && existing.change === 'created' && entry.change === 'modified') {
      // A file created in this run stays "created".
      this.changed.set(entry.path, { ...entry, change: 'created', backup: entry.backup ?? existing.backup })
      return
    }
    this.changed.set(entry.path, entry)
  }

  addCommand(entry: CommandEvidence): void {
    this.commandList.push(entry)
  }

  changedFiles(): ChangedFileEvidence[] {
    return [...this.changed.values()]
  }

  commands(): CommandEvidence[] {
    return [...this.commandList]
  }

  tests(): CommandEvidence[] {
    return this.commandList.filter((c) =>
      /\b(test|tests|vitest|jest|pytest|playwright|cypress|tsc|eslint|typecheck|lint)\b/i.test(c.command),
    )
  }

  failingCommands(): CommandEvidence[] {
    return this.commandList.filter((c) => c.exitCode !== 0)
  }
}
