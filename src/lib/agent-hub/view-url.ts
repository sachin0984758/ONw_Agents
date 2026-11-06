import type { ViewId } from './types'

// ── Deep-link view resolution ────────────────────────────────────────────────
// The shell keeps the active view in the URL (`?view=chat` or `#chat`) so a
// reload or a shared link lands on the same view. The parsing lives here as a
// small pure function so it can be unit-tested without a browser: the shell
// only needs to hand it `location.search` and `location.hash`.

/** Every view id the shell can navigate to. Keep in sync with `NAV` in shell.tsx. */
export const VIEW_IDS: ViewId[] = [
  'overview',
  'chat',
  'agents',
  'sessions',
  'auto',
  'tasks',
  'changes',
  'playground',
  'ui-components',
  'capabilities',
  'models',
  'settings',
  'agent-api',
]

export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && (VIEW_IDS as readonly string[]).includes(value)
}

/**
 * Resolve the view a deep link points at.
 *
 * `?view=chat` takes precedence over the `#chat` hash, and an unknown or empty
 * value resolves to `null` so the caller keeps the current view. Links to the
 * retired Code Graph and Workflows screens return to Overview.
 */
export function resolveViewFromDeepLink(search: string, hash: string): ViewId | null {
  let fromQuery: string | null = null
  try {
    fromQuery = new URLSearchParams(search ?? '').get('view')
  } catch {
    fromQuery = null
  }
  const candidate = fromQuery && fromQuery.length > 0 ? fromQuery : (hash ?? '').replace(/^#/, '')
  if (candidate === 'graph' || candidate === 'workflows') return 'overview'
  return isViewId(candidate) ? candidate : null
}
