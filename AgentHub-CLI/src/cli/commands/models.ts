import type { AgentConfig } from '../../config/types.ts'
import { isLocalUrl, NoModelError, discoverProviders, probeToolCalling, resolveTarget } from '../../providers/registry.ts'
import { createGlyphs, defaultAnsi } from '../../utils/ansi.ts'
import { formatTokens } from '../../utils/token.ts'
import type { ParsedArgs } from '../args.ts'

export async function runModelsCommand(config: AgentConfig, args: ParsedArgs, signal: AbortSignal): Promise<number> {
  const providers = await discoverProviders(config, signal)
  let selected: { provider: string; model: string; warning?: string } | null = null
  let error: string | null = null
  let target = null
  try {
    target = resolveTarget(config, providers)
    selected = {
      provider: target.providerConfig.id,
      model: target.model,
      ...(target.warning ? { warning: target.warning } : {}),
    }
  } catch (err) {
    error = err instanceof NoModelError ? `${err.message}\n${err.detail}` : (err as Error).message
  }

  let probe = null
  if (args.probe && target) {
    probe = await probeToolCalling(target, AbortSignal.any([signal, AbortSignal.timeout(45_000)]))
  }

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: selected !== null,
          selected,
          error,
          probe,
          providers: providers.map((p) => ({
            id: p.provider.id,
            baseUrl: p.provider.baseUrl,
            local: isLocalUrl(p.provider.baseUrl),
            ok: p.ok,
            skipped: p.skipped ?? null,
            error: p.error ?? null,
            durationMs: p.durationMs,
            models: p.models.map((m) => ({
              id: m.id,
              loaded: m.loaded ?? null,
              contextLength: m.contextLength ?? null,
            })),
          })),
        },
        null,
        2,
      )}\n`,
    )
    return selected ? 0 : 1
  }

  const ansi = defaultAnsi()
  const glyphs = createGlyphs(config.ascii)
  const print = (line = '') => process.stdout.write(`${line}\n`)
  print(ansi.bold('Reachable models'))
  for (const provider of providers) {
    if (provider.skipped) {
      print(`  ${ansi.gray('–')} ${provider.provider.id.padEnd(10)} ${ansi.gray(provider.skipped)}`)
      continue
    }
    if (!provider.ok) {
      print(`  ${ansi.red(glyphs.fail)} ${provider.provider.id.padEnd(10)} ${ansi.red(provider.error ?? 'unreachable')}`)
      continue
    }
    print(`  ${ansi.green(glyphs.ok)} ${provider.provider.id.padEnd(10)} ${ansi.gray(provider.provider.baseUrl)}`)
    if (provider.models.length === 0) print(ansi.gray('     (no models listed)'))
    for (const model of provider.models) {
      const flags = [model.loaded ? 'loaded' : null, model.contextLength ? `${formatTokens(model.contextLength)} ctx` : null]
        .filter(Boolean)
        .join(', ')
      print(`     ${ansi.cyan(model.id)}${flags ? ansi.gray(`  (${flags})`) : ''}`)
    }
  }
  print('')
  if (selected) {
    print(`${ansi.green(glyphs.ok)} selected: ${ansi.bold(`${selected.provider} / ${selected.model}`)}`)
    if (selected.warning) print(`${ansi.yellow(glyphs.warn)} ${selected.warning}`)
  } else {
    print(`${ansi.red(glyphs.fail)} no model selected`)
    if (error) for (const line of error.split('\n')) print(`  ${ansi.gray(line)}`)
    print('')
    print(ansi.gray('Start LM Studio on 127.0.0.1:1234 or Ollama on 127.0.0.1:11434, or configure a provider.'))
  }
  if (probe) {
    print('')
    print(`Tool-calling probe: ${probe.status}`)
    print(`  model: ${probe.provider} / ${probe.model}`)
    print(`  ${probe.detail}`)
    print(ansi.gray('  A probe is evidence for this exact model, not a guarantee for other models.'))
  }
  return selected ? 0 : 1
}
