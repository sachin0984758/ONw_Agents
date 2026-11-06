import type { AgentConfig } from '../../config/types.ts'
import { describeConfig } from '../../config/load.ts'
import { defaultAnsi } from '../../utils/ansi.ts'
import type { ParsedArgs } from '../args.ts'
import { isLocalUrl } from '../../providers/registry.ts'
import { migrateConfig } from '../../config/migrate.ts'

export async function runConfigCommand(config: AgentConfig, args: ParsedArgs): Promise<number> {
  if (args.subcommand === 'migrate') {
    const file = args.user ? config.userConfigPath : config.workspaceConfigPath
    const result = await migrateConfig(file, args.dryRun)
    process.stdout.write(`${args.json ? JSON.stringify({ ok: true, file, dryRun: args.dryRun, ...result }) : `Schema v${result.version}: ${result.changed ? args.dryRun ? 'migration available' : 'migrated' : 'already current'}${result.backup ? `; backup: ${result.backup}` : ''}`}\n`)
    return 0
  }
  const providers = config.providers.map((p) => ({
    id: p.id,
    label: p.label ?? null,
    kind: p.kind,
    baseUrl: p.baseUrl,
    apiKeyEnv: p.apiKeyEnv ?? null,
    local: isLocalUrl(p.baseUrl),
    models: p.models ?? null,
    capabilities: p.capabilities ?? {},
    // apiKey is intentionally never serialized.
  }))
  const mcpServers = config.mcpServers.map((server) => ({
    id: server.id,
    command: server.command,
    // Arguments can contain credentials or private paths. Show only the count.
    argCount: server.args.length,
    envKeys: Object.keys(server.env ?? {}),
    cwd: server.cwd ?? null,
    timeoutMs: server.timeoutMs ?? null,
  }))
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          workspace: config.workspace,
          provider: config.provider,
          model: config.model,
          permissionMode: config.permissionMode,
          autoApprove: config.autoApprove,
          maxSteps: config.maxSteps,
          maxWallClockMs: config.maxWallClockMs,
          commandTimeoutMs: config.commandTimeoutMs,
          contextTokens: config.contextTokens,
          skillsDirs: config.skillsDirs,
          appUrl: config.appUrl,
          sessionsDir: config.sessionsDir,
          backupsDir: config.backupsDir,
          memory: config.memory,
          toolConcurrency: config.toolConcurrency,
          agentConcurrency: config.agentConcurrency,
          maxAgents: config.maxAgents,
          memoryBudgetBytes: config.memoryBudgetBytes,
          memoryAutoExtract: config.memoryAutoExtract,
          verification: config.verification,
          backupMaxEntries: config.backupMaxEntries,
          backupMaxBytes: config.backupMaxBytes,
          backupMaxAgeDays: config.backupMaxAgeDays,
          backups: config.backups,
          allowCloud: config.allowCloud,
          allowOutsideWorkspaceReads: config.allowOutsideWorkspaceReads,
          denyRules: config.denyRules,
          allowRules: config.allowRules,
          shell: config.shell,
          theme: config.theme,
          configPaths: { user: config.userConfigPath, workspace: config.workspaceConfigPath },
          warnings: config.configWarnings,
          providers,
          mcpServers,
        },
        null,
        2,
      )}\n`,
    )
    return 0
  }

  const ansi = defaultAnsi()
  const print = (line = '') => process.stdout.write(`${line}\n`)
  print(ansi.bold('Effective configuration'))
  print(describeConfig(config))
  print('')
  print(ansi.bold('Providers'))
  for (const provider of providers) {
    print(`  ${provider.id}  ${provider.baseUrl}  ${isLocalUrl(provider.baseUrl) ? '(local)' : '(remote)'}`)
    if (provider.apiKeyEnv) print(ansi.gray(`    key from: ${provider.apiKeyEnv}${process.env[provider.apiKeyEnv] ? ' (set)' : ' (not set)'}`))
  }
  print('')
  print(ansi.bold('MCP servers'))
  if (mcpServers.length === 0) print(ansi.gray('  (none configured)'))
  for (const server of mcpServers) {
    print(`  ${server.id}  ${server.command}${server.argCount > 0 ? ` (${server.argCount} arg(s))` : ''}`)
    if (server.envKeys.length > 0) print(ansi.gray(`    environment keys: ${server.envKeys.join(', ')} (values not shown)`))
  }
  print('')
  print(ansi.bold('Files'))
  print(`  user config:      ${config.userConfigPath}`)
  print(`  workspace config: ${config.workspaceConfigPath}`)
  print('')
  print(ansi.bold('Security rules'))
  print(`  hard denies are always enforced; approval and bypass cannot override them.`)
  print(`  deny patterns:  ${config.denyRules.length > 0 ? config.denyRules.join(', ') : '(none)'}`)
  print(`  allow patterns: ${config.allowRules.length > 0 ? config.allowRules.join(', ') : '(none)'}`)
  if (config.configWarnings.length > 0) {
    print('')
    print(ansi.bold('Warnings'))
    for (const warning of config.configWarnings) print(`  ! ${warning}`)
  }
  return 0
}
