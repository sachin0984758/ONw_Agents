import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import { downloadGitHubTemplate, listGitHubTemplates, normalizeGitHubRef, UI_LIBRARY_DIRECTORY } from './github-templates'

interface Job {
  provider?: 'github'
  ref: string
  status: 'queued' | 'saved' | 'failed' | 'cancelled'
  error?: string
}
interface Queue { paused: boolean; jobs: Job[]; lastDownload?: string }

const file = path.join(UI_LIBRARY_DIRECTORY, 'downloads.json')
const shared = globalThis as typeof globalThis & { agentHubDownloadQueue?: ReturnType<typeof createSerializer> }
const serialize = shared.agentHubDownloadQueue ??= createSerializer()

async function readQueue(): Promise<Queue> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as Queue }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('The download queue could not be read. Existing data was preserved.')
    return { paused: true, jobs: [] }
  }
}

export async function downloadStatus(queue?: Queue) {
  const state = queue ?? await readQueue()
  const downloaded = await listGitHubTemplates()
  return { ...state, jobs: state.jobs.filter((job) => job.provider === 'github'), downloaded: downloaded.length, sourceBytes: downloaded.reduce((total, entry) => total + entry.bytes, 0), templates: downloaded }
}

export async function updateDownloadQueue(action: 'enqueue' | 'pause' | 'resume' | 'retry' | 'step' | 'cancel', refs: string[] = []) {
  return serialize(async () => {
    const queue = await readQueue()
    if (action === 'enqueue') {
      const selected = new Set(refs.map(normalizeGitHubRef))
      const saved = new Set((await listGitHubTemplates()).map((record) => record.ref))
      const additions: Job[] = [...selected].filter((ref) => !saved.has(ref) && !queue.jobs.some((job) => job.provider === 'github' && job.ref === ref && job.status !== 'cancelled')).map((ref) => ({ ref, status: 'queued', provider: 'github' }))
      if (queue.jobs.length + additions.length > 3000) throw new Error('The download history supports up to 3,000 entries.')
      queue.jobs.push(...additions)
      queue.paused = false
    }
    if (action === 'pause') queue.paused = true
    if (action === 'cancel') {
      queue.paused = true
      for (const job of queue.jobs) if (job.provider === 'github' && job.status === 'queued') job.status = 'cancelled'
    }
    if (action === 'resume') queue.paused = false
    if (action === 'retry') {
      queue.jobs = queue.jobs.map((job) => job.provider === 'github' && job.status === 'failed' ? { ...job, status: 'queued', error: undefined } : job)
      queue.paused = false
    }
    if (action === 'step' && !queue.paused) {
      const job = queue.jobs.find((entry) => entry.provider === 'github' && entry.status === 'queued')
      if (job) {
        try {
          await downloadGitHubTemplate(job.ref)
          job.status = 'saved'
          queue.lastDownload = new Date().toISOString()
        } catch (error) {
          job.status = 'failed'
          job.error = error instanceof Error ? error.message : 'Source retrieval failed.'
          queue.paused = true
        }
      }
    }
    await writeJsonAtomic(file, queue)
    return downloadStatus(queue)
  })
}
