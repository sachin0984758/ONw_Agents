// ── Skills compatibility: server orchestration + cache ───────────────────────
// Server-side only (node:fs / node:child_process). Bridges the pure engine in
// `skills-compat.ts` to real inputs:
//   · the GitHub inspector (bounded text reads — no execution, no extraction)
//   · the installed library on disk
//   · the runtime policy + loaded model (for the environment fingerprint)
//   · an OPTIONAL, allow-listed binary probe (`--version`, no shell)
//
// Nothing here executes skill content. The one action that calls a model is the
// explicit, user-confirmed functional test, which runs against a disposable
// fixture in the OS temp dir — never the application project or its DB.

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DB_DIR } from './db-path'
import { createSerializer, writeJsonAtomic } from './fs-atomic'
import { readRuntimePolicy } from './runtime-policy'
import { callLLM, detectRuntimeModels, describeTarget, resolveTarget, type ChatTurn } from './llm'
import { buildSkillsPrompt, type ActiveSkillInstruction } from './skills'
import { readSkillInstructions, readSkillResource, type SkillRecord, type SkillsRegistry } from './skills-registry'
import { blobsInDir, fetchRepoTextFile, fetchSkillMarkdown, type GitHubRef, type RepoTree } from './skills-github'
import {
  RUNTIME_TOOL_NAMES,
  buildCompatReport,
  fingerprintEnv,
  type CompatEnvInput,
  type CompatFileInput,
  type CompatReport,
  type CompatStatus,
  type FunctionalTestResult,
  type FunctionalTestStep,
} from './skills-compat'

export const COMPAT_STORE_FILE = path.join(DB_DIR, 'skills-compat.json')
const STORE_VERSION = 1
const MAX_STORED_REPORTS = 200

export interface StoredCompatTest {
  envFingerprint: string
  testedAt: string
  result: FunctionalTestResult
}

export interface CompatStore {
  version: number
  updatedAt: string
  reports: CompatReport[]
  /** Functional-test results, keyed + fingerprinted so they go stale honestly. */
  tests: Record<string, StoredCompatTest>
}

const serializeStore = createSerializer()

function emptyStore(): CompatStore {
  return { version: STORE_VERSION, updatedAt: new Date().toISOString(), reports: [], tests: {} }
}

