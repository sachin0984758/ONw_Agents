'use client'

import { useId, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import type { SessionQuestion } from '@/lib/agent-hub/session/types'
import { cn } from '@/lib/utils'

export function SessionQuestionCard({ question, disabled, answered, onAnswer }: {
  question: SessionQuestion; disabled: boolean; answered: boolean; onAnswer?: (answer: string) => void
}) {
  const id = useId()
  const [selected, setSelected] = useState('')
  const [custom, setCustom] = useState('')
  const answer = selected === 'custom' ? custom.trim() : selected
  return <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-label="Project question">
    <div className="flex flex-wrap gap-2 border-b px-5 py-3 text-xs" aria-label="Project stages">
      {(['requirements', 'design', 'plan'] as const).map((stage, index) => <span key={stage} aria-current={stage === question.stage ? 'step' : undefined} className={cn('rounded-full px-3 py-1 capitalize', stage === question.stage ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{index + 1}. {stage}</span>)}
      <span className="px-3 py-1 text-muted-foreground">4. Implement</span>
    </div>
    {question.details ? <div className="border-b px-5 py-4 text-sm leading-6 [&_p]:my-2 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_h2]:mb-2 [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:font-semibold"><ReactMarkdown remarkPlugins={[remarkGfm]}>{question.details}</ReactMarkdown></div> : null}
    <form className="space-y-4 p-5" onSubmit={(event) => { event.preventDefault(); if (answer && !disabled && !answered) onAnswer?.(`Answer to “${question.prompt}”: ${answer}`) }}>
      <fieldset disabled={disabled || answered || !onAnswer} className="space-y-3">
        <legend className="mb-3 text-base font-semibold">{question.prompt}</legend>
        {question.options.map((option, index) => <label key={option} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors hover:bg-accent', selected === option && 'border-primary bg-primary/5')}>
          <input type="radio" name={id} value={option} checked={selected === option} onChange={() => setSelected(option)} className="mt-0.5 accent-current" />
          <span className="font-medium text-muted-foreground">{String.fromCharCode(65 + index)}.</span><span>{option}</span>
        </label>)}
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm"><input type="radio" name={id} value="custom" checked={selected === 'custom'} onChange={() => setSelected('custom')} />Something else</label>
        {selected === 'custom' ? <textarea aria-label="Your answer" value={custom} onChange={(event) => setCustom(event.target.value)} maxLength={4000} placeholder="Describe what you have in mind…" className="min-h-24 w-full rounded-xl border bg-background p-3 text-sm" /> : null}
      </fieldset>
      {answered ? <p className="text-xs text-muted-foreground">Answer sent · continued below</p> : <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Choose an option or write your own answer.</p><Button type="submit" disabled={disabled || !answer || !onAnswer}>Continue</Button></div>}
    </form>
  </section>
}
