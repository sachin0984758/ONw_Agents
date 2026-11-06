import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CURRENT_CONFIG_VERSION, validateConfigVersion } from './migrate.ts'
import {
  ConfigError,
  MODEL_ID_PATTERN,
  stricterMode,
  type AgentConfig,
  type CliOverrides,
  type McpServerConfig,
  type PermissionMode,
  type ProviderConfig,
  type ShellKind,
  type ThemeName,
} from './types.ts'

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'toolConcurrency', 'agentConcurrency', 'maxAgents', 'memoryBudgetBytes', 'memoryAutoExtract', 'verification',
  'backupMaxEntries', 'backupMaxBytes', 'backupMaxAgeDays',
  'provider',
  'model',
  'providers',
  'mcpServers',
  'permissionMode',
  'maxSteps',
  'maxWallClockMs',
  'commandTimeoutMs',
  'maxOutputBytes',
  'contextTokens',
  'skillsDirs',
  'appUrl',
  'sessionsDir',
  'backupsDir',
  'memory',
  'theme',
  'color',
  'ascii',
  'backups',
  'shell',
  'allowOutsideWorkspaceReads',
  'allowCloud',
  'deny',
  'allow',
  'quiet',
  'verbose',
])

const PERMISSION_MODES = new Set(['read-only', 'ask', 'auto', 'bypass'])
const THEMES = new Set(['auto', 'mono'])
const SHELLS = new Set(['auto', 'cmd', 'powershell', 'bash'])

interface PartialConfig {
  toolConcurrency?: number
  agentConcurrency?: number
  maxAgents?: number
  memoryBudgetBytes?: number
  memoryAutoExtract?: boolean
  verification?: boolean
  backupMaxEntries?: number
  backupMaxBytes?: number
  backupMaxAgeDays?: number
  provider?: string
  model?: string
  providers?: ProviderConfig[]
  mcpServers?: McpServerConfig[]
  permissionMode?: PermissionMode
  maxSteps?: number
  maxWallClockMs?: number
  commandTimeoutMs?: number
  maxOutputBytes?: number
  contextTokens?: number
  skillsDirs?: string[]
  appUrl?: string
  sessionsDir?: string
  backupsDir?: string
  memory?: boolean
  theme?: ThemeName
  color?: boolean
  ascii?: boolean
  backups?: boolean
  shell?: ShellKind
  allowOutsideWorkspaceReads?: boolean
  denyRules?: string[]
  allowRules?: string[]
  allowCloud?: boolean
  quiet?: boolean
  verbose?: boolean
}

function expandHome(input: string, home: string): string {
  if (input === '~') return home
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(home, input.slice(2))
  }
  return input
}

function resolveFrom(base: string, input: string, home: string): string {
  const expanded = expandHome(input, home)
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(base, expanded)
}

function defaultProviders(): ProviderConfig[] {
  return [
    {
      id: 'lmstudio',
      label: 'LM Studio',
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1234/v1',
      local: true,
    },
    {
      id: 'ollama',
      label: 'Ollama',
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      local: true,
    },
    {
      id: 'custom',
      label: 'Custom OpenAI-compatible endpoint',
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8000/v1',
      apiKeyEnv: 'AGENTHUB_API_KEY',
      local: true,
    },
  ]
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(
  raw: Record<string, unknown>,
  key: string,
  source: string,
  problems: string[],
): string | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    problems.push(`${source}: "${key}" must be a string.`)
    return undefined
  }
  return value
}

function readNumber(
  raw: Record<string, unknown>,
  key: string,
  source: string,
  problems: string[],
  min: number,
  max: number,
): number | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push(`${source}: "${key}" must be a number.`)
    return undefined
  }
  if (value < min || value > max) {
    problems.push(`${source}: "${key}" must be between ${min} and ${max}.`)
    return undefined
  }
  return Math.floor(value)
}

function readBoolean(
  raw: Record<string, unknown>,
  key: string,
  source: string,
  problems: string[],
): boolean | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    problems.push(`${source}: "${key}" must be true or false.`)
    return undefined
  }
  return value
}

