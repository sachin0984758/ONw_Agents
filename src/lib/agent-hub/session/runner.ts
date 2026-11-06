import type { CodingConversation, ModelMessage, ModelReply, SessionEvent, SessionItem, SessionTurn, ToolOutcome, ToolSpec } from './types'
import { parseSessionQuestion } from './questions'

export interface AgentDependencies {
  respond(messages: ModelMessage[], tools: ToolSpec[], onText: (text: string) => void | Promise<void>, signal: AbortSignal): Promise<ModelReply>
  execute(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome>
  approve(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<boolean>
  save(): Promise<void>
  emit(event: SessionEvent): void
  waitIfPaused?: () => Promise<void>
  system: string
  tools: ToolSpec[]
  maxSteps?: number
}

const MUTATIONS = new Set(['write_file', 'edit_file', 'delete_file'])
const IMPLEMENTATION_VERBS = 'build|create|make|implement|fix|edit|update|write|add'
const implementationVerb = new RegExp(`\\b(?:${IMPLEMENTATION_VERBS})\\b`, 'i')
// A prohibition such as "Do not edit files" is not an implementation request.
// Remove only the prohibited verbs, preserving positive requests elsewhere.
const prohibitedAction = `(?:${IMPLEMENTATION_VERBS}|run|execute)\\b(?:\\s+(?:any\\s+|the\\s+)?(?:code|files?|commands?|anything|scripts?|tests?))?`
const negatedImplementation = new RegExp(`\\b(?:do\\s+not|don['’]t|never|must\\s+not|should\\s+not)\\s+${prohibitedAction}(?:\\s*(?:,\\s*(?:(?:or|and)\\s+)?|or\\s+|and\\s+)${prohibitedAction})*`, 'gi')
const uid = () => crypto.randomUUID()
const cap = (text: string, limit = 16000) => text.length <= limit ? text : `${text.slice(0, limit)}\n[Output truncated; read a narrower range to continue.]`

/** Keep whole user turns together so no tool result loses its matching call. */
export function compactTranscript(messages: ModelMessage[], maxChars = 60000): ModelMessage[] {
  const groups: ModelMessage[][] = []
  for (const message of messages) {
    if (message.role === 'user' || !groups.length) groups.push([])
    groups[groups.length - 1].push(message)
  }
  let chars = 0
  const kept: ModelMessage[][] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    const cost = JSON.stringify(groups[i]).length
    if (kept.length && chars + cost > maxChars) break
    kept.unshift(groups[i]); chars += cost
  }
  return kept.flat()
}

export function startTurn(conversation: CodingConversation, request: string): SessionTurn {
  const turn: SessionTurn = { id: uid(), request, startedAt: new Date().toISOString(), status: 'running', items: [], changes: [] }
  conversation.turns.push(turn)
  conversation.messages.push({ role: 'user', content: request })
  if (conversation.turns.length === 1) conversation.title = request.replace(/\s+/g, ' ').slice(0, 60)
  return turn
}

/** A conversation loop, with actual tool results fed back into the next model call. */
export async function runConversation(conversation: CodingConversation, turn: SessionTurn, deps: AgentDependencies, signal: AbortSignal): Promise<void> {
  const publish = () => deps.emit({ type: 'turn', turn: structuredClone(turn) })
  const notice = (text: string) => turn.items.push({ id: uid(), kind: 'notice', text })
  const outcomes = new Map<string, boolean>()
  let needsFinal = true
  let coaching = 0
  try {
    signal.throwIfAborted()
    // Exact inventory questions don't require a language model or an inferred tree count.
    const countHere = /^(?:please\s+)?(?:how many files? (?:are|is) (?:there|therr)(?: (?:in )?(?:here|this (?:folder|workspace|project)))?|count (?:all |the )?files?(?: (?:in )?(?:here|this (?:folder|workspace|project)))?)[?.!\s]*$/i.test(turn.request)
    const listFiles = /^(?:(?:please\s+)?(?:list|show)(?:\s+me)?\s+(?:the\s+)?files?(?:\s+(?:here|in (?:this )?(?:folder|workspace|project)))?|what files are (?:here|in (?:this )?(?:folder|workspace|project)))[?.!\s]*$/i.test(turn.request)
    const locationQuestion = /^(?:(?:in )?(?:which|what) (?:location|folder|directory|workspace|path)(?: are (?:you|u)(?: in)?)?|where are (?:you|u)(?: (?:working|running))?|(?:show|give|tell)(?: me)? (?:the )?(?:current|working|selected|target(?:ed)?) (?:folder|directory|workspace|path)|(?:pwd|current directory))[?.!\s]*$/i.test(turn.request)
    if (countHere || listFiles || locationQuestion || /^(?:what can (?:you|u) do|help)[?.!\s]*$/i.test(turn.request)) {
      await deps.waitIfPaused?.()
      const name = countHere ? 'count_files' : listFiles ? 'list_files' : locationQuestion ? 'workspace_info' : 'help'
      const result = await deps.execute(name, { path: '.' }, signal)
      signal.throwIfAborted()
      turn.items.push({ id: uid(), kind: 'tool', name, args: {}, text: name, output: result.output, status: result.ok ? 'completed' : 'failed' })
      turn.items.push({ id: uid(), kind: 'assistant', text: result.output })
      conversation.messages.push({ role: 'assistant', content: result.output })
      turn.status = result.ok ? 'completed' : 'failed'
      needsFinal = false
    } else for (let step = 0; step < (deps.maxSteps ?? 32); step++) {
      signal.throwIfAborted()
      await deps.waitIfPaused?.()
      const item: SessionItem = { id: uid(), kind: 'assistant', text: '' }
      turn.items.push(item); publish()
      const reply = await deps.respond([{ role: 'system', content: deps.system }, ...compactTranscript(conversation.messages)], deps.tools, async (text) => {
        await deps.waitIfPaused?.()
        item.text += text
        deps.emit({ type: 'delta', turnId: turn.id, itemId: item.id, text })
      }, signal)
      signal.throwIfAborted()
      await deps.waitIfPaused?.()
      item.text = reply.content
      turn.tokens = (turn.tokens ?? 0) + (reply.tokens ?? 0)
      if (!item.text) turn.items.splice(turn.items.indexOf(item), 1)
      if (reply.truncated) {
        conversation.messages.push({ role: 'assistant', content: cap(reply.content) }, { role: 'user', content: 'The last generation was truncated. No incomplete tool call was executed. Use smaller file edits and continue from the actual results.' })
        notice('The model reached its reply limit. Retrying with smaller edits.'); publish()
        if (++coaching >= 3) throw new Error('The model repeatedly reached its reply limit. Try a smaller task or a model with a larger output budget.')
        continue
      }
      if (!reply.calls.length) {
        if (!reply.content.trim()) throw new Error('The model returned an empty response. Choose another model or try again.')
        const implementation = implementationVerb.test(turn.request.replace(negatedImplementation, '')) && !/^(?:how|why|explain|what)\b/i.test(turn.request)
        if (implementation && !turn.changes.length && coaching++ < 2) {
          conversation.messages.push({ role: 'assistant', content: reply.content }, { role: 'user', content: 'No file change or command succeeded. Use the tools to implement the request, or clearly explain the blocker. Do not claim that code was changed.' })
          continue
        }
        conversation.messages.push({ role: 'assistant', content: reply.content })
        turn.status = [...outcomes.values()].some((ok) => !ok) || (implementation && !turn.changes.length) ? 'partial' : 'completed'
        needsFinal = false
        break
      }
      conversation.messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) })
      const questionCall = reply.calls.find((call) => call.name === 'ask_user' && deps.tools.some((tool) => tool.name === call.name))
      if (questionCall) {
        // Pause the whole batch: no co-emitted mutation can run while asking.
        let question
        try { question = parseSessionQuestion(questionCall.args) } catch (error) {
          for (const call of reply.calls) conversation.messages.push({ role: 'tool', tool_call_id: call.id, content: call.id === questionCall.id ? `Invalid question: ${error instanceof Error ? error.message : 'Invalid input'}` : 'Deferred while a question is being prepared.' })
          continue
        }
        for (const call of reply.calls) conversation.messages.push({ role: 'tool', tool_call_id: call.id, content: call.id === questionCall.id ? `Question shown to user: ${question.prompt}\nChoices: ${question.options.join('; ')}\nAwaiting the user response.` : 'Deferred: waiting for the user to answer. No action executed.' })
        turn.items.push({ id: uid(), kind: 'question', text: question.prompt, question })
        turn.status = 'completed'
        needsFinal = false
        break
      }
      for (const call of reply.calls) {
        signal.throwIfAborted()
        await deps.waitIfPaused?.()
        const tool: SessionItem = { id: uid(), kind: 'tool', name: call.name, args: call.args, text: call.name, status: 'running' }
        turn.items.push(tool); publish()
        let result: ToolOutcome
        if (!deps.tools.some((spec) => spec.name === call.name)) result = { ok: false, output: 'Unknown or unavailable tool. Pick a tool from the provided catalog.' }
        else if (MUTATIONS.has(call.name) && conversation.mode !== 'edit') result = { ok: false, output: 'Read-only mode does not allow file changes.' }
        else {
          let approved = true
          if (MUTATIONS.has(call.name)) {
            tool.status = 'waiting'; publish()
            approved = await deps.approve(call.name, call.args, signal)
          }
          await deps.waitIfPaused?.()
          signal.throwIfAborted()
          tool.status = 'running'; publish()
          try { result = approved ? await deps.execute(call.name, call.args, signal) : { ok: false, output: 'The user declined this action. Do not retry it or work around the refusal.' } }
          catch (error) { signal.throwIfAborted(); result = { ok: false, output: error instanceof Error ? error.message : 'Tool failed.' } }
        }
        signal.throwIfAborted()
        tool.status = result.ok ? 'completed' : 'failed'
        tool.output = cap(result.output, 24000)
        outcomes.set(`${call.name}:${String(call.args.path ?? call.args.command ?? '')}`, result.ok)
        if (result.change) {
          const existing = turn.changes.find((change) => change.path === result.change!.path)
          if (existing) { existing.after = result.change.after; existing.truncated ||= result.change.truncated }
          else turn.changes.push(result.change)
        }
        conversation.messages.push({ role: 'tool', tool_call_id: call.id, content: cap((result.ok ? '' : 'ERROR: ') + result.output) })
        publish(); await deps.save()
      }
    }
    if (needsFinal) { turn.status = 'partial'; notice('The tool budget was reached. Review the completed actions and send a follow-up to continue.') }
  } catch (error) {
    turn.status = signal.aborted ? 'cancelled' : 'failed'
    for (const item of turn.items) if (item.status === 'running' || item.status === 'waiting') { item.status = 'failed'; item.output ??= 'Interrupted; verify the actual result before retrying.' }
    notice(signal.aborted ? 'Stopped. Completed file changes remain available below.' : error instanceof Error ? error.message : 'The agent could not finish.')
    // Repair interrupted tool protocol before the next turn.
    const answered = new Set(conversation.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id))
    for (const message of [...conversation.messages]) for (const call of message.tool_calls ?? []) if (!answered.has(call.id)) conversation.messages.push({ role: 'tool', tool_call_id: call.id, content: 'Interrupted. Outcome unknown; inspect state before repeating this action.' })
  } finally {
    turn.endedAt = new Date().toISOString()
    conversation.updatedAt = turn.endedAt
    conversation.messages = compactTranscript(conversation.messages)
    publish(); deps.emit({ type: 'approval', approval: null })
    await deps.save()
    deps.emit({ type: 'done' })
  }
}
