import { execFile } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import { promisify } from 'node:util'
import type { AgentConfig } from '../config/types.ts'
import { discoverProviders, describeDiscovery, probeToolCalling, resolveTarget, type DiscoveryResult, type ToolProbeResult } from '../providers/registry.ts'
import { NoModelError } from '../providers/registry.ts'
import { discoverSkills, type SkillIndex } from '../skills/discover.ts'
import { probeApp, type AppProbe } from '../skills/compat.ts'
import { createAnsi, createGlyphs, defaultAnsi } from '../utils/ansi.ts'
import { ensureDir } from '../utils/fsx.ts'
import { VERSION } from '../version.ts'

const execFileAsync = promisify(execFile)

export interface DoctorReport {
  ok: boolean
  version: string
  node: string
  platform: string
  workspace: string
  workspaceWritable: boolean
  config: {
    user: string
    userExists: boolean
    workspace: string
    workspaceExists: boolean
    warnings: string[]
  }
  posture: {
    permissionMode: string
    allowCloud: boolean
    allowOutsideReads: boolean
    backups: boolean
    memory: boolean
  }
  providers: DiscoveryResult[]
  selected: { provider: string; model: string; warning?: string } | null
  selectionError: string | null
  toolProbe?: ToolProbeResult
  app: AppProbe
  skills: {
    dirs: SkillIndex['dirs']
    total: number
    valid: number
    invalid: number
    warnings: string[]
  }
  git: { available: boolean; version?: string; error?: string }
  sessions: { dir: string; writable: boolean; error?: string }
}

