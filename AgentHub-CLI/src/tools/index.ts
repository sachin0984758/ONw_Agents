import type { ToolSchema } from '../providers/types.ts'
import { fileTools } from './files.ts'
import { gitTools } from './git.ts'
import { planTools } from './plan.ts'
import { shellTools } from './shell.ts'
import { skillTools } from './skills.ts'
import { mcpTools } from './mcp.ts'
import { subagentTools } from './subagent.ts'
import type { AgentTool } from './types.ts'

export const TOOLS: AgentTool[] = [
  ...fileTools,
  ...shellTools,
  ...gitTools,
  ...planTools,
  ...skillTools,
  ...mcpTools,
  ...subagentTools,
]

export function findTool(name: string): AgentTool | undefined {
  return TOOLS.find((tool) => tool.name === name)
}

export function toolSchemas(): ToolSchema[] {
  return TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

export function toolNames(): string[] {
  return TOOLS.map((t) => t.name)
}
