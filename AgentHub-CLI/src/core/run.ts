import type { AgentConfig } from '../config/types.ts'
import type { ResolvedTarget } from '../providers/registry.ts'
import { ProviderError, isAbortError, type ChatMessage, type TokenUsage, type ToolCall } from '../providers/types.ts'
import type { ApprovalBroker } from '../policy/engine.ts'
import { PolicyEngine } from '../policy/engine.ts'
import { createAuthorizer } from './authorize.ts'
import { AuditTrail } from './audit.ts'
import { awaitWithSignal } from './cancellation.ts'
import { BackupStore } from './backups.ts'
import { PlanState } from './plan.ts'
import { RunLedger } from './ledger.ts'
import type { RunResult, RunStatus, EventSink, CommandEvidence, ChangedFileEvidence } from './events.ts'
import type { SkillIndex } from '../skills/discover.ts'
import type { RepoContext } from '../context/repo.ts'
import { buildSystemPrompt } from '../context/prompt.ts'
import { MemoryStore, retrieveMemory } from '../context/memory.ts'
import { ActionJournal } from './journal.ts'
import { CapabilityRegistry } from '../providers/capabilities.ts'
import { mapBounded, PARALLEL_READ_TOOLS } from './scheduler.ts'
import { verifyChanges } from './verify.ts'
import { trimMessages } from '../context/budget.ts'
import { findTool, toolSchemas } from '../tools/index.ts'
import type { SubagentOptions, ToolContext, ToolResult } from '../tools/types.ts'
import { ToolInputError } from '../tools/types.ts'
import { redactSecrets } from '../utils/redact.ts'
import { estimateMessagesTokens, estimateTokens } from '../utils/token.ts'
import type { SessionStore, StoredSession } from '../sessions/store.ts'

export interface RunOptions {
  task: string
  config: AgentConfig
  target: ResolvedTarget
  session: StoredSession
  store: SessionStore
  skills: SkillIndex
  repo: RepoContext
  events: EventSink
  broker: ApprovalBroker
  signal: AbortSignal
  resumed?: boolean
  /** Zero for the primary agent. Children may not spawn unbounded descendants. */
  depth?: number
  orchestration?: { started: number; active: number }
  role?: SubagentOptions['role']
}

const MAX_TOOL_RESULT_CHARS = 120_000
const MAX_EVENT_CHARS = 12_000
const MAX_TOOL_MS = 10 * 60_000
const EXPLICIT_ACTION_REQUEST = /^\s*(?:(?:please|can you|could you|would you|i need you to|i want you to)\s+)*(?:read|open|inspect|check|review|write|edit|modify|change|update|create|delete|remove|rename|move|copy|search|find|list|run|execute|build|test|install|implement|fix|refactor|stage|commit|undo|invoke|call)\b/i

function eventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function capText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const head = text.slice(0, Math.floor(maxChars * 0.6))
  const tail = text.slice(Math.max(head.length, text.length - Math.floor(maxChars * 0.3)))
  return { text: `${head}\n\n… truncated (${text.length} chars) …\n\n${tail}`, truncated: true }
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  let text = raw.trim()
  if (!text) return {}
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(text)
  if (fenced && fenced[1]) text = fenced[1].trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ToolInputError(`Tool arguments are not valid JSON: ${(err as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolInputError('Tool arguments must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function unexecutedToolResponseName(task: string, text: string): string | undefined {
  if (!EXPLICIT_ACTION_REQUEST.test(task)) return undefined
  let value: Record<string, unknown>
  try {
    value = parseToolArguments(text)
  } catch {
    return undefined
  }
  if (Object.keys(value).some((key) => key !== 'name' && key !== 'arguments')) return undefined
  const name = value.name
  const args = value.arguments
  if (
    typeof name !== 'string' || !findTool(name) ||
    !args || typeof args !== 'object' || Array.isArray(args)
  ) return undefined
  return name
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (key === 'content' && typeof value === 'string') {
      out[key] = `[${value.length} chars]`
    } else if ((key === 'new_text' || key === 'old_text') && typeof value === 'string') {
      out[key] = value.length > 160 ? `${value.slice(0, 160)}… [${value.length} chars]` : value
    } else if (typeof value === 'string' && value.length > 400) {
      out[key] = `${value.slice(0, 400)}…`
    } else {
      out[key] = value
    }
  }
  return out
}

function safeEventArgs(raw: string): Record<string, unknown> {
  try {
    return summarizeArgs(parseToolArguments(raw))
  } catch {
    return { _raw: raw.slice(0, 400) }
  }
}

export function raceAbort<T>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled.'))
      return
    }
    const controller = new AbortController()
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const timer = setTimeout(() => {
      controller.abort(new Error('Tool runtime limit exceeded.'))
      finish(() => reject(new Error(`Tool exceeded the ${Math.round(timeoutMs / 1000)}s runtime limit.`)))
    }, timeoutMs)
    const onAbort = () => {
      controller.abort(signal.reason)
      finish(() => reject(new Error('Cancelled.')))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve().then(() => operation(controller.signal)).then(
      (value) => {
        finish(() => resolve(value))
      },
      (err) => {
        finish(() => reject(err))
      },
    )
  })
}

function toolMessageBody(result: ToolResult): string {
  const text = result.ok
    ? result.content
    : `ERROR: ${result.error ?? 'The tool failed.'}${result.content ? `\n${result.content}` : ''}`
  return capText(text, MAX_TOOL_RESULT_CHARS).text
}

/**
 * Every assistant tool call must be followed by a tool result, otherwise a
 * resumed conversation is invalid. Cancellation can interrupt a batch, so add
 * explicit placeholders for calls that never ran.
 */
export function repairToolPairing(messages: ChatMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (!message || message.role !== 'assistant' || !message.tool_calls?.length) continue
    const answered = new Set<string>()
    let j = i + 1
    while (j < messages.length && messages[j]?.role === 'tool') {
      const id = messages[j]?.tool_call_id
      if (id) answered.add(id)
      j++
    }
    for (const call of message.tool_calls) {
      if (answered.has(call.id)) continue
      messages.splice(j, 0, {
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: 'ERROR: This tool call did not run (the run was cancelled or interrupted). Check the workspace before retrying.',
      })
      j++
    }
  }
}

export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const budget = new AbortController()
  const timeout = setTimeout(() => budget.abort(new Error('Run wall-clock budget exhausted.')), opts.config.maxWallClockMs)
  const signal = AbortSignal.any([opts.signal, budget.signal])
  try {
    return await runWithinBudget({ ...opts, signal }, budget.signal)
  } finally {
    clearTimeout(timeout)
  }
}

async function runWithinBudget(opts: RunOptions, budgetSignal: AbortSignal): Promise<RunResult> {
  const { config, target, session, store, skills, repo, broker, signal } = opts
  const depth = opts.depth ?? 0
  const orchestration = opts.orchestration ?? { started: 0, active: 0 }
  const journal = new ActionJournal(config, session.id)
  const capabilityRegistry = new CapabilityRegistry(config.home)
  const runId = eventId('run')
  const audit = new AuditTrail(runId, config.workspace, session.audit)
  const events: EventSink = (event) => {
    audit.recordRuntime(event)
    opts.events(event)
  }
  const started = Date.now()
  const startedAt = new Date().toISOString()
  const policy = new PolicyEngine(config)
  const backups = new BackupStore(config)
  const authorize = createAuthorizer(policy, broker, events, signal, audit)
  const plan = new PlanState(opts.resumed ? session.plan : [])
  const ledger = new RunLedger()
  const activeSkills = new Set(session.activeSkills)
  const usageBeforeRun = { input: session.usage.input ?? 0, output: session.usage.output ?? 0 }

  let managedProvider = false
  try {
    const providerUrl = new URL(target.providerConfig.baseUrl)
    const host = providerUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    managedProvider = ['http:', 'https:'].includes(providerUrl.protocol) && ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host)
  } catch {
    managedProvider = false
  }

  events({
    type: 'run_started',
    runId,
    sessionId: session.id,
    task: opts.task,
    workspace: config.workspace,
    provider: target.providerConfig.id,
    model: target.model,
    permission: config.permissionMode,
    startedAt,
  })

  if (opts.resumed && plan.steps.length > 0) {
    // Restore the visible plan without replaying any tool call. The plan is
    // context for the next turn; it is not evidence that earlier work finished.
    events({ type: 'plan', steps: plan.snapshot() })
  }

  const prior = session.messages.filter((m) => m.role !== 'system')
  const userMessage: ChatMessage = { role: 'user', content: opts.task }
  const conversation: ChatMessage[] = [...prior, userMessage]
  session.messages = [...prior, userMessage]

  const system: ChatMessage = {
    role: 'system',
    content: buildSystemPrompt({
      config,
      repo: { ...repo, memory: await retrieveMemory(config, opts.task).catch((err: Error) => {
        events({ type: 'warning', message: `Memory retrieval failed: ${redactSecrets(err.message)}` })
        return []
      }) },
      skills,
      activeSkills,
      resumed: opts.resumed,
    }) + (opts.role ? `\nAssigned responsibility: ${opts.role}. ${opts.role === 'reviewer' ? 'Review logic, security, performance, validation, side effects and maintainability. Separate confirmed issues from concerns; cite file and evidence. Do not approve changes merely because another agent generated them.' : 'Focus on this responsibility within the assigned task.'}` : ''),
  }

  const messages: ChatMessage[] = [system, ...conversation]
  let steps = 0
  let toolCallsExecuted = 0
  let status: RunStatus = 'partial'
  let finalText = ''
  let lastAssistantText = ''
  let fatalError: string | undefined
  let persistenceError: string | undefined
  let stoppedForLoop = false
  let contextTrimmed = false
  let denials = 0
  let toolErrors = 0
  let providerReported = false
  let usageEstimated = false
  let reportedInput = 0
  let reportedOutput = 0
  let estimatedInput = 0
  let estimatedOutput = 0
  const limitations: string[] = []
  const failures = new Map<string, number>()
  const maxToolCalls = Math.min(100, Math.max(20, config.maxSteps * 6))
  const schemas = toolSchemas()
  const modelContext = target.models.find((model) => model.id === target.model)?.contextLength
  const contextLimit = typeof modelContext === 'number' && Number.isFinite(modelContext) && modelContext > 0
    ? Math.min(config.contextTokens, modelContext) : config.contextTokens
  // Tool definitions also consume context. Reserve room for the response and
  // framing before trimming messages; never remove protected instructions.
  const messageBudget = Math.max(1, contextLimit - estimateTokens(JSON.stringify(schemas)) - Math.min(1024, Math.floor(contextLimit / 4)) - 64)
  const deadline = started + config.maxWallClockMs
  const interrupt = (): 'partial' | 'cancelled' => {
    if (budgetSignal.aborted && signal.reason === budgetSignal.reason) {
      limitations.push(`Wall-clock budget (${Math.round(config.maxWallClockMs / 1000)}s) was exhausted.`)
      return 'partial'
    }
    return 'cancelled'
  }

  if (!managedProvider) {
    limitations.push(
      `Project content was sent to a non-local endpoint (${target.providerConfig.baseUrl}). This was explicitly selected.`,
    )
  }

  const spawnSubagent = async (sub: SubagentOptions): Promise<RunResult> => {
    const label = sub.label || 'subagent'
    if (target.models.find((m) => m.id === target.model)?.capabilities?.tools?.supported === false || depth >= 2 || orchestration.started >= (config.maxAgents ?? 4) || orchestration.active >= (config.agentConcurrency ?? 1)) {
      const error = 'Subagent nesting, concurrency or total-agent limit reached. No child task was started.'
      events({ type: 'subagent_completed', id: eventId('sub'), label, status: 'failed', text: error, changedFiles: [], commands: [], durationMs: 0 })
      return {
        runId: eventId('run'),
        sessionId: session.id,
        status: 'failed',
        text: '',
        changedFiles: [],
        commands: [],
        usage: { input: 0, output: 0 },
        usageEstimated: true,
        durationMs: 0,
        steps: 0,
        limitations: [error],
        error,
      }
    }
    const childId = eventId('sub')
    const requested = sub.maxSteps ?? 6
    const childSteps = Math.max(1, Math.min(requested, config.maxSteps, 8))
    const remainingWallClockMs = Math.max(1000, config.maxWallClockMs - (Date.now() - started))
    const childConfig: AgentConfig = {
      ...config,
      maxSteps: childSteps,
      maxWallClockMs: Math.min(config.maxWallClockMs, remainingWallClockMs, 5 * 60_000),
      contextTokens: Math.min(config.contextTokens, 12_000),
      ...(sub.role && sub.role !== 'coder' ? { permissionMode: 'read-only' as const, autoApprove: false, verification: false } : {}),
    }
    const childSession = store.create({
      task: sub.task,
      workspace: config.workspace,
      provider: target.providerConfig.id,
      model: target.model,
      permissionMode: config.permissionMode,
    })
    events({ type: 'subagent_started', id: childId, label, task: sub.task.slice(0, 1000), maxSteps: childSteps })
    const childSink: EventSink = (event) => {
      switch (event.type) {
        case 'tool_proposed':
          events({ type: 'subagent_progress', id: childId, message: `tool ${event.name}` })
          break
        case 'tool_result':
          events({ type: 'subagent_progress', id: childId, message: `${event.name} finished in ${(event.durationMs / 1000).toFixed(2)}s` })
          break
        case 'tool_error':
          events({ type: 'subagent_progress', id: childId, message: `${event.name} failed: ${redactSecrets(event.error).slice(0, 300)}` })
          break
        case 'warning':
          events({ type: 'subagent_progress', id: childId, message: `warning: ${redactSecrets(event.message).slice(0, 300)}` })
          break
        case 'error':
          events({ type: 'subagent_progress', id: childId, message: `error: ${redactSecrets(event.message).slice(0, 300)}` })
          break
        case 'subagent_started':
          events({ type: 'subagent_progress', id: childId, message: `child ${event.label} started` })
          break
        case 'subagent_completed':
          events({ type: 'subagent_progress', id: childId, message: `child ${event.label}: ${event.status}` })
          break
        default:
          break
      }
    }
    orchestration.started++
    orchestration.active++
    try {
      const result = await runAgent({
        task: sub.task,
        role: sub.role,
        config: childConfig,
        target,
        session: childSession,
        store,
        skills,
        repo,
        events: childSink,
        broker,
        signal: sub.signal ? AbortSignal.any([signal, sub.signal]) : signal,
        resumed: false,
        depth: depth + 1,
        orchestration,
      })
      events({
        type: 'subagent_completed',
        id: childId,
        label,
        status: result.status,
        text: redactSecrets(result.text).slice(0, 12_000),
        changedFiles: result.changedFiles,
        commands: result.commands,
        durationMs: result.durationMs,
      })
      return result
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      events({ type: 'subagent_completed', id: childId, label, status: 'failed', text: '', changedFiles: [], commands: [], durationMs: 0 })
      return {
        runId: eventId('run'),
        sessionId: childSession.id,
        status: 'failed',
        text: '',
        changedFiles: [],
        commands: [],
        usage: { input: 0, output: 0 },
        usageEstimated: true,
        durationMs: 0,
        steps: 0,
        limitations: [error],
        error,
      }
    } finally {
      orchestration.active--
    }
  }

  const toolCtx: ToolContext = {
    runId,
    workspace: config.workspace,
    config,
    authorize,
    events,
    signal,
    backups,
    skills,
    plan,
    ledger,
    activeSkills,
    spawnSubagent,
  }

  const persist = async (): Promise<void> => {
    session.messages = messages.filter((m) => m.role !== 'system')
    session.activeSkills = [...activeSkills]
    session.ledger = {
      changedFiles: ledger.changedFiles(),
      commands: ledger.commands(),
      tests: ledger.tests(),
    }
    session.plan = plan.stored()
    session.audit = audit.snapshot()
    session.status = status
    session.provider = target.providerConfig.id
    session.model = target.model
    session.permissionMode = config.permissionMode
    session.usage = {
      input: usageBeforeRun.input + reportedInput + estimatedInput,
      output: usageBeforeRun.output + reportedOutput + estimatedOutput,
    }
    try {
      await store.save(session)
      persistenceError = undefined
    } catch (err) {
      persistenceError = err instanceof Error ? redactSecrets(err.message) : redactSecrets(String(err))
      events({ type: 'warning', message: `Could not save the session: ${persistenceError}` })
    }
  }

  const accountUsage = (sent: ChatMessage[], response: { content: string; toolCalls: ToolCall[]; usage: TokenUsage | null }): void => {
    if (response.usage) {
      providerReported = true
      if (response.usage.input !== null) reportedInput += response.usage.input
      if (response.usage.output !== null) reportedOutput += response.usage.output
      if (response.usage.input === null || response.usage.output === null) {
        usageEstimated = true
        if (response.usage.input === null) estimatedInput += estimateMessagesTokens(sent)
        if (response.usage.output === null) {
          estimatedOutput += estimateTokens(response.content) + estimateTokens(JSON.stringify(response.toolCalls))
        }
      }
    } else {
      usageEstimated = true
      estimatedInput += estimateMessagesTokens(sent)
      estimatedOutput += estimateTokens(response.content) + estimateTokens(JSON.stringify(response.toolCalls))
    }
    events({
      type: 'usage',
      input: response.usage?.input ?? null,
      output: response.usage?.output ?? null,
      estimated: !response.usage || response.usage.input === null || response.usage.output === null,
      totalInput: reportedInput + estimatedInput,
      totalOutput: reportedOutput + estimatedOutput,
    })
  }

  try {
    const recovery = await journal.recover()
    if (recovery.observedApplied || recovery.unresolved.length) {
      const detail = `Recovery: ${recovery.observedApplied} interrupted write(s) match intended bytes; ${recovery.unresolved.length} action(s) have unknown outcomes. Nothing was replayed. ${recovery.unresolved.join(', ')}`
      events({ type: 'warning', message: detail })
      messages.push({ role: 'user', content: detail })
      if (recovery.unresolved.length) limitations.push(detail)
    }
    if (config.memory && config.memoryAutoExtract && depth === 0) {
      if (opts.task.split(/\r?\n/).some((line) => /^remember\s+(preference|fact|decision|history):\s*.{1,500}$/i.test(line.trim()))) {
        const permission = await authorize({ kind: 'memory.write', scope: 'project' }, 'memory_extract', 'Store only explicitly labelled user facts in project memory.')
        if (permission.ok) {
          signal.throwIfAborted()
          const extracted = await new MemoryStore(config).extract(opts.task)
          events({ type: 'warning', message: `Stored ${extracted.length} explicitly requested project memory fact(s); inspect with /memory.` })
          system.content += '\nThe runtime has already stored this request in project memory. Acknowledge it; do not create duplicate memory files or repeat the write using another tool.'
        } else {
          denials++
          events({ type: 'warning', message: `Memory extraction denied: ${permission.reason}` })
          system.content += '\nThe runtime denied memory storage under the current permission policy. Explain the denial; do not retry it with another tool.'
        }
      }
    }
    for (let step = 0; step < config.maxSteps; step++) {
      if (signal.aborted) {
        status = interrupt()
        break
      }
      if (Date.now() > deadline) {
        limitations.push(`Wall-clock budget (${Math.round(config.maxWallClockMs / 1000)}s) was exhausted.`)
        status = 'partial'
        break
      }
      if (toolCallsExecuted >= maxToolCalls) {
        limitations.push(`Tool-call budget (${maxToolCalls}) was exhausted.`)
        status = 'partial'
        break
      }

      events({ type: 'status', status: 'running', detail: `step ${step + 1}/${config.maxSteps}` })
      const trimmed = trimMessages(messages, messageBudget)
      if (trimmed.overBudget) {
        limitations.push('The context budget is too small for the protected conversation, tool definitions, and response reserve. No oversized model request was sent.')
        status = 'partial'
        break
      }
      if (trimmed.evictedChars > 0 || trimmed.droppedMessages > 0) {
        contextTrimmed = true
        events({
          type: 'warning',
            message: `Context trimmed to fit the ${messageBudget}-token message budget within ${contextLimit} total tokens (${trimmed.droppedMessages} message(s) dropped).`,
        })
      }
      const sent = trimmed.messages

      let response
      let observedStreaming = false
      try {
        response = await awaitWithSignal(() => target.provider.chat({
          model: target.model,
          messages: sent,
          tools: schemas,
          signal,
          temperature: 0.2,
          onText: (delta) => { if (!signal.aborted) { observedStreaming = true; events({ type: 'assistant_delta', text: delta }) } },
        }), signal)
      } catch (err) {
        if (signal.aborted || isAbortError(err) || (err instanceof ProviderError && err.code === 'ABORTED')) {
          status = interrupt()
          break
        }
        const message = err instanceof Error ? err.message : String(err)
        const detail = err instanceof ProviderError && err.detail ? `\n${err.detail}` : ''
        fatalError = `${message}${detail}`
        events({ type: 'error', message: fatalError, fatal: true })
        status = 'failed'
        break
      }

      steps++
      try {
        if (observedStreaming && response.streamed === true) await capabilityRegistry.observe(target.providerConfig, target.model, 'streaming', true)
        if (response.toolCalls.length && response.finishReason !== 'length' && response.toolCalls.every((call) => {
          try { return !!findTool(call.function.name) && !!parseToolArguments(call.function.arguments) } catch { return false }
        })) await capabilityRegistry.observe(target.providerConfig, target.model, 'tools', true)
      } catch (err) { events({ type: 'warning', message: `Capability observation could not be saved: ${redactSecrets((err as Error).message)}` }) }
      accountUsage(sent, response)

      if (response.content.trim()) {
        lastAssistantText = response.content
        events({ type: 'assistant_message', text: response.content })
      }

      if (response.finishReason === 'length') {
        messages.push({ role: 'assistant', content: response.content })
        finalText = response.content.trim()
        status = 'partial'
        limitations.push('The model stopped at its token limit; the response may be incomplete. No tool calls from this truncated response were executed.')
        break
      }

      if (response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content })
        finalText = response.content.trim()
        const unexecutedTool = unexecutedToolResponseName(opts.task, response.content)
        if (unexecutedTool) {
          status = 'partial'
          limitations.push(`The model returned a tool-shaped response for ${unexecutedTool} as text; no tool was executed.`)
        } else {
          status = 'completed'
        }
        break
      }

      messages.push({
        role: 'assistant',
        content: response.content || null,
        tool_calls: response.toolCalls,
      })

      // Persist the proposed batch before any action can affect the workspace.
      status = 'running'
      await persist()
      if (persistenceError) throw new Error('Cannot checkpoint proposed actions; no tools in this batch were started.')
      status = 'partial'

      let stopStep = false
      const executeCall = async (call: ToolCall): Promise<void> => {
        if (signal.aborted) {
          status = interrupt()
          stopStep = true
          return
        }
        if (toolCallsExecuted >= maxToolCalls) {
          limitations.push(`Tool-call budget (${maxToolCalls}) was exhausted.`)
          status = 'partial'
          stopStep = true
          return
        }
        toolCallsExecuted++
        const name = call.function.name
        events({
          type: 'tool_proposed',
          id: call.id,
          name,
          args: safeEventArgs(call.function.arguments),
        })
        const tool = findTool(name)
        if (!tool) {
          const error = `Unknown tool "${name}". The registry is fixed; use one of the provided tools.`
          toolErrors++
          events({ type: 'tool_error', id: call.id, name, error, durationMs: 0 })
          messages.push({ role: 'tool', tool_call_id: call.id, name, content: `ERROR: ${error}` })
          return
        }

        let args: Record<string, unknown>
        try {
          args = parseToolArguments(call.function.arguments)
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          toolErrors++
          events({ type: 'tool_error', id: call.id, name, error, durationMs: 0 })
          messages.push({ role: 'tool', tool_call_id: call.id, name, content: `ERROR: ${error}` })
          return
        }

        const signature = `${name}:${JSON.stringify(args)}`
        if ((failures.get(signature) ?? 0) >= 2) {
          const error =
            'Repeated identical failing tool call blocked by the runtime. Change the arguments or approach instead of retrying.'
          toolErrors++
          events({ type: 'tool_error', id: call.id, name, error, durationMs: 0 })
          messages.push({ role: 'tool', tool_call_id: call.id, name, content: `ERROR: ${error}` })
          limitations.push(`The model repeated a failing ${name} call; the run was stopped instead of retrying.`)
          stoppedForLoop = true
          status = 'partial'
          stopStep = true
          return
        }

        events({ type: 'tool_started', id: call.id, name })
        const t0 = Date.now()
        let result: ToolResult
        // Journal failures are fatal: never start an action without durable intent.
        await journal.start(runId, call.id, name, args)
        try {
          result = await raceAbort(
            (toolSignal) => tool.run(args, {
              ...toolCtx,
              signal: toolSignal,
              authorize: createAuthorizer(policy, broker, events, toolSignal, audit),
            }),
            signal,
            MAX_TOOL_MS,
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          result = {
            ok: false,
            content: '',
            error: err instanceof ToolInputError ? message : `Tool failed: ${message}`,
          }
        }
        const durationMs = Date.now() - t0
        await journal.finish(runId, call.id, name, result.ok)

        if (result.ok) {
          const body = capText(redactSecrets(result.content), MAX_EVENT_CHARS)
          events({
            type: 'tool_result',
            id: call.id,
            name,
            ok: true,
            content: body.text,
            durationMs,
            truncated: body.truncated || result.truncated === true,
          })
          failures.delete(signature)
        } else {
          toolErrors++
          if (/denied|not allowed|read-only|blocked by/i.test(result.error ?? '')) denials++
          events({
            type: 'tool_error',
            id: call.id,
            name,
            error: redactSecrets(result.error ?? 'Tool failed.'),
            durationMs,
          })
          failures.set(signature, (failures.get(signature) ?? 0) + 1)
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name,
          content: toolMessageBody(result),
        })
        if (signal.aborted) {
          status = interrupt()
          stopStep = true
          return
        }
      }
      for (let i = 0; i < response.toolCalls.length && !stopStep;) {
        const first = response.toolCalls[i]!
        const group = [first]
        i++
        if (PARALLEL_READ_TOOLS.has(first.function.name)) {
          while (i < response.toolCalls.length && PARALLEL_READ_TOOLS.has(response.toolCalls[i]!.function.name)) group.push(response.toolCalls[i++]!)
        }
        const offset = messages.length
        // Approval prompts remain sequential; read-only mode never opens a prompt.
        const concurrency = config.permissionMode === 'read-only' ? config.toolConcurrency ?? 1 : 1
        const settled = await Promise.allSettled([mapBounded(group, concurrency, executeCall)])
        const failure = settled.find((item) => item.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        const order = new Map(group.map((call, index) => [call.id, index]))
        const results = messages.splice(offset)
        results.sort((a, b) => (order.get(a.tool_call_id ?? '') ?? 0) - (order.get(b.tool_call_id ?? '') ?? 0))
        messages.push(...results)
      }
      if (stopStep) break
      await persist()
    }

    if (steps >= config.maxSteps && status !== 'completed' && status !== 'cancelled' && status !== 'failed') {
      limitations.push(`Step budget (${config.maxSteps}) was exhausted before a final answer.`)
    }
    if (status === 'completed' && denials > 0) {
      // A denied action means the requested work was blocked, even if the
      // model produced a polite final message afterwards.
      status = 'partial'
      limitations.push('One or more actions were denied, so the result may be incomplete.')
    }
    if (status === 'completed' && toolErrors > 0) {
      // A final assistant message is not proof that failed tool actions were
      // recovered. Report partial conservatively so a normal model response
      // cannot hide a failed read, write, command, or unknown tool call.
      status = 'partial'
      limitations.push(`${toolErrors} tool call(s) failed during the run; verify the requested work before treating it as complete.`)
    }
    if (status === 'completed' && recovery.unresolved.length > 0) status = 'partial'
    if (status === 'completed' && config.verification === true && ledger.changedFiles().length > 0) {
      const verification = await verifyChanges(toolCtx, repo, async (name, args) => {
        const id = eventId('verify')
        const tool = findTool(name)
        if (!tool) return { ok: false, content: '', error: `Missing verification tool ${name}.` }
        events({ type: 'tool_proposed', id, name, args: summarizeArgs(args) })
        await journal.start(runId, id, name, args)
        events({ type: 'tool_started', id, name })
        const started = Date.now()
        let result: ToolResult
        try { result = await raceAbort((toolSignal) => tool.run(args, { ...toolCtx, signal: toolSignal, authorize: createAuthorizer(policy, broker, events, toolSignal, audit) }), signal, MAX_TOOL_MS) }
        catch (err) { result = { ok: false, content: '', error: (err as Error).message } }
        await journal.finish(runId, id, name, result.ok)
        if (result.ok) events({ type: 'tool_result', id, name, ok: true, content: capText(redactSecrets(result.content), MAX_EVENT_CHARS).text, durationMs: Date.now() - started, truncated: result.truncated === true })
        else events({ type: 'tool_error', id, name, error: redactSecrets(result.error ?? 'Verification failed.'), durationMs: Date.now() - started })
        return result
      })
      if (!verification.ok) status = 'partial'
      limitations.push(...verification.concerns)
      messages.push({ role: 'assistant', content: `Runtime verification: ${JSON.stringify(verification)}` })
    }
    if (status === 'completed') {
      const unfinishedSteps = plan.steps.filter((step) => step.status !== 'completed').length
      if (unfinishedSteps > 0) {
        status = 'partial'
        limitations.push(`${unfinishedSteps} planned step(s) remain unfinished; complete or revise the plan before treating the result as complete.`)
      }
    }
    if (!finalText) {
      if (lastAssistantText) finalText = lastAssistantText
      else if (status === 'completed') finalText = 'The model returned an empty response.'
      else if (status === 'partial') finalText = 'The run stopped before producing a final answer.'
    }
    if (status === 'cancelled') {
      events({ type: 'run_cancelled', runId, reason: 'Cancelled by the user.' })
    }

    if (contextTrimmed) limitations.push('Older context was trimmed to stay within the configured token budget.')
    if (usageEstimated || !providerReported) {
      limitations.push('Token usage is estimated because the provider did not report it.')
    }
    if (denials > 0) limitations.push(`${denials} action(s) were denied by policy or the user.`)
    if (ledger.failingCommands().length > 0) {
      limitations.push(`${ledger.failingCommands().length} command(s) exited non-zero; see the evidence list.`)
    }
    if (ledger.changedFiles().length > 0 && ledger.tests().length === 0) {
      limitations.push('No test or check command was run after the file changes.')
    }
    if (stoppedForLoop) limitations.push('The run was stopped to avoid an unproductive retry loop.')

    const usage: TokenUsage = {
      input: reportedInput + estimatedInput,
      output: reportedOutput + estimatedOutput,
    }
    const changedFiles: ChangedFileEvidence[] = ledger.changedFiles()
    const commands: CommandEvidence[] = ledger.commands()
    const result: RunResult = {
      runId,
      sessionId: session.id,
      status: status,
      text: finalText,
      changedFiles,
      commands,
      usage,
      usageEstimated: usageEstimated || !providerReported,
      durationMs: Date.now() - started,
      steps,
      limitations: [...new Set(limitations)],
      ...(fatalError ? { error: fatalError } : {}),
    }

    session.turns += 1
    repairToolPairing(messages)
    await persist()
    if (persistenceError) {
      if (result.status === 'completed') result.status = 'partial'
      result.limitations = [...new Set([...result.limitations, `Session save failed; this run could not be safely resumed: ${persistenceError}`])]
      session.status = result.status
    }
    events({
      type: 'run_completed',
      runId,
      sessionId: session.id,
      status: result.status,
      text: result.text,
      changedFiles,
      commands,
      usage,
      durationMs: result.durationMs,
      steps,
      limitations: result.limitations,
    })
    return result
  } catch (err) {
    // A bug must never masquerade as a successful run.
    const message = err instanceof Error ? err.message : String(err)
    status = signal.aborted ? interrupt() : 'failed'
    fatalError = message
    events({ type: 'error', message, fatal: true })
    session.status = status
    await persist().catch(() => undefined)
    const result: RunResult = {
      runId,
      sessionId: session.id,
      status,
      text: lastAssistantText,
      changedFiles: ledger.changedFiles(),
      commands: ledger.commands(),
      usage: { input: reportedInput + estimatedInput, output: reportedOutput + estimatedOutput },
      usageEstimated: true,
      durationMs: Date.now() - started,
      steps,
      limitations,
      error: fatalError,
    }
    events({
      type: 'run_completed',
      runId,
      sessionId: session.id,
      status: result.status,
      text: result.text,
      changedFiles: result.changedFiles,
      commands: result.commands,
      usage: result.usage,
      durationMs: result.durationMs,
      steps,
      limitations: result.limitations,
    })
    return result
  }
}