export async function readCompatStore(): Promise<CompatStore> {
  try {
    const raw = await fs.readFile(COMPAT_STORE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<CompatStore>
    const reports = Array.isArray(parsed.reports)
      ? parsed.reports.filter((r): r is CompatReport => !!r && typeof r === 'object' && typeof r.revisionKey === 'string')
      : []
    const tests: Record<string, StoredCompatTest> = {}
    if (parsed.tests && typeof parsed.tests === 'object') {
      for (const [k, v] of Object.entries(parsed.tests)) {
        const t = v as Partial<StoredCompatTest>
        if (t && typeof t === 'object' && typeof t.envFingerprint === 'string' && t.result && typeof t.result === 'object') {
          tests[k] = { envFingerprint: t.envFingerprint, testedAt: typeof t.testedAt === 'string' ? t.testedAt : new Date().toISOString(), result: t.result }
        }
      }
    }
    return { version: STORE_VERSION, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(), reports, tests }
  } catch {
    return emptyStore()
  }
}

export async function writeCompatStore(store: CompatStore): Promise<void> {
  const tests: Record<string, StoredCompatTest> = {}
  for (const k of Object.keys(store.tests).slice(-MAX_STORED_REPORTS)) tests[k] = store.tests[k]
  const next: CompatStore = { version: STORE_VERSION, updatedAt: new Date().toISOString(), reports: store.reports.slice(0, MAX_STORED_REPORTS), tests }
  await writeJsonAtomic(COMPAT_STORE_FILE, next)
}

export async function clearCompatStore(): Promise<void> {
  await serializeStore(async () => {
    await writeCompatStore(emptyStore())
  })
}

/** Read a functional-test result only when it was produced under this exact environment. */
export async function getStoredCompatTest(key: string, envFingerprint: string): Promise<FunctionalTestResult | null> {
  const store = await readCompatStore()
  const t = store.tests[key]
  return t && t.envFingerprint === envFingerprint ? t.result : null
}

export async function saveCompatTest(key: string, envFingerprint: string, result: FunctionalTestResult): Promise<void> {
  await serializeStore(async () => {
    const store = await readCompatStore()
    store.tests[key] = { envFingerprint, testedAt: result.startedAt ?? new Date().toISOString(), result }
    await writeCompatStore(store)
  })
}

/** Stable cache identity: origin + source/identity + the exact source revision. */
export function compatCacheKey(origin: 'repo' | 'installed', id: string, source: { owner?: string; repo?: string; dirInRepo?: string }, revisionKey: string): string {
  const src = origin === 'installed' ? `id:${id}` : `${source.owner ?? ''}/${source.repo ?? ''}@${source.dirInRepo ?? ''}`
  return `${origin}|${src}|${revisionKey}`
}

export async function saveCompatReport(report: CompatReport): Promise<void> {
  await serializeStore(async () => {
    const store = await readCompatStore()
    const key = compatCacheKey(report.origin, report.id, report.source, report.revisionKey)
    const rest = store.reports.filter((r) => compatCacheKey(r.origin, r.id, r.source, r.revisionKey) !== key)
    store.reports = [report, ...rest].slice(0, MAX_STORED_REPORTS)
    await writeCompatStore(store)
  })
}

export async function getCachedCompat(
  origin: 'repo' | 'installed',
  id: string,
  source: { owner?: string; repo?: string; dirInRepo?: string },
  revisionKey: string,
  envFingerprint: string,
): Promise<CompatReport | null> {
  const store = await readCompatStore()
  const key = compatCacheKey(origin, id, source, revisionKey)
  const hit = store.reports.find((r) => compatCacheKey(r.origin, r.id, r.source, r.revisionKey) === key)
  if (!hit) return null
  if (hit.envFingerprint !== envFingerprint) return null
  return hit
}

export function summarizeCompat(reports: CompatReport[]): Record<CompatStatus, number> & { total: number } {
  const counts: Record<CompatStatus, number> & { total: number } = {
    'fully-compatible': 0,
    'partially-compatible': 0,
    incompatible: 0,
    'needs-review': 0,
    'not-verified': 0,
    total: reports.length,
  }
  for (const r of reports) counts[r.overall]++
  return counts
}

// ── Environment ──────────────────────────────────────────────────────────────

export interface EnvBuildOptions {
  probe?: boolean
  mode?: 'ro' | 'edit'
  model?: CompatEnvInput['model']
}

const PROBE_BINARIES = ['python', 'python3', 'node', 'npm', 'git', 'bash', 'curl']
const execFileAsync = promisify(execFile)

/**
 * Availability probe for a fixed allow-list of executables. Fixed binary + fixed
 * argument (`--version`), no shell, short timeout — it never runs skill code and
 * never passes user input to a command.
 */
export async function probeBinaries(names: string[] = PROBE_BINARIES): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  await Promise.all(
    names.map(async (n) => {
      try {
        await execFileAsync(n, ['--version'], { timeout: 2000, windowsHide: true })
        out[n] = true
      } catch {
        out[n] = false
      }
    }),
  )
  return out
}

async function probeContextLength(providerId: string, modelId: string): Promise<number | undefined> {
  if (providerId !== 'lmstudio') return undefined
  try {
    const res = await fetch('http://localhost:1234/api/v0/models', { signal: AbortSignal.timeout(2500) })
    if (!res.ok) return undefined
    const j = (await res.json()) as { data?: Array<Record<string, unknown>> }
    const m = (j.data ?? []).find((x) => x.id === modelId)
    const n = m?.loaded_context_length ?? m?.max_context_length
    return typeof n === 'number' && n > 0 ? n : undefined
  } catch {
    return undefined
  }
}

/** Describe the currently loaded chat model, or undefined when none is running. */
export async function describeLoadedModel(): Promise<CompatEnvInput['model']> {
  const report = await detectRuntimeModels().catch(() => null)
  const first = report?.loaded?.[0]
  if (!first) return undefined
  const contextLength = await probeContextLength(first.providerId, first.id)
  return {
    id: first.id,
    label: first.id,
    provider: first.providerName,
    contextLength,
    vision: first.type === 'vlm',
    loaded: true,
  }
}

/** Assemble the runtime environment description used for the fingerprint. */
export async function buildEnvInput(opts: EnvBuildOptions = {}): Promise<CompatEnvInput> {
  const policy = await readRuntimePolicy()
  const model = opts.model ?? (await describeLoadedModel())
  const env: CompatEnvInput = {
    platform: process.platform,
    mode: opts.mode ?? 'edit',
    codeExecution: policy.codeExecution,
    networkEgress: policy.networkEgress,
    binaries: opts.probe ? await probeBinaries() : undefined,
    model,
    runtimeTools: RUNTIME_TOOL_NAMES,
  }
  return env
}

// ── Repository candidate (pre-install) ───────────────────────────────────────