function readStringArray(
  raw: Record<string, unknown>,
  key: string,
  source: string,
  problems: string[],
): string[] | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    problems.push(`${source}: "${key}" must be an array of strings.`)
    return undefined
  }
  return value as string[]
}

const PROVIDER_KEYS = new Set([
  'capabilities',
  'id',
  'label',
  'kind',
  'baseUrl',
  'apiKeyEnv',
  'apiKey',
  'models',
  'headers',
  'timeoutMs',
  'local',
])

function parseProviders(
  value: unknown,
  source: string,
  problems: string[],
  warnings: string[],
): ProviderConfig[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    problems.push(`${source}: "providers" must be an array.`)
    return undefined
  }
  const out: ProviderConfig[] = []
  for (let i = 0; i < value.length; i++) {
    const obj = asObject(value[i])
    if (!obj) {
      problems.push(`${source}: providers[${i}] must be an object.`)
      continue
    }
    for (const key of Object.keys(obj)) {
      if (!PROVIDER_KEYS.has(key)) {
        warnings.push(`${source}: providers[${i}].${key} is not a known provider field and was ignored.`)
      }
    }
    const id = typeof obj.id === 'string' ? obj.id.trim() : ''
    if (!/^[a-z0-9-]{1,40}$/.test(id)) {
      problems.push(`${source}: providers[${i}].id must match ^[a-z0-9-]{1,40}$.`)
      continue
    }
    if (obj.kind !== undefined && obj.kind !== 'openai-compatible') {
      problems.push(`${source}: providers[${i}].kind must be "openai-compatible".`)
      continue
    }
    const baseUrl = typeof obj.baseUrl === 'string' ? obj.baseUrl.trim() : ''
    if (!baseUrl) {
      problems.push(`${source}: providers[${i}].baseUrl is required.`)
      continue
    }
    if (obj.apiKey !== undefined) {
      warnings.push(
        `${source}: providers[${i}].apiKey is ignored. Put the key in an environment variable and reference it with apiKeyEnv.`,
      )
    }
    const headers: Record<string, string> = {}
    if (obj.headers !== undefined) {
      const h = asObject(obj.headers)
      if (!h) {
        problems.push(`${source}: providers[${i}].headers must be an object of strings.`)
      } else {
        for (const [k, v] of Object.entries(h)) {
          if (typeof v !== 'string') {
            problems.push(`${source}: providers[${i}].headers["${k}"] must be a string.`)
            continue
          }
          headers[k] = v
        }
      }
    }
    const capabilities: ProviderConfig['capabilities'] = {}
    if (obj.capabilities !== undefined) {
      const caps = asObject(obj.capabilities)
      if (!caps) problems.push(`${source}: providers[${i}].capabilities must be an object.`)
      else for (const [key, v] of Object.entries(caps)) {
        if (!['streaming', 'tools', 'json', 'vision', 'reasoning'].includes(key) || typeof v !== 'boolean') {
          problems.push(`${source}: invalid capability ${key}; use a known capability and boolean value.`)
        } else capabilities[key as keyof typeof capabilities] = v
      }
    }
    out.push({
      id,
      label: typeof obj.label === 'string' ? obj.label : undefined,
      kind: 'openai-compatible',
      baseUrl,
      apiKeyEnv: typeof obj.apiKeyEnv === 'string' ? obj.apiKeyEnv : undefined,
      models: Array.isArray(obj.models) ? obj.models.filter((m): m is string => typeof m === 'string') : undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      timeoutMs: typeof obj.timeoutMs === 'number' ? obj.timeoutMs : undefined,
      local: obj.local === true,
      ...(Object.keys(capabilities).length ? { capabilities } : {}),
    })
  }
  return out
}

const MCP_KEYS = new Set(['id', 'command', 'args', 'env', 'cwd', 'timeoutMs'])

