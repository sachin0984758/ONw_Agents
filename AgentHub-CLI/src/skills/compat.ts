import { redactSecrets } from '../utils/redact.ts'

export interface AppCompatResult {
  ok: boolean
  url: string
  reachable: boolean
  status?: number
  report?: unknown
  multiple?: boolean
  candidates?: Array<{ dir: string; name: string }>
  error?: string
  durationMs: number
}

export interface AppProbe {
  ok: boolean
  url: string
  status?: number
  error?: string
  durationMs: number
}

function base(appUrl: string): string {
  return appUrl.replace(/\/+$/, '')
}

function timeoutSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
}

export async function probeApp(appUrl: string, signal?: AbortSignal): Promise<AppProbe> {
  const started = Date.now()
  const url = `${base(appUrl)}/api/skills?op=compat-cache`
  try {
    const res = await fetch(url, { signal: timeoutSignal(signal, 4000), headers: { Accept: 'application/json' } })
    return {
      ok: res.ok,
      url,
      status: res.status,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
      durationMs: Date.now() - started,
    }
  } catch (err) {
    return {
      ok: false,
      url,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    }
  }
}

async function call(appUrl: string, params: Record<string, string>, signal?: AbortSignal): Promise<AppCompatResult> {
  const started = Date.now()
  const url = `${base(appUrl)}/api/skills?${new URLSearchParams(params).toString()}`
  try {
    const res = await fetch(url, {
      signal: timeoutSignal(signal, 30_000),
      headers: { Accept: 'application/json' },
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      return {
        ok: false,
        url,
        reachable: true,
        status: res.status,
        error: `The app returned non-JSON output: ${redactSecrets(text).slice(0, 300)}`,
        durationMs: Date.now() - started,
      }
    }
    const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
    if (!res.ok || obj.ok === false) {
      const message = typeof obj.error === 'string' ? obj.error : `HTTP ${res.status}`
      return {
        ok: false,
        url,
        reachable: true,
        status: res.status,
        error: redactSecrets(message),
        durationMs: Date.now() - started,
      }
    }
    return {
      ok: true,
      url,
      reachable: true,
      status: res.status,
      report: obj.report,
      multiple: obj.multiple === true,
      candidates: Array.isArray(obj.candidates)
        ? obj.candidates.filter((c): c is { dir: string; name: string } => {
            if (!c || typeof c !== 'object') return false
            const o = c as Record<string, unknown>
            return typeof o.dir === 'string' && typeof o.name === 'string'
          })
        : undefined,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    return {
      ok: false,
      url,
      reachable: false,
      error: redactSecrets(err instanceof Error ? err.message : String(err)),
      durationMs: Date.now() - started,
    }
  }
}

export function checkRepoCompat(
  appUrl: string,
  repo: string,
  opts: { ref?: string; dir?: string; probe?: boolean } = {},
  signal?: AbortSignal,
): Promise<AppCompatResult> {
  const params: Record<string, string> = { op: 'compat', repo }
  if (opts.ref) params.ref = opts.ref
  if (opts.dir) params.dir = opts.dir
  if (opts.probe) params.probe = '1'
  return call(appUrl, params, signal)
}

export function checkInstalledCompat(
  appUrl: string,
  id: string,
  opts: { probe?: boolean } = {},
  signal?: AbortSignal,
): Promise<AppCompatResult> {
  const params: Record<string, string> = { op: 'compat', id }
  if (opts.probe) params.probe = '1'
  return call(appUrl, params, signal)
}

export function checkAllInstalledCompat(
  appUrl: string,
  opts: { probe?: boolean } = {},
  signal?: AbortSignal,
): Promise<AppCompatResult> {
  const params: Record<string, string> = { op: 'compat-all' }
  if (opts.probe) params.probe = '1'
  return call(appUrl, params, signal)
}

/**
 * The existing app's report is opaque to this client on purpose: rendering it
 * verbatim avoids a second, subtly different compatibility implementation.
 */
export function summarizeReport(report: unknown): string {
  if (!report || typeof report !== 'object') return '(no report)'
  const obj = report as Record<string, unknown>
  const lines: string[] = []
  const fields: Array<[string, string]> = [
    ['skill', 'name'],
    ['overall', 'overall'],
    ['status', 'status'],
    ['verdict', 'verdict'],
    ['format', 'format'],
    ['revision', 'revision'],
    ['commit', 'commit'],
    ['summary', 'summary'],
    ['error', 'error'],
  ]
  for (const [label, key] of fields) {
    const value = obj[key]
    if (typeof value === 'string' && value) lines.push(`${label}: ${value}`)
  }
  const dimensions = obj.dimensions
  if (Array.isArray(dimensions)) {
    for (const dim of dimensions) {
      if (!dim || typeof dim !== 'object') continue
      const d = dim as Record<string, unknown>
      const name = typeof d.name === 'string' ? d.name : typeof d.id === 'string' ? d.id : 'dimension'
      const status = typeof d.status === 'string' ? d.status : 'unknown'
      const detail = typeof d.detail === 'string' ? ` — ${d.detail}` : ''
      lines.push(`- ${name}: ${status}${detail}`)
    }
  }
  const missing = obj.missing
  if (Array.isArray(missing) && missing.length > 0) {
    lines.push(`missing: ${missing.map((m) => String(m)).join(', ')}`)
  }
  const warnings = obj.warnings
  if (Array.isArray(warnings) && warnings.length > 0) {
    lines.push(`warnings: ${warnings.map((w) => String(w)).join('; ')}`)
  }
  if (lines.length === 0) return JSON.stringify(report, null, 2).slice(0, 4000)
  return lines.join('\n')
}
