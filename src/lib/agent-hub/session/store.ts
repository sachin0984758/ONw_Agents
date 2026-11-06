import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from '../db-path'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import { relativeProjectPath } from './paths'
import type { CodingConversation, SessionSummary } from './types'

const STORE_FILE = path.join(DB_DIR, 'session-conversations.json')
const serialize = createSerializer()
const safeId = /^[a-f0-9-]{36}$/i
const validMode = (value: unknown): value is 'ro' | 'edit' => value === 'ro' || value === 'edit'
const validEffort = (value: unknown): value is CodingConversation['effort'] => ['off', 'low', 'medium', 'high'].includes(String(value))

async function readAll(): Promise<CodingConversation[]> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is CodingConversation => {
      if (!item || typeof item !== 'object') return false
      const value = item as Partial<CodingConversation>
      return value.version === 2 && typeof value.id === 'string' && safeId.test(value.id) && typeof value.workspace === 'string' && Array.isArray(value.turns) && Array.isArray(value.messages)
    }).map((item) => ({ ...item, turns: item.turns.slice(-100), messages: item.messages.slice(-500) }))
  } catch { return [] }
}

export async function listConversations(): Promise<SessionSummary[]> {
  return (await readAll()).filter((entry) => !entry.deletedAt).map(({ turns, messages, ...summary }) => ({ ...summary, turnCount: turns.length }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getConversation(id: string): Promise<CodingConversation | null> {
  if (!safeId.test(id)) return null
  return (await readAll()).find((conversation) => conversation.id === id && !conversation.deletedAt) ?? null
}

export async function saveConversation(conversation: CodingConversation): Promise<void> {
  await serialize(async () => {
    const conversations = await readAll()
    const index = conversations.findIndex((entry) => entry.id === conversation.id)
    if (index >= 0 && conversations[index].deletedAt) throw new Error('This session was deleted.')
    const stored = structuredClone(conversation)
    stored.turns = stored.turns.slice(-100)
    stored.messages = stored.messages.slice(-500)
    if (index >= 0) conversations[index] = stored
    else conversations.push(stored)
    const sorted = conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const bounded = [...sorted.filter((entry) => !entry.deletedAt).slice(0, 80), ...sorted.filter((entry) => entry.deletedAt).slice(0, 80)]
    await writeJsonAtomic(STORE_FILE, bounded, 0)
  })
}

export async function setConversationDeleted(id: string, deleted: boolean): Promise<boolean> {
  if (!safeId.test(id)) return false
  return serialize(async () => {
    const conversations = await readAll()
    const conversation = conversations.find((entry) => entry.id === id)
    if (!conversation) return false
    if (deleted) conversation.deletedAt = new Date().toISOString()
    else delete conversation.deletedAt
    await writeJsonAtomic(STORE_FILE, conversations, 0)
    return true
  })
}

export function createConversation(input: { workspace: string; workspaceId?: string; workspaceLabel?: string; workspaceAccess?: CodingConversation['workspaceAccess']; mode?: unknown; model?: unknown; effort?: unknown; chatId?: unknown; localOnly?: unknown }): CodingConversation {
  return {
    version: 2,
    id: crypto.randomUUID(),
    ...(typeof input.chatId === 'string' ? { chatId: input.chatId } : {}),
    localOnly: input.localOnly === true,
    title: 'New session',
    workspace: input.workspace,
    workspaceAccess: input.workspaceAccess ?? 'none',
    ...(input.workspaceId ? { workspaceId: input.workspaceId, workspaceLabel: input.workspaceLabel } : {}),
    mode: validMode(input.mode) ? input.mode : 'ro',
    model: typeof input.model === 'string' ? input.model.slice(0, 300) : '',
    effort: validEffort(input.effort) ? input.effort : 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    turns: [],
    messages: [],
  }
}

export function workspaceInProject(value: unknown): string {
  if (typeof value !== 'string') return '.'
  return relativeProjectPath(value, 'Workspace must be a relative folder inside the project.')
}
