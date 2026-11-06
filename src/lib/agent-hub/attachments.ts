// ── Chat attachments (shared client + server) ────────────────────────────────
// Types, validation, capability hints and request-shaping helpers for the
// normal Chat composer's image/document attachments and the Thinking control.
// Dependency-free and environment-neutral so it is safe to import from both the
// browser bundle and the /api/chat route.

export type AttachmentKind = 'image' | 'document'

export interface ChatAttachmentPayload {
  name: string
  /** Declared MIME type (may be empty when the browser does not know it). */
  mime: string
  /** Byte length, validated server-side against the real decoded size. */
  size: number
  /** Base64 of the file bytes (no `data:` prefix). */
  dataBase64: string
}

export const MAX_ATTACHMENTS = 8
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
export const MAX_TOTAL_ATTACHMENT_BYTES = 16 * 1024 * 1024
/** Cap on extracted document text folded into the model context. */
export const MAX_EXTRACTED_DOC_CHARS = 20000

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp']
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp'])

const TEXT_EXTS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'json', 'jsonc', 'csv', 'tsv', 'log',
  'yml', 'yaml', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'jsx', 'mjs', 'cjs',
  'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp',
  'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'ini', 'toml', 'env', 'gitignore', 'tex',
  'conf', 'cfg', 'properties', 'graphql', 'gql', 'vue', 'svelte',
])
const TEXT_MIMES = new Set([
  'application/json', 'application/xml', 'application/javascript', 'application/x-yaml',
  'application/yaml', 'application/sql', 'application/x-sh',
])

const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
])
const ZIP_MIMES = new Set(['application/zip', 'application/x-zip-compressed'])

/** Lower-cased filename extension without the dot. */
export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

/** Classify a file as an image, a supported document, or null (unsupported). */
export function attachmentKind(name: string, mime: string): AttachmentKind | null {
  const m = (mime || '').toLowerCase()
  const ext = extOf(name)
  if (IMAGE_MIMES.includes(m) || IMAGE_EXTS.has(ext)) return 'image'
  if (m === 'application/pdf' || ext === 'pdf') return 'document'
  if (DOCX_MIMES.has(m) || ext === 'docx') return 'document'
  if (ZIP_MIMES.has(m) || ext === 'zip') return 'document'
  if (m.startsWith('text/') || TEXT_MIMES.has(m) || TEXT_EXTS.has(ext)) return 'document'
  return null
}

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.includes((mime || '').toLowerCase())
}

/** Human-readable reason a file cannot be attached, or null when it is fine. */
export function validateAttachment(name: string, mime: string, size: number): string | null {
  if (!name || !name.trim()) return 'A file with no name cannot be attached.'
  if (!Number.isFinite(size) || size <= 0) return `“${name}” is empty and was not attached.`
  if (size > MAX_ATTACHMENT_BYTES) {
    return `“${name}” is ${(size / (1024 * 1024)).toFixed(1)} MB — the limit is ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB per file.`
  }
  if (attachmentKind(name, mime) === null) {
    return `“${name}” is not a supported image or document type (PNG/JPEG/WebP, TXT/MD/JSON/CSV/source, PDF, DOCX, ZIP).`
  }
  return null
}

export function dataUrlFor(mime: string, base64: string, name = ''): string {
  const ext = extOf(name)
  const fallback = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'application/octet-stream'
  const m = isImageMime(mime) ? mime.toLowerCase() : fallback
  return `data:${m};base64,${base64}`
}

/** Parse a `data:<mime>;base64,<data>` URL, returning null when malformed. */
export function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]+)?;base64,([\s\S]*)$/.exec(dataUrl)
  if (!m) return null
  return { mime: m[1] || 'application/octet-stream', base64: m[2] ?? '' }
}

// ── Vision capability ────────────────────────────────────────────────────────
// Local providers report `type: 'vlm'` for vision models; otherwise fall back to
// well-known id patterns. Used to avoid pretending a text-only model saw an
// image — and to suggest an actually-available vision model instead.
const VISION_ID_HINT =
  /(^|[^a-z])(vl|vision|llava|pixtral|moondream|minicpm-?v|internvl|idefics|paligemma|florence)([^a-z]|$)|qwen[^/]*vl|gemma[^/]*vision|llama[^/]*vision|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|o[34]/i

export function modelLooksVision(id: string, type?: string): boolean {
  if (type === 'vlm') return true
  if (!id) return false
  return VISION_ID_HINT.test(id)
}

// ── Thinking / answer-effort ─────────────────────────────────────────────────
// Providers that accept a native `reasoning_effort` parameter. Everything else
// gets a clearly-labelled prompt-guided depth instruction instead.
const NATIVE_REASONING_HINT =
  /(^|[-_/])(o1|o3|o4|o4-mini|gpt-5|gpt-oss|deepseek-r\d*|deepseek-reasoner|qwq|magistral|reasoning|thinking)([-_/:]|$)|qwen3[^/]*think|o[34]-/i

export type ThinkingMode = 'native' | 'prompt'

/** Whether the model id is expected to accept a native reasoning-effort param. */
export function thinkingModeFor(modelId: string): ThinkingMode {
  return NATIVE_REASONING_HINT.test(modelId || '') ? 'native' : 'prompt'
}

/** Extra request-body fields for native reasoning. Empty for prompt-guided. */
export function reasoningBody(modelId: string, effort: string): Record<string, unknown> {
  if (thinkingModeFor(modelId) !== 'native') return {}
  return { reasoning_effort: effort }
}

const DEPTH: Record<string, string> = {
  low: 'briefly and efficiently',
  medium: 'carefully, step by step',
  high: 'very thoroughly, verifying each step',
}

/** A clearly prompt-guided depth instruction (NOT a native reasoning control). */
export function thinkingPromptSuffix(effort: string): string {
  const depth = DEPTH[effort] ?? DEPTH.medium
  return (
    `\n\nThe user enabled "Thinking" (effort: ${effort}). Reason ${depth} before answering, ` +
    `and double-check the result. Present only the final, reasoned answer — do not print private ` +
    `chain-of-thought, drafts, or internal deliberation.`
  )
}
