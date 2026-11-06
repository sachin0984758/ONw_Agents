export function codingSessionUrl(href: string, id?: string): string {
  const url = new URL(href)
  if (id) url.searchParams.set('session', id)
  else url.searchParams.delete('session')
  return url.toString()
}

export function rememberCodingSession(id?: string): void {
  if (id) window.localStorage.setItem('agenthub-active-coding-session', id)
  else window.localStorage.removeItem('agenthub-active-coding-session')
  window.history.replaceState(null, '', codingSessionUrl(window.location.href, id))
}
