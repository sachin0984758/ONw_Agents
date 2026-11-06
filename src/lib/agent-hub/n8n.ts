// ── n8n integration service (server-only) ────────────────────────────────────
// Talks to a real n8n instance through its official public API and its trigger
// endpoints. Every function here returns either something n8n actually reported
// or an honest, secret-free explanation of why it could not. There are no mock
// executions and no fabricated success states.
//
// SECURITY: the API key lives only in this server module (env or
// db/n8n-config.json). It is never included in any value returned to a route or
// the browser — `toPublicConfig()` strips it and `redactSecrets()` scrubs it
// from every error/response string.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  addExecutionRecord,
  clearStoredN8nConfig,
  getExecutionRecord,
  getWorkflowLink,
  listExecutionRecords,
  readStoredN8nConfig,
  removeWorkflowLink,
  updateExecutionRecord,
  upsertWorkflowLink,
  writeStoredN8nConfig,
} from './n8n-store'
import type {
  N8nBlockReason,
  N8nExecutionRecord,
  N8nExecutionState,
  N8nPublicConfig,
  N8nStatus,
  N8nTriggerInfo,
  N8nTriggerKind,
  N8nWorkflowLink,
  StoredN8nConfig,
} from './n8n-types'

export class N8nError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'N8nError'
    this.code = code
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface N8nRuntimeConfig {
  baseUrl: string
  webhookBaseUrl: string
  apiKey: string
  timeoutMs: number
  allowPrivateHosts: boolean
  source: 'env' | 'stored' | 'default'
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Resolves the effective config: environment variables win, then stored config.
export async function getRuntimeConfig(): Promise<N8nRuntimeConfig> {
  const stored = await readStoredN8nConfig()
  const env = process.env
  const baseUrl = (env.N8N_BASE_URL || stored.baseUrl || '').trim()
  const apiKey = (env.N8N_API_KEY || stored.apiKey || '').trim()
  const webhookBaseUrl = (env.N8N_WEBHOOK_BASE_URL || stored.webhookBaseUrl || '').trim() || baseUrl
  const timeoutMs = clamp(Number(env.N8N_TIMEOUT_MS || stored.timeoutMs || 15000) || 15000, 1000, 60000)
  const source: N8nRuntimeConfig['source'] = env.N8N_BASE_URL ? 'env' : stored.baseUrl ? 'stored' : 'default'
  return { baseUrl, webhookBaseUrl, apiKey, timeoutMs, allowPrivateHosts: env.N8N_ALLOW_PRIVATE_HOSTS !== 'false', source }
}

export function toPublicConfig(cfg: N8nRuntimeConfig): N8nPublicConfig {
  return {
    baseUrl: cfg.baseUrl,
    webhookBaseUrl: cfg.webhookBaseUrl,
    timeoutMs: cfg.timeoutMs,
    hasApiKey: cfg.apiKey.length > 0,
    configured: cfg.baseUrl.length > 0 && cfg.apiKey.length > 0,
    source: cfg.source,
  }
}

export async function getPublicConfig(): Promise<N8nPublicConfig> {
  return toPublicConfig(await getRuntimeConfig())
}

/**
 * Save connection settings. The API key is write-only: passing an empty string
 * leaves the existing key untouched so the UI never needs to round-trip it.
 */
export async function saveConfig(input: {
  baseUrl?: string
  apiKey?: string
  webhookBaseUrl?: string
  timeoutMs?: number
}): Promise<N8nPublicConfig> {
  const patch: StoredN8nConfig = {}
  if (typeof input.baseUrl === 'string') patch.baseUrl = input.baseUrl.trim()
  if (typeof input.webhookBaseUrl === 'string') patch.webhookBaseUrl = input.webhookBaseUrl.trim()
  if (typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)) {
    patch.timeoutMs = clamp(Math.round(input.timeoutMs), 1000, 60000)
  }
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) patch.apiKey = input.apiKey.trim()

  if (patch.baseUrl) assertAllowedHost(patch.baseUrl)
  if (patch.webhookBaseUrl) assertAllowedHost(patch.webhookBaseUrl)

  const current = await readStoredN8nConfig()
  await writeStoredN8nConfig({ ...current, ...patch })
  return getPublicConfig()
}

/** Removes the stored connection config (env vars, if any, remain in effect). */
export async function clearStoredN8nConfigSafe(): Promise<void> {
  await clearStoredN8nConfig()
}

