/** Transport-neutral result shared by workspace services and their HTTP adapters. */
export interface WorkspaceResult {
  body: Record<string, unknown>
  status: number
}

export function workspaceResult(body: Record<string, unknown>, options?: { status?: number }): WorkspaceResult {
  return { body, status: options?.status ?? 200 }
}
