import type { ChatMessage } from '../providers/types.ts'
import { estimateMessagesTokens, estimateTokens } from '../utils/token.ts'

export interface TrimResult {
  messages: ChatMessage[]
  estimated: number
  evictedChars: number
  droppedMessages: number
  overBudget: boolean
}

interface Group {
  start: number
  end: number
}

function groupsOf(messages: ChatMessage[]): Group[] {
  const groups: Group[] = []
  let i = 0
  while (i < messages.length) {
    const message = messages[i]
    if (!message) break
    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      let end = i + 1
      while (end < messages.length && messages[end]?.role === 'tool') end++
      groups.push({ start: i, end })
      i = end
      continue
    }
    groups.push({ start: i, end: i + 1 })
    i++
  }
  return groups
}

/**
 * Keep the system prompt, the original task and the most recent turns. Old
 * tool output is replaced with short placeholders first (which preserves the
 * assistant/tool pairing required by the API), then whole old groups are
 * dropped if necessary.
 */
export function trimMessages(messages: ChatMessage[], maxTokens: number): TrimResult {
  const working = messages.map((m) => ({ ...m }))
  let evictedChars = 0
  let droppedMessages = 0

  const estimate = () => estimateMessagesTokens(working)
  if (estimate() <= maxTokens) {
    return { messages: working, estimated: estimate(), evictedChars: 0, droppedMessages: 0, overBudget: false }
  }

  // Pass 1: shrink old content in place.
  const protectFromEnd = 4
  for (let i = 1; i < working.length - protectFromEnd; i++) {
    const m = working[i]
    if (!m) continue
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 500) {
      evictedChars += m.content.length - 120
      m.content = `[older tool output omitted to fit context: ${m.content.length} chars]`
    } else if (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 800) {
      evictedChars += m.content.length - 800
      m.content = `${m.content.slice(0, 800)}\n[older assistant text truncated]`
    }
    if (estimate() <= maxTokens) {
      return { messages: working, estimated: estimate(), evictedChars, droppedMessages, overBudget: false }
    }
  }

  // Pass 2: drop old groups, but keep the system message, the first user
  // message (the task) and the most recent groups.
  let current = working
  const firstUser = current.find((m) => m.role === 'user')
  const currentUser = current.findLast((m) => m.role === 'user')
  for (;;) {
    const estimated = estimateMessagesTokens(current)
    if (estimated <= maxTokens) {
      return { messages: current, estimated, evictedChars, droppedMessages, overBudget: false }
    }
    const groups = groupsOf(current)
    let removable = -1
    for (let i = 0; i < groups.length - 3; i++) {
      const group = groups[i]
      if (!group) continue
      const message = current[group.start]
      if (!message) continue
      if (message === current[0]) continue
      if (message === firstUser) continue
      if (message === currentUser) continue
      removable = i
      break
    }
    if (removable < 0) break
    const group = groups[removable]
    if (!group) break
    droppedMessages += group.end - group.start
    current = [...current.slice(0, group.start), ...current.slice(group.end)]
  }

  const finalEstimate = estimateMessagesTokens(current)
  return {
    messages: current,
    estimated: finalEstimate,
    evictedChars,
    droppedMessages,
    overBudget: finalEstimate > maxTokens,
  }
}

export function compactMessages(messages: ChatMessage[], keepLast = 8): ChatMessage[] {
  if (messages.length <= keepLast + 2) return messages
  const system = messages.find((m) => m.role === 'system')
  const tail = messages.slice(-keepLast)
  // Do not start the tail with an orphan tool result.
  while (tail.length > 0 && tail[0]?.role === 'tool') tail.shift()
  const note: ChatMessage = {
    role: 'user',
    content: `[Earlier conversation was compacted to save context. ${messages.length - keepLast - 1} message(s) omitted.]`,
  }
  return system ? [system, note, ...tail] : [note, ...tail]
}

export function contextStats(messages: ChatMessage[]): { estimated: number; longest: number } {
  let longest = 0
  for (const m of messages) {
    longest = Math.max(longest, estimateTokens(m.content ?? ''))
  }
  return { estimated: estimateMessagesTokens(messages), longest }
}