const INSPECT_TEXT_MAX_FILES = 16
const INSPECT_TEXT_MAX_BYTES = 256 * 1024
const INSPECT_TEXT_MAX_TOTAL = 2 * 1024 * 1024
const MANIFEST_NAMES = ['requirements.txt', 'pyproject.toml', 'package.json', 'Pipfile', 'environment.yml', 'setup.py', 'Gemfile', 'go.mod']

function wantsContent(relPath: string): boolean {
  if (relPath.split('/')[0] === 'scripts') return true
  return MANIFEST_NAMES.includes(relPath.slice(relPath.lastIndexOf('/') + 1))
}

export interface RepoCandidateCompatInput {
  ref: GitHubRef
  commit: string
  refUsed: string
  dirInRepo: string
  tree: RepoTree
  env?: CompatEnvInput
  envOptions?: EnvBuildOptions
  useCache?: boolean
}

export type CompatResult = { ok: true; report: CompatReport } | { ok: false; error: string }

export async function repoCandidateCompat(input: RepoCandidateCompatInput): Promise<CompatResult> {
  const blobs = blobsInDir(input.tree, input.dirInRepo)
  const prefix = input.dirInRepo ? `${input.dirInRepo}/` : ''
  const rel = blobs.map((b) => ({ rel: b.path.slice(prefix.length), blob: b }))
  if (!rel.some((r) => r.rel === 'SKILL.md')) return { ok: false, error: `No SKILL.md was found in "${input.dirInRepo || '/'}".` }
  const id = input.dirInRepo ? input.dirInRepo.split('/').pop()! : input.ref.repo
  const env = input.env ?? (await buildEnvInput(input.envOptions))
  const revisionKey = `${input.commit}:${input.dirInRepo}`
  const source = {
    kind: 'github' as const,
    repoUrl: input.ref.repoUrl,
    owner: input.ref.owner,
    repo: input.ref.repo,
    refUsed: input.refUsed,
    commit: input.commit,
    dirInRepo: input.dirInRepo,
  }
  if (input.useCache !== false) {
    const hit = await getCachedCompat('repo', id, source, revisionKey, fingerprintEnv(env))
    if (hit) return { ok: true, report: hit }
  }

  const md = await fetchSkillMarkdown(input.ref.owner, input.ref.repo, input.commit, input.dirInRepo)
  if (!md.ok) return { ok: false, error: md.error }

  const files: CompatFileInput[] = []
  let fetched = 0
  let totalBytes = 0
  for (const { rel: relPath, blob } of rel) {
    const fi: CompatFileInput = { path: relPath, size: blob.size }
    if (wantsContent(relPath) && fetched < INSPECT_TEXT_MAX_FILES && totalBytes < INSPECT_TEXT_MAX_TOTAL) {
      const got = await fetchRepoTextFile(input.ref.owner, input.ref.repo, input.commit, blob.path, INSPECT_TEXT_MAX_BYTES)
      if (got.ok) {
        fi.text = got.text
        fetched++
        totalBytes += got.text.length
      }
    }
    files.push(fi)
  }

  const report = buildCompatReport({
    id,
    name: id,
    dirName: id,
    skillMd: md.text,
    files,
    env,
    source,
    origin: 'repo',
    revisionKey,
    checkedAt: new Date().toISOString(),
  })
  await saveCompatReport(report)
  return { ok: true, report }
}

// ── Installed skill ──────────────────────────────────────────────────────────

export interface InstalledCompatOptions {
  probe?: boolean
  mode?: 'ro' | 'edit'
  env?: CompatEnvInput
  functional?: FunctionalTestResult
}

const LOCAL_TEXT_MAX_FILES = 16

export async function installedSkillCompat(workspaceRoot: string, rec: SkillRecord, opts: InstalledCompatOptions = {}): Promise<CompatResult> {
  const env = opts.env ?? (await buildEnvInput({ probe: opts.probe, mode: opts.mode }))
  const revisionKey = rec.integrity || `${rec.id}:${rec.updatedAt}`
  const envFp = fingerprintEnv(env)
  const cacheKey = compatCacheKey('installed', rec.id, rec.source, revisionKey)
  let functional = opts.functional
  if (functional) await saveCompatTest(cacheKey, envFp, functional)
  else functional = (await getStoredCompatTest(cacheKey, envFp)) ?? undefined

  const md = await readSkillInstructions(workspaceRoot, rec.id)
  if (!md.ok || typeof md.text !== 'string') {
    return { ok: false, error: md.error ?? 'SKILL.md could not be read.' }
  }

  const files: CompatFileInput[] = []
  let read = 0
  for (const f of rec.files) {
    const fi: CompatFileInput = { path: f.path, size: f.size }
    if (f.path !== 'SKILL.md' && wantsContent(f.path) && read < LOCAL_TEXT_MAX_FILES) {
      const got = await readSkillResource(workspaceRoot, rec.id, f.path)
      if (got.ok && typeof got.text === 'string') {
        fi.text = got.text
        read++
      }
    }
    files.push(fi)
  }

  const report = buildCompatReport({
    id: rec.id,
    name: rec.name || rec.id,
    dirName: rec.id,
    skillMd: md.text,
    files,
    env,
    source: rec.source.kind === 'github' ? { ...rec.source, license: rec.license } : { kind: 'local', license: rec.license },
    origin: 'installed',
    revisionKey,
    functional,
    checkedAt: new Date().toISOString(),
  })
  await saveCompatReport(report)
  return { ok: true, report }
}

