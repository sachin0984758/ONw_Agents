// ── Teaching intent: user request → a structured lesson request ──────────────
// Two responsibilities, both deterministic-first:
//   1. decide whether a request is genuinely an educational request
//      (`isTeachingRequest`) — carefully, so "explain the project structure"
//      is NOT hijacked into a lesson;
//   2. turn a request into a LessonRequest and parse any quiz questions the
//      local model proposes, leniently and with validation.
//
// The model never invents the methodology: it may only add extra practice
// questions, which are coerced and validated here.

import {
  TOPICS,
  detectLevel,
  detectSubject,
  matchTopic,
  requestedTopicLabel,
  getSubject,
  type LessonRequest,
  type Level,
  type QuizQuestion,
  type SubjectId,
} from './teaching-framework'

// Strong teaching nouns/verbs: enough on their own to mean "a lesson".
const STRONG_INTENT =
  /\b(teach me|teach\b|learn(ing)?\b|lessons?|tutorials?|syllabus|curriculum|quiz(zes)?|exercis(e|es|ing)\b|homework|help me understand|walk me through|practice (questions?|problems?|sets?)|study plan|from scratch)\b/i

// Weaker explanatory verbs: only count as teaching when a subject is present.
const EXPLAIN_INTENT =
  /\b(explain|explaining|understand|what is|what are|how does|how do|introduction to|intro to|guide to|concepts? of|basics of|revise|revision)\b/i

/**
 * True only for genuine teaching/learning requests.
 *
 * A strong phrase (`teach me`, `lesson`, `quiz`, `exercises`, …) is enough on
 * its own. A weak phrase (`explain`, `what is`, …) additionally requires a real
 * subject signal, so "explain the project overview" stays a normal task.
 */
export function isTeachingRequest(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (t.startsWith('/')) return false // slash commands are handled elsewhere
  const subject = detectSubject(t)
  const hasSubject = subject !== 'generic'
  const strong = STRONG_INTENT.test(t)
  const explain = EXPLAIN_INTENT.test(t)
  if (strong && hasSubject) return true
  if (strong && /^(teach me|learn|i want to learn|help me understand|walk me through)\b/i.test(t)) return true
  if (explain && hasSubject) return true
  // A bare strong phrase without a subject counts only for unambiguous asks.
  if (strong && /\b(lesson|tutorial|syllabus|curriculum|homework)\b/i.test(t)) return true
  return false
}

/** Best-effort subject for UI defaults (never throws). */
export function requestSubject(text: string): SubjectId {
  return detectSubject(text)
}

/** Best-effort level for UI defaults. */
export function requestLevel(text: string): Level {
  return detectLevel(text)
}

/** Build a structured lesson request from natural language. */
export function toLessonRequest(text: string): LessonRequest {
  const subject = detectSubject(text)
  // Use a real bank topic when one matches; otherwise keep the learner's own
  // requested sub-topic (never a subject default — buildLessonPlan decides).
  const topic = matchTopic(text, subject)
  const requested = requestedTopicLabel(text) || text.trim()
  return {
    topic: topic?.label ?? requested,
    subject,
    level: detectLevel(text),
    context: text,
    includeProject: /\bmini[- ]?project|build|implement|create\b/i.test(text) ? true : undefined,
  }
}

// ── Lenient model-question parsing ───────────────────────────────────────────
// The model may propose extra practice questions. We accept a fenced ```json
// block (array or {questions:[…]}) and a simple Q/A text form, coerce every
// field to shape, drop anything invalid, and cap the count. A malformed block
// is ignored — never fatal.

const MAX_EXTRA_QUESTIONS = 5

