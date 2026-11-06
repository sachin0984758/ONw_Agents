import { promises as fs } from 'node:fs'
import path from 'node:path'

const LOCK_WAIT_MS = 15_000

/** Cross-process exclusion. Never steals a lock: a crash requires manual review/removal. */
export async function withFileLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const lock = `${file}.lock`
  const deadline = Date.now() + LOCK_WAIT_MS
  let handle
  for (;;) {
    try { handle = await fs.open(lock, 'wx', 0o600); break }
    catch (err) {
      let code = (err as NodeJS.ErrnoException).code
      // Windows can surface a simultaneous exclusive-create collision as
      // EPERM. Treat it as contention only when the lock path actually exists;
      // otherwise preserve the original permission error.
      if (process.platform === 'win32' && code === 'EPERM') {
        try { await fs.stat(lock); code = 'EEXIST' } catch { throw err }
      }
      if (code !== 'EEXIST') throw err
      if (Date.now() >= deadline) throw new Error(`Storage is locked; review the owning process before removing ${lock}`)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  try { return await operation() }
  finally { await handle.close(); await fs.unlink(lock) }
}
