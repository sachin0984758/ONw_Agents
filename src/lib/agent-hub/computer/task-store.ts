import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from '../db-path'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import type { AutoEvent, AutoPhase, AutoTask, ComputerScope } from './protocol'

const TASKS_FILE = path.join(DB_DIR, 'computer-tasks.json')
const MAX_TASKS = 30
const MAX_EVENTS = 100
const MAX_REQUEST = 8000
const MAX_RESULT = 16000
const MAX_EVENT_OUTPUT = 16000
const phases = new Set<AutoPhase>(['idle', 'planned', 'observing', 'planning', 'validating', 'acting', 'verifying', 'recovery', 'paused', 'waiting', 'completed', 'partial', 'failed', 'cancelled'])
const interruptedPhases = new Set<AutoPhase>(['idle', 'observing', 'planning', 'validating', 'acting', 'verifying', 'recovery', 'paused', 'waiting'])
const serialize = createSerializer()

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback
}

function cleanScope(value: unknown): ComputerScope | undefined {
  if (!record(value) || !Array.isArray(value.applications) || !Array.isArray(value.domains) || typeof value.readonly !== 'boolean') return undefined
  const workspaceAccess = value.workspaceAccess === 'none' || value.workspaceAccess === 'read' || value.workspaceAccess === 'write' ? value.workspaceAccess : undefined
  const pointerProfile = value.pointerProfile === 'fast' || value.pointerProfile === 'normal' || value.pointerProfile === 'demonstration' ? value.pointerProfile : undefined
  return {
    approvalMode: value.approvalMode === 'when-needed' || value.approvalMode === 'full' ? value.approvalMode : 'always-ask',
    applications: value.applications.filter((item): item is string => typeof item === 'string').slice(0, 5).map((item) => item.slice(0, 100)),
    domains: value.domains.filter((item): item is string => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 253)),
    readonly: value.readonly,
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId.slice(0, 100) } : {}),
    ...(workspaceAccess ? { workspaceAccess } : {}),
    ...(typeof value.internet === 'boolean' ? { internet: value.internet } : {}),
    ...(pointerProfile ? { pointerProfile } : {}),
    ...(typeof value.screenshots === 'boolean' ? { screenshots: value.screenshots } : {}),
  }
}

function cleanEvent(value: unknown): AutoEvent | undefined {
  if (!record(value) || typeof value.id !== 'string' || typeof value.action !== 'string' || !phases.has(value.phase as AutoPhase) || typeof value.startedAt !== 'string' || typeof value.output !== 'string') return undefined
  return {
    id: value.id.slice(0, 100),
    action: value.action.slice(0, 160),
    phase: value.phase as AutoPhase,
    startedAt: value.startedAt.slice(0, 40),
    ...(typeof value.finishedAt === 'string' ? { finishedAt: value.finishedAt.slice(0, 40) } : {}),
    ...(typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) ? { durationMs: Math.max(0, value.durationMs) } : {}),
    ...(typeof value.ok === 'boolean' ? { ok: value.ok } : {}),
    ...(typeof value.verified === 'boolean' ? { verified: value.verified } : {}),
    ...(typeof value.target === 'string' ? { target: value.target.slice(0, 1000) } : {}),
    output: value.output.slice(0, MAX_EVENT_OUTPUT),
  }
}

