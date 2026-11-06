import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DB_DIR } from './db-path'
import { createSerializer, writeJsonAtomic } from './fs-atomic'

const HISTORY_FILE = path.join(DB_DIR, 'chat-history.json')
const THREADS_DIR = path.join(DB_DIR, 'chat-threads')
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_STORED_MESSAGES = 200
export const serializeChat = createSerializer()

export interface StoredChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  time: string
  kind?: 'chat' | 'tool_activity' | 'system_event' | 'error'
  activity?: unknown
}

interface ChatThread {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: StoredChatMessage[]
}

export function validChatId(id: string): boolean {
  return id === 'legacy' || THREAD_ID_PATTERN.test(id)
}

export function threadFile(id: string): string {
  return path.join(THREADS_DIR, `${id}.json`)
}

export async function readThread(id: string): Promise<ChatThread | null> {
  if (!THREAD_ID_PATTERN.test(id)) return null
  try {
    const parsed = JSON.parse(await fs.readFile(threadFile(id), 'utf-8')) as ChatThread
    return parsed?.id === id && Array.isArray(parsed.messages) ? parsed : null
  } catch {
    return null
  }
}

export async function readHistory(chatId = 'legacy'): Promise<StoredChatMessage[]> {
  if (chatId !== 'legacy') return (await readThread(chatId))?.messages ?? []
  let raw: string
  try {
    raw = await fs.readFile(HISTORY_FILE, 'utf-8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as StoredChatMessage[]
    return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.content === 'string') : []
  } catch {
    try {
      await fs.rename(HISTORY_FILE, `${HISTORY_FILE}.corrupt-${Date.now()}`)
    } catch {
      // renaming is best-effort; never crash reads over it
    }
    console.warn('[api/chat] history file was corrupt — backed it up and starting fresh')
    return []
  }
}

export async function writeHistory(messages: StoredChatMessage[], chatId = 'legacy') {
  if (chatId === 'legacy') {
    await writeJsonAtomic(HISTORY_FILE, messages.slice(-MAX_STORED_MESSAGES))
    return
  }
  const thread = await readThread(chatId)
  if (!thread) throw new Error('Chat conversation no longer exists.')
  const firstUser = messages.find((m) => m.role === 'user' && m.kind === 'chat' && m.content.trim())
  const title = thread.title === 'New chat' && firstUser
    ? firstUser.content.replace(/\[Attached:[\s\S]*$/, '').trim().slice(0, 60) || 'Attachment chat'
    : thread.title
  await writeJsonAtomic(threadFile(chatId), {
    ...thread,
    title,
    updatedAt: new Date().toISOString(),
    messages: messages.slice(-MAX_STORED_MESSAGES),
  })
}


export async function listChatConversations() {
  const conversations: Array<{ id: string; title: string; updatedAt: string; messageCount: number }> = []
  try {
    const legacy = JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8')) as ChatThread['messages']
    if (Array.isArray(legacy) && legacy.length) {
      const first = legacy.find((m) => m.role === 'user' && typeof m.content === 'string')
      conversations.push({
        id: 'legacy',
        title: first?.content?.trim().slice(0, 60) || 'Previous chat',
        updatedAt: (await fs.stat(HISTORY_FILE)).mtime.toISOString(),
        messageCount: legacy.length,
      })
    }
  } catch { /* no previous chat */ }

  try {
    for (const file of await fs.readdir(THREADS_DIR)) {
      const id = file.endsWith('.json') ? file.slice(0, -5) : ''
      if (!THREAD_ID_PATTERN.test(id)) continue
      const thread = await readThread(id)
      if (thread) conversations.push({
        id,
        title: thread.title || 'New chat',
        updatedAt: thread.updatedAt,
        messageCount: thread.messages.length,
      })
    }
  } catch { /* no conversations yet */ }
  conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return conversations
}

export async function createChatConversation(): Promise<ChatThread> {
  const now = new Date().toISOString()
  const thread: ChatThread = { id: crypto.randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, messages: [] }
  await writeJsonAtomic(threadFile(thread.id), thread)
  return thread
}

export function renameChatConversation(id: string, title: string): Promise<boolean> {
  return serializeChat(async () => {
    const thread = await readThread(id)
    if (!thread) return false
    await writeJsonAtomic(threadFile(id), { ...thread, title, updatedAt: new Date().toISOString() })
    return true
  })
}

export function deleteChatConversation(id: string): Promise<boolean> {
  return serializeChat(async () => {
    if (!(await readThread(id))) return false
    await fs.rm(threadFile(id))
    return true
  })
}

export async function clearHistory(chatId: string): Promise<void> {
  if (chatId === 'legacy') await fs.rm(HISTORY_FILE, { force: true })
  else {
    const thread = await readThread(chatId)
    if (thread) await writeJsonAtomic(threadFile(chatId), { ...thread, updatedAt: new Date().toISOString(), messages: [] })
  }
}