interface RawQuestion {
  prompt?: unknown
  question?: unknown
  options?: unknown
  answer?: unknown
  answerIndex?: unknown
  explanation?: unknown
  hint?: unknown
  level?: unknown
  kind?: unknown
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function coerceQuestion(raw: RawQuestion, subject: SubjectId, index: number): QuizQuestion | null {
  const prompt = asString(raw.prompt) || asString(raw.question)
  if (!prompt) return null
  const options = Array.isArray(raw.options)
    ? raw.options.map((o) => asString(o)).filter((o) => o.length > 0)
    : undefined
  let answerIndex: number | undefined
  if (typeof raw.answerIndex === 'number') answerIndex = raw.answerIndex
  else if (typeof raw.answerIndex === 'string' && /^\d+$/.test(raw.answerIndex)) answerIndex = Number(raw.answerIndex)
  else if (typeof raw.answer === 'string' && options) {
    const letter = raw.answer.trim().toUpperCase()
    if (/^[A-E]$/.test(letter)) answerIndex = letter.charCodeAt(0) - 65
  }
  const kind = options && options.length >= 2 ? 'multiple-choice' : 'explain-result'
  if (kind === 'multiple-choice') {
    if (typeof answerIndex !== 'number' || answerIndex < 0 || answerIndex >= (options?.length ?? 0)) return null
  } else {
    // An open question is only usable if it has a model answer to grade against.
    if (!asString(raw.answer)) return null
  }
  const lvl = asString(raw.level).toLowerCase()
  const level: Level = lvl === 'advanced' || lvl === 'hard' ? 'advanced' : lvl === 'medium' || lvl === 'intermediate' ? 'intermediate' : 'beginner'
  return {
    id: `gen-${subject}-${index}`,
    level,
    kind,
    prompt,
    options: kind === 'multiple-choice' ? options : undefined,
    answerIndex: kind === 'multiple-choice' ? answerIndex : undefined,
    answer: kind === 'explain-result' ? asString(raw.answer) || undefined : undefined,
    explanation: asString(raw.explanation) || 'Review the concept section and try again.',
    hint: asString(raw.hint) || undefined,
  }
}

/** Extract and validate extra quiz questions from a model reply. */
export function parseModelQuestions(text: string, subject: SubjectId): QuizQuestion[] {
  if (!text) return []
  const out: QuizQuestion[] = []
  // 1) Fenced JSON blocks.
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim())
  for (const body of fences) {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      continue
    }
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown }).questions)
        ? (parsed as { questions: unknown[] }).questions
        : []
    for (const item of list) {
      if (item && typeof item === 'object') {
        const q = coerceQuestion(item as RawQuestion, subject, out.length)
        if (q) out.push(q)
      }
      if (out.length >= MAX_EXTRA_QUESTIONS) return out
    }
  }
  if (out.length > 0) return out
  // 2) Plain Q/A text form: "Q: …", "A) …", "Answer: B".
  const lines = text.split(/\r?\n/)
  let cur: RawQuestion | null = null
  for (const line of lines) {
    const qm = line.match(/^\s*(?:Q\d*[:.)]|\d+[.)])\s*(.+)$/i)
    if (qm && !/^[A-E][).]\s/.test(line)) {
      if (cur && (cur.prompt || cur.question)) {
        const q = coerceQuestion(cur, subject, out.length)
        if (q) out.push(q)
      }
      cur = { prompt: qm[1], options: [] }
      continue
    }
    if (!cur) continue
    const om = line.match(/^\s*[A-E][).]\s*(.+)$/)
    if (om && Array.isArray(cur.options)) {
      ;(cur.options as string[]).push(om[1].trim())
      continue
    }
    const am = line.match(/^\s*answer\s*[:=]\s*(.+)$/i)
    if (am) cur.answer = am[1].trim()
    if (out.length >= MAX_EXTRA_QUESTIONS) break
  }
  if (cur && (cur.prompt || cur.question)) {
    const q = coerceQuestion(cur, subject, out.length)
    if (q) out.push(q)
  }
  return out.slice(0, MAX_EXTRA_QUESTIONS)
}

// ── Focused follow-up prompt ─────────────────────────────────────────────────
// Keeps continuity inside a lesson without re-sending the whole lesson.

export function buildFollowUpPrompt(topicLabel: string, subject: SubjectId, question: string, context?: string): string {
  const subjectSpec = getSubject(subject)
  const excerpt = (context ?? '').trim().slice(0, 1800)
  return (
    `You are continuing to teach the topic "${topicLabel}" (${subjectSpec.label}). ` +
    `Subject style: ${subjectSpec.pattern} ` +
    `The learner asks a follow-up. Answer it directly and concretely, in a few short paragraphs, ` +
    `using the same style. Fence code/examples. Do not restart the lesson.` +
    (excerpt ? `\n\nLesson material already given (use it for continuity; do not repeat it verbatim):\n${excerpt}` : '') +
    `\n\nLearner: ${question}`
  )
}

/** Suggest a nearby topic, used when a request names a topic we know. */
export function knownTopics(): string[] {
  return TOPICS.map((t) => t.label)
}
