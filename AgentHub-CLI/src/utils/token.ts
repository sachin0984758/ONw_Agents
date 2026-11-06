export function estimateTokens(text: string): number {
  // Deliberately conservative and provider-agnostic. Used only for budgeting;
  // reported usage always comes from the provider when it supplies it.
  return Math.ceil(text.length / 4)
}

export function estimateMessagesTokens(messages: Array<{ content: string | null; tool_calls?: unknown }>): number {
  let total = 0
  for (const m of messages) {
    total += 4
    total += estimateTokens(m.content ?? '')
    if (m.tool_calls) total += estimateTokens(JSON.stringify(m.tool_calls))
  }
  return total
}

export function formatTokens(n: number | null): string {
  if (n === null) return 'unknown'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
