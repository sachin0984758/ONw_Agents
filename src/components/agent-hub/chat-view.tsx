'use client'

import Image from 'next/image'

import { splitInteractiveQuizzes, calculateQuizScore, type InteractiveQuiz } from '@/lib/agent-hub/quiz-parser'
import { useModelPreference } from '@/lib/agent-hub/use-model-preference'
import { AssistantMark } from '@/components/agent-hub/assistant-mark'
export { splitInteractiveQuizzes, calculateQuizScore } from '@/lib/agent-hub/quiz-parser'

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  AlertTriangle,
  Brain,
  CircleCheck,
  CircleX,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Eraser,
  FileText,
  GraduationCap,
  Loader2,
  Pause,
  Paperclip,
  Play,
  Plus,
  RotateCw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { removeQueuedMessage, sendNextQueuedMessage, acknowledgeChatMessages, discardChatRun, getChatRun, getServerChatRun, mergeChatMessages, setChatRunPaused, startChatRun, stopChatRun, subscribeChatRun } from '@/lib/agent-hub/chat-runs'
import { MASCOT_CHAT_PAUSE_EVENT, MASCOT_CHAT_SEND_EVENT } from '@/lib/agent-hub/mascot-activity'
import { Button } from '@/components/ui/button'
import { HubSelect, HubSelectGroup, HubSelectItem, HubSelectLabel } from './hub-select'
import {
  ADD_CUSTOM_MODEL_VALUE,
  DEFAULT_CHAT_SETTINGS,
  MAX_SYSTEM_PROMPT_CHARS,
  RESPONSE_DEPTHS,
  RESPONSE_DEPTH_LABEL,
  THINKING_EFFORTS,
  loadChatSettings,
  saveChatSettings,
  type ChatSettings,
  type ResponseDepth,
  type ThinkingEffort,
} from '@/lib/agent-hub/chat-settings'
import {
  attachmentKind,
  validateAttachment,
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  type AttachmentKind,
  type ChatAttachmentPayload,
} from '@/lib/agent-hub/attachments'
import type { CustomModel } from '@/lib/agent-hub/types'
import type { LocalModelMetadata } from '@/lib/agent-hub/llm'
import type { ExplainBlock } from '@/lib/agent-hub/explain-protocol'
import type { CodingConversation, SessionTurn } from '@/lib/agent-hub/session/types'
import {
  newMessageId,
  normalizeHistory,
  type ChatActivityStep,
  type ChatMessage,
} from '@/lib/agent-hub/chat-types'
import { useHub } from '@/lib/agent-hub/store'
import { ExplainBlocks } from './explain/blocks'
import { CodeBlock } from './code-block'
import { ChatDiagram } from './chat-diagram'
import conversationStyles from './conversation-profile.module.css'

// A rendered chat message. `blocks` are preserved for legacy explanation entries.
type UiMessage = ChatMessage & {
  blocks?: ExplainBlock[]
  codingTurn?: SessionTurn
  /** Locally-attached files shown in the optimistic user bubble (not persisted). */
  attachments?: { name: string; kind: AttachmentKind; previewUrl?: string }[]
}

// A file the user picked but has not sent yet.
interface PendingAttachment {
  id: string
  file: File
  name: string
  mime: string
  size: number
  kind: AttachmentKind
  previewUrl?: string
  /** Non-null when the file is unsupported / too large — blocks sending. */
  error?: string
}

interface ChatConversation {
  id: string
  title: string
  updatedAt: string
  messageCount: number
}

const EFFORT_LABEL: Record<ThinkingEffort, string> = { low: 'Low', medium: 'Medium', high: 'High' }

const ATTACH_ACCEPT =
  '.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.json,.jsonc,.csv,.tsv,.log,.yml,.yaml,.xml,.html,.css,' +
  '.js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cc,.cpp,.hpp,.cs,.php,.sh,.ps1,.sql,.ini,.toml,.env,.pdf,.docx,.zip,image/*,text/*'

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read “${file.name}”.`))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : '')
    }
    reader.readAsDataURL(file)
  })
}

// Keep the internal grading request useful to the model and history, while
// showing a short, readable submission label in the chat transcript.
function displayChatMessage(content: string): string {
  const submission = /^My answers to "(.+?)":\s*([\s\S]+?)\. Please check them and explain any mistakes\.$/i.exec(content)
  if (!submission) return content
  const answerCount = submission[2].match(/\bQuestion\s+\d+:/gi)?.length ?? 0
  if (answerCount === 0) return content
  return `Submitted quiz: ${submission[1]} · ${answerCount} answers`
}

const PROSE_CLASS =
  'explain-prose text-[13.5px] leading-relaxed [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_strong]:font-semibold [&_strong]:text-foreground [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2.5 [&_h3]:text-[13.5px] [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:text-[13px] [&_h4]:font-semibold [&_h5]:mb-1 [&_h5]:mt-1.5 [&_h5]:text-[12.5px] [&_h5]:font-semibold [&_h6]:mb-1 [&_h6]:mt-1.5 [&_h6]:text-[12px] [&_h6]:font-semibold [&_h6]:text-muted-foreground [&_hr]:my-3 [&_hr]:border-border/50 [&_li]:ml-4 [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12.5px] [&_td]:border [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:border-border/60 [&_th]:bg-secondary/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground'

// Collapsible answer block (rendered from a ```answer fenced block in teach mode).
// Keeps quiz answers hidden until the learner chooses to reveal them.
function AnswerBlock({ children }: { children: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-emerald-500/30 bg-emerald-500/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {open ? 'Hide answer' : 'Show answer'}
      </button>
      {open ? (
        <div className="border-t border-emerald-500/20 px-3 py-2">
          <Markdown content={children} />
        </div>
      ) : null}
    </div>
  )
}

function QuizInlineText({ content }: { content: string }) {
  return <span className="break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em]">
    <ReactMarkdown allowedElements={['strong', 'em', 'code', 'del', 'br']} unwrapDisallowed remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </span>
}

