import { promises as fs } from 'fs'
import path from 'path'

// ── Atomic JSON writes with unique temp names ────────────────────────────────
// Every writer used to share one `<file>.tmp` path. Under concurrent writes
// (the dashboard POSTs the full state once per UI change — Pause All fires
// nine at once) two writers could write the same temp file and one rename
// would hit ENOENT after the other renamed it away, surfacing as spurious
// 400s and silently dropped writes. A unique temp name makes each write
// atomic on its own; concurrent renames to the target are last-write-wins.

let seq = 0

function tempPathFor(file: string): string {
  seq = (seq + 1) % 1_000_000
  return `${file}.${process.pid}.${Date.now()}.${seq}.tmp`
}

export async function writeTextAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true })
  const tmp = tempPathFor(file)
  try {
    await fs.writeFile(/* turbopackIgnore: true */ tmp, content, 'utf-8')
    // Windows can briefly deny replacement while another atomic writer or
    // reader has the destination open. Retry only those transient lock errors;
    // permanent path/permission errors still fail without touching the target.
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(tmp, file); break }
      catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(String(code)) || attempt >= 5) throw error
        await new Promise((resolve) => setTimeout(resolve, 20 * (2 ** attempt)))
      }
    }
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {})
  }
}

export async function writeJsonAtomic(file: string, value: unknown, space = 2): Promise<void> {
  await writeTextAtomic(file, JSON.stringify(value, null, space))
}

// Serialize async work (read-merge-write cycles) that must not interleave.
export function createSerializer(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }
}
