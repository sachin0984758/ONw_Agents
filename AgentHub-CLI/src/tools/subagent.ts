import { enumValue, optionalNumber, optionalString, requireString } from './validate.ts'
import { mapBounded } from '../core/scheduler.ts'
import type { AgentTool, ToolResult } from './types.ts'

export const runSubagentTool: AgentTool = {
  name: 'run_subagent',
  description:
    'Run a bounded, independent child agent on a self-contained subtask. The child uses the same workspace, provider and permission policy as this agent (never broader), has its own turn/step budget, can be cancelled with the parent, and records its own session. Use it for parallelizable or context-heavy subtasks, not for approvals or policy changes.',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'A self-contained task for the child. Include all context it needs.' },
      label: { type: 'string', description: 'Short label shown in progress output.' },
      max_steps: { type: 'integer', description: 'Optional child step budget (bounded by the parent and at most 8).' },
      role: { type: 'string', enum: ['planner', 'researcher', 'coder', 'reviewer', 'tester', 'debugger'], description: 'Non-coder roles are read-only. Reviewer separates confirmed findings from concerns.' },
    },
    required: ['task'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const task = requireString(input, 'task', { max: 12_000 })
    const label = optionalString(input, 'label', { max: 80 })?.trim() || 'subagent'
    const requested = optionalNumber(input, 'max_steps', { min: 1, max: 8, integer: true })
    if (!ctx.spawnSubagent) {
      return {
        ok: false,
        content: '',
        error: 'Subagents are unavailable in this runtime context. No child task was started.',
      }
    }
    const role = enumValue(input, 'role', ['planner', 'researcher', 'coder', 'reviewer', 'tester', 'debugger'] as const, 'coder')
    const result = await ctx.spawnSubagent({ task, label, role, signal: ctx.signal, ...(requested ? { maxSteps: requested } : {}) })
    for (const file of result.changedFiles) ctx.ledger.addChanged(file)
    for (const command of result.commands) ctx.ledger.addCommand(command)
    const lines = [
      `Subagent "${label}" finished with status: ${result.status}`,
      `session: ${result.sessionId} · steps: ${result.steps} · ${(result.durationMs / 1000).toFixed(2)}s`,
      '',
      result.text.trim() || '(the subagent produced no final text)',
    ]
    if (result.changedFiles.length > 0) {
      lines.push('', 'Changed files:')
      for (const file of result.changedFiles) lines.push(`- ${file.path} (${file.change})`)
    }
    if (result.commands.length > 0) {
      lines.push('', 'Commands:')
      for (const command of result.commands) lines.push(`- ${command.command} → exit ${command.exitCode ?? 'unknown'}`)
    }
    if (result.error) lines.push('', `Error: ${result.error}`)
    return {
      ok: result.status === 'completed',
      content: lines.join('\n'),
      ...(result.status === 'completed' ? {} : { error: `Subagent ended with status ${result.status}.` }),
    }
  },
}

export const runAgentsTool: AgentTool = {
  name: 'run_agents',
  description: 'Assign up to four independent READ-ONLY tasks to specialized agents. Results are aggregated in input order. Concurrency and total agents are centrally bounded. Use run_subagent for a sequential coding task.',
  parameters: {
    type: 'object', properties: { tasks: { type: 'array', maxItems: 4, items: { type: 'object', properties: {
      task: { type: 'string' }, role: { type: 'string', enum: ['planner', 'researcher', 'reviewer', 'tester', 'debugger'] },
    }, required: ['task', 'role'], additionalProperties: false } } }, required: ['tasks'], additionalProperties: false,
  },
  async run(input, ctx) {
    if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 4 || !ctx.spawnSubagent) return { ok: false, content: '', error: 'Supply 1-4 tasks in a runtime supporting child agents.' }
    const tasks = input.tasks.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid child task.')
      const value = raw as Record<string, unknown>
      return { task: requireString(value, 'task', { max: 12000 }), role: enumValue(value, 'role', ['planner', 'researcher', 'reviewer', 'tester', 'debugger'] as const, 'researcher') }
    })
    const results = await mapBounded(tasks, ctx.config.agentConcurrency ?? 1, async (task) => {
      ctx.signal.throwIfAborted()
      return ctx.spawnSubagent!({ ...task, label: task.role, maxSteps: 6, signal: ctx.signal })
    })
    const ok = results.every((result) => result.status === 'completed')
    return { ok, content: JSON.stringify(results.map((result, i) => ({ role: tasks[i]?.role, sessionId: result.sessionId, status: result.status, text: result.text, limitations: result.limitations }))), ...(ok ? {} : { error: 'One or more child tasks did not complete.' }) }
  },
}

export const subagentTools: AgentTool[] = [runSubagentTool, runAgentsTool]
