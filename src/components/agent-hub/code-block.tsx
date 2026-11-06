'use client'

import { memo, useContext, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { codeLanguageLabel, resolveCodeLanguage } from '@/lib/agent-hub/code-languages'
import { ConversationColorScheme } from './conversation-color-scheme'

// ── Language registration ─────────────────────────────────────────────────────
// The "light" Prism build only knows the languages we register explicitly, so
// only the set AgentHub answers actually use is pulled in (keeps the client
// bundle small). Order matters: refractor requires dependencies first
// (clike → c → cpp, markup + javascript → jsx, javascript → typescript → tsx).
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import clike from 'react-syntax-highlighter/dist/esm/languages/prism/clike'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'

const LANGUAGE_MODULES: Array<[string, unknown]> = [
  ['markup', markup],
  ['css', css],
  ['clike', clike],
  ['c', c],
  ['cpp', cpp],
  ['javascript', javascript],
  ['jsx', jsx],
  ['typescript', typescript],
  ['tsx', tsx],
  ['python', python],
  ['sql', sql],
  ['bash', bash],
  ['java', java],
  ['json', json],
  ['yaml', yaml],
  ['markdown', markdown],
  ['powershell', powershell],
]

for (const [name, mod] of LANGUAGE_MODULES) {
  try {
    SyntaxHighlighter.registerLanguage(name, mod)
  } catch {
    // Already registered (e.g. after a fast refresh) — safe to ignore.
  }
}

// The app loads Geist Mono through next/font (--font-geist-mono). The Prism
// themes ship their own font-family, so we override it to match the app.
const MONO_FONT =
  'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

export interface CodeBlockProps {
  /** Raw fenced-code language identifier (may be an alias or unsupported). */
  language?: string
  /** Raw source code (copied verbatim, no line numbers). */
  code: string
  /** Force line numbers on/off. Shown by default, including short snippets. */
  showLineNumbers?: boolean
}

export const CodeBlock = memo(function CodeBlock({ language, code, showLineNumbers }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const { resolvedTheme } = useTheme()
  const conversationScheme = useContext(ConversationColorScheme)
  const colorScheme = conversationScheme ?? resolvedTheme

  const prismLang = resolveCodeLanguage(language ?? '')
  const label = codeLanguageLabel(language ?? '')
  // Normalize line endings only for display. Copy always preserves raw source.
  const displayedCode = useMemo(() => code.replace(/\r\n?/g, '\n'), [code])
  const lineCount = useMemo(() => displayedCode.split('\n').length, [displayedCode])
  const withLineNumbers = showLineNumbers ?? true
  const gutterWidth = `${Math.max(2, String(lineCount).length)}ch`

  // Default to the dark theme until next-themes resolves (avoids a hydration
  // mismatch: the server and first client render both use dark).
  const theme = useMemo(() => ({
    ...(colorScheme === 'light' ? oneLight : oneDark),
    // Prism labels inline numbers as comments, then merges theme styles after
    // lineNumberStyle. Override only the gutter so real comments stay italic.
    linenumber: { color: 'var(--muted-foreground)', fontStyle: 'normal' as const },
  }), [colorScheme])

  async function handleCopy() {
    setCopyError(false)
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // Clipboard API unavailable (insecure context / older browser).
      try {
        const ta = document.createElement('textarea')
        ta.value = code
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.top = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        try {
          if (!document.execCommand('copy')) throw new Error('Copy unavailable')
        } finally {
          ta.remove()
        }
      } catch {
        setCopyError(true)
        return
      }
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className="group/code my-2.5 max-w-full overflow-hidden rounded-lg border border-border/60 bg-secondary/40"
      data-code-block={prismLang ?? 'text'}
      data-line-count={lineCount}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-secondary/60 px-3 py-1">
        <span className="truncate font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code"
          className={cn(
            'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
            copied ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copyError ? <p role="status" className="px-3 py-1 text-xs text-destructive">Could not copy. Select the code and copy it manually.</p> : null}
      <SyntaxHighlighter
        language={prismLang ?? undefined}
        style={theme}
        className="hub-scroll font-mono"
        customStyle={{
          margin: 0,
          padding: '0.7rem 0.85rem',
          background: 'transparent',
          fontSize: '12px',
          fontFamily: MONO_FONT,
          lineHeight: '1.65',
          whiteSpace: 'pre',
          wordBreak: 'normal',
          overflowWrap: 'normal',
          tabSize: 4,
          textAlign: 'left',
          direction: 'ltr',
          overflowX: 'auto',
        }}
        codeTagProps={{
          className: prismLang ? `language-${prismLang}` : undefined,
          style: {
            background: 'transparent',
            display: 'block',
            margin: 0,
            padding: 0,
            borderRadius: 0,
            fontFamily: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
            whiteSpace: 'pre',
            textShadow: 'none',
          },
        }}
        showLineNumbers={withLineNumbers}
        showInlineLineNumbers
        wrapLines
        wrapLongLines={false}
        lineProps={(lineNumber: number) => ({ 'data-code-line': lineNumber })}
        lineNumberStyle={{
          width: gutterWidth,
          minWidth: gutterWidth,
          paddingRight: '1.25em',
          boxSizing: 'content-box',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
          fontStyle: 'normal',
          fontWeight: 400,
          textAlign: 'right',
          color: 'var(--muted-foreground)',
          opacity: 0.8,
          userSelect: 'none',
        }}
      >
        {displayedCode}
      </SyntaxHighlighter>
    </div>
  )
})
