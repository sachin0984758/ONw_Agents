import path from 'path'

// ─── Durable db/ directory resolution ─────────────────────────────────────────
// Both API routes persist JSON under db/. Resolving that directory from
// process.cwd() alone is WRONG in production mode: Next's standalone server
// (`.next/standalone/server.js`) calls process.chdir(__dirname) at boot, so
// cwd points at `.next/standalone` — a transient build artifact that
// `next build` wipes. Persisting there silently destroys chat history and
// agent state on every rebuild and splits dev/prod state.
//
// Resolution order:
//   1. AGENT_HUB_DB_DIR env var (absolute or cwd-relative) — overrides
//      everything; also lets tests isolate persistence into a temp dir.
//   2. If cwd is inside `.next/standalone`, climb back to the repo root
//      (two levels up) so dev and production share the same db/ files.
//   3. Default: <cwd>/db (covers `next dev`, which runs from the repo root).
export function resolveProjectRoot(cwd: string = process.cwd()): string {
  if (process.env.AGENTHUB_PROJECT_ROOT) return path.resolve(process.env.AGENTHUB_PROJECT_ROOT)
  const buildDirectory = path.basename(path.dirname(cwd))
  if (path.basename(cwd) === 'standalone' && /^\.next(?:-.*)?$/.test(buildDirectory)) {
    return path.resolve(cwd, '..', '..')
  }
  return cwd
}

export function resolveDbDir(cwd: string = process.cwd()): string {
  if (process.env.AGENT_HUB_DB_DIR) {
    return path.resolve(process.env.AGENT_HUB_DB_DIR)
  }
  return path.join(resolveProjectRoot(cwd), 'db')
}

export const DB_DIR = resolveDbDir()