// ── Secret handling / SSRF guards ────────────────────────────────────────────

/** Masks anything that looks like an API key. Used on every outbound string. */
export function redactSecrets(text: string, secret?: string): string {
  if (!text) return text
  let out = String(text)
  if (secret) out = out.split(secret).join('***')
  out = out.replace(/(x-n8n-api-key["'\s:]*)[^\s"']+/gi, '$1***')
  out = out.replace(/("?(?:api[_-]?key|token|authorization)"?\s*[:=]\s*"?)([A-Za-z0-9._~+/=-]{6,})/gi, '$1***')
  return out
}

/**
 * Validates an n8n base URL and enforces the optional host allowlist. This is
 * the SSRF boundary: AgentHub only ever talks to the configured n8n host (and
 * webhooks it serves), never to a URL chosen by the request body.
 */
export function assertAllowedHost(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new N8nError('bad_url', 'n8n URL must be a valid absolute http(s) URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new N8nError('bad_url', 'n8n URL must use http or https.')
  }
  const allow = (process.env.N8N_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allow.length > 0 && !allow.includes(url.host) && !allow.includes(url.hostname)) {
    throw new N8nError('host_not_allowed', `Host "${url.host}" is not permitted by N8N_ALLOWED_HOSTS.`)
  }
  // Opt-in hardening for internet-facing deployments. Default keeps a local n8n
  // (localhost) working.
  if (process.env.N8N_ALLOW_PRIVATE_HOSTS === 'false' && isPrivateHost(url.hostname)) {
    throw new N8nError('host_not_allowed', `Host "${url.host}" is private and N8N_ALLOW_PRIVATE_HOSTS is false.`)
  }
  return url
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
}

/** Rejects webhook paths that could escape the n8n origin. */
export function sanitizeWebhookPath(raw: string): string {
  const trimmed = String(raw || '').trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed || trimmed.includes('..') || trimmed.includes('://') || /\s/.test(trimmed) || !/^[\w./-]+$/.test(trimmed)) {
    throw new N8nError('bad_webhook_path', 'The workflow webhook path is missing or unsafe.')
  }
  return trimmed
}

// ── Low-level HTTP ───────────────────────────────────────────────────────────

function joinUrl(base: string, resource: string): string {
  const b = base.endsWith('/') ? base : `${base}/`
  return new URL(resource.replace(/^\/+/, ''), b).href
}

async function doFetch(cfg: N8nRuntimeConfig, url: string, init: RequestInit, auth: boolean): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  const headers = new Headers(init.headers || {})
  headers.set('accept', 'application/json')
  if (auth && cfg.apiKey) headers.set('X-N8N-API-KEY', cfg.apiKey)
  try {
    // redirect:"manual" so a redirect can never bounce us to another origin.
    return await fetch(url, { ...init, headers, signal: controller.signal, redirect: 'manual' })
  } finally {
    clearTimeout(timer)
  }
}

async function n8nApiFetch(cfg: N8nRuntimeConfig, resource: string, init: RequestInit = {}): Promise<Response> {
  const base = assertAllowedHost(cfg.baseUrl)
  return doFetch(cfg, joinUrl(base.href, resource), init, true)
}

async function fetchAbsolute(cfg: N8nRuntimeConfig, absoluteUrl: string, init: RequestInit, auth: boolean): Promise<Response> {
  const url = new URL(absoluteUrl)
  assertAllowedHost(url.origin) // only the configured n8n host is reachable
  return doFetch(cfg, url.href, init, auth)
}

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function safeJson(res: Response): Promise<JsonObject | null> {
  try {
    const value: unknown = await res.json()
    return isJsonObject(value) ? value : null
  } catch {
    return null
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ── Connectivity ─────────────────────────────────────────────────────────────

async function probeVersion(cfg: N8nRuntimeConfig): Promise<string | null> {
  try {
    const res = await fetchAbsolute(cfg, joinUrl(assertAllowedHost(cfg.baseUrl).href, 'rest/settings'), { method: 'GET' }, false)
    if (!res.ok) return null
    const j = await safeJson(res)
    const data = isJsonObject(j?.data) ? j.data : null
    const v = data?.versionCli ?? j?.versionCli ?? data?.version ?? null
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

export async function getN8nStatus(): Promise<N8nStatus> {
  const cfg = await getRuntimeConfig()
  const config = toPublicConfig(cfg)
  const checkedAt = new Date().toISOString()

  if (!cfg.baseUrl) {
    return {
      state: 'not_configured',
      config,
      version: null,
      message: 'n8n is not configured yet. Set the base URL and API key to connect.',
      workflowCount: null,
      checkedAt,
    }
  }

  const version = await probeVersion(cfg)

  if (!cfg.apiKey) {
    return {
      state: version ? 'unauthorized' : 'unreachable',
      config,
      version,
      message: version
        ? 'n8n is reachable but no API key is configured. Add an API key to import and run workflows.'
        : `Could not reach an n8n instance at ${cfg.baseUrl}. Check that n8n is running and the base URL is correct.`,
      workflowCount: null,
      checkedAt,
    }
  }

  try {
    const res = await n8nApiFetch(cfg, 'api/v1/workflows?limit=1')
    if (res.status === 401 || res.status === 403) {
      return {
        state: 'unauthorized',
        config,
        version,
        message: 'Authentication failed. Check that N8N_API_KEY is a valid n8n API key with workflow permissions.',
        workflowCount: null,
        checkedAt,
      }
    }
    if (!res.ok) {
      return {
        state: 'error',
        config,
        version,
        message: `n8n returned HTTP ${res.status} for the workflows endpoint.`,
        workflowCount: null,
        checkedAt,
      }
    }
    const body = await safeJson(res)
    const count = Array.isArray(body?.data) ? body.data.length : null
    return {
      state: 'connected',
      config,
      version,
      message: `Connected to ${cfg.baseUrl}${version ? ` (n8n ${version})` : ''}.`,
      workflowCount: count,
      checkedAt,
    }
  } catch (e) {
    return {
      state: 'unreachable',
      config,
      version,
      message: redactSecrets(`Could not reach n8n at ${cfg.baseUrl}: ${errMessage(e)}`, cfg.apiKey),
      workflowCount: null,
      checkedAt,
    }
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

const TEMPLATE_DIRS = [
  path.join(process.cwd(), 'public', 'n8n-templates'),
  path.join(process.cwd(), '.next', 'standalone', 'public', 'n8n-templates'),
]

export async function readTemplateJson(templateId: string): Promise<JsonObject> {
  if (!/^n8n-\d+$/.test(templateId)) {
    throw new N8nError('bad_template', 'Unknown template id.')
  }
  const numeric = templateId.slice('n8n-'.length)
  for (const dir of TEMPLATE_DIRS) {
    try {
      const raw = await fs.readFile(path.join(dir, `${numeric}.json`), 'utf-8')
      const value: unknown = JSON.parse(raw)
      if (isJsonObject(value)) return value
    } catch {
      /* try next dir */
    }
  }
  throw new N8nError('template_not_found', `The workflow template ${templateId} was not found on disk.`)
}

const TRIGGER_MATCHERS: Array<{ kind: N8nTriggerKind; test: (t: string) => boolean }> = [
  { kind: 'webhook', test: (t) => t === 'n8n-nodes-base.webhook' },
  { kind: 'form', test: (t) => t === 'n8n-nodes-base.formTrigger' },
  { kind: 'schedule', test: (t) => /scheduleTrigger|cron|interval/i.test(t) },
  { kind: 'manual', test: (t) => t === 'n8n-nodes-base.manualTrigger' },
  { kind: 'event', test: (t) => /trigger/i.test(t) || /executeWorkflowTrigger|emailReadImap|errorTrigger/i.test(t) },
]

const KIND_PRIORITY: N8nTriggerKind[] = ['webhook', 'form', 'manual', 'schedule', 'event']

function kindOf(nodeType: string): N8nTriggerKind | null {
  for (const m of TRIGGER_MATCHERS) if (m.test(nodeType)) return m.kind
  return null
}

/**
 * Classifies a raw n8n workflow so AgentHub knows how (or whether) it can be
 * started. Returns the real node it found plus the credentials the workflow
 * references — never a guess presented as fact.
 */
export function classifyTrigger(workflow: unknown): N8nTriggerInfo {
  const workflowObject = isJsonObject(workflow) ? workflow : {}
  const nodes: JsonObject[] = Array.isArray(workflowObject.nodes) ? workflowObject.nodes.filter(isJsonObject) : []
  const requiredCredentials = Array.from(
    new Set(nodes.flatMap((node) => Object.keys(isJsonObject(node.credentials) ? node.credentials : {})))
  ).sort()

  const triggerNodes = nodes
    .map((node) => ({ node, kind: kindOf(String(node.type ?? '')) }))
    .filter((entry): entry is { node: JsonObject; kind: N8nTriggerKind } => entry.kind !== null)

  let chosen = triggerNodes.find((x) => x.kind === 'webhook')
  if (!chosen) {
    for (const kind of KIND_PRIORITY) {
      chosen = triggerNodes.find((x) => x.kind === kind)
      if (chosen) break
    }
  }

  if (!chosen) {
    return {
      kind: 'unknown',
      nodeType: '',
      nodeName: null,
      webhookPath: null,
      webhookSegment: null,
      httpMethod: 'POST',
      requiredCredentials,
      runnableOnDemand: false,
      note: 'No trigger node was found in this workflow.',
    }
  }

  const node = chosen.node
  const nodeType = String(node.type ?? '')
  const nodeName = typeof node.name === 'string' ? node.name : null
  const params = isJsonObject(node.parameters) ? node.parameters : {}
  const rawPath = typeof params.path === 'string' && params.path.trim() ? params.path : node.webhookId
  const webhookPath = rawPath ? String(rawPath) : null
  const webhookSegment: N8nTriggerInfo['webhookSegment'] = chosen.kind === 'webhook' ? 'webhook' : chosen.kind === 'form' ? 'form' : null
  const httpMethod = String(params.httpMethod ?? (chosen.kind === 'webhook' ? 'POST' : 'POST')).toUpperCase()

  let note = ''
  let runnableOnDemand = false
  switch (chosen.kind) {
    case 'webhook':
      runnableOnDemand = !!webhookPath
      note = runnableOnDemand
        ? 'Runs on demand. Activate the workflow, then AgentHub calls its production webhook.'
        : 'This webhook has no path or id, so its URL cannot be derived.'
      break
    case 'form':
      runnableOnDemand = !!webhookPath
      note = runnableOnDemand
        ? 'Runs on demand. Activate the workflow, then AgentHub submits its form trigger URL.'
        : 'This form trigger has no path, so its URL cannot be derived.'
      break
    case 'manual':
      note = "Manual-trigger workflows cannot be started through n8n's public API. Open the workflow in n8n to run it, or add a webhook trigger."
      break
    case 'schedule':
      note = 'This workflow runs on a schedule. Activate it and n8n fires it automatically — it is not started by the Run button.'
      break
    case 'event':
      note = `This workflow waits for an external event (${nodeType}). Activate it and let the event fire.`
      break
  }

  return {
    kind: chosen.kind,
    nodeType,
    nodeName,
    webhookPath,
    webhookSegment,
    httpMethod,
    requiredCredentials,
    runnableOnDemand,
    note,
  }
}

/** Inspection works offline: it reads the local template, not n8n. */
export async function inspectTemplate(templateId: string) {
  const cfg = await getRuntimeConfig()
  const workflow = await readTemplateJson(templateId)
  const trigger = classifyTrigger(workflow)
  const link = await getWorkflowLink(templateId)
  return {
    templateId,
    name: String(workflow?.name ?? templateId),
    trigger,
    requiredCredentials: trigger.requiredCredentials,
    imported: !!link,
    link,
    deepLink: link ? workflowDeepLink(cfg, link.n8nWorkflowId) : null,
    connected: cfg.baseUrl.length > 0 && cfg.apiKey.length > 0,
  }
}

export function buildWebhookUrl(cfg: N8nRuntimeConfig, trigger: N8nTriggerInfo): string {
  if (!trigger.webhookSegment || !trigger.webhookPath) {
    throw new N8nError('no_webhook', 'This workflow does not expose a webhook path.')
  }
  const base = assertAllowedHost(cfg.webhookBaseUrl || cfg.baseUrl)
  const safePath = sanitizeWebhookPath(trigger.webhookPath)
  const encoded = safePath.split('/').map((s) => encodeURIComponent(s)).join('/')
  return joinUrl(base.href, `${trigger.webhookSegment}/${encoded}`)
}

/** The URL a user can open in n8n to see a workflow. */
export function workflowDeepLink(cfg: N8nRuntimeConfig, n8nWorkflowId: string): string | null {
  try {
    const base = assertAllowedHost(cfg.baseUrl)
    return joinUrl(base.href, `workflow/${encodeURIComponent(n8nWorkflowId)}`)
  } catch {
    return null
  }
}

// ── Import (with de-duplication) ─────────────────────────────────────────────

async function findWorkflowByName(cfg: N8nRuntimeConfig, name: string): Promise<JsonObject | null> {
  try {
    const res = await n8nApiFetch(cfg, 'api/v1/workflows?limit=250')
    if (!res.ok) return null
    const body = await safeJson(res)
    const rows: JsonObject[] = Array.isArray(body?.data) ? body.data.filter(isJsonObject) : []
    return rows.find((workflow) => workflow.name === name) ?? null
  } catch {
    return null
  }
}

async function workflowExists(cfg: N8nRuntimeConfig, id: string): Promise<boolean> {
  try {
    const res = await n8nApiFetch(cfg, `api/v1/workflows/${encodeURIComponent(id)}`)
    return res.ok
  } catch {
    return false
  }
}

function requireConfigured(cfg: N8nRuntimeConfig): void {
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new N8nError('not_configured', 'n8n is not configured. Set N8N_BASE_URL and N8N_API_KEY, or use the connection panel.')
  }
}

export async function importTemplate(
  templateId: string,
  opts: { activate?: boolean } = {}
): Promise<{ link: N8nWorkflowLink; created: boolean; verified: boolean }> {
  const cfg = await getRuntimeConfig()
  requireConfigured(cfg)

  const workflow = await readTemplateJson(templateId)
  const trigger = classifyTrigger(workflow)

  const existing = await getWorkflowLink(templateId)
  if (existing) {
    return { link: existing, created: false, verified: await workflowExists(cfg, existing.n8nWorkflowId) }
  }

  // Reuse an identically named workflow already in n8n (avoids duplicates when
  // AgentHub's link file was cleared but the n8n workflow still exists).
  const byName = await findWorkflowByName(cfg, String(workflow?.name ?? ''))
  let n8nWorkflowId: string | null = byName?.id != null ? String(byName.id) : null
  let created = false

  if (!n8nWorkflowId) {
    const payload = {
      name: workflow?.name ?? templateId,
      nodes: workflow?.nodes ?? [],
      connections: workflow?.connections ?? {},
      settings: workflow?.settings ?? {},
    }
    const res = await n8nApiFetch(cfg, 'api/v1/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status === 401 || res.status === 403) {
      throw new N8nError('unauthorized', 'n8n rejected the API key while importing the workflow.')
    }
    if (!res.ok) {
      const detail = redactSecrets(truncate(await safeText(res), 400), cfg.apiKey)
      throw new N8nError('n8n_error', `Import failed (HTTP ${res.status}). ${detail}`)
    }
    const body = await safeJson(res)
    if (body?.id == null) throw new N8nError('n8n_error', 'n8n did not return an id for the imported workflow.')
    n8nWorkflowId = String(body.id)
    created = true
  }

  let link: N8nWorkflowLink = {
    templateId,
    templateName: String(workflow?.name ?? templateId),
    n8nWorkflowId,
    importedAt: new Date().toISOString(),
    activated: byName?.active === true,
    triggerKind: trigger.kind,
  }
  await upsertWorkflowLink(link)

  if (opts.activate && (trigger.kind === 'webhook' || trigger.kind === 'form' || trigger.kind === 'schedule' || trigger.kind === 'event')) {
    link = await setActivation(templateId, true)
  }

  return { link, created, verified: true }
}

// ── Activation ───────────────────────────────────────────────────────────────

export async function setActivation(templateId: string, active: boolean): Promise<N8nWorkflowLink> {
  const cfg = await getRuntimeConfig()
  requireConfigured(cfg)
  const link = await getWorkflowLink(templateId)
  if (!link) throw new N8nError('not_imported', 'Import this workflow into n8n before activating it.')

  const action = active ? 'activate' : 'deactivate'
  const res = await n8nApiFetch(cfg, `api/v1/workflows/${encodeURIComponent(link.n8nWorkflowId)}/${action}`, { method: 'POST' })
  if (res.status === 401 || res.status === 403) {
    throw new N8nError('unauthorized', `n8n rejected the API key while trying to ${action} the workflow.`)
  }
  if (!res.ok) {
    const detail = redactSecrets(truncate(await safeText(res), 400), cfg.apiKey)
    throw new N8nError('n8n_error', `n8n returned HTTP ${res.status} when trying to ${action} the workflow. ${detail}`)
  }
  const next: N8nWorkflowLink = { ...link, activated: active }
  await upsertWorkflowLink(next)
  return next
}

// ── Execution ────────────────────────────────────────────────────────────────

export async function unlinkTemplate(templateId: string): Promise<void> {
  await removeWorkflowLink(templateId)
}

const STATUS_MAP: Record<string, N8nExecutionState> = {
  new: 'waiting',
  waiting: 'waiting',
  running: 'running',
  success: 'success',
  error: 'error',
  crashed: 'error',
  failed: 'error',
  canceled: 'canceled',
  cancelled: 'canceled',
}

function mapExecutionStatus(s: unknown): N8nExecutionState | null {
  if (typeof s !== 'string') return null
  return STATUS_MAP[s.toLowerCase()] ?? null
}

function durationFromExecution(ex: JsonObject | null): number | null {
  const start = typeof ex?.startedAt === 'string' ? Date.parse(ex.startedAt) : NaN
  const stop = typeof ex?.stoppedAt === 'string' ? Date.parse(ex.stoppedAt) : NaN
  if (Number.isFinite(start) && Number.isFinite(stop) && stop >= start) return stop - start
  return null
}

async function latestExecutionFor(cfg: N8nRuntimeConfig, workflowId: string, startedAfter?: string): Promise<JsonObject | null> {
  try {
    const q = new URLSearchParams({ workflowId, limit: '5' })
    if (startedAfter) q.set('startedAfter', startedAfter)
    const res = await n8nApiFetch(cfg, `api/v1/executions?${q.toString()}`)
    if (!res.ok) return null
    const body = await safeJson(res)
    const rows: JsonObject[] = Array.isArray(body?.data) ? body.data.filter(isJsonObject) : []
    return rows[0] ?? null
  } catch {
    return null
  }
}

export interface ExecuteResult {
  ok: boolean
  record: N8nExecutionRecord
  trigger: N8nTriggerInfo
  requiredCredentials: string[]
  message?: string
  blockedReason?: N8nBlockReason
  webhookResponse?: { status: number; body: string } | null
}

export async function executeTemplate(
  templateId: string,
  opts: { confirmCredentials?: boolean; data?: unknown } = {}
): Promise<ExecuteResult> {
  const cfg = await getRuntimeConfig()
  const workflow = await readTemplateJson(templateId)
  const trigger = classifyTrigger(workflow)
  const link = await getWorkflowLink(templateId)
  const templateName = String(workflow?.name ?? link?.templateName ?? templateId)

  const start = new Date().toISOString()
  const makeRecord = (): N8nExecutionRecord => ({
    id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId,
    templateName,
    n8nWorkflowId: link?.n8nWorkflowId ?? '',
    n8nExecutionId: null,
    status: 'blocked',
    mode: null,
    startedAt: start,
    finishedAt: null,
    requestDurationMs: null,
    n8nDurationMs: null,
    httpStatus: null,
    error: null,
    resultPreview: null,
    blockedReason: null,
    trigger: trigger.kind,
  })

  const block = async (reason: N8nBlockReason, message: string): Promise<ExecuteResult> => {
    const record = { ...makeRecord(), status: 'blocked' as N8nExecutionState, blockedReason: reason, error: message, finishedAt: new Date().toISOString() }
    await addExecutionRecord(record)
    return { ok: false, record, trigger, requiredCredentials: trigger.requiredCredentials, message, blockedReason: reason }
  }

  if (!cfg.baseUrl || !cfg.apiKey) {
    return block('not_configured', 'n8n is not configured. Set the base URL and API key before running workflows.')
  }
  if (!link) {
    return block('not_imported', 'Import this workflow into n8n before running it.')
  }
  if (trigger.requiredCredentials.length > 0 && !opts.confirmCredentials) {
    return block(
      'needs_credentials',
      `This workflow references credentials (${trigger.requiredCredentials.join(', ')}). Configure them in n8n, then confirm to run.`
    )
  }
  if (trigger.kind === 'manual') {
    return block('manual_trigger', "Manual-trigger workflows can't be started through n8n's public API. Open the workflow in n8n to run it, or add a webhook trigger.")
  }
  if (trigger.kind === 'schedule') {
    return block('scheduled_trigger', 'This workflow runs on a schedule. Activate it and n8n will fire it automatically — it is not started by Run.')
  }
  if (trigger.kind === 'event') {
    return block('event_trigger', `This workflow waits for an external event (${trigger.nodeType}). Activate it and let the event fire.`)
  }
  if ((trigger.kind === 'webhook' || trigger.kind === 'form') && trigger.webhookPath) {
    if (!link.activated) {
      return block('needs_activation', 'Activate the workflow to expose its production trigger URL, then run it.')
    }

    const running: N8nExecutionRecord = {
      ...makeRecord(),
      status: 'running',
      mode: 'webhook',
      n8nWorkflowId: link.n8nWorkflowId,
    }
    await addExecutionRecord(running)

    const url = buildWebhookUrl(cfg, trigger)
    const t0 = Date.now()
    try {
      const res = await fetchAbsolute(
        cfg,
        url,
        {
          method: trigger.httpMethod === 'GET' ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: trigger.httpMethod === 'GET' ? undefined : JSON.stringify(opts.data ?? {}),
        },
        false
      )
      const requestDurationMs = Date.now() - t0
      const text = await safeText(res)
      const preview = redactSecrets(truncate(text, 2000), cfg.apiKey)

      // The webhook accepting the request is not proof of success — ask n8n for
      // the execution it created and use that as the authoritative outcome.
      const ex = await latestExecutionFor(cfg, link.n8nWorkflowId, new Date(t0 - 5000).toISOString())
      const status = mapExecutionStatus(ex?.status) ?? (res.ok ? 'success' : 'error')
      const finishedAt = new Date().toISOString()

      const record: N8nExecutionRecord = {
        ...running,
        status,
        mode: typeof ex?.mode === 'string' ? ex.mode : 'webhook',
        n8nExecutionId: ex?.id != null ? String(ex.id) : null,
        httpStatus: res.status,
        requestDurationMs,
        n8nDurationMs: durationFromExecution(ex),
        finishedAt,
        resultPreview: preview || null,
        error: res.ok ? null : `Trigger responded HTTP ${res.status}. ${redactSecrets(truncate(text, 500), cfg.apiKey)}`,
        blockedReason: null,
      }
      await updateExecutionRecord(running.id, record)
      return {
        ok: status !== 'error' && status !== 'canceled',
        record,
        trigger,
        requiredCredentials: trigger.requiredCredentials,
        webhookResponse: { status: res.status, body: preview },
      }
    } catch (e) {
      const record: N8nExecutionRecord = {
        ...running,
        status: 'error',
        finishedAt: new Date().toISOString(),
        requestDurationMs: Date.now() - t0,
        error: redactSecrets(errMessage(e), cfg.apiKey),
      }
      await updateExecutionRecord(running.id, record)
      return { ok: false, record, trigger, requiredCredentials: trigger.requiredCredentials, message: record.error ?? undefined }
    }
  }

  return block('event_trigger', 'This workflow has no trigger AgentHub can start. Open it in n8n.')
}

/** Pulls the latest status for an AgentHub execution record from n8n. */
export async function refreshExecutionRecord(id: string): Promise<N8nExecutionRecord | null> {
  const record = await getExecutionRecord(id)
  if (!record) return null
  if (!record.n8nExecutionId) return record

  const cfg = await getRuntimeConfig()
  if (!cfg.baseUrl || !cfg.apiKey) return record

  try {
    const res = await n8nApiFetch(cfg, `api/v1/executions/${encodeURIComponent(record.n8nExecutionId)}?includeData=false`)
    if (!res.ok) return record
    const ex = await safeJson(res)
    const status = mapExecutionStatus(ex?.status) ?? record.status
    const terminal = status !== 'running' && status !== 'waiting'
    return updateExecutionRecord(id, {
      status,
      mode: typeof ex?.mode === 'string' ? ex.mode : record.mode,
      startedAt: typeof ex?.startedAt === 'string' ? ex.startedAt : record.startedAt,
      finishedAt: typeof ex?.stoppedAt === 'string' ? ex.stoppedAt : terminal ? record.finishedAt ?? new Date().toISOString() : record.finishedAt,
      n8nDurationMs: durationFromExecution(ex) ?? record.n8nDurationMs,
    })
  } catch {
    return record
  }
}

export async function getExecutionHistory(templateId?: string) {
  return listExecutionRecords(templateId)
}

export async function getTemplateStatus(templateId: string) {
  return inspectTemplate(templateId)
}
