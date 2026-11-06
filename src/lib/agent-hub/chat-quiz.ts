// Pure quiz request interpretation and output contract; no storage or provider IO.
export function requestedMcqCount(message: string): number | null {
  const hasQuizTerm = /\b(?:mcqs?|multiple[\s-]?choice|quizzes?)\b/i.test(message)
  if (!hasQuizTerm) return null
  if (/\b(?:grade|score|check|review)\b/i.test(message) && /\banswers?\b/i.test(message)) return null
  // A lesson can contain both visuals and a closing quiz. Do not replace the
  // entire lesson with the standalone quiz-only output contract.
  if (/^\s*(?:teach|explain)\b/i.test(message) || /\b(?:diagram|flowchart|concept map)\b[\s\S]*\bmcqs?\b|\bmcqs?\b[\s\S]*\band\b[\s\S]*\b(?:diagram|flowchart|concept map)\b/i.test(message)) return null
  const bareQuizRequest = /^(?:mcqs?|quizzes?|multiple[\s-]?choice(?:\s+questions?)?)\s*[?.!]*$/i.test(message.trim())
  const asksForQuiz = bareQuizRequest || /\b(?:give|make|create|generate|write|start|prepare|another|new)\b/i.test(message) || /^\s*\d{1,2}\s*(?:mcqs?|questions?)\b/i.test(message) || /\b(?:quiz|test)\s+me\b/i.test(message)
  if (!asksForQuiz) return null
  const count = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:(?:beginner|intermediate|advanced|foundational|scenario-based)\s+)?(?:mcqs?|questions?)\b/i.exec(message)?.[1]?.toLowerCase()
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
  return count ? Math.max(1, Math.min(20, words[count] ?? Number(count))) : 5
}

export function compactMcqHistory<T extends { role: string; content: string }>(history: T[]): T[] {
  const selected: T[] = []
  let remaining = 8000
  for (const message of history.slice().reverse()) {
    const content = message.content.trim()
    if (!content || /^\(empty reply/i.test(content)) continue
    const bounded = content.slice(0, Math.min(1800, remaining))
    if (!bounded) break
    selected.push({ ...message, content: bounded })
    remaining -= bounded.length
    if (remaining <= 0 || selected.length >= 6) break
  }
  return selected.reverse()
}

export function establishedMcqTopic(history: Array<{ role: string; content: string }>): string | null {
  for (const message of history.slice().reverse()) {
    const content = message.content
    const heading = /^\s*#{1,6}\s+\*{0,2}MCQs?\s*:\s*(.+?)\*{0,2}\s*$/im.exec(content)
    if (heading) return heading[1].trim().replace(/\*+/g, '')
    const titled = /(?:["“]|for the\s+)(?:\*{0,2})?([A-Z][^\n"”*]{2,90}?)\s*[—–-]\s*(?:MCQ|Quiz)\s*Test\b/i.exec(content)
    if (titled) return titled[1].trim()
    const legacyTitle = /^\s*(?:#{1,6}\s*)?(.{2,90}?)\s*[—–-]\s*MCQs?(?:\s*\(multiple choice questions?\))?\s*$/im.exec(content)
    if (legacyTitle) return legacyTitle[1].trim().replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1')
  }
  return null
}

export function topicFromUserMessage(message: string): string | null {
  const match = /\b(?:on|about|covering)\s+(.+?)\s*[?.!]*$/i.exec(message)
  const topic = match?.[1]?.trim().replace(/^(?:the\s+)?topic\s+/i, '')
  if (!topic || /^(?:me|it|this|that|them|questions?)$/i.test(topic)) return null
  return topic.slice(0, 100)
}

export function topicFromChatTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null
  const topic = title
    .replace(/[\r\n`"'<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:steps? to learn|how to learn|learning|learn|teach me|teaching)\s+/i, '')
  if (!topic || /^(?:new chat|chat|untitled)$/i.test(topic)) return null
  return topic.slice(0, 100)
}

export function mcqResponseContract(count: number, topic: string | null, level: 'Beginner' | 'Intermediate' | 'Advanced' = 'Beginner'): string {
  return [
    `The user asked for an interactive multiple-choice quiz. Generate exactly ${count} questions${topic ? ` about the established topic “${topic}”. Do not ask the user what topic they mean.` : ' using the latest clearly established topic in the conversation. If there is no established topic, ask one brief topic question instead of guessing.'}`,
    `Format the quiz so AgentHub Chat can render it: begin with a Markdown heading ending in “MCQ Test”, followed by “${count} questions · ${level} level · 1 mark each”. Use ${level.toLowerCase()} questions appropriate to what has been taught${level === 'Advanced' ? ', including realistic scenarios and tradeoffs' : ''}. Write each question as “Question 1. …” and give exactly four concise choices on separate lines as “- A) …” through “- D) …”. Keep each stem under 20 words. Do not mark or reveal the correct choice in the options.`,
    `For EVERY question, add one answer block immediately after its options:\n\u0060\u0060\u0060answer\nCorrect: C. Explanation: A brief reason, no more than 18 words.\n\u0060\u0060\u0060\nUse short choices and explanations. Never add an introduction, conclusion, or separate explanation list. Do not omit any question, choice, key, or reason. Return only the complete quiz.`,
  ].join('\n')
}

