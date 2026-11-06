import { PlanState } from '../core/plan.ts'
import { enumValue, optionalNumber, optionalString, requireStringArray } from './validate.ts'
import type { AgentTool, ToolResult } from './types.ts'

export const setPlanTool: AgentTool = {
  name: 'set_plan',
  description:
    'Create or replace the visible task plan. Use 2-8 concrete, verifiable steps for multi-step work. Do not use for trivial questions.',
  parameters: {
    type: 'object',
    properties: {
      steps: { type: 'array', items: { type: 'string' }, description: 'Ordered plan steps.' },
      dependencies: { type: 'array', items: { type: 'array', items: { type: 'integer' } }, description: 'Optional dependency numbers for each step (1-based). Replacing a plan resets statuses.' },
    },
    required: ['steps'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const steps = requireStringArray(input, 'steps', { min: 1, max: 20, itemMax: 200 })
    if (input.dependencies !== undefined && (!Array.isArray(input.dependencies) || input.dependencies.some((v) => !Array.isArray(v)))) {
      return { ok: false, content: '', error: 'dependencies must contain one array per step.' }
    }
    ctx.plan.set(steps, input.dependencies as number[][] | undefined)
    ctx.events({ type: 'plan', steps: ctx.plan.snapshot() })
    return {
      ok: true,
      content: `Plan set (${steps.length} steps):\n${steps.map((s, i) => `${i + 1}. [pending] ${s}`).join('\n')}`,
    }
  },
}

export const updatePlanTool: AgentTool = {
  name: 'update_plan',
  description:
    'Update one plan step. Mark a step active when you start it, completed only after the work is verified, blocked when it cannot proceed.',
  parameters: {
    type: 'object',
    properties: {
      index: { type: 'integer', description: 'Step number, 1-based.' },
      status: { type: 'string', enum: ['pending', 'active', 'completed', 'blocked', 'skipped', 'failed', 'cancelled'] },
      note: { type: 'string', description: 'Optional short note or blocker.' },
    },
    required: ['index', 'status'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const index = optionalNumber(input, 'index', { min: 1, max: 50, integer: true })
    if (index === undefined) return { ok: false, content: '', error: '"index" is required.' }
    const status = enumValue(input, 'status', ['pending', 'active', 'completed', 'blocked', 'skipped', 'failed', 'cancelled'] as const, 'pending')
    const note = optionalString(input, 'note', { max: 300 })
    const ok = ctx.plan.update(index, status, note)
    if (!ok) {
      return {
        ok: false,
        content: '',
        error: `Plan step ${index} does not exist. ${ctx.plan.steps.length === 0 ? 'Call set_plan first.' : `There are ${ctx.plan.steps.length} steps.`}`,
      }
    }
    ctx.events({ type: 'plan_step', index: index - 1, status, ...(note ? { note } : {}) })
    ctx.events({ type: 'plan', steps: ctx.plan.snapshot() })
    const step = ctx.plan.steps[index - 1]
    return { ok: true, content: `Step ${index} "${step?.title ?? ''}" is now ${status}.` }
  },
}

export const showPlanTool: AgentTool = {
  name: 'show_plan',
  description: 'Show the current plan and its statuses.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  async run(_input, ctx): Promise<ToolResult> {
    if (ctx.plan.steps.length === 0) return { ok: true, content: 'No plan has been set.' }
    const lines = ctx.plan.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.title}${s.note ? ` — ${s.note}` : ''}`)
    return { ok: true, content: lines.join('\n') }
  },
}

export const planTools: AgentTool[] = [setPlanTool, updatePlanTool, showPlanTool]

export { PlanState }