function parseMcpServers(
  value: unknown,
  source: string,
  baseDir: string,
  problems: string[],
  warnings: string[],
): McpServerConfig[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    problems.push(`${source}: "mcpServers" must be an array.`)
    return undefined
  }
  const out: McpServerConfig[] = []
  const ids = new Set<string>()
  for (let i = 0; i < value.length; i++) {
    const obj = asObject(value[i])
    if (!obj) {
      problems.push(`${source}: mcpServers[${i}] must be an object.`)
      continue
    }
    for (const key of Object.keys(obj)) {
      if (!MCP_KEYS.has(key)) warnings.push(`${source}: mcpServers[${i}].${key} is not a known field and was ignored.`)
    }
    const id = typeof obj.id === 'string' ? obj.id.trim() : ''
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) {
      problems.push(`${source}: mcpServers[${i}].id must match ^[a-z0-9][a-z0-9-]{0,39}$.`)
      continue
    }
    if (ids.has(id)) {
      problems.push(`${source}: duplicate MCP server id "${id}".`)
      continue
    }
    if (typeof obj.command !== 'string' || !obj.command.trim()) {
      problems.push(`${source}: mcpServers[${i}].command is required.`)
      continue
    }
    const args = obj.args === undefined ? [] : obj.args
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      problems.push(`${source}: mcpServers[${i}].args must be an array of strings.`)
      continue
    }
    const env: Record<string, string> = {}
    if (obj.env !== undefined) {
      const rawEnv = asObject(obj.env)
      if (!rawEnv) {
        problems.push(`${source}: mcpServers[${i}].env must be an object of strings.`)
        continue
      }
      for (const [key, envValue] of Object.entries(rawEnv)) {
        if (typeof envValue !== 'string') {
          problems.push(`${source}: mcpServers[${i}].env.${key} must be a string.`)
          continue
        }
        env[key] = envValue
      }
    }
    let cwd: string | undefined
    if (obj.cwd !== undefined) {
      if (typeof obj.cwd !== 'string' || !obj.cwd.trim()) {
        problems.push(`${source}: mcpServers[${i}].cwd must be a non-empty string.`)
        continue
      }
      cwd = resolveFrom(baseDir, obj.cwd, baseDir)
    }
    let timeoutMs: number | undefined
    if (obj.timeoutMs !== undefined) {
      if (typeof obj.timeoutMs !== 'number' || !Number.isFinite(obj.timeoutMs) || obj.timeoutMs < 1000 || obj.timeoutMs > 600_000) {
        problems.push(`${source}: mcpServers[${i}].timeoutMs must be between 1000 and 600000.`)
        continue
      }
      timeoutMs = Math.floor(obj.timeoutMs)
    }
    ids.add(id)
    out.push({
      id,
      command: obj.command.trim(),
      args: args as string[],
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(cwd ? { cwd } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    })
  }
  return out
}

function parseJsonConfig(text: string, file: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ConfigError([`${file}: not valid JSON (${(err as Error).message}).`])
  }
  const obj = asObject(parsed)
  if (!obj) throw new ConfigError([`${file}: the top level must be a JSON object.`])
  return obj
}

