import { readUsage, type LLMUsage } from '../llm'
import { reasoningBody } from '../attachments'
import type { LLMTarget } from '../llm'
import type { ModelMessage, ModelReply, ToolCall, ToolSpec } from './types'
import { recordServerUsage } from '../state-file'
import { beginModelActivity } from '../usage-events'

function fallbackCalls(content: string): { content: string; calls: ToolCall[] } {
  const calls: ToolCall[] = []
  const text = content.replace(/```tool\s*([\s\S]*?)```/g, (block, raw: string) => {
    try {
      const value = JSON.parse(raw)
      if (typeof value.name === 'string' && value.args && typeof value.args === 'object' && !Array.isArray(value.args)) {
        calls.push({ id: crypto.randomUUID(), name: value.name, args: value.args }); return ''
      }
    } catch { /* Malformed calls are never executed. */ }
    return block
  })
  return { content: text.trim(), calls }
}

function streamError(value: unknown): Error {
  // Classify provider diagnostics without exposing bodies that may echo prompts.
  const description = JSON.stringify(value).slice(0, 8000)
  if (/exceed_context_size|context_length_exceeded|exceeds? (?:the )?(?:available )?context|context (?:size|length|window)/i.test(description)) {
    const error = new Error('The request exceeds the local model’s loaded context window. Reduce the task context or increase the context length in LM Studio.')
    error.name = 'ModelContextLimitError'
    return error
  }
  return new Error('The model provider reported a generation error. Check the local model server logs; no action from this response was executed.')
}

