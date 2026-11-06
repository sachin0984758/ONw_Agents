export type PermissionMode = 'read-only' | 'ask' | 'auto' | 'bypass'
export type ThemeName = 'auto' | 'mono'
export type ShellKind = 'auto' | 'cmd' | 'powershell' | 'bash'

export interface ProviderConfig {
  id: string
  label?: string
  kind: 'openai-compatible'
  baseUrl: string
  apiKeyEnv?: string
  /** Runtime-only; never written to a config file by this program. */
  apiKey?: string
  models?: string[]
  capabilities?: Partial<Record<'streaming' | 'tools' | 'json' | 'vision' | 'reasoning', boolean>>
  headers?: Record<string, string>
  timeoutMs?: number
  local?: boolean
}

export interface McpServerConfig {
  id: string
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  timeoutMs?: number
}

export interface AgentConfig {
  home: string
  workspace: string
  provider: string
  model: string
  providers: ProviderConfig[]
  /** Explicitly configured stdio MCP servers. Workspace config cannot add these. */
  mcpServers: McpServerConfig[]
  permissionMode: PermissionMode
  autoApprove: boolean
  maxSteps: number
  maxWallClockMs: number
  commandTimeoutMs: number
  maxOutputBytes: number
  contextTokens: number
  skillsDirs: string[]
  appUrl: string
  sessionsDir: string
  backupsDir: string
  memory: boolean
  theme: ThemeName
  /** undefined = automatic (TTY + NO_COLOR); true/false force it. */
  color: boolean | undefined
  ascii: boolean
  backups: boolean
  shell: ShellKind
  allowOutsideWorkspaceReads: boolean
  /** Must be explicitly enabled to send project content to a non-local endpoint. */
  allowCloud: boolean
  denyRules: string[]
  allowRules: string[]
  quiet: boolean
  verbose: boolean
  userConfigPath: string
  workspaceConfigPath: string
  configWarnings: string[]
  /** Optional on legacy embedded configurations; defaults are applied by loadConfig. */
  toolConcurrency?: number
  agentConcurrency?: number
  maxAgents?: number
  memoryBudgetBytes?: number
  memoryAutoExtract?: boolean
  verification?: boolean
  backupMaxEntries?: number
  backupMaxBytes?: number
  backupMaxAgeDays?: number
}

export const PERMISSION_RANK: Record<PermissionMode, number> = {
  'read-only': 0,
  ask: 1,
  auto: 2,
  bypass: 3,
}

export function stricterMode(a: PermissionMode, b: PermissionMode): PermissionMode {
  return PERMISSION_RANK[a] <= PERMISSION_RANK[b] ? a : b
}

export const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/

export interface CliOverrides {
  workspace?: string
  model?: string
  provider?: string
  permissionMode?: PermissionMode
  maxSteps?: number
  timeoutMs?: number
  appUrl?: string
  noMemory?: boolean
  skillsDirs?: string[]
  autoApprove?: boolean
  theme?: ThemeName
  color?: boolean
  ascii?: boolean
  shell?: ShellKind
  sessionsDir?: string
  backups?: boolean
  allowOutsideReads?: boolean
  allowCloud?: boolean
  quiet?: boolean
  verbose?: boolean
}

export class ConfigError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join('\n- ')}`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}
