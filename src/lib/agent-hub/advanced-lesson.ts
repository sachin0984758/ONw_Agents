// Progress is reconstructed from persisted, application-labelled lesson turns.
// A quiz, clarification or unrelated follow-up never constitutes confirmation.
export const ADVANCED_STEPS = [
  'The Simplified Concept', 'The Real-World Friction Point',
  'The Communication Bridge', 'The Tactical Playbook',
  'The Second-Order and Edge-Case Audit',
] as const

export function advancedStep(history: Array<{ role: string; content: string }>, message: string): number {
  if (/\b(?:restart|start over|new topic|change topic)\b/i.test(message)) return 1
  const previous = history.filter((turn) => turn.role === 'assistant')
    .map((turn) => /^## Step ([1-5]): /m.exec(turn.content)?.[1]).filter(Boolean).at(-1)
  const current = Number(previous || 1)
  const confirmed = /^(?:yes|i understand|understood|continue|next(?: step)?|go ahead|got it)(?:[,!\s.]|$)/i.test(message.trim())
    && !/\b(?:confused|don['’]t understand|do not understand|not sure|explain again)\b/i.test(message)
  return previous && confirmed ? Math.min(5, current + 1) : current
}

export function labelAdvancedLesson(text: string, step: number): string {
  // Leave the model's topic-fit questions untouched; no lesson has begun yet.
  if (/\b(?:clarif|which (?:topic|aspect)|what (?:topic|aspect)|too (?:broad|vague)|more (?:context|specific))\b/i.test(text) && (text.match(/\?/g)?.length ?? 0) >= 2) return text
  const body = text.replace(/^\s*#{0,6}\s*(?:\*\*)?Step\s*[1-5]\s*[:—-][^\n]*\n?/i, '').trim()
  return `## Step ${step}: ${ADVANCED_STEPS[step - 1]}\n\n${body}`
}
