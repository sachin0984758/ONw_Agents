import type { SessionQuestion } from './types'

export function parseSessionQuestion(args: Record<string, unknown>): SessionQuestion {
  if (!['requirements', 'design', 'plan'].includes(String(args.stage))) throw new Error('Choose requirements, design, or plan as the question stage.')
  if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 500) throw new Error('Provide a question of at most 500 characters.')
  if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 4 || args.options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 200)) throw new Error('Provide two to four short choices.')
  const options = args.options.map((option: string) => option.trim())
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) throw new Error('Question choices must be distinct.')
  if (args.details !== undefined && (typeof args.details !== 'string' || args.details.length > 8000)) throw new Error('Design or plan details must be text of at most 8000 characters.')
  return { stage: args.stage as SessionQuestion['stage'], prompt: args.prompt.trim(), options, ...(typeof args.details === 'string' ? { details: args.details } : {}) }
}

export const SESSION_QUESTION_GUIDANCE = `Guide substantial project work through requirements, design, and then a plan before implementation.
For a vague request such as "dashboard", call ask_user with stage requirements and 2-4 concrete choices instead of listing questions in prose. Ask one focused question at a time. The UI always offers a custom answer; do not add an Other option. These are preferences, not scored quizzes.
Use answers already given and do not repeat resolved questions. Once essential requirements are known, describe the proposed layout, style, and behavior in ask_user details with stage design and ask whether to use it or adjust it. Ask additional focused questions only if the design reveals a missing requirement.
Then use the plan tool to show a concise implementation checklist, and ask_user with stage plan to offer proceeding or revising. Once the user chooses to proceed, implement using available tools and verify results. If the user explicitly requests proceeding without more questions, respect that choice while stating assumptions.
Call ask_user alone and stop for the user's response. A question is a successful handoff, not unfinished implementation. Answers never grant workspace access or approve file mutations. If access is missing, explain how to select the folder and grant access using the existing controls.`
