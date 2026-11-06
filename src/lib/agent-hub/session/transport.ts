// Independent transport helpers; no session state or initialization side effects.

export async function apiGet(base: string, params: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response
  try {
    const qs = new URLSearchParams(params).toString()
    res = await fetch(`${base}?${qs}`)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Network error')
  }
  let json: Record<string, unknown> | null = null
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = null
  }
  return { status: res.status, json }
}

export async function apiPost(base: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let res: Response
  try {
    res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Network error')
  }
  let json: Record<string, unknown> | null = null
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = null
  }
  return { status: res.status, json }
}

