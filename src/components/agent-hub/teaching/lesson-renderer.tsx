'use client'

// ── Lesson renderer (inside Sessions) ────────────────────────────────────────
// Renders a LessonView produced by the Teaching Agent: markdown sections with
// highlighted code, a subject-appropriate visual (SVG flow / ASCII), and the
// app-owned interactive assessments (quiz with check + explanation + retry,
// exercises with progressive hints and hidden solutions). Content is data — it
// is rendered as markdown/values, never executed.

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy, Eye, EyeOff, Lightbulb, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { highlightCode, type LessonRef, type LessonView } from '@/lib/agent-hub/agent-session'
import { scoreQuiz, gradeExercise, type Exercise, type ExerciseGrade, type LessonDiagram, type QuizQuestion } from '@/lib/agent-hub/teaching-framework'

const CODE_CLASS: Record<string, string> = {
  kw: 'text-violet-600 dark:text-violet-300',
  str: 'text-emerald-700 dark:text-emerald-300',
  com: 'text-zinc-500 italic',
  num: 'text-amber-700 dark:text-amber-300',
  fn: 'text-sky-700 dark:text-sky-300',
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const tokens = highlightCode(code, language)
  return (
    <div className="group/code relative my-2 overflow-hidden rounded-md border bg-secondary/70 dark:bg-black/40">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1">
        <span className="font-mono text-[10px] text-muted-foreground">{language || 'code'}</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(code).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/code:opacity-100"
        >
          {copied ? <Check className="size-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="hub-scroll overflow-x-auto p-2.5 font-mono text-[11px] leading-relaxed">
        <code>
          {tokens.map((t, i) => (
            <span key={i} className={t.cls ? CODE_CLASS[t.cls] : undefined}>
              {t.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function MarkdownCode(props: { className?: string; children?: React.ReactNode }) {
  const { className, children } = props
  const match = /language-([\w+-]+)/.exec(className ?? '')
  const text = String(children ?? '').replace(/\n$/, '')
  const block = Boolean(match) || text.includes('\n')
  if (!block) return <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px]">{children}</code>
  return <CodeBlock language={match?.[1] ?? ''} code={text} />
}

function Prose({ text }: { text: string }) {
  return (
    <div className="break-words text-xs leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1.5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[11px] [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:border [&_th]:border-border [&_th]:bg-secondary [&_th]:px-1.5 [&_th]:py-0.5 [&_ul]:list-disc">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: MarkdownCode }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

// ── Visual: SVG flow or ASCII, vertical and mobile-readable ──────────────────

function FlowDiagram({ diagram }: { diagram: LessonDiagram }) {
  const nodes = diagram.nodes ?? []
  if (nodes.length === 0) return null
  const W = 420
  const boxH = 46
  const rowH = 66
  const H = 16 + nodes.length * rowH
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]))
  return (
    <div className="my-2 overflow-x-auto rounded-lg border bg-card p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" style={{ minWidth: 280 }}>
        <defs>
          <marker id="teach-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-muted-foreground/60" />
          </marker>
        </defs>
        {(diagram.edges ?? []).map((e, i) => {
          const a = indexOf.get(e.from)
          const b = indexOf.get(e.to)
          if (a === undefined || b === undefined) return null
          const ax = W / 2
          const ay = 16 + a * rowH + boxH
          const by = 16 + b * rowH
          return (
            <g key={i}>
              <line x1={ax} y1={ay} x2={ax} y2={by} stroke="currentColor" className="text-muted-foreground/50" strokeWidth={1.2} markerEnd="url(#teach-arrow)" />
              {e.label ? (
                <text x={ax + 6} y={(ay + by) / 2} className="fill-muted-foreground text-[8px]">
                  {e.label}
                </text>
              ) : null}
            </g>
          )
        })}
        {nodes.map((n, i) => (
          <g key={n.id}>
            <rect x={16} y={16 + i * rowH} width={W - 32} height={boxH} rx={8} className="fill-secondary stroke-border" strokeWidth={1} />
            <text x={W / 2} y={16 + i * rowH + boxH / 2 + 4} textAnchor="middle" className="fill-foreground text-[10px]">
              {n.label.length > 56 ? n.label.slice(0, 55) + '…' : n.label}
            </text>
          </g>
        ))}
      </svg>
      {diagram.caption ? <p className="px-1 pb-1 pt-1.5 text-[11px] text-muted-foreground">{diagram.caption}</p> : null}
    </div>
  )
}

function DiagramView({ diagram }: { diagram: LessonDiagram }) {
  if (diagram.format === 'ascii' && diagram.ascii) {
    return (
      <div className="my-2 overflow-x-auto rounded-lg border bg-secondary/60 p-2 dark:bg-black/30">
        <pre className="font-mono text-[11px] leading-relaxed">{diagram.ascii}</pre>
        {diagram.caption ? <p className="mt-1.5 text-[10px] text-muted-foreground">{diagram.caption}</p> : null}
      </div>
    )
  }
  return <FlowDiagram diagram={diagram} />
}

// ── Interactive quiz: real check-answer with explanation and retry ───────────

function QuizCard({ question, index, onChecked }: { question: QuizQuestion; index: number; onChecked?: (id: string, correct: boolean, detail: string) => void }) {
  const [choice, setChoice] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [checked, setChecked] = useState(false)
  const [showHint, setShowHint] = useState(false)

  const isMc = Boolean(question.options && typeof question.answerIndex === 'number')
  const grade = checked
    ? scoreQuiz([question], { [question.id]: isMc ? (choice ?? -1) : text })
    : null
  const correct = grade?.details[0]?.correct ?? false

  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">Q{index + 1}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{question.kind.replace('-', ' ')} · {question.level}</span>
      </div>
      <Prose text={question.prompt} />
      {isMc ? (
        <div className="mt-2 space-y-1">
          {question.options!.map((opt, i) => (
            <label key={i} className={cn('flex cursor-pointer items-start gap-2 rounded border px-2 py-1 text-[11px]', choice === i ? 'border-primary bg-primary/10' : 'border-border')}>
              <input type="radio" name={question.id} className="mt-0.5" checked={choice === i} onChange={() => { setChoice(i); setChecked(false) }} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      ) : (
        <textarea
          className="mt-2 h-16 w-full rounded border border-input bg-background p-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Type your answer…"
          value={text}
          onChange={(e) => { setText(e.target.value); setChecked(false) }}
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1 text-[11px]"
          disabled={isMc ? choice === null : !text.trim()}
          onClick={() => {
            const g = scoreQuiz([question], { [question.id]: isMc ? (choice ?? -1) : text })
            onChecked?.(question.id, g.details[0]?.correct ?? false, question.prompt.slice(0, 60))
            setChecked(true)
          }}
        >
          Check answer
        </Button>
        {question.hint ? (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => setShowHint((v) => !v)}>
            <Lightbulb className="size-3" /> {showHint ? 'Hide hint' : 'Hint'}
          </Button>
        ) : null}
        {checked ? (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => { setChecked(false); setShowHint(false); if (!isMc) setText('') }}>
            <RotateCcw className="size-3" /> Retry
          </Button>
        ) : null}
      </div>
      {showHint && question.hint ? <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">Hint: {question.hint}</p> : null}
      {checked && grade ? (
        <div className={cn('mt-1.5 rounded px-2 py-1.5 text-[11px]', correct ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'bg-red-500/10 text-red-800 dark:text-red-200')}>
          <span className="font-medium">{correct ? 'Correct.' : 'Not quite.'}</span> {question.explanation}
          {!correct && isMc ? <span className="mt-0.5 block text-foreground/80">Correct answer: {question.options?.[question.answerIndex ?? -1]}</span> : null}
          {!correct && !isMc && question.answer ? <span className="mt-0.5 block text-foreground/80">Model answer: {question.answer}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

// ── Progressive exercises: hint → solution (hidden until asked) ──────────────

function ExerciseCard({ exercise, index, onSolved }: { exercise: Exercise; index: number; onSolved: (correct: boolean, detail: string) => void }) {
  const [showHint, setShowHint] = useState(false)
  const [showSolution, setShowSolution] = useState(false)
  const [done, setDone] = useState(false)
  const [choice, setChoice] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [grade, setGrade] = useState<ExerciseGrade | null>(null)
  const [recorded, setRecorded] = useState(false)

  const isMc = Boolean(exercise.options && exercise.options.length >= 2 && typeof exercise.answerIndex === 'number')
  const hasExpected = typeof exercise.expected === 'string' && exercise.expected.trim().length > 0
  const checkable = isMc || hasExpected

  function check(): void {
    const g = gradeExercise(exercise, { choice, text })
    setGrade(g)
    if (g.gradeable && g.correct) setDone(true)
    if (!recorded) {
      setRecorded(true)
      onSolved(Boolean(g.correct), `${g.correct ? 'Solved' : 'Attempted'} exercise "${exercise.prompt.slice(0, 60)}"`)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">E{index + 1}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{exercise.level} · {exercise.kind.replace('-', ' ')}</span>
        {checkable ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">auto-graded</span> : null}
      </div>
      <Prose text={exercise.prompt} />
      {exercise.code ? <CodeBlock language={exercise.language ?? ''} code={exercise.code} /> : null}
      {isMc ? (
        <div className="mt-2 space-y-1">
          {exercise.options!.map((opt, i) => (
            <label key={i} className={cn('flex cursor-pointer items-start gap-2 rounded border px-2 py-1 text-[11px]', choice === i ? 'border-primary bg-primary/10' : 'border-border')}>
              <input type="radio" name={exercise.id} className="mt-0.5" checked={choice === i} disabled={done} onChange={() => { setChoice(i); setGrade(null) }} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      ) : hasExpected ? (
        <textarea
          className="mt-2 h-16 w-full rounded border border-input bg-background p-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Type your answer…"
          value={text}
          disabled={done}
          onChange={(e) => { setText(e.target.value); setGrade(null) }}
        />
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {checkable ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1 text-[11px]"
            disabled={done || (isMc ? choice === null : !text.trim())}
            onClick={check}
          >
            <Check className="size-3" /> {done ? 'Correct' : 'Check answer'}
          </Button>
        ) : (
          <Button
            size="sm"
            variant={done ? 'secondary' : 'default'}
            className="h-7 gap-1 text-[11px]"
            disabled={done}
            onClick={() => { setDone(true); onSolved(true, `Solved exercise "${exercise.prompt.slice(0, 60)}"`) }}
          >
            <Check className="size-3" /> {done ? 'Marked solved' : "I've solved it"}
          </Button>
        )}
        {exercise.hint ? (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => setShowHint((v) => !v)}>
            <Lightbulb className="size-3" /> {showHint ? 'Hide hint' : 'Hint'}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => setShowSolution((v) => !v)}>
          {showSolution ? <EyeOff className="size-3" /> : <Eye className="size-3" />} {showSolution ? 'Hide solution' : 'Show solution'}
        </Button>
      </div>
      {showHint && exercise.hint ? <p className="mt-1.5 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">Hint: {exercise.hint}</p> : null}
      {grade?.gradeable && grade.correct === false ? (
        <p className="mt-1.5 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-800 dark:text-red-200">
          Not quite — try again or use the hint. The solution stays hidden until you ask for it.
        </p>
      ) : null}
      {grade?.gradeable && grade.correct === true ? (
        <p className="mt-1.5 rounded bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-800 dark:text-emerald-200">Correct.</p>
      ) : null}
      {!checkable ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground">Self-marked: this exercise is open-ended, so the app does not fake a grade.</p>
      ) : null}
      {showSolution ? (
        <div className="mt-1.5">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Solution</p>
          {exercise.language ? <CodeBlock language={exercise.language} code={exercise.solution} /> : <Prose text={exercise.solution} />}
        </div>
      ) : null}
    </div>
  )
}

// ── Lesson body ──────────────────────────────────────────────────────────────

export function LessonRenderer({
  lesson,
  onExerciseSolved,
  onQuizChecked,
}: {
  lesson: LessonView
  ref: LessonRef
  onExerciseSolved: (correct: boolean, detail: string) => void
  onQuizChecked?: (id: string, correct: boolean, detail: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{lesson.topic}</h2>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {lesson.subjectLabel} · {lesson.level} · {lesson.modelUsed ? 'model-enriched' : 'app content'}
          </span>
        </div>
        {lesson.prerequisites.length > 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">Prerequisites: {lesson.prerequisites.join(' · ')}</p>
        ) : null}
        {lesson.sources.length > 0 ? (
          <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">Using your own material: {lesson.sources.join(', ')}</p>
        ) : null}
        {lesson.coverage && lesson.coverage !== 'bank' && lesson.coverageNote ? (
          <p className="mt-1 rounded bg-sky-500/10 px-2 py-1 text-[11px] text-sky-800 dark:text-sky-200">{lesson.coverageNote}</p>
        ) : null}
        {lesson.validation ? (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Validation note: {lesson.validation}</p>
        ) : null}
      </div>

      {lesson.sections.map((s) => (
        <section key={s.kind} className="rounded-lg border bg-card p-3">
          <h3 className="mb-1.5 text-[13px] font-semibold">{s.label}</h3>
          {s.kind === 'visual' ? <DiagramView diagram={lesson.diagram} /> : null}
          <Prose text={s.markdown} />
        </section>
      ))}

      {lesson.quiz.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold">Practice questions</h3>
          <p className="text-[11px] text-muted-foreground">Answer each question and check it — explanations appear after you try.</p>
          {lesson.quiz.map((q, i) => (
            <QuizCard key={q.id} question={q} index={i} onChecked={onQuizChecked} />
          ))}
        </section>
      ) : null}

      {lesson.exercises.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold">Exercises</h3>
          <p className="text-[11px] text-muted-foreground">Try these yourself. Hints and solutions are hidden until you ask.</p>
          {lesson.exercises.map((e, i) => (
            <ExerciseCard key={e.id} exercise={e} index={i} onSolved={onExerciseSolved} />
          ))}
        </section>
      ) : null}
    </div>
  )
}
