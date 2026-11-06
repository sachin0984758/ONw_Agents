// ── Teaching framework: deterministic lesson structure + assessment logic ────
// The application — not the model — owns the teaching methodology:
//
//   • subject taxonomy and how each subject should be *presented*
//   • the ordered lesson-section framework (intro → … → revision)
//   • prerequisite sequencing and the "next topic" graph
//   • difficulty levels and the progressive-practice taxonomy
//   • quiz/exercise structures, answer keys and scoring
//   • a learning-progress record (topics, quiz results, mistakes, revision)
//   • content validation and bounded-context helpers
//
// The model only ever ENRICHES a section with focused prose. Every function
// here is pure and works offline, so a small local model (or none) still
// yields a complete, correct, structured lesson.
//
// Pure data + logic only — no fs, no fetch, no React.

import {
  TOPICS,
  getTopic,
  type Exercise,
  type LessonDiagram,
  type LessonSectionKind,
  type Level,
  type QuizQuestion,
  type SubjectId,
  type TopicContent,
} from './teaching-bank'

export type {
  Exercise,
  ExerciseKind,
  LessonDiagram,
  LessonSectionKind,
  Level,
  QuizQuestion,
  SubjectId,
  TopicContent,
} from './teaching-bank'
export { TOPICS, getTopic } from './teaching-bank'

// ── Bounded context ──────────────────────────────────────────────────────────
// Each section prompt is sent to the model on its own; a lesson is therefore
// many small, focused calls rather than one huge one. These caps keep prompts
// inside a small context window.

export const MAX_SECTION_CHARS = 2200
export const MAX_SECTIONS_PER_LESSON = 9
export const MODEL_SECTIONS = 6 // sections we ask the model to enrich

// ── Subject taxonomy ─────────────────────────────────────────────────────────
// `pattern` is presentation guidance, not prose — it tells the model how this
// subject is conventionally taught so electronics is never explained like a
// Python article.

export interface SubjectSpec {
  id: SubjectId
  label: string
  /** Code-fence language for examples of this subject. */
  language: string
  keywords: RegExp
  /** Ordered section framework used for this subject. */
  sections: LessonSectionKind[]
  /** Presentation guidance handed to the model for every section. */
  pattern: string
  /** Representative topic when no specific topic is recognised. */
  defaultTopicId: string
}

