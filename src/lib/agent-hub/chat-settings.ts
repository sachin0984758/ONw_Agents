// Shared chat settings — used by BOTH the /api/chat route (server) and the
// Chat view (client). Pure data + validation only, so it is safe to import
// from client code (no fs / SDK dependencies).

export const DEFAULT_SYSTEM_PROMPT =
  'You are the built-in assistant of AgentHub, an all-in-one developer and agent dashboard. ' +
  'You are helpful and friendly. Answer questions directly and follow the selected response-depth preference; provide well-formatted code ' +
  'examples when appropriate using Markdown code blocks, and chat naturally without robotic canned greetings.'

// ── Local providers (auto-detected) ──────────────────────────────────────────
// LM Studio runs on localhost:1234, Ollama on localhost:11434. Both expose
// OpenAI-compatible /v1/chat/completions endpoints — no API key needed.
export interface LocalProvider {
  id: string
  name: string
  endpoint: string
  port: number
}

export const LOCAL_PROVIDERS: LocalProvider[] = [
  { id: 'lmstudio', name: 'LM Studio', endpoint: 'http://localhost:1234/v1', port: 1234 },
  { id: 'ollama', name: 'Ollama', endpoint: 'http://localhost:11434/v1', port: 11434 },
]

export const ADD_CUSTOM_MODEL_VALUE = '__add_custom__'

// ── Model dropdown options ───────────────────────────────────────────────────
export const CHAT_MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Default (auto-detect)' },
]

// Provider model ids: alphanumerics plus . _ : - / separators, 1–128 chars.
// Must allow "/" because some local runtimes return namespaced model ids.
export const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/

export const MAX_SYSTEM_PROMPT_CHARS = 4000

export type ThinkingEffort = 'low' | 'medium' | 'high'
export const THINKING_EFFORTS: ThinkingEffort[] = ['low', 'medium', 'high']
export type ResponseDepth = 'concise' | 'standard' | 'detailed' | 'comprehensive'
export const RESPONSE_DEPTHS: ResponseDepth[] = ['concise', 'standard', 'detailed', 'comprehensive']
export const RESPONSE_DEPTH_LABEL: Record<ResponseDepth, string> = {
  concise: 'Concise',
  standard: 'Standard',
  detailed: 'Detailed',
  comprehensive: 'Comprehensive',
}

/** Shape answer length without changing the separate reasoning-effort setting. */
export function responseDepthPromptSuffix(depth: ResponseDepth): string {
  const instructions: Record<ResponseDepth, string> = {
    concise: 'Keep the response concise: answer directly and include only the explanation needed to be useful. Preserve required formats, requested items, complete code, and important caveats.',
    standard: 'Use a balanced response length: answer directly, explain key points, and add examples or edge cases when they help. Avoid unnecessary padding.',
    detailed: 'Give a detailed response when the task benefits from it: explain key steps, assumptions, examples, and relevant edge cases. Preserve required formats and avoid padding simple answers.',
    comprehensive: 'For a substantial explanation, teach progressively from beginner understanding to advanced practical mastery. Start with prerequisites, plain-language definitions and a simple mental model. Then explain the mechanism step by step, introduce terminology as needed, and work through concrete examples before advanced details, tradeoffs, edge cases, limitations and troubleshooting. Include one worked case study that follows a realistic problem from context and constraints through approach, execution and outcome; label invented scenarios as illustrative and never invent measured results. Explain practical use cases, when this approach is appropriate and when it is unsuitable. For programming topics include runnable examples and expected output where feasible, followed by advanced variations. Finish with a concise synthesis and optional practice when useful. Cover the requested topic fully without irrelevant padding. Scale depth to the question and honor explicit user limits; greetings and simple factual questions still deserve brief answers. When explaining a process, algorithm, system or connected concepts, include one focused flowchart or concept map that makes the central mechanism easier to understand. Use 3–10 short labeled nodes. Label decision branches Yes/No where relevant and explain the connections in the surrounding prose. Render it as a fenced diagram block containing JSON with title, direction ("TB" or "LR"), nodes (unique id, label, optional description and tone), edges (from, to, optional label), and caption. Example:\n```diagram\n{"title":"Process flow","direction":"TB","nodes":[{"id":"start","label":"Start"},{"id":"check","label":"Condition true?"},{"id":"work","label":"Do work"},{"id":"end","label":"Finish"}],"edges":[{"from":"start","to":"check"},{"from":"check","to":"work","label":"Yes"},{"from":"work","to":"check"},{"from":"check","to":"end","label":"No"}],"caption":"Repeat the work while the condition is true, then finish."}\n```\nUse this supported JSON format instead of Mermaid or ASCII diagrams. Skip diagrams for greetings, trivial answers, code-only requests, quiz-only requests or when the user requests plain text. Preserve required formats, MCQ answer keys and explanations. Do not add irrelevant material or claim unperformed verification.',
  }
  return `\n\nResponse depth preference (${depth}): ${instructions[depth]}`
}
export type CodingAgentMode = 'off' | 'read' | 'edit'