export interface DoctorOptions {
  json: boolean
  probe: boolean
  signal: AbortSignal
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function gitCheck(): Promise<{ available: boolean; version?: string; error?: string }> {
  try {
    const result = await execFileAsync('git', ['--version'], { timeout: 4000, windowsHide: true })
    return { available: true, version: result.stdout.trim() }
  } catch (err) {
    return { available: false, error: (err as Error).message }
  }
}

export async function collectDoctorReport(config: AgentConfig, opts: DoctorOptions): Promise<DoctorReport> {
  const ansi = opts.json ? createAnsi(false) : defaultAnsi()
  const glyphs = createGlyphs(config.ascii)
  const warnings: string[] = [...config.configWarnings]

  const stat = await fs.stat(config.workspace).catch(() => null)
  let workspaceWritable = false
  if (stat?.isDirectory()) {
    workspaceWritable = await fs.access(config.workspace, constants.W_OK).then(() => true).catch(() => false)
  }

  const providers = await discoverProviders(config, opts.signal)
  let selected: DoctorReport['selected'] = null
  let selectionError: string | null = null
  let toolProbe: ToolProbeResult | undefined
  try {
    const target = resolveTarget(config, providers)
    selected = {
      provider: target.providerConfig.id,
      model: target.model,
      ...(target.warning ? { warning: target.warning } : {}),
    }
    if (opts.probe) {
      if (!opts.json) process.stderr.write(`${ansi.gray('Probing tool calling with one small request…')}\n`)
      toolProbe = await probeToolCalling(target, AbortSignal.any([opts.signal, AbortSignal.timeout(45_000)]))
    }
  } catch (err) {
    selectionError = err instanceof NoModelError ? `${err.message}\n${err.detail}` : (err as Error).message
  }

  const app = await probeApp(config.appUrl, opts.signal)
  const skills = await discoverSkills(config)
  const git = await gitCheck()

  let sessionsWritable = false
  let sessionsError: string | undefined
  try {
    await ensureDir(config.sessionsDir)
    await fs.access(config.sessionsDir, constants.W_OK)
    sessionsWritable = true
  } catch (err) {
    sessionsError = (err as Error).message
  }

  const report: DoctorReport = {
    ok: Boolean(stat?.isDirectory()) && workspaceWritable && sessionsWritable && selected !== null &&
      (!opts.probe || toolProbe?.status === 'supported'),
    version: VERSION,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    workspace: config.workspace,
    workspaceWritable,
    config: {
      user: config.userConfigPath,
      userExists: await exists(config.userConfigPath),
      workspace: config.workspaceConfigPath,
      workspaceExists: await exists(config.workspaceConfigPath),
      warnings,
    },
    posture: {
      permissionMode: config.permissionMode,
      allowCloud: config.allowCloud,
      allowOutsideReads: config.allowOutsideWorkspaceReads,
      backups: config.backups,
      memory: config.memory,
    },
    providers,
    selected,
    selectionError,
    ...(toolProbe ? { toolProbe } : {}),
    app,
    skills: {
      dirs: skills.dirs,
      total: skills.entries.length,
      valid: skills.entries.filter((s) => s.valid && !s.shadowedBy).length,
      invalid: skills.invalid.length,
      warnings: skills.warnings,
    },
    git,
    sessions: { dir: config.sessionsDir, writable: sessionsWritable, ...(sessionsError ? { error: sessionsError } : {}) },
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report
  }

  const print = (line = '') => process.stdout.write(`${line}\n`)
  const ok = ansi.green(glyphs.ok)
  const bad = ansi.red(glyphs.fail)
  const warn = ansi.yellow(glyphs.warn)

  print(ansi.bold(`AgentHub Terminal ${VERSION} · doctor`))
  print(ansi.gray('─'.repeat(52)))
  print(`${stat?.isDirectory() ? ok : bad} workspace   ${config.workspace}${workspaceWritable ? '' : ansi.red(' (not writable)')}`)
  print(`${ok} runtime     Node ${process.version} · ${process.platform} ${process.arch}`)
  print(`${git.available ? ok : warn} git         ${git.version ?? git.error ?? 'unavailable'}`)
  print(`${sessionsWritable ? ok : bad} sessions    ${config.sessionsDir}`)
  print(`${config.autoApprove ? warn : ok} permission  ${config.permissionMode}${config.autoApprove ? ' + auto-approve' : ''}`)
  print(`${config.allowCloud ? warn : ok} cloud       ${config.allowCloud ? 'allowed (explicit)' : 'blocked'}`)
  print(`${config.allowOutsideWorkspaceReads ? warn : ok} reads       ${config.allowOutsideWorkspaceReads ? 'outside workspace allowed' : 'inside workspace only'}`)
  print(`${config.backups ? ok : warn} backups     ${config.backups ? 'enabled' : 'disabled'}`)
  print('')

  print(ansi.bold('Configuration'))
  print(`  user:      ${config.userConfigPath} ${report.config.userExists ? '(found)' : '(not found)'}`)
  print(`  workspace: ${config.workspaceConfigPath} ${report.config.workspaceExists ? '(found)' : '(not found)'}`)
  for (const warning of config.configWarnings) print(`  ${warn} ${warning}`)
  print('')

  print(ansi.bold('Model providers'))
  if (providers.length === 0) print('  (none configured)')
  for (const provider of providers) {
    if (provider.skipped) {
      print(`  ${ansi.gray('–')} ${provider.provider.id.padEnd(10)} ${ansi.gray(provider.skipped)}`)
      continue
    }
    if (!provider.ok) {
      print(`  ${bad} ${provider.provider.id.padEnd(10)} ${ansi.red(provider.error ?? 'unreachable')}`)
      continue
    }
    print(`  ${ok} ${provider.provider.id.padEnd(10)} ${provider.provider.baseUrl} · ${provider.models.length} model(s) · ${provider.durationMs} ms`)
    for (const model of provider.models.slice(0, 12)) {
      const flags = [model.loaded ? 'loaded' : null, model.contextLength ? `${model.contextLength} ctx` : null]
        .filter(Boolean)
        .join(', ')
      print(`     ${ansi.cyan(model.id)}${flags ? ansi.gray(`  (${flags})`) : ''}`)
    }
    if (provider.models.length > 12) print(ansi.gray(`     … ${provider.models.length - 12} more`))
  }
  print('')

  print(ansi.bold('Selected model'))
  if (selected) {
    print(`  ${ok} ${selected.provider} / ${selected.model}`)
    if (selected.warning) print(`  ${warn} ${selected.warning}`)
  } else {
    print(`  ${bad} no usable model`)
    if (selectionError) {
      for (const line of selectionError.split('\n')) print(`     ${ansi.gray(line)}`)
    }
  }
  if (toolProbe) {
    const symbol = toolProbe.status === 'supported' ? ok : toolProbe.status === 'unsupported' ? bad : warn
    print(`  ${symbol} tool-calling probe: ${toolProbe.status} — ${toolProbe.detail}`)
    print(ansi.gray(`     exact model tested: ${toolProbe.provider} / ${toolProbe.model}`))
  }
  print('')

  print(ansi.bold('AgentHub app (skills compatibility adapter)'))
  print(`  ${app.ok ? ok : warn} ${config.appUrl} ${app.ok ? `reachable (${app.durationMs} ms)` : `unavailable: ${app.error ?? 'unknown'}`}`)
  if (!app.ok) print(ansi.gray('     Optional. Only used by `agenthub skills check --repo`.'))
  print('')

  print(ansi.bold('Skills'))
  for (const dir of skills.dirs) {
    print(`  ${dir.exists ? ok : ansi.gray('–')} ${dir.path}${dir.exists ? '' : ansi.gray(' (missing)')}`)
  }
  print(`  ${skills.entries.length} installed · ${skills.entries.filter((s) => s.valid && !s.shadowedBy).length} valid · ${skills.invalid.length} invalid`)
  for (const entry of skills.invalid.slice(0, 8)) {
    print(`  ${bad} ${entry.name}: ${entry.errors[0] ?? 'invalid'}`)
  }
  for (const warning of skills.warnings.slice(0, 8)) print(`  ${warn} ${warning}`)
  print('')

  print(ansi.gray('Doctor is read-only. It does not install anything or change configuration.'))
  if (!report.ok) {
    print('')
    print(ansi.yellow('Fix the items marked above, then run `agenthub doctor` again.'))
    print(ansi.gray(describeDiscovery(providers)))
  }
  return report
}

export async function runDoctor(config: AgentConfig, opts: DoctorOptions): Promise<number> {
  const report = await collectDoctorReport(config, opts)
  return report.ok ? 0 : 1
}