export const SUBJECTS: SubjectSpec[] = [
  {
    id: 'python',
    label: 'Programming (Python)',
    language: 'python',
    keywords: /\b(python|pip|django|flask|pandas|numpy|list comprehension)\b/i,
    sections: ['intro', 'prerequisites', 'concepts', 'visual', 'examples', 'mistakes', 'practice', 'project', 'revision'],
    pattern:
      'Teach programming as: the idea in plain words → a minimal runnable snippet → the exact printed output → a line-by-line trace → a slightly harder variant → edge cases. ' +
      'Always fence Python code with ```python and show real output in its own fenced block. Name variables meaningfully.',
    defaultTopicId: 'python-functions',
  },
  {
    id: 'sql',
    label: 'Databases & SQL',
    language: 'sql',
    keywords: /\b(sql|query|queries|database|select\b|table|schema|postgres|mysql|sqlite)\b/i,
    sections: ['intro', 'prerequisites', 'concepts', 'visual', 'examples', 'mistakes', 'practice', 'project', 'revision'],
    pattern:
      'Teach SQL declaratively: what question the query answers → the clauses in evaluation order (FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY) → the result as a small table → which rows/NULLs are affected. ' +
      'Show a tiny sample schema before the query and fence it as ```sql.',
    defaultTopicId: 'sql-joins',
  },
  {
    id: 'c',
    label: 'Systems programming (C)',
    language: 'c',
    keywords: /\b(c programming|c language|gcc|segfault|pointer|malloc|struct|compile|linker|makefile|debugging)\b/i,
    sections: ['intro', 'prerequisites', 'concepts', 'visual', 'examples', 'mistakes', 'practice', 'revision'],
    pattern:
      'Teach C with memory in mind: what lives on the stack vs the heap → what the compiler checks vs what it cannot → undefined behaviour and how to observe it (warnings, sanitizers, debugger) → a minimal compiling snippet. ' +
      'Fence C as ```c and mention compiler flags explicitly.',
    defaultTopicId: 'c-debugging',
  },
  {
    id: 'excel',
    label: 'Spreadsheets & analytics (Excel)',
    language: 'excel',
    keywords: /\b(excel|spreadsheet|workbook|vlookup|xlookup|pivot|formula|worksheet|cell)\b/i,
    sections: ['intro', 'prerequisites', 'concepts', 'visual', 'examples', 'mistakes', 'practice', 'revision'],
    pattern:
      'Teach Excel by showing the grid: a tiny table with column letters and row numbers → the formula → the returned value → what happens when the data changes. ' +
      'Write formulas exactly as typed (leading =) and use a table to show before/after.',
    defaultTopicId: 'excel-lookup',
  },
  {
    id: 'linux',
    label: 'Linux & the command line',
    language: 'bash',
    keywords: /\b(linux|bash|shell|terminal|command line|grep|chmod|permissions|unix|filesystem)\b/i,
    sections: ['intro', 'prerequisites', 'concepts', 'visual', 'examples', 'mistakes', 'practice', 'revision'],
    pattern:
      'Teach the shell as a conversation: the command, then its realistic output, then a safe read-only variant first. ' +
      'Fence commands/output as ```bash and always warn before a destructive command.',
    defaultTopicId: 'linux-commands',
  },
  {
    id: 'electronics',
    label: 'Electronics & embedded systems',
    language: 'c',
    keywords: /\b(electronics?|embedded|circuit|resistor|voltage|current|ohm'?s? law|gpio|arduino|microcontroller|pull-?up|pull-?down|sensor)\b/i,
    sections: ['intro', 'prerequisites', 'concepts', 'visual', 'examples', 'mistakes', 'practice', 'revision'],
    pattern:
      'Teach electronics physically, never like code: name the components and what each terminal does → the governing law (e.g. V = I × R) → a labelled circuit path (source → component → ground) → the numbers with units → the safety or polarity constraint. ' +
      'Use a flow diagram of the physical path, not a program listing.',
    defaultTopicId: 'electronics-basics',
  },
  {
    id: 'ml',
    label: 'AI & machine learning',
    language: 'python',
    keywords: /\b(machine learning|ml|neural|model training|dataset|feature|label|classifier|regression|overfitting|sklearn|deep learning)\b/i,
    sections: ['intro', 'prerequisites', 'concepts', 'visual', 'examples', 'mistakes', 'practice', 'revision'],
    pattern:
      'Teach ML as a pipeline: inputs (features) and targets (labels) → the split → training → honest evaluation on unseen data → the failure modes (leakage, overfitting, bad metric). ' +
      'Show the pipeline as a flow diagram and fence code as ```python.',
    defaultTopicId: 'ml-basics',
  },
  {
    id: 'aptitude',
    label: 'Math & aptitude',
    language: 'text',
    keywords: /\b(aptitude|percentage|ratio|proportion|profit|loss|average|speed|distance|time|maths?|mathematics)\b/i,
    sections: ['intro', 'prerequisites', 'concepts', 'visual', 'examples', 'mistakes', 'practice', 'revision'],
    pattern:
      'Teach aptitude with a repeatable method: state the formula → substitute the numbers in one line → compute step by step → interpret the answer with its unit → give the shortcut. ' +
      'Do not use code; use a steps/table layout.',
    defaultTopicId: 'aptitude',
  },
  {
    id: 'generic',
    label: 'General topic',
    language: 'text',
    keywords: /$^/,
    sections: ['intro', 'prerequisites', 'concepts', 'visual', 'examples', 'mistakes', 'practice', 'revision'],
    pattern:
      'Teach the topic from first principles: what it is, why it exists, where it is used, a concrete worked example, common mistakes, then practice. Be concrete and avoid jargon without a definition.',
    defaultTopicId: '',
  },
]

const SUBJECT_BY_ID: Record<string, SubjectSpec> = Object.fromEntries(SUBJECTS.map((s) => [s.id, s]))

export function getSubject(id: SubjectId): SubjectSpec {
  return SUBJECT_BY_ID[id] ?? SUBJECT_BY_ID.generic
}

// ── Section framework ────────────────────────────────────────────────────────

export interface SectionSpec {
  kind: LessonSectionKind
  label: string
  purpose: string
}

export const LESSON_SECTIONS: SectionSpec[] = [
  { kind: 'intro', label: 'Introduction', purpose: 'Briefly introduce the topic — what it is, why it matters, where it is used, and what the learner will achieve.' },
  { kind: 'prerequisites', label: 'Prerequisites', purpose: 'List prerequisites in the correct learning order and briefly remind (do not re-teach) each one.' },
  { kind: 'concepts', label: 'Core concepts', purpose: 'Explain concepts step by step from simple to complex, covering terminology, principles and mechanisms.' },
  { kind: 'visual', label: 'Visual explanation', purpose: 'Provide a visual model of the concept (diagram, flow, table) so the structure is visible.' },
  { kind: 'examples', label: 'Worked examples', purpose: 'Walk through worked examples from simple to complex, showing inputs, real output, tracing and edge cases.' },
  { kind: 'mistakes', label: 'Common mistakes & debugging', purpose: 'Show common mistakes of every kind, the wrong version, why it fails, and the corrected version.' },
  { kind: 'practice', label: 'Practice', purpose: 'Give progressive practice (easy → medium → hard) across several question styles.' },
  { kind: 'project', label: 'Mini-project', purpose: 'Propose a small, proportional mini-project that applies the topic and produces a concrete result.' },
  { kind: 'revision', label: 'Revision & next steps', purpose: 'Give a compact revision/cheat-sheet and point to the next topic.' },
]

const SECTION_BY_KIND: Record<string, SectionSpec> = Object.fromEntries(LESSON_SECTIONS.map((s) => [s.kind, s]))

export function getSection(kind: LessonSectionKind): SectionSpec {
  return SECTION_BY_KIND[kind]
}

// ── Difficulty ───────────────────────────────────────────────────────────────

export const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced']

export const LEVEL_LABEL: Record<Level, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

// ── Subject / topic detection ────────────────────────────────────────────────
// Deliberately conservative: a bare "explain the project" must NOT be treated
// as a lesson. We look for a real subject signal or a specific bank topic.

export function detectSubject(text: string): SubjectId {
  const t = text ?? ''
  // Subjects whose OWN keyword set matches the text.
  const explicit = SUBJECTS.filter((s) => s.id !== 'generic' && s.keywords.test(t)).map((s) => s.id)
  // Specific bank topics whose keyword set matches the text.
  const topics = TOPICS.filter((x) => x.keywords.test(t))
  if (topics.length > 0) {
    // A topic belongs to an explicitly-named subject → that is the strongest signal.
    const owned = topics.find((x) => explicit.includes(x.subject))
    if (owned) return owned.subject
    // No subject named at all → trust the topic keyword.
    // (When a *different* subject IS named, e.g. "SQL window functions" matching a
    // generic word like "functions", the named subject wins — never a cross-subject
    // false match.)
    if (explicit.length === 0) return topics[0].subject
  }
  // Otherwise the first named subject (python before generic).
  return explicit[0] ?? 'generic'
}

export function detectLevel(text: string): Level {
  const t = (text ?? '').toLowerCase()
  if (/\b(advanced|expert|in[- ]depth|deep dive|internals?)\b/.test(t)) return 'advanced'
  if (/\b(interview|hard|complex|optimis|optimiz|system design)\b/.test(t)) return 'advanced'
  if (/\b(intermediate|medium|some experience|refresher)\b/.test(t)) return 'intermediate'
  return 'beginner'
}

/**
 * Lesson scope. A concise factual question ("what is a Python list", "how does
 * XLOOKUP work") should get a compact answer, not the full chapter framework;
 * an explicit teaching ask gets the whole lesson. Deterministic and offline.
 */
export type LessonScope = 'quick' | 'full'

/** Sections kept for a quick answer — no project, mistakes or long practice. */
export const QUICK_SECTIONS: LessonSectionKind[] = ['intro', 'concepts', 'examples', 'revision']

const QUICK_ASK = /^\s*(what\s+(is|are|does|do|'?s)|how\s+(does|do|is)|difference between|define)\b/i
const FULL_ASK = /\b(teach me|lesson|tutorial|syllabus|curriculum|quiz|exercise|practice|from scratch|step[- ]by[- ]step|full|complete|deep dive|course|everything about)\b/i

export function detectScope(text: string): LessonScope {
  const t = (text ?? '').trim()
  if (!t) return 'full'
  const words = t.split(/\s+/).filter(Boolean).length
  if (QUICK_ASK.test(t) && !FULL_ASK.test(t) && words <= 12) return 'quick'
  return 'full'
}

/**
 * The strongest signal: an actual bank topic whose keywords match the request.
 * When a subject is known, matching is scoped to that subject so a generic word
 * ("functions", "classes") can never pull in a different subject's topic.
 * Returns `undefined` — never a default — so callers can tell "we found this
 * topic" apart from "we did not".
 */
export function matchTopic(text: string, subject?: SubjectId): TopicContent | undefined {
  const t = text ?? ''
  if (!t.trim()) return undefined
  if (subject && subject !== 'generic') {
    return TOPICS.find((x) => x.subject === subject && x.keywords.test(t))
  }
  return TOPICS.find((x) => x.keywords.test(t))
}

// Leading question/teaching phrases stripped to recover the *requested* topic
// from a sentence ("What is a Python list?" → "Python list").
const LEAD_IN =
  /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+|i\s+(?:want|would\s+like)\s+to\s+|i'?d\s+like\s+to\s+|help\s+me\s+|teach\s+me(?:\s+about)?\s+|learn(?:\s+about)?\s+|explain(?:ing)?\s+|tell\s+me\s+about\s+|describe\s+|define\s+|what\s+(?:is|are|does|do)\s+|how\s+(?:does|do|is)\s+|an?\s+(?:introduction|intro|guide|overview|basics?|lesson|tutorial|explainer)\s+(?:to|of|about|on)\s+)+/i

/** Recover the learner's requested topic from a natural-language sentence. */
export function requestedTopicLabel(text: string): string {
  let t = (text ?? '').trim().replace(/[?.!,;:]+$/g, '').trim()
  t = t.replace(LEAD_IN, '').trim()
  t = t.replace(/^(?:a|an|the)\s+/i, '').trim()
  return t.replace(/[?.!,;:]+$/g, '').trim()
}

// Words that name the subject itself (or are too generic to be a sub-topic).
const SUBJECT_NAME_WORDS: Record<SubjectId, string[]> = {
  python: ['python', 'programming', 'program', 'code', 'coding'],
  sql: ['sql', 'database', 'databases', 'db', 'query', 'queries'],
  c: ['c', 'programming', 'language', 'sys'],
  excel: ['excel', 'spreadsheet', 'spreadsheets', 'sheet', 'workbook'],
  linux: ['linux', 'unix', 'command', 'commands', 'shell', 'bash', 'terminal', 'cli', 'line'],
  electronics: ['electronics', 'embedded', 'circuit', 'circuits', 'hardware', 'system'],
  ml: ['ml', 'machine', 'learning', 'ai', 'deep'],
  aptitude: ['aptitude', 'math', 'maths', 'mathematics'],
  generic: [],
}
const NON_TOPIC_WORDS = new Set([
  'about', 'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'my', 'your',
  'it', 'this', 'that', 'these', 'those', 'basic', 'basics', 'introduction', 'intro', 'overview',
  'guide', 'concept', 'concepts', 'fundamental', 'fundamentals', 'something', 'anything', 'stuff',
  'things', 'topic', 'lesson', 'tutorial', 'more', 'please', 'me',
])

/** The meaningful sub-topic words in a label, or '' when only the subject is named. */
function subtopicResidue(label: string, subject: SubjectId): string {
  const subjectWords = new Set(SUBJECT_NAME_WORDS[subject] ?? [])
  return label
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9+#-]/g, ''))
    .filter((w) => w && !subjectWords.has(w) && !NON_TOPIC_WORDS.has(w))
    .join(' ')
    .trim()
}

export type LessonCoverage = 'bank' | 'general' | 'default'

/**
 * How a lesson's topic was chosen. `bank` means a real bank topic matched;
 * `general` means the learner asked for a sub-topic that is NOT in the bank (we
 * must not substitute an unrelated default); `default` means no sub-topic was
 * named at all, so the subject's foundational topic is used deliberately.
 */
export interface LessonResolution {
  coverage: LessonCoverage
  /** The bank topic chosen for content/assessment, when one applies. */
  topic?: TopicContent
  /** True when a bank topic matched the request. */
  matched: boolean
  /** True when no sub-topic was named and the subject default was chosen. */
  usedDefault: boolean
  /** The learner's requested sub-topic when it is not a bank topic. */
  requestedTopic?: string
  /** True when the request is too ambiguous to build a lesson without asking. */
  needsClarification: boolean
  /** Honest, human-readable explanation of the choice (never claims a bank match). */
  note?: string
}

/**
 * Resolve the topic for a request without ever silently substituting an
 * unrelated default:
 *   1. an actual bank topic match wins;
 *   2. otherwise a *specific* sub-topic becomes a general explanation built with
 *      the subject's framework (honestly marked as not from the bank);
 *   3. a bare subject name deliberately uses the subject's foundational topic;
 *   4. an unidentifiable subject asks a short clarifying question instead.
 */
export function resolveTopic(subject: SubjectId, detectText: string, learnerText: string): LessonResolution {
  const matched = matchTopic(detectText, subject)
  if (matched) {
    return { coverage: 'bank', topic: matched, matched: true, usedDefault: false, needsClarification: false }
  }

  const label = requestedTopicLabel(learnerText) || learnerText.trim()

  if (subject === 'generic') {
    return {
      coverage: 'general',
      matched: false,
      usedDefault: false,
      needsClarification: true,
      note: 'No subject or bank topic could be identified in this request.',
    }
  }

  if (subtopicResidue(label, subject)) {
    return {
      coverage: 'general',
      matched: false,
      usedDefault: false,
      requestedTopic: label,
      needsClarification: false,
      note: `“${label}” is not one of the app's verified bank topics, so this is a general explanation built with the ${getSubject(subject).label} framework — not a bank topic.`,
    }
  }

  const defId = getSubject(subject).defaultTopicId
  const def = defId ? getTopic(defId) : undefined
  return {
    coverage: 'default',
    topic: def,
    matched: false,
    usedDefault: true,
    requestedTopic: label || undefined,
    needsClarification: false,
    note: def
      ? `No specific sub-topic was named — starting from the ${getSubject(subject).label} foundational topic: ${def.label}.`
      : undefined,
  }
}

// ── Lesson plan ──────────────────────────────────────────────────────────────

export interface LessonSectionPlan {
  kind: LessonSectionKind
  label: string
  purpose: string
  /** Focused, self-contained prompt for the model to enrich this section. */
  prompt: string
  /** Deterministic bank content (markdown) — used as-is offline. */
  fallback: string
  /** Whether the model should be asked to enrich this section. */
  model: boolean
}

export interface LessonPlan {
  topic: string
  topicId: string
  subject: SubjectId
  subjectLabel: string
  level: Level
  language: string
  prerequisites: string[]
  next: string[]
  sections: LessonSectionPlan[]
  quiz: QuizQuestion[]
  exercises: Exercise[]
  diagram: LessonDiagram
  /** How the topic was chosen — surfaced so the UI never implies a bank match. */
  resolution: LessonResolution
}

export interface LessonRequest {
  topic: string
  subject?: SubjectId
  level?: Level
  /** Extra free-text context from the user's message. */
  context?: string
  /** Force the mini-project section on/off; default follows the subject. */
  includeProject?: boolean
  /** Lesson scope; when omitted it is detected from the request text. */
  scope?: LessonScope
}

function topicLabel(id: string): string {
  const t = getTopic(id)
  return t ? t.label : id
}

function prereqLabels(topic: TopicContent | undefined): string[] {
  if (!topic) return []
  return topic.prereqs.map((p) => topicLabel(p))
}

function nextLabels(topic: TopicContent | undefined): string[] {
  if (!topic) return []
  return topic.next.map((n) => topicLabel(n))
}

/** Bank content rendered as section fallback markdown (always available). */
function fallbackFor(kind: LessonSectionKind, topic: TopicContent | undefined, subject: SubjectSpec, label: string): string {
  switch (kind) {
    case 'intro':
      return topic ? topic.intro : `**${label}.** ${subject.pattern}`
    case 'prerequisites': {
      const pre = prereqLabels(topic)
      if (pre.length === 0) return 'No specific prerequisites — we start from the fundamentals.'
      return pre.map((p) => `- ${p}`).join('\n')
    }
    case 'concepts':
      if (!topic) return `We will build up ${label} from its core definitions, principles and mechanisms.`
      return topic.keyIdeas.map((k) => `**${k.term}** — ${k.definition}`).join('\n\n')
    case 'visual':
      if (!topic) return `A visual model of ${label}.`
      return topic.diagram.caption ?? `A visual model of ${label}.`
    case 'examples':
      if (!topic) return `A worked example of ${label}.`
      return (
        '```' + topic.example.language + '\n' + topic.example.code + '\n```\n\n' +
        (topic.example.output ? `**Output**\n\n\`\`\`text\n${topic.example.output}\n\`\`\`\n\n` : '') +
        topic.example.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
      )
    case 'mistakes':
      if (!topic) return 'Common mistakes and how to avoid them.'
      return topic.mistakes
        .map((m) => `**${m.mistake}**\n\n- Why: ${m.cause}\n- Fix: ${m.fix}${m.code ? `\n\n\`\`\`\n${m.code}\n\`\`\`` : ''}`)
        .join('\n\n')
    case 'practice':
      return 'See the interactive practice panel below — questions are graded as you answer, with hints and explanations.'
    case 'project':
      if (!topic?.project) return ''
      return (
        `**Objective:** ${topic.project.objective}\n\n` +
        `**Requirements**\n${topic.project.requirements.map((r) => `- ${r}`).join('\n')}\n\n` +
        `**Steps**\n${topic.project.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
        `**Expected result:** ${topic.project.expected}`
      )
    case 'revision':
      if (!topic) return `A compact revision of ${label}.`
      return topic.revision.map((r) => `- **${r.label}** — ${r.value}`).join('\n')
    default:
      return ''
  }
}

function promptFor(
  kind: LessonSectionKind,
  label: string,
  subject: SubjectSpec,
  level: Level,
  prerequisites: string[],
  next: string[],
  ask?: string,
): string {
  const spec = getSection(kind)
  const name = label
  const focus = (ask ?? '').trim().slice(0, 200)
  const head =
    `You are a patient, expert teacher. Write ONLY the "${spec.label}" section for a ${level} lesson on: ${name}. ` +
    (focus && focus.toLowerCase() !== name.toLowerCase() ? `The learner's own words: "${focus}". Stay on that specific request. ` : '') +
    `Subject style: ${subject.pattern} ` +
    `Be concise (a few short paragraphs or a short list). Use Markdown. Do not repeat other sections. Do not add a title — the UI already shows "${spec.label}".`
  const extra: Partial<Record<LessonSectionKind, string>> = {
    prerequisites:
      prerequisites.length > 0
        ? `Prerequisites in order: ${prerequisites.join('; ')}. Remind the learner in one line each — do not teach them fully.`
        : 'State that there are no special prerequisites.',
    examples:
      'Start with the simplest working example, show the exact output, trace it line by line, then give one harder variant and note an edge case. Fence code.',
    mistakes:
      'Give 3 realistic mistakes spanning syntax, runtime, logic and assumption errors. For each: the wrong version, why it fails, and the corrected version.',
    project:
      'Propose a small mini-project (a handful of files or cells) that applies the topic and ends in a concrete, checkable result.',
    revision:
      `Provide a compact cheat-sheet of the key facts and name the next topic: ${next.join('; ') || 'none'}.`,
  }
  return `${head}${extra[kind] ? ' ' + extra[kind] : ''}`
}

/** Build the complete, deterministic lesson structure for a request. */
export function buildLessonPlan(request: LessonRequest): LessonPlan {
  const contextText = (request.context ?? '').trim()
  const learnerText = (contextText || request.topic).trim()
  const text = `${request.topic} ${contextText}`.trim()
  let subjectId = request.subject ?? detectSubject(text)
  const resolution = resolveTopic(subjectId, text, learnerText)
  const topic = resolution.topic
  // Safety net only: if the subject stayed 'generic' yet a bank topic matched,
  // follow that topic so presentation and assessment never mix.
  if (topic && topic.subject !== subjectId) {
    subjectId = topic.subject
  }
  const subject = getSubject(subjectId)
  const level = request.level ?? detectLevel(text)
  // Scope follows the learner's own words when available, not the bank's label.
  const scope = request.scope ?? detectScope(contextText ? contextText : text)
  // The effective topic label the lesson is about — a bank label, the learner's
  // requested sub-topic (general explanation), or the raw request as a last resort.
  const label = topic?.label ?? resolution.requestedTopic ?? (learnerText || request.topic)
  const prerequisites = prereqLabels(topic)
  const next = nextLabels(topic)

  let sections = subject.sections.slice(0, MAX_SECTIONS_PER_LESSON)
  if (scope === 'quick') sections = sections.filter((k) => QUICK_SECTIONS.includes(k))
  if (request.includeProject === false) sections = sections.filter((k) => k !== 'project')
  if (request.includeProject === true && !sections.includes('project')) sections = [...sections, 'project']
  if (!topic?.project && request.includeProject === undefined) sections = sections.filter((k) => k !== 'project')

  const plans: LessonSectionPlan[] = sections.map((kind) => ({
    kind,
    label: getSection(kind).label,
    purpose: getSection(kind).purpose,
    prompt: promptFor(kind, label, subject, level, prerequisites, next, contextText ? request.context : request.topic),
    fallback: fallbackFor(kind, topic, subject, label),
    // practice is interactive and app-owned; the rest can be enriched by prose.
    model: kind !== 'practice' && kind !== 'visual',
  }))

  return {
    topic: label || request.topic,
    topicId: topic?.id ?? `${subjectId}:${slugTopic(label || request.topic)}`,
    subject: subjectId,
    subjectLabel: subject.label,
    level,
    language: subject.language,
    prerequisites,
    next,
    sections: plans,
    quiz: topic?.quiz ? topic.quiz.slice() : [],
    exercises: topic?.exercises ? topic.exercises.slice() : [],
    diagram: topic?.diagram ?? { format: 'flow', caption: `A model of ${label || request.topic}.`, nodes: [], edges: [] },
    resolution,
  }
}

/** A stable, filesystem-safe id fragment for a free-form topic label. */
function slugTopic(label: string): string {
  return (label || 'topic')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'topic'
}

// ── Validation ───────────────────────────────────────────────────────────────
// Deterministic check that a lesson is structurally complete before it is
// shown or stored. Returns null when valid, else a human-readable reason.

export function validateLesson(plan: LessonPlan, results: Record<string, string | undefined>): string | null {
  if (!plan.topic.trim()) return 'A lesson needs a topic.'
  if (plan.sections.length === 0) return 'A lesson needs at least one section.'
  const missing = plan.sections.filter((s) => !(results[s.kind] ?? s.fallback).trim())
  if (missing.length > 0) return `Missing content for: ${missing.map((m) => m.label).join(', ')}.`
  for (const q of plan.quiz) {
    if (q.kind === 'multiple-choice') {
      if (!q.options || q.options.length < 2) return `Quiz question ${q.id} needs at least two options.`
      if (typeof q.answerIndex !== 'number' || q.answerIndex < 0 || q.answerIndex >= q.options.length) {
        return `Quiz question ${q.id} has an out-of-range answer key.`
      }
    }
  }
  return null
}

// ── Assessment: scoring ──────────────────────────────────────────────────────

export interface QuizGradeDetail {
  id: string
  correct: boolean
  expected: string
  chosen: string
}

export interface QuizGrade {
  correct: number
  total: number
  details: QuizGradeDetail[]
}

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '')
}

/**
 * Grade quiz answers. Multiple-choice is graded exactly against the key;
 * free-text answers use a deterministic token-overlap check so it works
 * offline. Returns a full per-question breakdown, never a bare number.
 */
export function scoreQuiz(questions: QuizQuestion[], answers: Record<string, string | number>): QuizGrade {
  const details: QuizGradeDetail[] = []
  let correct = 0
  for (const q of questions) {
    const given = answers[q.id]
    let isCorrect = false
    let chosen = ''
    let expected = ''
    if (q.kind === 'multiple-choice' || (q.options && typeof q.answerIndex === 'number')) {
      const idx = typeof given === 'number' ? given : Number(given)
      expected = q.options?.[q.answerIndex ?? -1] ?? ''
      chosen = q.options?.[idx] ?? String(given ?? '')
      isCorrect = idx === q.answerIndex
    } else {
      expected = q.answer ?? ''
      chosen = typeof given === 'number' ? String(given) : (given ?? '')
      const e = normalise(expected)
      const c = normalise(chosen)
      if (e && c) {
        const eTokens = new Set(e.split(/\s+/).filter((w) => w.length > 3))
        const cTokens = new Set(c.split(/\s+/).filter((w) => w.length > 3))
        let overlap = 0
        for (const t of eTokens) if (cTokens.has(t)) overlap++
        isCorrect = eTokens.size === 0 ? c === e : overlap / eTokens.size >= 0.5
      }
    }
    if (isCorrect) correct++
    details.push({ id: q.id, correct: isCorrect, expected, chosen })
  }
  return { correct, total: questions.length, details }
}

/**
 * Deterministically grade an exercise **only** when it carries an unambiguous
 * answer key: a multiple-choice key, or an exact expected result. Free-form
 * code/scenario/find-error/explain answers return `gradeable: false` so the UI
 * keeps honest self-marking instead of guessing. Never executes learner code.
 */
export interface ExerciseGrade {
  gradeable: boolean
  /** null when not gradeable (nothing is claimed). */
  correct: boolean | null
  /** The reference answer, when one exists (still hidden until requested). */
  expected?: string
}

export function gradeExercise(exercise: Exercise, answer: { choice?: number | null; text?: string }): ExerciseGrade {
  if (exercise.options && exercise.options.length >= 2 && typeof exercise.answerIndex === 'number') {
    const expected = exercise.options[exercise.answerIndex] ?? ''
    const choice = typeof answer.choice === 'number' ? answer.choice : -1
    return { gradeable: true, correct: choice === exercise.answerIndex, expected }
  }
  if (typeof exercise.expected === 'string' && exercise.expected.trim()) {
    const expected = exercise.expected
    const exp = normalise(expected)
    const got = normalise(answer.text ?? '')
    // Exact match, or the expected value appears as a standalone token
    // ("6" matches "6" and "the answer is 6", but not "16").
    const tokenHit = got.length > 0 && got.split(/\s+/).includes(exp)
    return { gradeable: true, correct: got === exp || tokenHit, expected }
  }
  return { gradeable: false, correct: null }
}

// ── Learning progress ────────────────────────────────────────────────────────
// Stored inside the existing Session persistence — there is no second DB.

export interface TopicProgress {
  topicId: string
  subject: SubjectId
  label: string
  presented: number
  exercisesAttempted: number
  quizAttempts: number
  quizCorrect: number
  quizTotal: number
  mistakes: number
  needsRevision: boolean
  lastAt: string
}

export interface LearningHistoryEntry {
  kind: 'lesson' | 'quiz' | 'exercise'
  topicId: string
  detail: string
  at: string
}

export interface LearningProgress {
  version: number
  topics: Record<string, TopicProgress>
  history: LearningHistoryEntry[]
}

export function emptyProgress(): LearningProgress {
  return { version: 1, topics: {}, history: [] }
}

function ensure(progress: LearningProgress, plan: Pick<LessonPlan, 'topicId' | 'subject' | 'topic'>, at: string): TopicProgress {
  let tp = progress.topics[plan.topicId]
  if (!tp) {
    tp = {
      topicId: plan.topicId,
      subject: plan.subject,
      label: plan.topic,
      presented: 0,
      exercisesAttempted: 0,
      quizAttempts: 0,
      quizCorrect: 0,
      quizTotal: 0,
      mistakes: 0,
      needsRevision: false,
      lastAt: at,
    }
    progress.topics[plan.topicId] = tp
  }
  tp.lastAt = at
  return tp
}

export function recordLesson(progress: LearningProgress, plan: LessonPlan, at = new Date().toISOString()): LearningProgress {
  const next = cloneProgress(progress)
  const tp = ensure(next, plan, at)
  tp.presented += 1
  next.history.push({ kind: 'lesson', topicId: plan.topicId, detail: `Presented “${plan.topic}” (${plan.level})`, at })
  return boundHistory(next)
}

export function recordQuiz(progress: LearningProgress, plan: Pick<LessonPlan, 'topicId' | 'subject' | 'topic'>, grade: QuizGrade, at = new Date().toISOString()): LearningProgress {
  const next = cloneProgress(progress)
  const tp = ensure(next, plan, at)
  tp.quizAttempts += 1
  tp.quizCorrect += grade.correct
  tp.quizTotal += grade.total
  tp.mistakes += grade.total - grade.correct
  tp.needsRevision = grade.total > 0 && grade.correct / grade.total < 0.6
  next.history.push({ kind: 'quiz', topicId: plan.topicId, detail: `Quiz ${grade.correct}/${grade.total}`, at })
  return boundHistory(next)
}

export function recordExercise(progress: LearningProgress, plan: Pick<LessonPlan, 'topicId' | 'subject' | 'topic'>, correct: boolean, detail: string, at = new Date().toISOString()): LearningProgress {
  const next = cloneProgress(progress)
  const tp = ensure(next, plan, at)
  tp.exercisesAttempted += 1
  if (!correct) tp.mistakes += 1
  next.history.push({ kind: 'exercise', topicId: plan.topicId, detail, at })
  return boundHistory(next)
}

function cloneProgress(p: LearningProgress): LearningProgress {
  return {
    version: p.version,
    topics: Object.fromEntries(Object.entries(p.topics).map(([k, v]) => [k, { ...v }])),
    history: p.history.slice(),
  }
}

const MAX_HISTORY = 200
function boundHistory(p: LearningProgress): LearningProgress {
  if (p.history.length > MAX_HISTORY) p.history = p.history.slice(p.history.length - MAX_HISTORY)
  return p
}

/** Suggest what to study next: mastery gaps first, then the topic graph. */
export function recommendNext(progress: LearningProgress, plan: { next: string[] }): { topicId: string; label: string } | null {
  const weak = Object.values(progress.topics)
    .filter((t) => t.needsRevision)
    .sort((a, b) => b.mistakes - a.mistakes)[0]
  if (weak) return { topicId: weak.topicId, label: `${weak.label} (revision — ${weak.quizCorrect}/${weak.quizTotal} correct last time)` }
  if (plan.next.length > 0) {
    const nextId = findTopicIdByLabel(plan.next[0])
    return { topicId: nextId ?? plan.next[0], label: plan.next[0] }
  }
  return null
}

function findTopicIdByLabel(label: string): string | undefined {
  return TOPICS.find((t) => t.label === label)?.id
}

export function progressSummary(progress: LearningProgress): string[] {
  return Object.values(progress.topics)
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
    .map((t) => {
      const acc = t.quizTotal > 0 ? ` · quiz ${t.quizCorrect}/${t.quizTotal}` : ''
      const ex = t.exercisesAttempted > 0 ? ` · ${t.exercisesAttempted} exercise${t.exercisesAttempted === 1 ? '' : 's'}` : ''
      const rev = t.needsRevision ? ' · needs revision' : ''
      return `${t.label}: studied ×${t.presented}${acc}${ex}${rev}`
    })
}

// ── Deterministic diagram → ASCII (offline visual fallback) ──────────────────

export function diagramAsAscii(diagram: LessonDiagram): string {
  if (diagram.format === 'ascii' && diagram.ascii) return diagram.ascii
  if (!diagram.nodes || diagram.nodes.length === 0) return (diagram.caption ?? '').slice(0, MAX_SECTION_CHARS)
  const labels = diagram.nodes.map((n) => n.label.replace(/\|/g, '/'))
  const w = Math.max(...labels.map((l) => l.length)) + 2
  const bar = '+' + '-'.repeat(w) + '+'
  const lines: string[] = []
  labels.forEach((l, i) => {
    lines.push(bar)
    lines.push('| ' + l.padEnd(w - 1) + '|')
    if (i < labels.length - 1) lines.push('|' + ' '.repeat(w) + '|')
  })
  lines.push(bar)
  if (diagram.caption) lines.push('', diagram.caption)
  return lines.join('\n')
}

// ── Lesson → Markdown (for the conversation transcript + task result) ─────────

export function lessonToMarkdown(
  plan: LessonPlan,
  results: Record<string, string | undefined>,
  quizGrade?: QuizGrade,
): string {
  const parts: string[] = []
  parts.push(`# ${plan.topic}`)
  parts.push(`_${plan.subjectLabel} · ${LEVEL_LABEL[plan.level]}_`)
  for (const s of plan.sections) {
    const body = (results[s.kind] ?? s.fallback).trim()
    if (!body) continue
    parts.push(`## ${s.label}\n\n${body}`)
  }
  if (plan.quiz.length > 0) {
    parts.push('## Practice questions')
    plan.quiz.forEach((q, i) => {
      const opts = q.options ? '\n' + q.options.map((o, j) => `   ${String.fromCharCode(65 + j)}. ${o}`).join('\n') : ''
      parts.push(`${i + 1}. ${q.prompt}${opts}`)
    })
  }
  if (plan.exercises.length > 0) {
    parts.push('## Exercises')
    plan.exercises.forEach((e, i) => parts.push(`${i + 1}. (${e.level}) ${e.prompt}`))
  }
  if (quizGrade) parts.push(`## Quiz result\n\nScored **${quizGrade.correct}/${quizGrade.total}**.`)
  return parts.join('\n\n')
}
