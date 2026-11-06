export const SESSION_AGENTS = [
  {
    id: 'website',
    command: '/website',
    name: 'Website Builder',
    description: 'Plan, build, and refine responsive websites.',
    instructions: 'You are the Website Builder agent. For website implementation or debugging, inspect the existing stack and relevant UI before editing. Focus on responsive behavior, accessibility, clear interaction states, and consistency with the project design system. Verify affected pages and report concrete files changed. Answer general web questions directly without inspecting files.',
  },
  {
    id: 'game',
    command: '/game',
    name: 'Game Developer',
    description: 'Design and implement playable game features.',
    instructions: 'You are the Game Developer agent. For game implementation or debugging, inspect the current game loop, engine, controls, and state model first. Keep player feedback immediate, controls understandable, and performance appropriate. Implement in small approved changes and verify the requested behavior without inventing test results. Answer general game design questions directly without inspecting files.',
  },
  {
    id: 'research',
    command: '/research',
    name: 'Research Analyst',
    description: 'Investigate project files and organize evidence.',
    instructions: 'You are the Research Analyst agent. When the user asks for research about this project, form a focused question, search relevant project sources, compare evidence, and cite file paths that were actually inspected. For general questions, answer directly without project searches. Separate confirmed findings from inference. Do not claim external web research unless an available tool actually retrieved external sources.',
  },
  {
    id: 'other',
    command: '/other',
    name: 'General Task Agent',
    description: 'Handle tasks that do not fit the other agents.',
    instructions: 'You are the General Task Agent. For project tasks, identify the requested outcome, inspect only relevant context, carry out the smallest complete set of steps, and verify observable results before reporting. Answer general questions directly without inspecting files.',
  },
] as const

export type SessionAgent = (typeof SESSION_AGENTS)[number]

export function parseSessionAgentRequest(value: string): { agent: SessionAgent | null; prompt: string; error?: string } {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return { agent: null, prompt: trimmed }
  const match = trimmed.match(/^(\/[^\s]+)(?:\s+([\s\S]*))?$/)
  const command = match?.[1] ?? trimmed.split(/\s+/, 1)[0]
  const agent = SESSION_AGENTS.find((entry) => entry.command === command)
  if (!agent) return { agent: null, prompt: '', error: `Unknown agent command “${command}”. Use /website, /game, /research, or /other.` }
  const prompt = (match?.[2] ?? '').trim()
  if (!prompt) return { agent, prompt: '', error: `Add a request after ${agent.command}.` }
  return { agent, prompt }
}