export function createModelResponder(target: LLMTarget, effort: string, options?: { onRequest?: () => void; source?: string; maxTokens?: number; waitIfPaused?: () => Promise<void>; images?: { type: 'image_url'; image_url: { url: string } }[] }) {
  let nativeTools = true
  return async (messages: ModelMessage[], tools: ToolSpec[], onText: (text: string) => void | Promise<void>, signal: AbortSignal): Promise<ModelReply> => {
    const endActivity = beginModelActivity(target.label, options?.source ?? 'Coding session')
    const usageState: { value: LLMUsage | null } = { value: null }
    let inputChars = 0; let outputChars = 0
    try {
    const prepared = nativeTools ? messages : messages.map((message): ModelMessage => ({
      role: message.role === 'tool' ? 'user' : message.role,
      content: message.content + (message.tool_calls?.length ? `\nTool calls: ${JSON.stringify(message.tool_calls)}` : ''),
    }))
    if (!nativeTools) prepared[0] = { ...prepared[0], content: `${prepared[0].content}\nThis provider uses text tool calls. Emit one fenced tool block: \`\`\`tool\n{"name":"read_file","args":{"path":"README.md"}}\n\`\`\`. Tools: ${JSON.stringify(tools)}` }
    const withImages = (turns: ModelMessage[]) => {
      const userIndex = turns.findLastIndex((message) => message.role === 'user')
      return turns.map((message, index) => index === userIndex && options?.images?.length
        ? { ...message, content: [{ type: 'text', text: message.content }, ...options.images] } : message)
    }
    const body: Record<string, unknown> = { model: target.modelId, messages: withImages(prepared), stream: true, stream_options: { include_usage: true }, max_tokens: options?.maxTokens ?? 4096, ...reasoningBody(target.modelId, effort === 'off' ? 'none' : effort) }
    if (nativeTools && tools.length) {
      body.tools = tools.map((tool) => ({ type: 'function', function: tool }))
      body.tool_choice = 'auto'
      body.parallel_tool_calls = false
    }
    const request = () => { inputChars = JSON.stringify({ messages: body.messages, tools: body.tools }).length; options?.onRequest?.(); return fetch(`${target.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}) },
      // Local code generation can exceed three minutes on laptop hardware.
      // Keep a bounded request while preserving immediate user cancellation.
      body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]),
    }) }
    let response = await request()
    if ([400, 422].includes(response.status) && nativeTools) {
      const diagnostic = await response.json().catch(() => null)
      const classified = streamError(diagnostic)
      if (classified.name === 'ModelContextLimitError') throw classified
      nativeTools = false
      delete body.tools; delete body.tool_choice; delete body.parallel_tool_calls; delete body.reasoning_effort
      body.messages = messages.map((message) => ({ role: message.role === 'tool' ? 'user' : message.role, content: message.content + (message.tool_calls ? `\nTool calls: ${JSON.stringify(message.tool_calls)}` : '') }))
      const fallback = body.messages as ModelMessage[]
      fallback[0].content += `\nUse one fenced tool JSON block when taking an action, for example \`\`\`tool\n{"name":"list_files","args":{"path":"."}}\n\`\`\`. Available tools: ${JSON.stringify(tools)}`
      body.messages = withImages(fallback)
      response = await request()
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(target.loaded === false && [400, 404].includes(response.status)
        ? `Load ${target.modelId} in the model provider, then try again.`
        : `The model provider returned HTTP ${response.status}. Check the selected model and provider.`)
    }
    if (!response.body) throw new Error('The model provider returned no response body.')
    let content = ''
    let truncated = false
    let tokens: number | undefined
    const accumulated = new Map<number, { id: string; name: string; args: string }>()
    const consume = async (json: Record<string, unknown>) => {
      if (json.error) throw streamError(json.error)
      const usage = readUsage(json)
      if (usage) { tokens = usage.totalTokens; usageState.value = usage }
      const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0]
      if (!choice) return
      truncated ||= choice.finish_reason === 'length'
      const delta = (choice.delta ?? choice.message ?? {}) as { content?: string; reasoning_content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }
      outputChars += (delta.content?.length ?? 0) + (delta.reasoning_content?.length ?? 0)
      if (typeof delta.content === 'string') { content += delta.content; await onText(delta.content) }
      for (const [index, call] of (delta.tool_calls ?? []).entries()) {
        outputChars += (call.function?.name?.length ?? 0) + (call.function?.arguments?.length ?? 0)
        const key = call.index ?? index
        const current = accumulated.get(key) ?? { id: '', name: '', args: '' }
        if (call.id) current.id = call.id
        if (call.function?.name) current.name += call.function.name
        if (call.function?.arguments) current.args += call.function.arguments
        if (current.args.length > 1_100_000) throw new Error('The model proposed a tool call that is too large.')
        accumulated.set(key, current)
      }
    }
    if ((response.headers.get('content-type') ?? '').includes('application/json')) { await options?.waitIfPaused?.(); await consume(await response.json()) }
    else {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          await options?.waitIfPaused?.()
          const chunk = await reader.read()
          buffer += decoder.decode(chunk.value, { stream: !chunk.done })
          const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''
          if (chunk.done && buffer) { lines.push(buffer); buffer = '' }
          for (const line of lines) if (line.startsWith('data:')) {
            const data = line.slice(5).trim()
            if (data && data !== '[DONE]') { await options?.waitIfPaused?.(); await consume(JSON.parse(data)) }
          }
          if (content.length > 200000 || buffer.length > 2_000_000) throw new Error('The model response exceeded the session limit.')
          if (chunk.done) break
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    }
    const calls: ToolCall[] = []
    if (!truncated) for (const call of accumulated.values()) {
      try {
        const args = JSON.parse(call.args || '{}')
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object')
        calls.push({ id: call.id || crypto.randomUUID(), name: call.name, args })
      } catch { throw new Error('The model returned invalid tool arguments. Nothing from that call was executed.') }
    }
    const fallback = calls.length || truncated ? { content, calls } : fallbackCalls(content)
    return { ...fallback, truncated, tokens }
    } finally {
      try {
        const reportedUsage = usageState.value
        if (reportedUsage || outputChars > 0) await recordServerUsage({
          input: reportedUsage ? reportedUsage.inputTokens : Math.ceil(inputChars / 4),
          output: reportedUsage ? reportedUsage.outputTokens : Math.ceil(outputChars / 4),
          estimated: !reportedUsage, model: target.label,
        })
      } catch { console.error('Could not persist coding/Auto token usage.') }
      endActivity()
    }
  }
}