/** Deterministic bulk audit of the installed library — no model calls at all. */
export async function bulkInstalledCompat(workspaceRoot: string, registry: SkillsRegistry, opts: InstalledCompatOptions = {}): Promise<CompatReport[]> {
  const env = opts.env ?? (await buildEnvInput({ probe: opts.probe, mode: opts.mode }))
  const out: CompatReport[] = []
  for (const rec of registry.skills) {
    const res = await installedSkillCompat(workspaceRoot, rec, { env })
    if (res.ok) out.push(res.report)
    else out.push(brokenReport(rec, env, res.error))
  }
  return out
}

function brokenReport(rec: SkillRecord, env: CompatEnvInput, error: string): CompatReport {
  return buildCompatReport({
    id: rec.id,
    name: rec.name || rec.id,
    dirName: rec.id,
    skillMd: '---\nname: ' + rec.id + '\ndescription: unavailable\n---\n',
    files: rec.files,
    env,
    source: rec.source.kind === 'github' ? rec.source : { kind: 'local' },
    origin: 'installed',
    revisionKey: `${rec.id}:missing`,
    checkedAt: new Date().toISOString(),
    functional: { status: 'blocked', steps: [{ step: 'read SKILL.md', ok: false, detail: error }], limitations: [error] },
  })
}

// ── Controlled functional test (uses the real local model) ───────────────────

interface Fixture {
  name: string
  task: string
  content: string
}

function pickFixture(rec: SkillRecord, body: string): Fixture {
  const text = `${rec.name} ${rec.description} ${rec.category} ${body}`.toLowerCase()
  if (/\bhumanizer\b/.test(text)) {
    return {
      name: 'sample.md',
      task: 'Rewrite this customer-service update so it sounds natural and concise. Preserve all facts and commitments.',
      content: 'Please be advised that your request has been received and will be processed in due course. We are thrilled to let you know that our team is currently looking into the matter. We will get back to you as soon as possible.\n',
    }
  }
  if (/\bturkish\b|\bdeasciifier\b/.test(text)) {
    return {
      name: 'sample.txt',
      task: 'Restore only clear Turkish diacritics in this ASCII-written Turkish text.',
      content: 'Merhaba nasilsin? Bugun gorusuruz.\n',
    }
  }
  if (/\bcsv\b|spreadsheet|tabular|dataset/.test(text)) {
    return {
      name: 'sample.csv',
      task: 'Explain what this table contains and point out one concrete observation.',
      content: 'region,units,month\nnorth,120,jan\nsouth,80,jan\nnorth,140,feb\nsouth,95,feb\n',
    }
  }
  if (/\breview|refactor|lint|bug|typescript|javascript\b/.test(text)) {
    return {
      name: 'sample.ts',
      task: 'Review this file and list any concrete problems or improvements.',
      content: 'export function divide(a: number, b: number): number {\n  return a / b\n}\n',
    }
  }
  if (/\bpython\b/.test(text)) {
    return {
      name: 'sample.py',
      task: 'Review this snippet and describe what it does and any issue you see.',
      content: 'def read(path):\n    f = open(path)\n    return f.read()\n',
    }
  }
  return {
    name: 'sample.md',
    task: 'Summarize this document in three short bullet points.',
    content: '# Quarterly update\n\n- The team shipped the reporting dashboard.\n- Two latency regressions were resolved.\n- Next quarter focuses on export formats and accessibility.\n',
  }
}

const FUNCTIONAL_TIMEOUT_MS = 90_000

