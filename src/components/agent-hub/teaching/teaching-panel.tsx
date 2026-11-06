'use client'

// ── Teaching panel (inside Sessions) ─────────────────────────────────────────
// The application owns the lesson framework, the assessment structure, the
// scoring and the progress record; the local model only enriches section prose.
// "Teach me" runs the real Sessions pipeline (Project Manager + Teaching Agent),
// and every control here does something real: quizzes check and explain,
// exercises reveal hints/solutions, progress and the next topic are persisted.

import { useEffect, useMemo, useRef, useState } from 'react'
import { GraduationCap, Loader2, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  LEVELS,
  SUBJECTS,
  progressSummary,
  type LearningProgress,
  type Level,
  type LessonRequest,
  type SubjectId,
} from '@/lib/agent-hub/teaching-framework'
import {
  askWithinLesson,
  clearLearningProgress,
  getLearningProgress,
  recordLessonAnswer,
  recordLessonExercise,
  suggestNextLesson,
  subscribeAgentSession,
  teachTopic,
  type AgentSessionState,
  type LessonRef,
  type LessonView,
} from '@/lib/agent-hub/agent-session'
import { LessonRenderer } from './lesson-renderer'
import { HubSelect, HubSelectItem } from '../hub-select'

export function TeachingPanel({ seed, onClose }: { seed?: string; onClose: () => void }) {
  const [topic, setTopic] = useState(seed ?? '')
  const [subject, setSubject] = useState<SubjectId | 'auto'>('auto')
  const [level, setLevel] = useState<Level | 'auto'>('auto')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clarification, setClarification] = useState<string | null>(null)
  const [lesson, setLesson] = useState<LessonView | null>(null)
  const [progress, setProgress] = useState<LearningProgress>(() => safeProgress())
  const [followUp, setFollowUp] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [next, setNext] = useState<{ topicId: string; label: string } | null>(null)
  const recorded = useRef<Set<string>>(new Set())
  const autoRan = useRef(false)

  const ref: LessonRef | null = useMemo(
    () => (lesson ? { topicId: lesson.topicId, subject: lesson.subject, topic: lesson.topic, next: lesson.next, quiz: lesson.quiz } : null),
    [lesson],
  )

  useEffect(() => {
    const unsub = subscribeAgentSession((s: AgentSessionState) => {
      setProgress(s.learningProgress)
      setRunning(s.isRunning)
    })
    return () => unsub()
  }, [])

  async function run(input: LessonRequest | string): Promise<void> {
    setError(null)
    setClarification(null)
    setReply(null)
    setNext(null)
    recorded.current = new Set()
    setRunning(true)
    try {
      const task = await teachTopic(input)
      if (task.lesson) {
        setLesson(task.lesson)
        setProgress(getLearningProgress())
      } else if (task.clarification) {
        // Ambiguous request: the agent asks rather than substituting a lesson.
        setLesson(null)
        setClarification(task.clarification)
      } else {
        setError(task.error ?? 'The Teaching Agent did not produce a lesson.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teaching failed.')
    } finally {
      setRunning(false)
    }
  }

  function teach(): void {
    const text = topic.trim()
    if (!text || running) return
    const req: LessonRequest = {
      topic: text,
      subject: subject === 'auto' ? undefined : subject,
      level: level === 'auto' ? undefined : level,
      context: text,
    }
    void run(req)
  }

  // A seeded request (typed in the composer) teaches immediately.
  useEffect(() => {
    if (seed && !autoRan.current) {
      autoRan.current = true
      void run(seed)
    }
  }, [seed])

  async function ask(): Promise<void> {
    const q = followUp.trim()
    if (!q || !lesson || asking) return
    setAsking(true)
    setReply(null)
    try {
      // Continuity without re-sending the whole lesson: hand the model a bounded
      // excerpt of the concept/example material it already produced.
      const context = lesson.sections
        .filter((s) => s.kind === 'concepts' || s.kind === 'examples')
        .map((s) => s.markdown)
        .join('\n\n')
        .slice(0, 1800)
      const r = await askWithinLesson(lesson.topic, lesson.subject, q, context)
      setReply(r.ok ? r.result : `Teaching Agent could not answer: ${r.error ?? 'model unavailable'}`)
    } finally {
      setAsking(false)
    }
  }

  function computeNext(): void {
    if (!ref) return
    setNext(suggestNextLesson(ref))
  }

  const summary = progressSummary(progress)

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap className="size-4 text-primary" />
          <span className="text-sm font-semibold">Teaching Agent</span>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">structured lessons · graded practice · progress</span>
        </div>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={onClose}>
          <X className="size-3.5" /> Close
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="What should I teach you? e.g. Python OOPs, SQL joins, Excel VLOOKUP…"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') teach() }}
        />
        <HubSelect
          ariaLabel="Subject (auto-detected when left on Auto)"
          title="Subject (auto-detected when left on Auto)"
          value={subject}
          onValueChange={(next) => setSubject(next as SubjectId | 'auto')}
          className="w-full"
        >
          <HubSelectItem value="auto">Subject: auto</HubSelectItem>
          {SUBJECTS.filter((s) => s.id !== 'generic').map((s) => (
            <HubSelectItem key={s.id} value={s.id}>{s.label}</HubSelectItem>
          ))}
        </HubSelect>
        <HubSelect
          ariaLabel="Level"
          title="Level"
          value={level}
          onValueChange={(next) => setLevel(next as Level | 'auto')}
          className="w-full"
        >
          <HubSelectItem value="auto">Level: auto</HubSelectItem>
          {LEVELS.map((l) => (
            <HubSelectItem key={l} value={l}>{l}</HubSelectItem>
          ))}
        </HubSelect>
        <Button size="sm" className="h-8 gap-1.5" disabled={!topic.trim() || running} onClick={teach}>
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Teach me
        </Button>
      </div>

      {running ? (
        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> The Project Manager is delegating section by section to the Teaching Agent…
        </p>
      ) : null}
      {error ? <p className="rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">{error}</p> : null}
      {clarification ? (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">{clarification}</p>
      ) : null}

      {lesson && ref ? (
        <>
          <LessonRenderer
            lesson={lesson}
            ref={ref}
            onExerciseSolved={(correct, detail) => recordLessonExercise(ref, correct, detail)}
            onQuizChecked={(id, correct, detail) => {
              if (recorded.current.has(id)) return
              recorded.current.add(id)
              recordLessonAnswer(ref, correct, detail)
            }}
          />

          <div className="rounded-lg border bg-card p-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-semibold">Ask a follow-up</span>
              {next ? (
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => { setTopic(next.label); void run(next.label) }}>
                  Teach next: {next.label}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={computeNext}>
                  <Sparkles className="size-3" /> Suggest next topic
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Ask a question about this lesson…"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void ask() }}
              />
              <Button size="sm" variant="secondary" className="h-8 gap-1.5" disabled={!followUp.trim() || asking} onClick={() => void ask()}>
                {asking ? <Loader2 className="size-3.5 animate-spin" /> : null} Ask
              </Button>
            </div>
            {reply ? <div className="mt-2 whitespace-pre-wrap rounded bg-secondary/60 p-2 text-[11px] leading-relaxed">{reply}</div> : null}
          </div>
        </>
      ) : null}

      <div className="rounded-lg border bg-card p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[13px] font-semibold">Learning progress</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => setProgress(getLearningProgress())}>
              <RefreshCw className="size-3" /> Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-[11px]"
              disabled={summary.length === 0}
              onClick={() => { clearLearningProgress(); setProgress(getLearningProgress()) }}
            >
              <Trash2 className="size-3" /> Clear
            </Button>
          </div>
        </div>
        {summary.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nothing tracked yet. Study a topic and answer questions to build your record.</p>
        ) : (
          <ul className={cn('space-y-0.5 text-[11px]')}>
            {summary.map((line) => (
              <li key={line} className="text-foreground/90">{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function safeProgress(): LearningProgress {
  try {
    return getLearningProgress()
  } catch {
    return { version: 1, topics: {}, history: [] }
  }
}