function cleanTask(value: unknown): AutoTask | undefined {
  if (!record(value) || typeof value.id !== 'string' || !value.id || typeof value.title !== 'string' || typeof value.request !== 'string' || !phases.has(value.phase as AutoPhase) || !['fast', 'balanced', 'careful'].includes(String(value.profile)) || typeof value.model !== 'string' || typeof value.visionModel !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' || !Array.isArray(value.events) || !Array.isArray(value.plan) || typeof value.result !== 'string' || typeof value.modelCalls !== 'number' || typeof value.modelMs !== 'number') return undefined
  const scope = cleanScope(value.scope)
  if (!scope) return undefined
  return {
    id: value.id.slice(0, 100),
    title: boundedString(value.title, 300),
    request: boundedString(value.request, MAX_REQUEST),
    phase: value.phase as AutoPhase,
    profile: value.profile as AutoTask['profile'],
    model: boundedString(value.model, 300),
    ...(typeof value.modelLabel === 'string' ? { modelLabel: boundedString(value.modelLabel, 300) } : {}),
    visionModel: boundedString(value.visionModel, 300),
    ...(typeof value.currentApplication === 'string' ? { currentApplication: boundedString(value.currentApplication, 500) } : {}),
    scope,
    events: value.events.map(cleanEvent).filter((event): event is AutoEvent => Boolean(event)).slice(-MAX_EVENTS),
    plan: value.plan.filter((item): item is string => typeof item === 'string').slice(0, 100).map((item) => item.slice(0, 2000)),
    result: boundedString(value.result, MAX_RESULT),
    createdAt: value.createdAt.slice(0, 40),
    updatedAt: value.updatedAt.slice(0, 40),
    modelCalls: Number.isFinite(value.modelCalls) ? Math.max(0, Math.floor(value.modelCalls)) : 0,
    modelMs: Number.isFinite(value.modelMs) ? Math.max(0, value.modelMs) : 0,
    ...(typeof value.permissionRequired === 'boolean' ? { permissionRequired: value.permissionRequired } : {}),
    // approval and screenshot are deliberately never accepted from disk.
  }
}

function recoverInterruptedTasks(tasks: AutoTask[]): { tasks: AutoTask[]; recovered: boolean } {
  let recovered = false
  const now = new Date().toISOString()
  const result = tasks.map((task) => {
    if (!interruptedPhases.has(task.phase)) return task
    recovered = true
    const message = 'AgentHub restarted before this task finished. Desktop permissions and pending approvals were discarded; no actions were resumed.'
    const recovery: AutoEvent = { id: crypto.randomUUID(), action: 'restart_recovery', phase: 'partial', startedAt: now, finishedAt: now, ok: false, verified: false, output: message }
    return { ...task, phase: 'partial' as const, result: `${task.result ? `${task.result.slice(0, MAX_RESULT - message.length - 2)}\n\n` : ''}${message}`, updatedAt: now, events: [...task.events, recovery].slice(-MAX_EVENTS) }
  })
  return { tasks: result, recovered }
}

export async function loadAutoTaskHistory(): Promise<{ tasks: AutoTask[]; recovered: boolean; writable: boolean; warning?: string }> {
  let value: unknown
  try {
    value = JSON.parse(await fs.readFile(TASKS_FILE, 'utf8'))
  } catch (error) {
    if (record(error) && error.code === 'ENOENT') return { tasks: [], recovered: false, writable: true }
    return { tasks: [], recovered: false, writable: false, warning: 'Auto task history could not be read and was left untouched.' }
  }
  if (!record(value) || value.version !== 1 || !Array.isArray(value.tasks)) return { tasks: [], recovered: false, writable: false, warning: 'Auto task history has an unsupported format and was left untouched.' }
  const cleaned = value.tasks.map(cleanTask)
  const writable = cleaned.every(Boolean)
  const capped = cleaned.filter((task): task is AutoTask => Boolean(task)).slice(0, MAX_TASKS)
  const restored = recoverInterruptedTasks(capped)
  return {
    ...restored,
    writable,
    ...(!writable ? { warning: 'Some Auto task history entries were invalid; the original file was left untouched.' } : {}),
  }
}

export async function saveAutoTaskHistory(tasks: AutoTask[]): Promise<void> {
  await serialize(async () => {
    const cleaned = tasks.map(cleanTask).filter((task): task is AutoTask => Boolean(task)).slice(0, MAX_TASKS)
    await writeJsonAtomic(TASKS_FILE, { version: 1, tasks: cleaned })
  })
}