async function readConfigFile(
  file: string,
  baseDir: string,
  home: string,
  problems: string[],
  warnings: string[],
): Promise<PartialConfig | null> {
  let text: string
  try {
    const stat = await fs.stat(file)
    if (stat.size > 256 * 1024) {
      problems.push(`${file}: config file is larger than 256 KB.`)
      return null
    }
    text = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    problems.push(`${file}: ${(err as Error).message}`)
    return null
  }
  const raw = parseJsonConfig(text, file)
  validateConfigVersion(raw)
  if (raw.schemaVersion === undefined) warnings.push(`${file}: legacy schema; use agenthub config migrate to back up and write schemaVersion ${CURRENT_CONFIG_VERSION}.`)
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) warnings.push(`${file}: unknown setting "${key}" was ignored.`)
  }

  const out: PartialConfig = {}
  const provider = readString(raw, 'provider', file, problems)
  if (provider !== undefined) out.provider = provider
  const model = readString(raw, 'model', file, problems)
  if (model !== undefined) out.model = model
  const providers = parseProviders(raw.providers, file, problems, warnings)
  if (providers) {
    out.providers = providers.map((p) => ({
      ...p,
      baseUrl: p.baseUrl,
    }))
  }
  const mcpServers = parseMcpServers(raw.mcpServers, file, baseDir, problems, warnings)
  if (mcpServers) out.mcpServers = mcpServers

  const mode = readString(raw, 'permissionMode', file, problems)
  if (mode !== undefined) {
    if (!PERMISSION_MODES.has(mode)) problems.push(`${file}: "permissionMode" must be one of read-only, ask, auto, bypass.`)
    else out.permissionMode = mode as PermissionMode
  }

  const theme = readString(raw, 'theme', file, problems)
  if (theme !== undefined) {
    if (!THEMES.has(theme)) problems.push(`${file}: "theme" must be "auto" or "mono".`)
    else out.theme = theme as ThemeName
  }
  const shell = readString(raw, 'shell', file, problems)
  if (shell !== undefined) {
    if (!SHELLS.has(shell)) problems.push(`${file}: "shell" must be auto, cmd, powershell or bash.`)
    else out.shell = shell as ShellKind
  }

  const numbers: Array<[keyof PartialConfig, string, number, number]> = [
    ['toolConcurrency', 'toolConcurrency', 1, 8],
    ['agentConcurrency', 'agentConcurrency', 1, 4],
    ['maxAgents', 'maxAgents', 1, 16],
    ['memoryBudgetBytes', 'memoryBudgetBytes', 256, 16000],
    ['backupMaxEntries', 'backupMaxEntries', 1, 10000],
    ['backupMaxBytes', 'backupMaxBytes', 1024, 1000000000],
    ['backupMaxAgeDays', 'backupMaxAgeDays', 1, 3650],
    ['maxSteps', 'maxSteps', 1, 200],
    ['maxWallClockMs', 'maxWallClockMs', 1000, 3_600_000],
    ['commandTimeoutMs', 'commandTimeoutMs', 1000, 3_600_000],
    ['maxOutputBytes', 'maxOutputBytes', 1000, 5_000_000],
    ['contextTokens', 'contextTokens', 1000, 2_000_000],
  ]
  for (const [field, key, min, max] of numbers) {
    const n = readNumber(raw, key, file, problems, min, max)
    if (n !== undefined) (out as Record<string, unknown>)[field] = n
  }

  const booleans: Array<[keyof PartialConfig, string]> = [
    ['memoryAutoExtract', 'memoryAutoExtract'],
    ['verification', 'verification'],
    ['memory', 'memory'],
    ['color', 'color'],
    ['ascii', 'ascii'],
    ['backups', 'backups'],
    ['allowOutsideWorkspaceReads', 'allowOutsideWorkspaceReads'],
    ['allowCloud', 'allowCloud'],
    ['quiet', 'quiet'],
    ['verbose', 'verbose'],
  ]
  for (const [field, key] of booleans) {
    const b = readBoolean(raw, key, file, problems)
    if (b !== undefined) (out as Record<string, unknown>)[field] = b
  }

  const skillsDirs = readStringArray(raw, 'skillsDirs', file, problems)
  if (skillsDirs) out.skillsDirs = skillsDirs.map((d) => resolveFrom(baseDir, d, home))
  const deny = readStringArray(raw, 'deny', file, problems)
  if (deny) out.denyRules = deny
  const allow = readStringArray(raw, 'allow', file, problems)
  if (allow) out.allowRules = allow

  const appUrl = readString(raw, 'appUrl', file, problems)
  if (appUrl !== undefined) out.appUrl = appUrl
  const sessionsDir = readString(raw, 'sessionsDir', file, problems)
  if (sessionsDir !== undefined) out.sessionsDir = resolveFrom(baseDir, sessionsDir, home)
  const backupsDir = readString(raw, 'backupsDir', file, problems)
  if (backupsDir !== undefined) out.backupsDir = resolveFrom(baseDir, backupsDir, home)

  return out
}

function envNumber(name: string, min: number, max: number, problems: string[]): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) {
    problems.push(`${name} must be a number between ${min} and ${max}.`)
    return undefined
  }
  return Math.floor(n)
}

function envBool(name: string): boolean | undefined {
  const raw = process.env[name]?.trim()
  if (raw === undefined || raw === '') return undefined
  const value = raw.toLowerCase()
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false
  return undefined
}

