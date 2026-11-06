'use client'

import { createContext } from 'react'
import type { ConversationAppearance } from './conversation-profile'

// Code highlighting follows the profile palette inside conversation surfaces.
// Standalone consumers continue to follow the application's theme.
export const ConversationColorScheme = createContext<'light' | 'dark' | undefined>(undefined)
export const ConversationAppearanceContext = createContext<ConversationAppearance | undefined>(undefined)