export interface ChatSettings {
  /** '' = let the server pick its default model */
  model: string
  systemPrompt: string
  /**
   * Teach mode: when on, the server uses the built-in TEACH_SYSTEM_PROMPT
   * (a full topic-teaching structure) instead of `systemPrompt`. The user's
   * custom `systemPrompt` is preserved and used again when this is off.
   */
  teachMode: boolean
  /** Advanced Teach mode follows a confirmation-gated five-step lesson. */
  advancedTeachMode: boolean
  /**
   * Thinking (answer-effort) control. When on, the server either sends a
   * provider-native reasoning parameter (for models that support it) or a
   * clearly-labelled prompt-guided depth instruction — never claiming native
   * reasoning when only prompt guidance is used.
   */
  thinking: boolean
  /** Effort level used when `thinking` is on. */
  effort: ThinkingEffort
  /** Desired answer length; independent of thinking/reasoning effort. */
  responseDepth: ResponseDepth
  /** Route messages through the persistent local coding-agent tool loop. */
  codingAgentMode: CodingAgentMode
  /** Empty selects the first available local model; custom API models are excluded. */
  codingAgentModel: string
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  model: '',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  teachMode: false,
  advancedTeachMode: false,
  thinking: false,
  effort: 'medium',
  responseDepth: 'standard',
  codingAgentMode: 'off',
  codingAgentModel: '',
}

const STORAGE_KEY = 'agenthub-chat-settings'

/** Load persisted settings from localStorage; falls back to defaults. */
export function loadChatSettings(): ChatSettings {
  if (typeof window === 'undefined') return DEFAULT_CHAT_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CHAT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ChatSettings>
    return {
      model: typeof parsed.model === 'string' && MODEL_ID_PATTERN.test(parsed.model) ? parsed.model : '',
      systemPrompt:
        typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.trim()
          ? parsed.systemPrompt.slice(0, MAX_SYSTEM_PROMPT_CHARS)
          : DEFAULT_SYSTEM_PROMPT,
      teachMode: parsed.teachMode === true,
      advancedTeachMode: parsed.advancedTeachMode === true,
      thinking: parsed.thinking === true,
      effort: THINKING_EFFORTS.includes(parsed.effort as ThinkingEffort)
        ? (parsed.effort as ThinkingEffort)
        : DEFAULT_CHAT_SETTINGS.effort,
      responseDepth: RESPONSE_DEPTHS.includes(parsed.responseDepth as ResponseDepth)
        ? (parsed.responseDepth as ResponseDepth)
        : DEFAULT_CHAT_SETTINGS.responseDepth,
      codingAgentMode: parsed.codingAgentMode === 'read' || parsed.codingAgentMode === 'edit' ? parsed.codingAgentMode : 'off',
      codingAgentModel: typeof parsed.codingAgentModel === 'string' && (parsed.codingAgentModel === '' || MODEL_ID_PATTERN.test(parsed.codingAgentModel))
        ? parsed.codingAgentModel
        : '',
    }
  } catch {
    return DEFAULT_CHAT_SETTINGS
  }
}

export function saveChatSettings(settings: ChatSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // storage may be unavailable (private mode / quota) — settings just won't persist
  }
}
