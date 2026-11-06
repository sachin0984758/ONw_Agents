'use client'

export type MascotActivityState = 'working' | 'game' | 'waiting' | 'paused' | 'done' | 'error' | 'idle'
export type MascotActivityDisplay = {
  task?: string
  phase?: string
  operation?: string
  output?: string
  files?: string[]
}
export const MASCOT_ACTIVITY_EVENT = 'agenthub:mascot-activity'
export const MASCOT_CHAT_SEND_EVENT = 'agenthub:mascot-chat-send'
export const MASCOT_CHAT_PAUSE_EVENT = 'agenthub:mascot-chat-pause'

export function sendMascotChatMessage(text: string, source?: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MASCOT_CHAT_SEND_EVENT, { detail: { text, source } }))
}

export function setMascotChatPaused(paused: boolean, source?: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MASCOT_CHAT_PAUSE_EVENT, { detail: { paused, source } }))
}

export function isGameBuildRequest(text: string): boolean {
  const message = text.trim()
  return /^\/game(?:\s|$)/i.test(message) ||
    /\b(?:creat(?:e|ing)|build(?:ing)?|mak(?:e|ing)|develop(?:ing)?|implement(?:ing)?|cod(?:e|ing)|design(?:ing)?|generat(?:e|ing))\b[\s\S]{0,100}\b(?:a\s+|the\s+)?(?:video\s+)?game\b/i.test(message)
}

export function setMascotActivity(source: string, state: MascotActivityState, display?: MascotActivityDisplay): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MASCOT_ACTIVITY_EVENT, { detail: { source, state, display } }))
}
