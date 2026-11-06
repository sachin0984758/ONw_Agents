// This is an early UX check, not the permission boundary. The native controller
// still rejects every mutation in read-only mode, including unrecognised phrasing.
export function requestsComputerInput(request: string): boolean {
  const text = request.trim().replace(/[.!?]+$/, '')
  const prefix = '(?:(?:please|can you|could you|would you|will you|i want you to|i need you to|help me)\\s+)*'
  const action = '(?:open|launch|start|type|enter|click|double[ -]click|right[ -]click|press|scroll|drag|drop|move|switch|focus|fill|select|replace|save|create|edit|delete|rename|run|execute|navigate)'
  return new RegExp(`^${prefix}${action}\\b`, 'i').test(text)
}

export const OBSERVE_ONLY_NOTICE = 'Observe only: opening applications, typing, clicking and other changes are disabled. Auto can inspect permitted applications that are already open.'

export function inputPermissionRequired(request: string, readonly: boolean): string | undefined {
  if (!readonly || !requestsComputerInput(request)) return undefined
  return 'This task needs computer input, but this session is in Observe only mode. The application-launch tool and typing are disabled by that permission setting, not by your local model. No input task has run.\n\nSelect Revoke access to change permissions if access is active, clear Read only, choose the apps, confirm access and select Grant session access. Then run the task again. Review any action prompts before Auto proceeds.'
}


/** Preferences are not grants. An omitted grant denies filesystem/network access. */
export function validateComputerScope(scope: import('./protocol').ComputerScope) {
  const access = scope.workspaceAccess ?? 'none'
  const approvalMode = scope.approvalMode ?? 'always-ask'
  if (!['always-ask', 'when-needed', 'full'].includes(approvalMode)) throw new Error('Choose a valid Auto approval mode.')
  if (!['none', 'read', 'write'].includes(access)) throw new Error('Choose a valid workspace access level.')
  if (access !== 'none' && !scope.workspaceId) throw new Error('Select an explicit registered workspace before granting file access.')
  if (scope.readonly && access === 'write') throw new Error('Observe only cannot grant file writes. Choose read access or allow approved input.')
  if (scope.domains.length && !scope.applications.includes('browser')) throw new Error('Browser hostnames require an explicit browser application grant.')
  if (!scope.internet && scope.domains.some((host) => !['localhost', '127.0.0.1'].includes(host))) throw new Error('External browser hostnames require explicit internet permission.')
  if (!scope.applications.length && access === 'none') throw new Error('Choose at least one application or an explicit workspace grant.')
  return { ...scope, approvalMode, workspaceId: access === 'none' ? undefined : scope.workspaceId, workspaceAccess: access, internet: scope.internet === true }
}

export function needsAutoApproval(scope: import('./protocol').ComputerScope, name: string) {
  if (scope.readonly) return true
  if (scope.approvalMode === 'full') return false
  if (scope.approvalMode === 'when-needed') {
    return !['desktop.open_application', 'desktop.focus_window', 'desktop.minimize_window', 'desktop.maximize_window', 'desktop.restore_window', 'desktop.move_mouse', 'desktop.hover', 'desktop.scroll', 'browser.scroll', 'browser.switch_tab'].includes(name)
  }
  return true
}

export function assertScopeTool(scope: import('./protocol').ComputerScope | undefined, name: string) {
  if (!scope) throw new Error('The session permission grant was revoked. Review permissions before continuing.')
  const reads = ['workspace_info', 'list_files', 'read_file', 'search', 'count_files']
  const writes = ['write_file', 'edit_file', 'delete_file', 'run_command']
  if (reads.includes(name) && (!scope.workspaceId || !['read', 'write'].includes(scope.workspaceAccess ?? 'none'))) throw new Error('Workspace read permission is required.')
  if (writes.includes(name) && (!scope.workspaceId || scope.workspaceAccess !== 'write' || scope.readonly)) throw new Error('Workspace write permission is required.')
  if (name.startsWith('browser.') && !scope.applications.includes('browser')) throw new Error('Browser permission is required.')
}
