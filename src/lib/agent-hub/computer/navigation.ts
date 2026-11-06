export const AUTO_SELECTION_EVENT = 'agenthub-select-auto-task'
export const AUTO_DELETION_EVENT = 'agenthub-auto-task-deleted'
const STORAGE_KEY = 'agenthub-active-auto-task'

export function readAutoSelection(): string | null {
  try { return window.sessionStorage.getItem(STORAGE_KEY) } catch { return null }
}

// Retain selection when the navigation mounts Auto after the event is sent.
export function rememberAutoTask(id: string) {
  try { window.sessionStorage.setItem(STORAGE_KEY, id) } catch { /* Navigation still works in the current view. */ }
  window.dispatchEvent(new CustomEvent<string>(AUTO_SELECTION_EVENT, { detail: id }))
}