function mergeProviders(base: ProviderConfig[], next: ProviderConfig[] | undefined): ProviderConfig[] {
  if (!next) return base
  const out = base.map((p) => ({ ...p }))
  for (const incoming of next) {
    const idx = out.findIndex((p) => p.id === incoming.id)
    if (idx === -1) out.push({ ...incoming })
    else out[idx] = { ...out[idx], ...incoming }
  }
  return out
}

function uniqueAppend(base: string[], next: string[] | undefined): string[] {
  if (!next) return base
  const seen = new Set(base)
  const out = [...base]
  for (const item of next) {
    if (!seen.has(item)) {
      out.push(item)
      seen.add(item)
    }
  }
  return out
}

function applyLayer(config: AgentConfig, layer: PartialConfig, kind: 'user' | 'workspace' | 'env' | 'cli'): void {
  for (const key of ['toolConcurrency', 'agentConcurrency', 'maxAgents', 'memoryBudgetBytes', 'backupMaxEntries', 'backupMaxBytes', 'backupMaxAgeDays'] as const) {
    const value = layer[key]
    if (value !== undefined) config[key] = kind === 'workspace' ? Math.min(config[key] ?? value, value) : value
  }
  for (const key of ['memoryAutoExtract', 'verification'] as const) {
    if (layer[key] !== undefined) {
      if (kind === 'workspace') config.configWarnings.push(`${key} is ignored in workspace config; configure it in user config.`)
      else config[key] = layer[key]
    }
  }
  if (layer.provider !== undefined) config.provider = layer.provider
  if (layer.model !== undefined) config.model = layer.model
  config.providers = mergeProviders(config.providers, layer.providers)
  if (layer.mcpServers) {
    if (kind === 'workspace') {
      config.configWarnings.push(
        `${config.workspaceConfigPath}: "mcpServers" is ignored in workspace config for safety. Put MCP server configuration in the user config.`,
      )
    } else {
      const merged = new Map(config.mcpServers.map((server) => [server.id, server]))
      for (const server of layer.mcpServers) merged.set(server.id, server)
      config.mcpServers = [...merged.values()]
    }
  }
  if (layer.permissionMode !== undefined) {
    config.permissionMode =
      kind === 'workspace' ? stricterMode(config.permissionMode, layer.permissionMode) : layer.permissionMode
  }
  if (layer.maxSteps !== undefined) {
    config.maxSteps = kind === 'user' || kind === 'cli' ? layer.maxSteps : Math.min(config.maxSteps, layer.maxSteps)
  }
  if (layer.maxWallClockMs !== undefined) {
    config.maxWallClockMs =
      kind === 'user' || kind === 'cli' ? layer.maxWallClockMs : Math.min(config.maxWallClockMs, layer.maxWallClockMs)
  }
  if (layer.commandTimeoutMs !== undefined) {
    config.commandTimeoutMs =
      kind === 'user' || kind === 'cli'
        ? layer.commandTimeoutMs
        : Math.min(config.commandTimeoutMs, layer.commandTimeoutMs)
  }
  if (layer.maxOutputBytes !== undefined) {
    config.maxOutputBytes =
      kind === 'user' || kind === 'cli' ? layer.maxOutputBytes : Math.min(config.maxOutputBytes, layer.maxOutputBytes)
  }
  if (layer.contextTokens !== undefined) {
    config.contextTokens =
      kind === 'user' || kind === 'cli' ? layer.contextTokens : Math.min(config.contextTokens, layer.contextTokens)
  }
  if (layer.skillsDirs) config.skillsDirs = uniqueAppend(config.skillsDirs, layer.skillsDirs)
  if (layer.appUrl !== undefined) config.appUrl = layer.appUrl
  if (layer.sessionsDir !== undefined) config.sessionsDir = layer.sessionsDir
  if (layer.backupsDir !== undefined) config.backupsDir = layer.backupsDir
  if (layer.memory !== undefined) config.memory = layer.memory
  if (layer.theme !== undefined) config.theme = layer.theme
  if (layer.color !== undefined) config.color = layer.color
  if (layer.ascii !== undefined) config.ascii = layer.ascii
  if (layer.backups !== undefined) config.backups = config.backups || layer.backups
  if (layer.shell !== undefined) config.shell = layer.shell
  if (layer.allowOutsideWorkspaceReads !== undefined) {
    config.allowOutsideWorkspaceReads =
      kind === 'workspace'
        ? config.allowOutsideWorkspaceReads && layer.allowOutsideWorkspaceReads
        : layer.allowOutsideWorkspaceReads
  }
  if (layer.allowCloud !== undefined) {
    if (kind === 'workspace') {
      config.configWarnings.push(
        `${config.workspaceConfigPath}: "allowCloud" is ignored in workspace config for safety. Use the user config or --allow-cloud.`,
      )
    } else {
      config.allowCloud = layer.allowCloud
    }
  }
  if (layer.denyRules) config.denyRules = uniqueAppend(config.denyRules, layer.denyRules)
  if (layer.allowRules) {
    if (kind === 'workspace') {
      config.configWarnings.push(
        `${config.workspaceConfigPath}: "allow" rules are ignored in workspace config; put them in the user config or CLI.`,
      )
    } else {
      config.allowRules = uniqueAppend(config.allowRules, layer.allowRules)
    }
  }
  if (layer.quiet !== undefined) config.quiet = layer.quiet
  if (layer.verbose !== undefined) config.verbose = layer.verbose
}

