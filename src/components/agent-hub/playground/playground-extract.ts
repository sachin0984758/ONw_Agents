// ── Suggestion extraction ────────────────────────────────────────────────────
// Model answers are Markdown. When an action is allowed to propose a
// replacement (improve / suggest-correction), the UI extracts the first fenced
// code block (or formula) from the RAW text and offers an explicit
// "Apply suggestion" button. Nothing is ever applied automatically and the
// original content stays in the editor until the user accepts.

/** First fenced code block in a markdown answer, without the fence markers. */
export function extractCodeSuggestion(markdown: string): string | null {
  const match = /```[a-zA-Z0-9+#_.-]*[ \t]*\r?\n([\s\S]*?)```/.exec(markdown)
  const body = match?.[1]
  if (!body) return null
  const trimmed = body.replace(/\s+$/, '')
  return trimmed.trim() ? trimmed : null
}

/** First formula (line starting with "=") inside a fenced block, else anywhere. */
export function extractFormulaSuggestion(markdown: string): string | null {
  const fence = /```[a-zA-Z0-9+#_.-]*[ \t]*\r?\n([\s\S]*?)```/.exec(markdown)
  const region = fence?.[1] ?? markdown
  const line = /(^|\n)[ \t]*(=[^\n]+)/.exec(region)
  let formula = line?.[2]?.trim() ?? ''
  if (!formula) return null
  // Models often append prose after the formula on the same line. If the
  // formula has a closing paren, cut after the last one so the applied text
  // is the formula itself.
  const close = formula.lastIndexOf(')')
  if (close >= 0) formula = formula.slice(0, close + 1)
  return formula.trim() || null
}
