import type { ModelMessage } from '../session/types'

export function autoModelMaxTokens(request: string): number {
  const longOutput = /\b(?:long|lengthy|full story|complete (?:code|program))\b/i.test(request)
    || [...request.matchAll(/\b(\d+)\s*(lines?|words?)\b/gi)].some((match) => Number(match[1]) >= (/line/i.test(match[2]) ? 50 : 300))
  return longOutput ? 4096 : 1024
}

// Keep the full native evidence in the event log. The model needs actionable
// controls, not repeated text rectangles or unnamed layout containers.
export function computerModelOutput(value: unknown): string {
  return JSON.stringify(value, (key, item) => {
    if (['image', 'screenshot', 'text_rects', 'patterns'].includes(key)) return undefined
    if (['pid', 'host_pid', 'process_started'].includes(key)) return undefined
    if (key === 'automation_id' && !item) return undefined
    if ((key === 'focused' && item === false) || (key === 'enabled' && item === true)) return undefined
    if (key === 'elements' && Array.isArray(item)) return item.filter((element) =>
      element.name || element.text || !['Pane', 'Window', 'MenuBar', 'List', 'Tab'].includes(element.control_type))
    return item
  })
}

/** Auto is one user turn with many tool rounds. General chat compaction cannot
 * split that turn, so retain complete recent call/result pairs explicitly. */
export function compactAutoTranscript(messages: ModelMessage[], recentRounds = 1): ModelMessage[] {
  const firstAction = messages.findIndex((message) => message.role === 'assistant' && message.tool_calls?.length)
  if (firstAction < 0) return messages
  const prefix = messages.slice(0, firstAction)
  const rounds: ModelMessage[][] = []
  for (const message of messages.slice(firstAction)) {
    if (message.role === 'assistant' || !rounds.length) rounds.push([])
    rounds[rounds.length - 1].push(message)
  }
  if (rounds.length <= recentRounds) return messages
  const older = rounds.slice(0, -recentRounds)
  const records = older.flatMap((round) => {
    const calls = round[0].tool_calls ?? []
    return calls.map((call) => {
      const result = round.find((message) => message.tool_call_id === call.id)
      try {
        const parsed = JSON.parse(result?.content ?? '{}')
        return `${call.function.name}: ok=${parsed.ok === true}, verified=${parsed.verified === true}${parsed.ok === false ? `, error=${String(parsed.result).slice(0, 200)}` : ''}`
      } catch { return `${call.function.name}: older result omitted; inspect again before relying on it` }
    })
  })
  return [...prefix, { role: 'user', content: `Earlier action outcomes (not fresh target observations):\n${records.join('\n').slice(-2500)}\nUse the latest snapshot or inspect again. Do not repeat completed actions just because their old target details were omitted.` }, ...rounds.slice(-recentRounds).flat()]
}