function validate(config: AgentConfig, problems: string[]): void {
  if (!PERMISSION_MODES.has(config.permissionMode)) {
    problems.push(`permissionMode must be read-only, ask, auto or bypass.`)
  }
  if (config.provider !== 'auto' && !/^[a-z0-9-]{1,40}$/.test(config.provider)) {
    problems.push(`provider "${config.provider}" is not a valid provider id.`)
  }
  if (config.model && !MODEL_ID_PATTERN.test(config.model)) {
    problems.push(`model "${config.model}" contains unsupported characters.`)
  }
  const ids = new Set<string>()
  for (const p of config.providers) {
    if (ids.has(p.id)) problems.push(`Duplicate provider id "${p.id}".`)
    ids.add(p.id)
    let url: URL
    try {
      url = new URL(p.baseUrl)
    } catch {
      problems.push(`providers.${p.id}.baseUrl is not a valid URL: ${p.baseUrl}`)
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      problems.push(`providers.${p.id}.baseUrl must use http or https.`)
    }
    if (url.username || url.password) {
      problems.push(`providers.${p.id}.baseUrl must not embed credentials.`)
    }
  }
  for (const p of [config.appUrl]) {
    try {
      const u = new URL(p)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') problems.push(`appUrl must use http or https.`)
    } catch {
      problems.push(`appUrl is not a valid URL: ${p}`)
    }
  }
}