function InteractiveQuizCard({
  quizzes,
  disabled = false,
}: {
  quizzes: InteractiveQuiz[]
  disabled?: boolean
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)
  const quizId = useId()
  const title = quizzes[0]?.title || 'Knowledge Check'
  const answeredCount = quizzes.filter((quiz) => answers[quiz.number]).length
  const progress = quizzes.length ? (answeredCount / quizzes.length) * 100 : 0
  const correctCount = calculateQuizScore(quizzes, answers)
  const canShowScore = quizzes.length > 0 && quizzes.every((quiz) => Boolean(quiz.correctLetter))
  const scoreMessage = correctCount === quizzes.length
    ? 'Excellent work! You got every question right.'
    : correctCount / quizzes.length >= 0.8
      ? 'Great work! Keep building on what you know.'
      : correctCount / quizzes.length >= 0.6
        ? 'Good work! Keep practicing.'
        : 'Keep practicing — review the explanations and try again.'

  const submitAnswers = () => {
    setSubmitted(true)
  }

  return (
    <section className="my-3 w-full max-w-[760px] overflow-hidden rounded-3xl border border-border/70 bg-card text-foreground shadow-sm" aria-label={title}>
      <header className="px-4 pb-3 pt-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">{title}</h3>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">Practice</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {quizzes[0]?.details || `${quizzes.length} ${quizzes.length === 1 ? 'question' : 'questions'} · Choose one answer for each`}
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${answeredCount} of ${quizzes.length} answered`}>
          <div className="h-full rounded-full bg-sky-500 transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <div className="px-4 sm:px-5">
        {quizzes.map((quiz, questionIndex) => (
          <fieldset key={`${quiz.number}-${questionIndex}`} className={cn('py-4', questionIndex > 0 && 'border-t border-border/60')} disabled={disabled || submitted}>
            <legend className="mb-3 block w-full text-sm font-semibold leading-relaxed">
              {quiz.number}. <QuizInlineText content={quiz.prompt} />
            </legend>
            <div className="space-y-1.5">
              {quiz.options.map((option) => {
                const selected = answers[quiz.number] === option.letter
                const isCorrect = option.letter === quiz.correctLetter
                return (
                  <label
                    key={`${quiz.number}-${option.letter}`}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-muted/70',
                      selected && !submitted && 'bg-primary/5',
                      submitted && selected && (isCorrect ? 'bg-emerald-500/10' : 'bg-amber-500/10'),
                      disabled && 'cursor-not-allowed opacity-70',
                    )}
                  >
                    <input
                      type="radio"
                      name={`chat-quiz-${quizId}-${quiz.number}`}
                      value={option.letter}
                      checked={selected}
                      data-testid="chat-quiz-option"
                      onChange={() => {
                        const next = { ...answers, [quiz.number]: option.letter }
                        setAnswers(next)
                      }}
                      className="size-5 shrink-0 accent-sky-500"
                    />
                    <span className="min-w-0"><span className="mr-1.5 font-medium">{option.letter}.</span><QuizInlineText content={option.text} /></span>
                  </label>
                )
              })}
            </div>
            {submitted && answers[quiz.number] ? (
              <div className="mt-2 text-xs" role="status">
                {quiz.correctLetter ? (
                  <>
                    <p className={cn('flex items-center gap-2 font-medium', answers[quiz.number] === quiz.correctLetter ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                      {answers[quiz.number] === quiz.correctLetter ? <CircleCheck className="size-4" aria-hidden="true" /> : <CircleX className="size-4" aria-hidden="true" />}
                      {answers[quiz.number] === quiz.correctLetter ? 'Correct' : <span>Correct answer: {quiz.correctLetter}. <QuizInlineText content={quiz.options.find((option) => option.letter === quiz.correctLetter)?.text ?? ''} /></span>}
                    </p>
                    {quiz.explanation ? <p className="mt-1 text-muted-foreground"><QuizInlineText content={quiz.explanation} /></p> : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </fieldset>
        ))}
      </div>

      {submitted ? (
        <div className="px-4 pb-5 pt-5 text-center sm:px-5" data-testid="chat-quiz-score" role="status" aria-live="polite">
          {canShowScore ? (
            <>
              <p className={cn('text-3xl font-semibold leading-none tracking-tight', correctCount === quizzes.length && 'text-emerald-600 dark:text-emerald-400')}>{correctCount} / {quizzes.length}</p>
              <p className="mt-2 text-sm text-muted-foreground">{scoreMessage}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">This older quiz has no complete answer key. Ask for a new quiz with answers and explanations to receive a score.</p>
          )}
        </div>
      ) : null}
      {submitted ? quizzes.filter((quiz) => quiz.quickExplanation).map((quiz) => (
        <div key={`explanation-${quiz.number}`} className="border-t border-border/60 px-4 py-4 sm:px-5" data-testid="chat-quiz-explanations">
          <MarkdownText content={quiz.quickExplanation!} />
        </div>
      )) : null}
      <footer className="border-t border-border/60 px-4 py-4 sm:px-5">
        {!submitted ? <p className="mb-3 text-xs text-muted-foreground">{answeredCount} of {quizzes.length} answered</p> : null}
        <div className="flex items-center gap-2">
          <button type="button" onClick={submitAnswers} disabled={disabled || submitted || answeredCount !== quizzes.length} data-testid="chat-quiz-submit" className="flex-1 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50">
            {submitted ? 'Quiz submitted' : 'Submit Quiz'}
          </button>
          <button
            type="button"
            onClick={() => {
              setAnswers({})
              setSubmitted(false)
            }}
            disabled={disabled}
            data-testid="chat-quiz-retry"
            aria-label="Try Again"
            title="Reset quiz and try again"
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border/80 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCw className="size-4" aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  )
}

const MarkdownText = memo(function MarkdownText({ content }: { content: string }) {
  return (
    <div className={PROSE_CLASS}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="hub-scroll my-2 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const raw = String(children ?? '')
            const lang = /language-([\w-]+)/.exec(className || '')?.[1] ?? ''
            if (lang === 'answer') return <AnswerBlock>{raw.replace(/\n$/, '')}</AnswerBlock>
            if (lang === 'diagram') return <ChatDiagram source={raw} />
            const isBlock = /language-/.test(className ?? '') || raw.includes('\n')
            if (!isBlock) {
              return <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[12px]">{children}</code>
            }
            return <CodeBlock language={lang} code={raw.replace(/\n$/, '')} />
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

// Markdown renderer for assistant messages, with clickable tutor MCQs.
export function Markdown({
  content,
  disabled,
}: {
  content: string
  disabled?: boolean
}) {
  const segments = splitInteractiveQuizzes(content)
  const rendered: ReactNode[] = []
  let index = 0
  while (index < segments.length) {
    const segment = segments[index]
    if (segment.type === 'markdown') {
      if (segment.content.trim()) rendered.push(<MarkdownText key={`markdown-${index}`} content={segment.content} />)
      index += 1
      continue
    }

    const quizzes = [segment.quiz]
    let next = index + 1
    while (next < segments.length) {
      const candidate = segments[next]
      if (candidate.type === 'quiz') {
        quizzes.push(candidate.quiz)
        next += 1
      } else if (!candidate.content.trim()) {
        next += 1
      } else {
        break
      }
    }
    rendered.push(
      <InteractiveQuizCard
        key={`quiz-${index}`}
        quizzes={quizzes}
        disabled={disabled}
      />,
    )
    index = next
  }
  return <>{rendered}</>
}

function CodingWorkDetails({ turn }: { turn: SessionTurn }) {
  const tools = turn.items.filter((item) => item.kind === 'tool')
  const notices = turn.items.filter((item) => item.kind === 'notice')
  return (
    <details className="mt-3 overflow-hidden rounded-lg border border-border/50 bg-background/50 text-left" data-testid="coding-work-details">
      <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-medium text-muted-foreground marker:hidden hover:text-foreground">
        Work details · {tools.length} {tools.length === 1 ? 'action' : 'actions'} · {turn.changes.length} {turn.changes.length === 1 ? 'file' : 'files'} changed
      </summary>
      <div className="space-y-2 border-t border-border/50 px-3 py-2.5">
        {tools.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-md border border-border/50">
            <div className="flex items-center gap-2 bg-secondary/40 px-2.5 py-1.5 text-[11px]">
              <Code2 className="size-3 shrink-0 text-primary" />
              <span className="font-mono font-medium">{item.name}</span>
              <span className="ml-auto text-muted-foreground">{item.status === 'waiting' ? 'Approval needed' : item.status === 'running' ? 'Running' : item.status === 'failed' ? 'Failed' : 'Completed'}</span>
            </div>
            {item.args ? <pre className="max-h-24 overflow-auto border-t border-border/40 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap">{JSON.stringify(item.args, null, 2)}</pre> : null}
            {item.output ? <pre className="max-h-36 overflow-auto border-t border-border/40 bg-background px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">{item.output.slice(0, 5000)}{item.output.length > 5000 ? '\n… output preview clipped' : ''}</pre> : null}
          </div>
        ))}
        {turn.changes.map((change) => (
          <div key={change.path} className="overflow-hidden rounded-md border border-border/50">
            <div className="flex items-center gap-2 bg-secondary/40 px-2.5 py-1.5 text-[10px] font-mono"><FileText className="size-3 text-primary" />{change.path}</div>
            <pre className="max-h-40 overflow-auto border-t border-border/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{change.before === null ? '(new file)\n' : `--- before ---\n${change.before.slice(0, 2500)}\n`}--- after ---\n{change.after.slice(0, 2500)}{change.truncated ? '\n… diff preview clipped' : ''}</pre>
          </div>
        ))}
        {notices.map((item) => <p key={item.id} className="rounded-md bg-amber-500/5 px-2.5 py-1.5 text-[10px] text-muted-foreground">{item.text}</p>)}
        {!tools.length && !turn.changes.length && !notices.length ? <p className="text-[10px] text-muted-foreground">No workspace actions were needed.</p> : null}
      </div>
    </details>
  )
}

// ── Tool/agent activity group ───────────────────────────────────────────────
function StatusDot({ status }: { status: ChatActivityStep['status'] }) {
  const cls =
    status === 'failed' ? 'bg-red-500' : status === 'running' ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
  return <span className={cn('mt-1 size-1.5 shrink-0 rounded-full', cls)} />
}

function ActivityGroup({ steps }: { steps: ChatActivityStep[] }) {
  const failed = steps.filter((s) => s.status === 'failed').length
  const done = steps.filter((s) => s.status === 'completed').length
  return (
    <div className="flex justify-start w-full">
      <details className="group w-full max-w-[85%] rounded-lg border bg-card/50">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3 shrink-0 transition-transform group-open:rotate-90" />
          <span className="font-medium text-foreground/80">
            Agent activity · {steps.length} operation{steps.length === 1 ? '' : 's'}
          </span>
          {failed > 0 ? (
            <span className="text-red-500">· {failed} failed</span>
          ) : (
            <span>· {done} completed</span>
          )}
        </summary>
        <ul className="space-y-1.5 border-t px-3 py-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[11.5px]">
              <StatusDot status={s.status} />
              <span className="flex-1 leading-relaxed">
                <span className={cn(s.status === 'failed' && 'text-red-600 dark:text-red-400')}>{s.label}</span>
                {s.detail ? <span className="text-muted-foreground"> — {s.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

interface StatusResponse {
  connected: boolean
  provider?: string
  modelId?: string
  loaded?: boolean
  isChatCompatible?: boolean
  warning?: string
  availableModels?: LocalModelMetadata[]
  customModels?: number
  error?: string
}

// ── Chat View Component ──────────────────────────────────────────────────────
export function ChatView({ conversationLayout = 'unified', profileImage }: { conversationLayout?: 'unified' | 'separate'; profileImage?: string }) {
  const [serverMessages, setMessages] = useState<UiMessage[]>([])
  const [draft, setDraft] = useState('')
  const [localError, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [activeChatId, setActiveChatId] = useState('legacy')
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const activeConversation = conversations.find((item) => item.id === activeChatId)
  const [conversationsReady, setConversationsReady] = useState(false)
  const [conversationPanelOpen, setConversationPanelOpen] = useState(false)
  const [conversationError, setConversationError] = useState<string | null>(null)
  const subscribeRun = useCallback((listener: () => void) => subscribeChatRun(activeChatId, listener), [activeChatId])
  const readRun = useCallback(() => getChatRun(activeChatId), [activeChatId])
  const run = useSyncExternalStore(subscribeRun, readRun, getServerChatRun)
  const pending = run.pending
  const isThinking = run.thinking
  const streamingText = run.text
  const error = localError ?? run.error
  const retryText = run.retryText
  const messages = useMemo(() => mergeChatMessages(serverMessages, run.messages) as UiMessage[], [serverMessages, run.messages])

  const [storedSettings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS)
  const globalModel = useModelPreference()
  const settings = useMemo(() => ({ ...storedSettings, model: globalModel.preference.model }), [storedSettings, globalModel.preference.model])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [responseDepthOpen, setResponseDepthOpen] = useState(false)
  const servedModel = run.model
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [availableModels, setAvailableModels] = useState<LocalModelMetadata[]>([])

  const [customModels, setCustomModels] = useState<CustomModel[]>([])
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [newModel, setNewModel] = useState({ name: '', endpoint: '', apiKey: '', modelId: '' })
  const [addError, setAddError] = useState('')

  // Attachments + Thinking control state
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const thinkingInfo = run.thinkingInfo
  const visionWarning = run.visionWarning
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  const projectName = useHub((s) => s.state.projectName)

  const listRef = useRef<HTMLDivElement>(null)
  const wasNearBottomRef = useRef(true)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const historyRequestRef = useRef(0)
  const messagesRef = useRef(messages)
  const [editingId, setEditingId] = useState('')
  const [editDraft, setEditDraft] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const editingChat = useRef(activeChatId)
  useEffect(() => {
    editingChat.current = activeChatId
  }, [activeChatId])
  const queuedMascotMessages = useRef<Array<{ chatId: string; text: string }>>([])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Normalize server history and preserve rich blocks for legacy messages
  const applyServer = useCallback((raw: unknown, coding?: CodingConversation | null) => {
    const normalized = normalizeHistory(raw)
    const codingMessages: UiMessage[] = (coding?.turns ?? []).flatMap((turn) => {
      const assistantText = [...turn.items].reverse().find((item) => item.kind === 'assistant' && item.text.trim())?.text.trim()
      const notices = turn.items.filter((item) => item.kind === 'notice').map((item) => item.text).join('\n\n')
      const reply = assistantText || (turn.status === 'running' ? '' : notices || `Task ${turn.status}. Open work details to inspect the result.`)
      const base: UiMessage[] = [{
        id: `coding-user-${turn.id}`, role: 'user', content: turn.request, time: turn.startedAt, kind: 'chat',
      }]
      if (reply) base.push({
        id: `coding-assistant-${turn.id}`, role: 'assistant', content: reply,
        time: turn.endedAt || turn.startedAt, kind: 'chat', codingTurn: turn,
      })
      return base
    })
    const combined = [...normalized, ...codingMessages].sort((a, b) => a.time.localeCompare(b.time))
    acknowledgeChatMessages(activeChatId, combined)
    setMessages((prev) => {
      // Reconcile: keep optimistic blocks if content matches
      return combined.map((m) => {
        if (m.role !== 'assistant' || !m.content) return m
        const match = prev.find((p) => p.blocks && p.role === m.role && p.content === m.content)
        return match ? { ...m, blocks: match.blocks } : m
      })
    })
  }, [activeChatId])

  const refreshConversations = useCallback(async () => {
    const res = await fetch('/api/chat/conversations', { cache: 'no-store' })
    if (!res.ok) throw new Error('Could not load conversations.')
    const json = await res.json() as { conversations?: ChatConversation[] }
    setConversations(Array.isArray(json.conversations) ? json.conversations : [])
    return Array.isArray(json.conversations) ? json.conversations : []
  }, [])

  useEffect(() => {
    let cancelled = false
    if (conversationsReady && !pending && (run.model || run.error)) {
      void Promise.resolve().then(() => { if (!cancelled) return refreshConversations() }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [activeChatId, conversationsReady, pending, refreshConversations, run.model, run.error])

  // Restore the selected conversation, while keeping the old flat history.
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => refreshConversations())
      .then((items) => {
        if (cancelled) return
        const saved = window.localStorage.getItem('agenthub-active-chat') || 'legacy'
        setActiveChatId(saved === 'legacy' || items.some((item) => item.id === saved) ? saved : items[0]?.id || 'legacy')
      })
      .catch(() => { if (!cancelled) setConversationError('Could not load the conversation list.') })
      .finally(() => {
        if (!cancelled) setConversationsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [refreshConversations])

  useEffect(() => {
    if (!conversationsReady) return
    let cancelled = false
    const request = ++historyRequestRef.current
    Promise.all([
      fetch(`/api/chat?chatId=${encodeURIComponent(activeChatId)}`).then((r) => r.json()),
      fetch(`/api/agent-session/conversations?chatId=${encodeURIComponent(activeChatId)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
    ])
      .then(([json, codingJson]) => {
        if (cancelled || request !== historyRequestRef.current) return
        const coding = codingJson?.ok && codingJson?.conversation && typeof codingJson.conversation.id === 'string'
          ? codingJson.conversation as CodingConversation
          : null
        if (Array.isArray(json?.messages)) applyServer(json.messages, coding)
      })
      .catch(() => { if (!cancelled) setConversationError('Could not load this chat.') })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [activeChatId, applyServer, conversationsReady])

  const switchChat = useCallback((id: string) => {
    if (id === activeChatId) return
    historyRequestRef.current += 1
    setLoaded(false)
    setMessages([])
    messagesRef.current = []
    wasNearBottomRef.current = true
    setActiveChatId(id)
    window.localStorage.setItem('agenthub-active-chat', id)
    setConversationPanelOpen(false)
    setDraft('')
    setAttachments((prev) => {
      for (const item of prev) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return []
    })
    setError(null)
    setConfirmClear(false)
    setAttachError(null)
    setConversationError(null)
  }, [activeChatId])

  const createChat = async () => {
    try {
      const res = await fetch('/api/chat/conversations', { method: 'POST' })
      const json = await res.json() as { conversation?: ChatConversation; error?: string }
      if (!res.ok || !json.conversation) throw new Error(json.error || 'Could not create chat.')
      setConversations((prev) => [json.conversation!, ...prev])
      switchChat(json.conversation.id)
    } catch (err) {
      setConversationError(err instanceof Error ? err.message : 'Could not create chat.')
    }
  }

  useEffect(() => {
    const selectChat = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail
      if (typeof id !== 'string') return
      switchChat(id)
      void refreshConversations().catch(() => {})
    }
    window.addEventListener('agenthub-select-chat', selectChat)
    return () => window.removeEventListener('agenthub-select-chat', selectChat)
  }, [refreshConversations, switchChat])

  useEffect(() => {
    const onDeleted = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: unknown; nextId?: unknown }>).detail
      if (typeof detail?.id !== 'string' || detail.id === 'legacy') return
      setConversations((current) => current.filter((entry) => entry.id !== detail.id))
      if (activeChatId === detail.id) switchChat(typeof detail.nextId === 'string' ? detail.nextId : 'legacy')
      void refreshConversations().catch(() => setConversationError('Could not refresh the conversation list.'))
    }
    window.addEventListener('agenthub-chat-deleted', onDeleted)
    return () => window.removeEventListener('agenthub-chat-deleted', onDeleted)
  }, [activeChatId, refreshConversations, switchChat])

  const deleteChat = async (id: string) => {
    if (id === 'legacy') return
    if (getChatRun(id).pending) { setConversationError('Stop this chat before deleting it. Other chats can keep running.'); return }
    if (!window.confirm('Delete this chat and its messages?')) return
    try {
      const res = await fetch(`/api/chat/conversations?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not delete chat.')
      discardChatRun(id)
      const remaining = conversations.filter((item) => item.id !== id)
      setConversations(remaining)
      if (activeChatId === id) switchChat(remaining[0]?.id || 'legacy')
    } catch (err) {
      setConversationError(err instanceof Error ? err.message : 'Could not delete chat.')
    }
  }

  // Settings hydration
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      setSettings(loadChatSettings())
      setSettingsLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Custom models load
  useEffect(() => {
    fetch('/api/custom-models')
      .then((r) => r.json())
      .then((json) => {
        if (Array.isArray(json?.models)) setCustomModels(json.models)
      })
      .catch(() => {})
  }, [showAddCustom])

  // Save settings on update
  useEffect(() => {
    if (!settingsLoaded) return
    saveChatSettings(settings)
  }, [settings, settingsLoaded])

  // Probe provider and loaded models status
  const checkStatus = useCallback(() => {
    if (!settingsLoaded) return
    fetch(`/api/chat?resource=status&model=${encodeURIComponent(settings.model)}`)
      .then((r) => r.json())
      .then((json: StatusResponse) => {
        setStatus(json)
        if (Array.isArray(json.availableModels)) {
          setAvailableModels(json.availableModels)
        }
      })
      .catch(() => {
        setStatus({ connected: false, error: 'Could not connect to model provider' })
      })
  }, [settings.model, settingsLoaded])

  useEffect(() => {
    checkStatus()
    const id = setInterval(checkStatus, 15000)
    return () => clearInterval(id)
  }, [checkStatus])

  // Live sync for external messages (e.g. from machine API)
  useEffect(() => {
    if (!conversationsReady) return
    let cancelled = false
    const id = setInterval(() => {
      if (getChatRun(activeChatId).pending) return
      const request = ++historyRequestRef.current
      Promise.all([
        fetch(`/api/chat?chatId=${encodeURIComponent(activeChatId)}`).then((r) => r.json()),
        fetch(`/api/agent-session/conversations?chatId=${encodeURIComponent(activeChatId)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      ])
        .then(([json, codingJson]) => {
          if (cancelled || request !== historyRequestRef.current || !Array.isArray(json?.messages)) return
          const coding = codingJson?.ok && codingJson?.conversation && typeof codingJson.conversation.id === 'string'
            ? codingJson.conversation as CodingConversation
            : null
              applyServer(json.messages, coding)
        })
        .catch(() => {})
    }, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [activeChatId, applyServer, conversationsReady])

  const updateScrollPosition = () => {
    const el = listRef.current
    if (!el) return
    wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    setShowJumpToBottom(!wasNearBottomRef.current)
  }

  const scrollToBottom = () => {
    const el = listRef.current
    if (!el) return
    wasNearBottomRef.current = true
    el.scrollTop = el.scrollHeight
    setShowJumpToBottom(false)
  }

  // Sticky-scroll only when near the bottom
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (wasNearBottomRef.current) el.scrollTop = el.scrollHeight
    setShowJumpToBottom(!wasNearBottomRef.current)
  }, [messages, pending, streamingText, isThinking])

  // Auto-expand textarea
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`
  }, [draft])

  // ── Attachments ────────────────────────────────────────────────────────────
  // Files the user selected are always shown, including any that cannot be
  // processed (with a reason) — nothing is silently dropped.
  const onPickFiles = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (list.length === 0) return
    setAttachError(null)
    setAttachments((prev) => {
      const next = [...prev]
      let total = next.reduce((sum, a) => sum + a.size, 0)
      for (const file of list) {
        if (next.length >= MAX_ATTACHMENTS) {
          setAttachError(`You can attach up to ${MAX_ATTACHMENTS} files.`)
          break
        }
        const kind = attachmentKind(file.name, file.type)
        const baseError = validateAttachment(file.name, file.type, file.size)
        total += file.size
        let error = baseError ?? undefined
        if (!error && total > MAX_TOTAL_ATTACHMENT_BYTES) {
          error = `Attachments exceed the ${MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024)} MB total limit.`
        }
        next.push({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          name: file.name,
          mime: file.type,
          size: file.size,
          kind: kind ?? 'document',
          previewUrl: kind === 'image' && !error ? URL.createObjectURL(file) : undefined,
          error,
        })
      }
      return next
    })
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  // Requests belong to the conversation store, so navigating away only
  // unsubscribes this view. Returning restores its optimistic turn and stream.
  const send = useCallback((override?: string, preserveComposer = false, afterEdit = false) => {
    const text = (override ?? draft).trim()
    if ((savingEdit && !afterEdit) || !conversationsReady || !loaded || !globalModel.ready || globalModel.saving || globalModel.error) return
    const usableAttachments = preserveComposer ? [] : attachments.filter((a) => !a.error)
    if (!preserveComposer && attachments.some((a) => a.error)) {
      setAttachError('Remove the unsupported attachment(s) before sending.')
      return
    }
    if (!text && !usableAttachments.length) return
    const chatId = activeChatId
    const selectedSettings = { ...settings }
    const history = messagesRef.current.filter((m) => m.kind === 'chat').map((m) => ({ role: m.role, content: m.content }))
    const userMsgId = newMessageId()
    const assistantMsgId = newMessageId()
    setError(null)
    setConfirmClear(false)
    if (!preserveComposer) {
      setAttachError(null)
      setDraft('')
      setAttachments([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      for (const item of usableAttachments) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    }
    wasNearBottomRef.current = true
    try { void startChatRun({
      chatId,
      user: { id: userMsgId, role: 'user', content: text, time: new Date().toISOString(), kind: 'chat', attachments: usableAttachments.map((a) => ({ name: a.name, kind: a.kind })) },
      assistantId: assistantMsgId,
      thinking: selectedSettings.thinking,
      queueIfBusy: true,
      prepareBody: async () => {
        const payloads: ChatAttachmentPayload[] = await Promise.all(usableAttachments.map(async (a) => ({ name: a.name, mime: a.mime, size: a.size, dataBase64: await readFileBase64(a.file) })))
        return {
          message: text,
          settings: { model: selectedSettings.model, systemPrompt: selectedSettings.systemPrompt, teachMode: selectedSettings.teachMode, advancedTeachMode: selectedSettings.advancedTeachMode, thinking: selectedSettings.thinking, effort: selectedSettings.effort, responseDepth: selectedSettings.responseDepth },
          history, stream: true, userMsgId, assistantMsgId, chatId,
          chatTitle: activeConversation?.title || '', attachments: payloads,
        }
      },
    }) } catch (reason) { setDraft(text); setError(reason instanceof Error ? reason.message : 'Could not queue message.') }
  }, [activeChatId, activeConversation?.title, attachments, conversationsReady, draft, globalModel.error, globalModel.ready, globalModel.saving, loaded, settings, savingEdit])

  const saveEditedMessage = async () => {
    if (pending || savingEdit || run.queued.length || !editDraft.trim() || !globalModel.ready) return
    const chatId = activeChatId
    const text = editDraft.trim()
    setSavingEdit(true)
    try {
      const response = await fetch('/api/chat', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, messageId: editingId, content: text }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not edit message.')
      discardChatRun(chatId)
      if (editingChat.current !== chatId) return
      setMessages(data.messages)
      messagesRef.current = data.messages
      setEditingId('')
      send(text, true, true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not edit message.') }
    finally { setSavingEdit(false) }
  }

  const stop = () => {
    queuedMascotMessages.current = queuedMascotMessages.current.filter((item) => item.chatId !== activeChatId)
    stopChatRun(activeChatId)
  }

  useEffect(() => {
    const onMascotSend = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: unknown; source?: unknown }>).detail
      if (typeof detail?.text !== 'string' || !detail.text.trim()) return
      if (typeof detail.source === 'string' && detail.source !== `chat:${activeChatId}`) return
      if (getChatRun(activeChatId).pending) {
        if (queuedMascotMessages.current.filter((item) => item.chatId === activeChatId).length >= 5) { setError('The pet chat queue is full. Wait for a message to finish before adding another.'); return }
        queuedMascotMessages.current.push({ chatId: activeChatId, text: detail.text.trim() })
      } else send(detail.text)
    }
    const onMascotPause = (event: Event) => {
      const detail = (event as CustomEvent<{ paused?: unknown; source?: unknown }>).detail
      if (typeof detail?.paused !== 'boolean' || (typeof detail.source === 'string' && detail.source !== `chat:${activeChatId}`)) return
      void setChatRunPaused(activeChatId, detail.paused).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not change the chat state.'))
    }
    window.addEventListener(MASCOT_CHAT_SEND_EVENT, onMascotSend)
    window.addEventListener(MASCOT_CHAT_PAUSE_EVENT, onMascotPause)
    return () => { window.removeEventListener(MASCOT_CHAT_SEND_EVENT, onMascotSend); window.removeEventListener(MASCOT_CHAT_PAUSE_EVENT, onMascotPause) }
  }, [activeChatId, send])

  useEffect(() => {
    if (pending) return
    const index = queuedMascotMessages.current.findIndex((item) => item.chatId === activeChatId)
    if (index < 0) return
    const [queued] = queuedMascotMessages.current.splice(index, 1)
    if (queued) send(queued.text)
  }, [activeChatId, pending, send])

  const clearChat = async () => {
    if (getChatRun(activeChatId).pending) { setError('Stop this response before clearing the chat.'); return }
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    try {
      const res = await fetch(`/api/chat?chatId=${encodeURIComponent(activeChatId)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not clear the server history.')
      await fetch('/api/agent-session/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink-chat', chatId: activeChatId }),
      }).catch(() => {})
      discardChatRun(activeChatId)
      setMessages([])
      setError(null)
      void refreshConversations().catch(() => {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear the chat.')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void createChat()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const copyResponse = (content: string) => {
    void navigator.clipboard?.writeText(content).catch(() => {})
  }

  const isCustomModel =
    settings.model !== '' &&
    !availableModels.some((m) => m.id === settings.model) &&
    !customModels.some((cm) => cm.id === settings.model)

  const promptCustomized = settings.systemPrompt.trim() !== DEFAULT_CHAT_SETTINGS.systemPrompt.trim()
  return (
    <div className={cn('relative flex min-h-0 flex-1 gap-3', conversationLayout === 'unified' && conversationStyles.unified)} data-chat-surface="workspace">
      {conversationPanelOpen ? (
        <aside className="absolute inset-y-0 left-0 z-30 flex w-60 flex-col rounded-2xl border bg-card p-2.5 shadow-lg md:static md:shrink-0 md:shadow-none" aria-label="Chat conversations" data-chat-surface="sidebar">
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <span className="text-xs font-semibold">Conversations</span>
            <button type="button" onClick={() => setConversationPanelOpen(false)} aria-label="Close conversations" className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="size-4" /></button>
          </div>
          <Button size="sm" variant="outline" className="mb-2 h-8 justify-start gap-2 text-xs" onClick={() => void createChat()} title="Start a new chat (Ctrl+Enter)"><Plus className="size-3.5" /> New chat</Button>
          <div className="hub-scroll min-h-0 flex-1 space-y-1 overflow-y-auto">
            {conversations.map((item) => (
              <div key={item.id} className={cn('group flex items-center gap-1 rounded-md px-1', activeChatId === item.id ? 'bg-primary/10 text-primary' : 'hover:bg-secondary')}>
                <button type="button" onClick={() => switchChat(item.id)} title={item.title} className="min-w-0 flex-1 truncate px-2 py-2 text-left text-xs">{item.title}</button>
                {item.id !== 'legacy' ? <button type="button" onClick={() => void deleteChat(item.id)} disabled={getChatRun(item.id).pending} aria-label={`Delete ${item.title}`} title="Delete chat" className="shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:bg-background hover:text-red-600 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 disabled:opacity-40"><Trash2 className="size-3.5" /></button> : null}
              </div>
            ))}
            {conversations.length === 0 ? <p className="px-2 py-3 text-xs text-muted-foreground">Start a new chat to keep conversations separate.</p> : null}
          </div>
        </aside>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3" data-chat-surface="canvas">
      {/* ── Header ── */}
      <div className="flex shrink-0 flex-col items-stretch justify-between gap-3 rounded-2xl border bg-card/70 px-3 py-3 shadow-sm xl:flex-row xl:items-start" data-testid="chat-toolbar" data-chat-surface="header">
        <div className="min-w-0 xl:flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="min-w-0 max-w-[14rem] flex-1 truncate text-base font-semibold leading-tight sm:flex-none"><span className="truncate">{activeConversation?.title || 'Chat'}</span></h1>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => void createChat()} title="Start a separate conversation (Ctrl+Enter)">
              <Plus className="size-3" /> New
            </Button>
            {status?.warning ? (
              <span
                role="status"
                aria-label={`Model status: ${status.warning}`}
                className="flex min-w-0 max-w-full items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] font-medium leading-snug text-amber-700 dark:text-amber-300"
                title={status.warning}
              >
                <AlertTriangle className="mt-px size-3 shrink-0" />
                <span className="min-w-0 break-words">{status.warning}</span>
              </span>
            ) : null}
          </div>
          {conversationError ? <p role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">{conversationError}</p> : null}
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            {status?.connected ? (
              <Wifi className="size-3 shrink-0 text-emerald-500" />
            ) : (
              <WifiOff className="size-3 shrink-0 text-muted-foreground/70" />
            )}
            <span className="min-w-0 max-w-full truncate font-mono text-foreground/80" title={status?.provider}>
              {status?.provider || 'Checking…'}
            </span>
            {projectName ? (
              <>
                <span className="opacity-40">·</span>
                <span className="max-w-[12rem] truncate">{projectName}</span>
              </>
            ) : null}
            <span className="opacity-40">·</span>
            <span>{settings.advancedTeachMode ? 'advanced teach' : settings.teachMode ? 'teach mode' : promptCustomized ? 'custom prompt' : 'default prompt'}</span>
            {(run.model || servedModel) ? (
              <>
                <span className="opacity-40">·</span>
                <span className="max-w-[14rem] truncate" title={`Last reply served by ${run.model || servedModel}`}>
                  last: {run.model || servedModel}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
          <Button
            size="sm"
            variant={settings.teachMode && !settings.advancedTeachMode ? 'default' : 'outline'}
            className="h-7 gap-1.5 text-xs"
            aria-pressed={settings.teachMode && !settings.advancedTeachMode}
            title="Teach mode: replies follow a complete, structured topic-teaching format"
            onClick={() =>
              setSettings((s) =>
                s.advancedTeachMode
                  ? { ...s, teachMode: true, advancedTeachMode: false }
                  : { ...s, teachMode: !s.teachMode },
              )
            }
          >
            <GraduationCap className="size-3" /> Teach
          </Button>
          <Button
            size="sm"
            variant={settings.advancedTeachMode ? 'default' : 'outline'}
            className="h-7 gap-1.5 text-xs"
            aria-pressed={settings.advancedTeachMode}
            title="Advanced Teach: a five-step lesson that waits for your confirmation between steps"
            onClick={() => setSettings((s) => ({ ...s, teachMode: true, advancedTeachMode: !s.advancedTeachMode }))}
          >
            <Brain className="size-3" /> <span className="hidden sm:inline">Advanced</span>
          </Button>
          <Button
            size="sm"
            variant={settingsOpen ? 'default' : 'outline'}
            className="h-7 gap-1.5 text-xs"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            <SlidersHorizontal className="size-3" /> Settings
          </Button>
          {confirmClear ? (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="destructive" className="h-7 gap-1.5 text-xs" onClick={() => void clearChat()}>
                <Eraser className="size-3" /> Confirm
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              aria-label="Clear chat"
              onClick={() => void clearChat()}
              disabled={pending || (messages.length === 0 && !error)}
            >
              <Eraser className="size-3" /> <span className="hidden sm:inline">Clear chat</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Settings Panel ── */}
      {settingsOpen ? (
        <div className="shrink-0 space-y-3 rounded-lg border bg-card p-3 shadow-xs">
          {status?.warning ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-500" />
              <div>
                <span className="font-semibold">Model Compatibility Notice: </span>
                <span>{status.warning}</span>
              </div>
            </div>
          ) : null}

          {settings.teachMode ? (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 p-2.5 text-xs text-foreground">
              {settings.advancedTeachMode ? (
                <Brain className="mt-0.5 size-4 shrink-0 text-primary" />
              ) : (
                <GraduationCap className="mt-0.5 size-4 shrink-0 text-primary" />
              )}
              <div>
                {settings.advancedTeachMode ? (
                  <>
                    <span className="font-semibold">Advanced Teach is on. </span>
                    <span>Lessons follow five steps and pause for your confirmation before moving forward.</span>
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Teach mode is on. </span>
                    <span>
                      The built-in topic-teaching structure is used instead of your system prompt below. Turn Teach off in the
                      header to use your own prompt again.
                    </span>
                  </>
                )}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="chat-model" className="text-[11px] font-medium text-muted-foreground">
                Model Selection
              </label>
              <HubSelect
                id="chat-model"
                ariaLabel="Model Selection"
                disabled={!globalModel.ready || globalModel.saving || pending}
                value={isCustomModel ? ADD_CUSTOM_MODEL_VALUE : settings.model}
                onValueChange={(v) => {
                  if (v === ADD_CUSTOM_MODEL_VALUE) {
                    setShowAddCustom(true)
                    return
                  }
                  void globalModel.setModel(v).catch(() => {})
                }}
                className="w-full"
              >
                <HubSelectItem value="">Auto · shared across Chat, Sessions and Auto</HubSelectItem>
                {availableModels.length > 0 && (
                  <HubSelectGroup>
                    <HubSelectLabel>Local Models (LM Studio / Ollama)</HubSelectLabel>
                    {availableModels.map((m) => (
                      <HubSelectItem key={m.id} value={m.id} title={m.id}>
                        {m.id} {m.loaded ? '✓ (Loaded)' : !m.isChatCompatible ? `(Incompatible: ${m.type})` : '(Not Loaded)'}
                      </HubSelectItem>
                    ))}
                  </HubSelectGroup>
                )}
                {customModels.length > 0 && (
                  <HubSelectGroup>
                    <HubSelectLabel>Custom model endpoints</HubSelectLabel>
                    {customModels.map((cm) => (
                      <HubSelectItem key={cm.id} value={cm.id} title={`${cm.name} (${cm.modelId})`}>
                        {cm.name} ({cm.modelId})
                      </HubSelectItem>
                    ))}
                  </HubSelectGroup>
                )}
                <HubSelectItem value={ADD_CUSTOM_MODEL_VALUE}>+ Add Custom Model…</HubSelectItem>
              </HubSelect>

              {isCustomModel ? (
                <input
                  key={settings.model}
                  defaultValue={settings.model}
                  onBlur={(e) => { if (e.target.value !== settings.model) void globalModel.setModel(e.target.value).catch(() => {}) }}
                  placeholder="model id, e.g. spark-x2.5-4b"
                  className="h-8 w-full rounded-md border border-input bg-secondary/50 px-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                />
              ) : null}

              <label className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground"><input type="checkbox" checked={globalModel.preference.allowRemote} disabled={globalModel.saving || pending} onChange={(event) => void globalModel.update({ allowRemote: event.target.checked }).catch(() => {})} /><span>Allow configured remote model endpoints. This does not grant browser, computer or file access.</span></label>
              {globalModel.error ? <p role="alert" className="text-xs text-destructive">{globalModel.error}</p> : null}
              <div className="min-h-4 text-[10px] text-muted-foreground">
                {status?.connected ? (
                  <>
                    Connected: <span className="font-mono text-foreground/80">{status.provider}</span>
                  </>
                ) : (
                  status?.error || 'No provider reachable — start LM Studio, Ollama, or add a custom model.'
                )}
              </div>

              {showAddCustom ? (
                <div className="mt-3 space-y-2 rounded-md border bg-secondary/30 p-3">
                  <div className="text-[11px] font-medium">Add Custom API Model</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={newModel.name}
                      onChange={(e) => setNewModel((m) => ({ ...m, name: e.target.value }))}
                      placeholder="Display name (e.g. My local model)"
                      className="h-8 w-full rounded-md border border-input bg-secondary/50 px-2 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                    />
                    <input
                      value={newModel.modelId}
                      onChange={(e) => setNewModel((m) => ({ ...m, modelId: e.target.value }))}
                      placeholder="Model ID from the runtime"
                      className="h-8 w-full rounded-md border border-input bg-secondary/50 px-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                    />
                    <input
                      value={newModel.endpoint}
                      onChange={(e) => setNewModel((m) => ({ ...m, endpoint: e.target.value }))}
                      placeholder="Local or approved compatible endpoint"
                      className="h-8 w-full rounded-md border border-input bg-secondary/50 px-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                    />
                    <input
                      value={newModel.apiKey}
                      onChange={(e) => setNewModel((m) => ({ ...m, apiKey: e.target.value }))}
                      placeholder="API key"
                      type="password"
                      className="h-8 w-full rounded-md border border-input bg-secondary/50 px-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                    />
                  </div>
                  {addError ? <div className="text-[10px] text-red-600 dark:text-red-400">{addError}</div> : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 gap-1 px-2.5 text-[11px]"
                      onClick={async () => {
                        setAddError('')
                        try {
                          const res = await fetch('/api/custom-models', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(newModel),
                          })
                          const json = await res.json()
                          if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to add model')
                          setCustomModels((prev) => [...prev, json.model])
                          setNewModel({ name: '', endpoint: '', apiKey: '', modelId: '' })
                          setShowAddCustom(false)
                        } catch (e) {
                          setAddError(e instanceof Error ? e.message : 'Failed to add model')
                        }
                      }}
                    >
                      Save Model
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2.5 text-[11px]"
                      onClick={() => {
                        setShowAddCustom(false)
                        setAddError('')
                        setNewModel({ name: '', endpoint: '', apiKey: '', modelId: '' })
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="chat-system-prompt" className="text-[11px] font-medium text-muted-foreground">
                  System Prompt
                </label>
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, systemPrompt: DEFAULT_CHAT_SETTINGS.systemPrompt }))}
                  className="text-[10px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  Reset to default
                </button>
              </div>
              <textarea
                id="chat-system-prompt"
                value={settings.systemPrompt}
                onChange={(e) => setSettings((s) => ({ ...s, systemPrompt: e.target.value }))}
                rows={4}
                className="hub-scroll flex-1 resize-none rounded-md border border-input bg-secondary/50 px-2 py-1.5 text-xs leading-relaxed outline-none focus:border-ring"
              />
              <div className="text-right text-[10px] text-muted-foreground">
                {settings.systemPrompt.length.toLocaleString('en-US')} /{' '}
                {MAX_SYSTEM_PROMPT_CHARS.toLocaleString('en-US')} chars
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Conversation Thread ── */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={listRef} onScroll={updateScrollPosition} className="hub-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 py-3 sm:px-2" data-chat-surface="feed">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
          {messages.length === 0 && loaded && !pending ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
              <div className="flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/15 via-background to-primary/5 text-primary shadow-sm">
                {profileImage ? <Image src={profileImage} width={64} height={64} unoptimized alt="Your profile" className="size-full object-cover" /> : <Sparkles className="size-7" aria-hidden="true" />}
              </div>
              <div className="text-sm font-medium text-foreground/80">Start a conversation</div>
              <div className="text-xs max-w-sm text-muted-foreground">
                Say hi, ask questions, generate code, or explore concepts.
              </div>
            </div>
          ) : null}

          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const groupedWithPrev =
              !!prev && prev.kind === 'chat' && m.kind === 'chat' && prev.role === m.role
            if (m.kind === 'system_event') return null
            if (m.kind === 'tool_activity') {
              const steps = m.activity ?? []
              if (!steps.length) return null
              return <ActivityGroup key={m.id} steps={steps} />
            }
            if (m.kind === 'error') {
              return (
                <div
                  key={m.id}
                  className="mx-auto max-w-lg rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-xs text-red-700 dark:text-red-300"
                >
                  {m.content}
                </div>
              )
            }

            const mine = m.role === 'user'
            const isExplain = !mine && Array.isArray(m.blocks) && m.blocks.length > 0
            const time = formatTime(m.time)

            // User messages: compact, right-aligned, bubble width fits message
            if (mine) {
              return (
                <div key={m.id} className={cn('flex justify-end w-full group', groupedWithPrev && '-mt-2.5')}>
                  <div className="flex flex-col items-end max-w-[80%] sm:max-w-[70%]">
                    <div className="w-fit min-w-0 max-w-full rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground text-[13.5px] leading-relaxed break-words whitespace-pre-wrap shadow-xs" data-chat-surface="user-message">
                      {editingId === m.id ? <div className="space-y-2">
                        <textarea aria-label="Edit sent message" value={editDraft} maxLength={32000} onChange={(event) => setEditDraft(event.target.value)} className="w-full min-h-24 rounded bg-background p-2 text-foreground" />
                        <p className="text-xs">Send the edited message to generate a new reply. Later messages are backed up.</p>
                        <Button size="sm" disabled={pending || savingEdit || !editDraft.trim()} onClick={() => void saveEditedMessage()}>{savingEdit ? 'Sending…' : 'Save & Send'}</Button>
                        <Button size="sm" variant="outline" disabled={savingEdit} onClick={() => setEditingId('')}>Cancel</Button>
                      </div> : m.content ? <span>{displayChatMessage(m.content)}</span> : null}
                      {m.attachments?.length ? (
                        <div className={cn('flex flex-wrap gap-1', m.content && 'mt-1.5')} data-testid="message-attachments">
                          {m.attachments.map((a, i) => (
                            <span
                              key={`${a.name}-${i}`}
                              className="flex items-center gap-1 rounded border border-primary-foreground/25 bg-primary-foreground/10 px-1.5 py-0.5 text-[10px]"
                            >
                              <FileText className="size-3" />
                              {a.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {m.id && !m.attachments?.length && !m.content.includes('[Attached:') ? <button type="button" className="mt-1 text-xs text-muted-foreground hover:text-foreground" disabled={pending || savingEdit || run.queued.length > 0 || !globalModel.ready} onClick={() => { setEditingId(m.id); setEditDraft(m.content) }}>Edit message</button> : null}
                    {time ? (
                      <span className="mt-1 px-1 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        {time}
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            }

            // Assistant messages: left-aligned, bubble fits content, no heavy card
            return (
              <div key={m.id} className={cn('flex justify-start items-start gap-3 w-full group', groupedWithPrev && '-mt-2.5')}>
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary border border-primary/20" aria-label="Conversation avatar">
                  <AssistantMark className="size-4" />
                </div>
                <div className="flex flex-col items-start max-w-[85%] sm:max-w-[82%] min-w-0">
                  <div className="w-fit min-w-0 max-w-full rounded-2xl rounded-tl-sm bg-secondary/40 text-foreground px-4 py-3 text-[13.5px] leading-relaxed break-words border border-border/30 shadow-2xs">
                    {isExplain ? (
                      <ExplainBlocks blocks={m.blocks!} />
                    ) : (
                      <Markdown content={m.content} disabled={pending} />
                    )}
                    {m.codingTurn ? <CodingWorkDetails turn={m.codingTurn} /> : null}
                  </div>
                  <div className="flex items-center gap-2 mt-1 px-1 text-[10px] text-muted-foreground">
                    {time ? <span>{time}</span> : null}
                    <button
                      type="button"
                      onClick={() => copyResponse(m.content)}
                      className="flex items-center gap-1 rounded hover:text-foreground transition-colors"
                      title="Copy response"
                    >
                      <Copy className="size-3" /> Copy
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Streaming in-progress assistant turn */}
          {pending ? (
            <div className="flex justify-start items-start gap-3 w-full">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-primary border border-primary/20" aria-label="Conversation avatar">
                <AssistantMark className="size-4" />
              </div>
              <div className="flex flex-col items-start max-w-[85%] sm:max-w-[82%] min-w-0">
                <div className="w-fit min-w-0 max-w-full rounded-2xl rounded-tl-sm bg-secondary/40 text-foreground px-4 py-3 text-[13.5px] leading-relaxed break-words border border-border/30 shadow-2xs">
                  {streamingText ? (
                    <div className="min-w-0 max-w-full">
                      <Markdown content={streamingText} />
                      <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
                    </div>
                  ) : isThinking ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-0.5">
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                      <span>Thinking…</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 py-1">
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-xs text-red-700 dark:text-red-300">
              <span className="font-medium">{error}</span>
              {retryText ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 px-2.5 text-[11px]"
                  onClick={() => void send(retryText)}
                >
                  <RotateCw className="size-3" /> Retry
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {showJumpToBottom ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom of chat"
          title="Go to latest message"
          className="absolute bottom-3 right-4 flex size-9 items-center justify-center rounded-full border bg-card text-foreground shadow-md transition-colors hover:bg-secondary"
          data-testid="chat-scroll-to-bottom"
        >
          <ChevronDown className="size-4" />
        </button>
      ) : null}
      </div>

      {/* ── Composer ── */}
      <div className="relative mx-auto w-full max-w-[860px] shrink-0 rounded-2xl border border-border/70 bg-card p-3 shadow-sm" data-chat-surface="composer">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          className="hidden"
          data-testid="chat-attach-input"
          onChange={(e) => {
            onPickFiles(e.target.files)
            e.target.value = ''
          }}
        />

        {attachments.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap gap-1.5" data-testid="chat-attachment-list">
            {attachments.map((a) => (
              <div
                key={a.id}
                data-attachment={a.name}
                className={cn(
                  'flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px]',
                  a.error
                    ? 'border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400'
                    : 'border-border bg-secondary/40',
                )}
              >
                {a.kind === 'image' && a.previewUrl ? (
                  <span
                    className="size-6 shrink-0 rounded bg-cover bg-center"
                    style={{ backgroundImage: `url(${a.previewUrl})` }}
                    aria-hidden="true"
                  />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 max-w-[12rem] truncate" title={a.error ?? a.name}>
                  {a.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{(a.size / 1024).toFixed(0)} KB</span>
                <button
                  onClick={() => removeAttachment(a.id)}
                  aria-label={`Remove ${a.name}`}
                  data-testid="chat-attachment-remove"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {attachError ? (
          <div
            role="alert"
            data-testid="chat-attach-error"
            className="mb-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-600 dark:text-red-400"
          >
            {attachError}
          </div>
        ) : null}

        {thinkingInfo ? (
          <div className="mb-1.5 text-[10px] text-muted-foreground" data-testid="chat-thinking-mode">
            {thinkingInfo.mode === 'native'
              ? `Thinking: native reasoning (effort ${EFFORT_LABEL[thinkingInfo.effort]})`
              : `Thinking: prompt-guided (effort ${EFFORT_LABEL[thinkingInfo.effort]}) — this model has no native reasoning control`}
          </div>
        ) : null}
        {visionWarning ? (
          <div
            data-testid="chat-vision-warning"
            className="mb-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300"
          >
            {visionWarning}
          </div>
        ) : null}

        {run.queued.length ? <div className="mb-2 rounded border p-2 text-xs" aria-label="Queued messages">
          <p>{run.queued.length} queued · sent in order after the current reply</p>
          {run.queued.map((item) => <div key={item.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{item.content || 'Attachments'}</span>
            <button type="button" aria-label="Remove queued message" onClick={() => removeQueuedMessage(activeChatId, item.id)}>Remove</button>
          </div>)}
          {!pending ? <button type="button" onClick={() => sendNextQueuedMessage(activeChatId)}>Send next queued message</button> : null}
        </div> : null}
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          aria-label="Message"
          placeholder="Message your assistant…"
          title="Enter sends · Ctrl+Enter starts a new chat · Shift+Enter adds a line"
          className="hub-scroll max-h-[180px] min-h-[44px] w-full resize-none bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1.5 border-t border-border/30">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => fileInputRef.current?.click()}
              title="Attach images (PNG/JPEG/WebP), documents (text/source, PDF, DOCX), or ZIP archives"
              data-testid="chat-attach-button"
              disabled={pending}
            >
              <Paperclip className="size-3.5" /> Attach
            </Button>
            <div className="relative">
              <Button
                size="sm"
                variant={settings.thinking ? 'default' : 'ghost'}
                className="h-7 gap-1 px-2 text-[11px]"
                aria-haspopup="dialog"
                aria-expanded={thinkingOpen}
                aria-pressed={settings.thinking}
                title="Thinking / answer effort"
                onClick={() => setThinkingOpen((o) => !o)}
                data-testid="chat-thinking-button"
              >
                <Brain className="size-3.5" />{' '}
                {settings.thinking ? `Thinking · ${EFFORT_LABEL[settings.effort]}` : 'Thinking off'}
              </Button>
              {thinkingOpen ? (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setThinkingOpen(false)} />
                  <div
                    role="dialog"
                    aria-label="Thinking settings"
                    data-testid="chat-thinking-popover"
                    className="absolute bottom-full right-0 z-40 mb-1 w-64 rounded-lg border bg-popover p-2.5 shadow-lg sm:left-0 sm:right-auto"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Thinking</span>
                      <button
                        role="switch"
                        aria-checked={settings.thinking}
                        aria-label="Toggle thinking"
                        data-testid="chat-thinking-toggle"
                        onClick={() => setSettings((s) => ({ ...s, thinking: !s.thinking }))}
                        className={cn(
                          'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
                          settings.thinking ? 'bg-primary' : 'bg-secondary',
                        )}
                      >
                        <span
                          className={cn(
                            'size-3 rounded-full bg-background transition-transform',
                            settings.thinking ? 'translate-x-3.5' : 'translate-x-0.5',
                          )}
                        />
                      </button>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {settings.thinking
                        ? 'On — the answer uses more effort.'
                        : 'Off — ordinary responses, no reasoning parameters.'}
                    </div>
                    <div className="mt-2">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Effort
                      </div>
                      <div className="flex gap-1" role="group" aria-label="Effort">
                        {THINKING_EFFORTS.map((e) => (
                          <button
                            key={e}
                            data-effort={e}
                            disabled={!settings.thinking}
                            aria-pressed={settings.thinking && settings.effort === e}
                            onClick={() => setSettings((s) => ({ ...s, thinking: true, effort: e }))}
                            className={cn(
                              'flex-1 rounded border px-1.5 py-1 text-[11px] transition-colors disabled:opacity-40',
                              settings.thinking && settings.effort === e
                                ? 'border-primary bg-primary/15 text-primary'
                                : 'border-border',
                            )}
                          >
                            {EFFORT_LABEL[e]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                      Native reasoning parameters are only sent for models that support them; other models receive a
                      clearly-labelled depth instruction.
                    </p>
                  </div>
                </>
              ) : null}
            </div>
            <div className="relative">
              <Button
                size="sm"
                variant={settings.responseDepth !== 'standard' ? 'default' : 'ghost'}
                className="h-7 gap-1 px-2 text-[11px]"
                aria-haspopup="dialog"
                aria-expanded={responseDepthOpen}
                title="Response length, separate from thinking effort"
                onClick={() => setResponseDepthOpen((open) => !open)}
                data-testid="chat-response-depth-button"
              >
                <SlidersHorizontal className="size-3.5" /> Answer · {RESPONSE_DEPTH_LABEL[settings.responseDepth]}
              </Button>
              {responseDepthOpen ? (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setResponseDepthOpen(false)} />
                  <div
                    role="dialog"
                    aria-label="Response depth settings"
                    data-testid="chat-response-depth-popover"
                    className="absolute bottom-full left-0 z-40 mb-1 w-64 rounded-lg border bg-popover p-2.5 shadow-lg"
                  >
                    <div className="text-xs font-medium">Response length</div>
                    <p className="mt-1 text-[10px] leading-snug text-muted-foreground">Choose how much explanation to show. This does not change thinking effort.</p>
                    <div className="mt-2 grid grid-cols-2 gap-1" role="group" aria-label="Response depth">
                      {RESPONSE_DEPTHS.map((depth: ResponseDepth) => (
                        <button
                          key={depth}
                          type="button"
                          data-response-depth={depth}
                          aria-pressed={settings.responseDepth === depth}
                          onClick={() => { setSettings((current) => ({ ...current, responseDepth: depth })); setResponseDepthOpen(false) }}
                          className={cn(
                            'rounded border px-2 py-1.5 text-left text-[11px] transition-colors',
                            settings.responseDepth === depth ? 'border-primary bg-primary/15 text-primary' : 'border-border hover:bg-secondary',
                          )}
                        >
                          {RESPONSE_DEPTH_LABEL[depth]}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {pending ? (
              <>
                <Button size="sm" className="h-7 px-3 text-xs" disabled={!draft.trim() || savingEdit || run.queued.length >= 10} onClick={() => send()}>Queue message</Button>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 px-3 text-xs" onClick={() => void setChatRunPaused(activeChatId, !run.paused).catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not change the chat state.'))}>
                  {run.paused ? <Play className="size-3" /> : <Pause className="size-3" />}{run.paused ? 'Resume' : 'Pause'}
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 px-3 text-xs" onClick={stop}>
                  <Square className="size-3" /> Stop
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="h-7 gap-1.5 px-3 text-xs"
                onClick={() => void send()}
                disabled={
                  (!draft.trim() && attachments.every((a) => !!a.error || attachments.length === 0)) ||
                  attachments.some((a) => a.error) ||
                  !conversationsReady || !loaded || !globalModel.ready || globalModel.saving || !!globalModel.error ||
                  status?.connected === false
                }
              >
                <Send className="size-3" /> Send
              </Button>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