/** Run a small representative task through the real skill-loading + model path. */
export async function functionalTestSkill(workspaceRoot: string, rec: SkillRecord): Promise<FunctionalTestResult> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  const steps: FunctionalTestStep[] = []
  const limitations: string[] = [
    'Tools are validated statically; this test confirms instruction loading and a model reply, not tool execution.',
    'A single non-streaming completion is used for a small fixture — not a full multi-step session.',
  ]

  const md = await readSkillInstructions(workspaceRoot, rec.id)
  if (!md.ok || typeof md.text !== 'string') {
    steps.push({ step: 'Skill discovered + instructions loaded', ok: false, detail: md.error ?? 'SKILL.md unreadable' })
    return { status: 'blocked', steps, limitations, error: md.error ?? 'SKILL.md unreadable', startedAt, durationMs: Date.now() - t0 }
  }
  steps.push({ step: 'Skill discovered + instructions loaded', ok: true, detail: `${md.text.length} chars` })

  const models = await detectRuntimeModels().catch(() => null)
  const loaded = models?.loaded?.[0]
  if (!loaded) {
    steps.push({ step: 'Local model available', ok: false, detail: `No loaded chat model (status: ${models?.status ?? 'unreachable'}).` })
    return { status: 'blocked', steps, limitations, error: 'No loaded local chat model was detected — start LM Studio/Ollama and load a model, then retry.', startedAt, durationMs: Date.now() - t0 }
  }
  let target
  try {
    target = await resolveTarget(loaded.id, [])
  } catch (err) {
    steps.push({ step: 'Local model available', ok: false, detail: err instanceof Error ? err.message : 'resolveTarget failed' })
    return { status: 'blocked', steps, limitations, error: 'The local provider could not be resolved.', startedAt, durationMs: Date.now() - t0 }
  }
  steps.push({ step: 'Local model available', ok: true, detail: describeTarget(target) })

  const skill: ActiveSkillInstruction = {
    id: rec.id,
    name: rec.name || rec.id,
    instructions: md.text,
    reason: 'controlled compatibility test',
    sourceRepo: rec.source.repoUrl ?? '',
    sourceCommit: rec.source.commit ?? '',
    truncated: md.truncated === true,
  }
  const fixture = pickFixture(rec, md.text)
  const fixtureDir = path.join(os.tmpdir(), 'agenthub-compat-fixtures', `${rec.id}-${Date.now()}`)
  let prompt: string
  try {
    await fs.mkdir(fixtureDir, { recursive: true })
    await fs.writeFile(path.join(fixtureDir, fixture.name), fixture.content, 'utf-8')
    steps.push({ step: 'Disposable fixture created', ok: true, detail: `${fixture.name} in the OS temp dir (deleted after the test)` })
    const skillBlock = buildSkillsPrompt([skill], [])
    prompt =
      `${skillBlock}\n\n---\n\nControlled compatibility test. Using ONLY the guidance above, complete the task on the fixture and reply with the result.\n\n` +
      `Task: ${fixture.task}\n\n--- BEGIN FIXTURE (${fixture.name}) ---\n${fixture.content}--- END FIXTURE ---`
  } catch (err) {
    steps.push({ step: 'Disposable fixture created', ok: false, detail: err instanceof Error ? err.message : 'fixture failed' })
    return { status: 'blocked', steps, limitations, error: 'Could not create the test fixture.', startedAt, durationMs: Date.now() - t0 }
  }

  const messages: ChatTurn[] = [
    { role: 'system', content: 'You are the AgentHub compatibility test harness. Follow the skill guidance for the fixture task and return a short, concrete result.' },
    { role: 'user', content: prompt },
  ]

  let usage: FunctionalTestResult['usage']
  let reply = ''
  try {
    reply = await Promise.race([
      callLLM(target, messages, { maxTokens: 700, onUsage: (u) => (usage = u) }),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('The model did not answer within 90 seconds.')), FUNCTIONAL_TIMEOUT_MS)),
    ])
  } catch (err) {
    steps.push({ step: 'Task sent to the configured local model', ok: false, detail: err instanceof Error ? err.message : 'model call failed' })
    await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {})
    return { status: 'failed', steps, limitations, error: err instanceof Error ? err.message : 'model call failed', startedAt, durationMs: Date.now() - t0 }
  } finally {
    await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {})
  }
  steps.push({ step: 'Task sent to the configured local model', ok: true, detail: describeTarget(target) })

  const ok = reply.trim().length >= 5
  steps.push({ step: 'Task result produced', ok, detail: `${reply.trim().length} chars returned` })

  return {
    status: ok ? 'passed' : 'failed',
    model: { id: loaded.id, label: loaded.id, provider: loaded.providerName },
    provider: loaded.providerName,
    startedAt,
    durationMs: Date.now() - t0,
    outputExcerpt: reply.trim().slice(0, 1200),
    outputChars: reply.trim().length,
    usage,
    steps,
    limitations,
    ...(ok ? {} : { error: 'The model returned an empty result.' }),
  }
}