export async function loadConfig(opts: { cwd: string; cli: CliOverrides }): Promise<AgentConfig> {
  const problems: string[] = []
  const warnings: string[] = []
  const homeRoot = process.env.AGENTHUB_HOME
    ? path.resolve(expandHome(process.env.AGENTHUB_HOME, os.homedir()))
    : path.join(os.homedir(), '.agenthub')

  const workspaceInput =
    opts.cli.workspace ?? process.env.AGENTHUB_WORKSPACE ?? opts.cwd
  const workspace = path.resolve(expandHome(workspaceInput, os.homedir()))
  const userConfigPath = path.join(homeRoot, 'config.json')
  const workspaceConfigPath = path.join(workspace, '.agenthub', 'config.json')

  try {
    const stat = await fs.stat(workspace)
    if (!stat.isDirectory()) problems.push(`Workspace is not a directory: ${workspace}`)
  } catch {
    problems.push(`Workspace does not exist: ${workspace}`)
  }

  const config: AgentConfig = {
    home: homeRoot,
    workspace,
    provider: 'auto',
    model: '',
    providers: defaultProviders(),
    mcpServers: [],
    permissionMode: 'ask',
    autoApprove: false,
    maxSteps: 12,
    maxWallClockMs: 15 * 60_000,
    commandTimeoutMs: 120_000,
    maxOutputBytes: 200_000,
    contextTokens: 16_000,
    skillsDirs: [path.join(homeRoot, 'skills'), path.join(workspace, '.agenthub', 'skills')],
    appUrl: 'http://127.0.0.1:3000',
    sessionsDir: path.join(homeRoot, 'sessions'),
    backupsDir: path.join(homeRoot, 'backups'),
    memory: true,
    theme: 'auto',
    color: undefined,
    ascii: false,
    backups: true,
    shell: 'auto',
    allowOutsideWorkspaceReads: false,
    allowCloud: false,
    denyRules: [],
    allowRules: [],
    quiet: false,
    verbose: false,
    userConfigPath,
    workspaceConfigPath,
    configWarnings: warnings,
    toolConcurrency: 1,
    agentConcurrency: 1,
    maxAgents: 4,
    memoryBudgetBytes: 6000,
    memoryAutoExtract: false,
    verification: true,
    backupMaxEntries: 200,
    backupMaxBytes: 100 * 1024 * 1024,
    backupMaxAgeDays: 90,
  }

  const userLayer = await readConfigFile(userConfigPath, homeRoot, homeRoot, problems, warnings)
  if (userLayer) applyLayer(config, userLayer, 'user')

  const workspaceLayer = await readConfigFile(
    workspaceConfigPath,
    path.dirname(workspaceConfigPath),
    homeRoot,
    problems,
    warnings,
  )
  if (workspaceLayer) applyLayer(config, workspaceLayer, 'workspace')

  // Environment layer (explicit, may loosen workspace restrictions).
  const envLayer: PartialConfig = {}
  if (process.env.AGENTHUB_PROVIDER) envLayer.provider = process.env.AGENTHUB_PROVIDER
  if (process.env.AGENTHUB_MODEL) envLayer.model = process.env.AGENTHUB_MODEL
  if (process.env.AGENTHUB_PERMISSION) {
    const mode = process.env.AGENTHUB_PERMISSION
    if (!PERMISSION_MODES.has(mode)) problems.push(`AGENTHUB_PERMISSION must be read-only, ask, auto or bypass.`)
    else envLayer.permissionMode = mode as PermissionMode
  }
  if (process.env.AGENTHUB_APP_URL) envLayer.appUrl = process.env.AGENTHUB_APP_URL
  if (process.env.AGENTHUB_THEME) {
    if (!THEMES.has(process.env.AGENTHUB_THEME)) problems.push(`AGENTHUB_THEME must be auto or mono.`)
    else envLayer.theme = process.env.AGENTHUB_THEME as ThemeName
  }
  if (process.env.AGENTHUB_SHELL) {
    if (!SHELLS.has(process.env.AGENTHUB_SHELL)) problems.push(`AGENTHUB_SHELL must be auto, cmd, powershell or bash.`)
    else envLayer.shell = process.env.AGENTHUB_SHELL as ShellKind
  }
  const envMaxSteps = envNumber('AGENTHUB_MAX_STEPS', 1, 200, problems)
  if (envMaxSteps !== undefined) envLayer.maxSteps = envMaxSteps
  const envTimeout = envNumber('AGENTHUB_COMMAND_TIMEOUT_MS', 1000, 3_600_000, problems)
  if (envTimeout !== undefined) envLayer.commandTimeoutMs = envTimeout
  const envContext = envNumber('AGENTHUB_CONTEXT_TOKENS', 1000, 2_000_000, problems)
  if (envContext !== undefined) envLayer.contextTokens = envContext
  const envMemory = envBool('AGENTHUB_NO_MEMORY')
  if (envMemory !== undefined) envLayer.memory = !envMemory
  const envCloud = envBool('AGENTHUB_ALLOW_CLOUD')
  if (envCloud !== undefined) envLayer.allowCloud = envCloud
  if (process.env.AGENTHUB_SKILLS_DIRS) {
    envLayer.skillsDirs = process.env.AGENTHUB_SKILLS_DIRS.split(path.delimiter)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => resolveFrom(workspace, s, homeRoot))
  }
  applyLayer(config, envLayer, 'env')

  // CLI layer (highest precedence).
  const cliLayer: PartialConfig = {}
  if (opts.cli.provider) cliLayer.provider = opts.cli.provider
  if (opts.cli.model !== undefined) cliLayer.model = opts.cli.model
  if (opts.cli.permissionMode) cliLayer.permissionMode = opts.cli.permissionMode
  if (opts.cli.maxSteps !== undefined) cliLayer.maxSteps = opts.cli.maxSteps
  if (opts.cli.timeoutMs !== undefined) cliLayer.commandTimeoutMs = opts.cli.timeoutMs
  if (opts.cli.appUrl) cliLayer.appUrl = opts.cli.appUrl
  if (opts.cli.noMemory) cliLayer.memory = false
  if (opts.cli.skillsDirs && opts.cli.skillsDirs.length > 0) {
    cliLayer.skillsDirs = opts.cli.skillsDirs.map((d) => resolveFrom(opts.cwd, d, homeRoot))
  }
  if (opts.cli.theme) cliLayer.theme = opts.cli.theme
  if (opts.cli.color !== undefined) cliLayer.color = opts.cli.color
  if (opts.cli.ascii !== undefined) cliLayer.ascii = opts.cli.ascii
  if (opts.cli.shell) cliLayer.shell = opts.cli.shell
  if (opts.cli.sessionsDir) cliLayer.sessionsDir = resolveFrom(opts.cwd, opts.cli.sessionsDir, homeRoot)
  if (opts.cli.backups !== undefined) cliLayer.backups = opts.cli.backups
  if (opts.cli.allowOutsideReads !== undefined) cliLayer.allowOutsideWorkspaceReads = opts.cli.allowOutsideReads
  if (opts.cli.allowCloud !== undefined) cliLayer.allowCloud = opts.cli.allowCloud
  if (opts.cli.quiet) cliLayer.quiet = true
  if (opts.cli.verbose) cliLayer.verbose = true
  applyLayer(config, cliLayer, 'cli')
  config.autoApprove = opts.cli.autoApprove === true

  // A custom endpoint from the environment.
  if (process.env.AGENTHUB_BASE_URL) {
    const baseUrl = process.env.AGENTHUB_BASE_URL
    const targetId = config.provider !== 'auto' ? config.provider : 'custom'
    const idx = config.providers.findIndex((p) => p.id === targetId)
    if (idx === -1) {
      config.providers.push({
        id: targetId,
        kind: 'openai-compatible',
        baseUrl,
        label: 'Environment endpoint',
        apiKeyEnv: 'AGENTHUB_API_KEY',
        local: true,
      })
    } else {
      config.providers[idx] = { ...config.providers[idx]!, baseUrl }
    }
    if (config.provider === 'auto') config.provider = targetId
  }
  if (process.env.AGENTHUB_API_KEY) {
    const targetId = config.provider !== 'auto' ? config.provider : 'custom'
    const provider = config.providers.find((p) => p.id === targetId)
    if (provider) provider.apiKey = process.env.AGENTHUB_API_KEY
    else {
      config.providers.push({
        id: targetId,
        kind: 'openai-compatible',
        baseUrl: process.env.AGENTHUB_BASE_URL ?? 'http://127.0.0.1:8000/v1',
        label: 'Environment endpoint',
        apiKey: process.env.AGENTHUB_API_KEY,
        local: true,
      })
      if (config.provider === 'auto') config.provider = targetId
    }
  }

  validate(config, problems)
  if (problems.length > 0) throw new ConfigError(problems)
  return config
}

export function describeConfig(config: AgentConfig): string {
  const lines = [
    `workspace: ${config.workspace}`,
    `provider: ${config.provider}`,
    `model: ${config.model || '(auto)'}`,
    `permission: ${config.permissionMode}${config.autoApprove ? ' (+auto-approve)' : ''}`,
    `max steps: ${config.maxSteps}`,
    `command timeout: ${config.commandTimeoutMs} ms`,
    `context budget: ${config.contextTokens} tokens (estimated)`,
    `skills: ${config.skillsDirs.join(', ')}`,
    `mcp servers: ${config.mcpServers.length > 0 ? config.mcpServers.map((server) => server.id).join(', ') : 'none configured'}`,
    `app compat adapter: ${config.appUrl}`,
    `sessions: ${config.sessionsDir}`,
    `memory: ${config.memory ? 'on' : 'off'}`,
    `cloud endpoints: ${config.allowCloud ? 'allowed (explicitly)' : 'blocked'}`,
  ]
  return lines.join('\n')
}
