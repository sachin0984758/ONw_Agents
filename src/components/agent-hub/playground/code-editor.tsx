'use client'

// ── Playground code editor (CodeMirror 6) ────────────────────────────────────
// A real editable editor: typing, selection, undo/redo, bracket matching,
// search and syntax highlighting come from CodeMirror's basicSetup plus one
// language extension. Highlighting is presentation only — the playground has
// no compiler or type-checker, and the UI never claims otherwise.
//
// The component is controlled (value → editor) and reports every document
// change through onChange. `setValue` (imperative handle) is used for
// programmatic replacement: session/starter loads pass { history: false },
// "Apply suggestion" passes { history: true } so Ctrl+Z can undo it.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, Prec, Transaction } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { acceptCompletion, autocompletion, completeAnyWord } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import type { EditorView as EditorViewType } from '@codemirror/view'
import { cn } from '@/lib/utils'
import type { SqlDialectId } from '@/lib/agent-hub/playground-languages'
import { loadLanguageExtension } from './code-editor-langs'
import { makeEditorTheme } from './code-editor-theme'

export interface CodeEditorHandle {
  /** Replace the whole document. history: false for loads, true for suggestions. */
  setValue: (next: string, opts?: { history?: boolean }) => void
  getValue: () => string
  focus: () => void
}

interface CodeEditorProps {
  value: string
  /** Playground language registry `cm` key (see code-editor-langs.ts). */
  cmKey: string
  /** SQL dialect — only used when cmKey is 'sql'. */
  sqlDialect?: SqlDialectId
  onChange: (next: string) => void
  ariaLabel?: string
  className?: string
}

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { value, cmKey, sqlDialect, onChange, ariaLabel, className },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorViewType | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const cmKeyRef = useRef(cmKey)
  cmKeyRef.current = cmKey
  const sqlDialectRef = useRef(sqlDialect)
  sqlDialectRef.current = sqlDialect
  const latestValueRef = useRef(value)
  const languageCompartment = useRef(new Compartment()).current
  const themeCompartment = useRef(new Compartment()).current

  useImperativeHandle(
    ref,
    () => ({
      setValue(next, opts) {
        const view = viewRef.current
        if (!view) {
          latestValueRef.current = next
          return
        }
        const current = view.state.doc.toString()
        if (current === next) return
        view.dispatch({
          changes: { from: 0, to: current.length, insert: next },
          ...(opts?.history === false ? { annotations: Transaction.addToHistory.of(false) } : {}),
        })
      },
      getValue() {
        return viewRef.current?.state.doc.toString() ?? latestValueRef.current
      },
      focus() {
        viewRef.current?.focus()
      },
    }),
    [],
  )

  useEffect(() => {
    let disposed = false
    let view: EditorViewType | null = null
    let observer: MutationObserver | null = null

    const rebuildTheme = async () => {
      if (!view || disposed) return
      const theme = await makeEditorTheme()
      view.dispatch({ effects: themeCompartment.reconfigure(theme) })
    }

    const setup = async () => {
      const [{ basicSetup }, { EditorView }, { EditorState }, themeExtension, languageExtension] =
        await Promise.all([
          import('codemirror'),
          import('@codemirror/view'),
          import('@codemirror/state'),
          makeEditorTheme(),
          loadLanguageExtension(cmKeyRef.current, sqlDialectRef.current),
        ])
      if (disposed || !containerRef.current) return
      view = new EditorView({
        parent: containerRef.current,
        state: EditorState.create({
          doc: latestValueRef.current,
          extensions: [
            basicSetup,
            autocompletion({ activateOnTyping: true, activateOnTypingDelay: 100, interactionDelay: 0 }),
            EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
            Prec.highest(keymap.of([
              { key: 'Tab', run: acceptCompletion },
              indentWithTab,
            ])),
            themeCompartment.of(themeExtension),
            languageCompartment.of(languageExtension),
            EditorState.tabSize.of(2),
            EditorView.contentAttributes.of({
              role: 'textbox',
              'aria-multiline': 'true',
              ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
            }),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) return
              const next = update.state.doc.toString()
              latestValueRef.current = next
              onChangeRef.current(next)
            }),
          ],
        }),
      })
      viewRef.current = view
      observer = new MutationObserver(() => {
        void rebuildTheme()
      })
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    }

    void setup()
    return () => {
      disposed = true
      observer?.disconnect()
      view?.destroy()
      viewRef.current = null
    }
  }, [ariaLabel, languageCompartment, themeCompartment])

  // Language / dialect switch: reconfigure only the language compartment.
  useEffect(() => {
    let cancelled = false
    void loadLanguageExtension(cmKey, sqlDialect).then((extension) => {
      if (cancelled) return
      viewRef.current?.dispatch({ effects: languageCompartment.reconfigure(extension) })
    })
    return () => {
      cancelled = true
    }
  }, [cmKey, sqlDialect, languageCompartment])

  // Programmatic value replacement (session load, starter load). The editor
  // itself keeps latestValueRef current while typing, so this only fires for
  // external changes.
  useEffect(() => {
    latestValueRef.current = value
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    })
  }, [value])

  return (
    <div
      ref={containerRef}
      data-testid="playground-editor"
      className={cn('h-full w-full overflow-hidden text-[13px]', className)}
    />
  )
})
