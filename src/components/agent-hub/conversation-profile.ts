export const CONVERSATION_APPEARANCES = ['day', 'night', 'warm-sand', 'ocean-panels', 'bold-outline'] as const

export type ConversationAppearance = (typeof CONVERSATION_APPEARANCES)[number]
