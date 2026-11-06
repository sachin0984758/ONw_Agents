import type { AgentEvent } from '../core/events.ts'

export type ActivityPhase =
  | 'working' | 'thinking' | 'responding' | 'acting' | 'planning'
  | 'approval' | 'delegating' | 'cancelling'
  | 'completed' | 'cancelled' | 'failed' | 'partial'

export interface Activity {
  phase: ActivityPhase
  detail?: string
}

export const ACTIVITY_LABELS: Record<ActivityPhase, string> = {
  working: 'Working', thinking: 'Thinking', responding: 'Responding',
  acting: 'Acting', planning: 'Planning', approval: 'Waiting for approval',
  delegating: 'Delegating', cancelling: 'Cancelling', completed: 'Completed',
  cancelled: 'Cancelled', failed: 'Failed', partial: 'Incomplete',
}

export function activityIsBusy(activity: Activity | null): boolean {
  return activity !== null && !['completed', 'cancelled', 'failed', 'partial'].includes(activity.phase)
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    read_file: 'Reading file', write_file: 'Writing file', edit_file: 'Editing file',
    list_dir: 'Listing folder', search_files: 'Searching files', run_command: 'Running command',
    git_status: 'Checking Git', git_diff: 'Reading changes', git_log: 'Reading history',
    list_skills: 'Listing skills', read_skill: 'Loading skill',
    set_plan: 'Creating plan', update_plan: 'Updating plan', show_plan: 'Reading plan',
    mcp_list: 'Listing external tools', mcp_call: 'Calling external tool',
    run_subagent: 'Running subagent',
  }
  return labels[name] ?? name.replaceAll('_', ' ')
}

/** Thinking means a model request is pending, not access to private reasoning. */
export function activityForEvent(current: Activity | null, event: AgentEvent): Activity | null {
  if (current?.phase === 'cancelling' && event.type !== 'run_cancelled' && event.type !== 'run_completed') return current
  switch (event.type) {
    case 'run_started': return { phase: 'working', detail: 'Starting session' }
    case 'status':
      if (event.status === 'running') return { phase: 'thinking', detail: 'Waiting for model' }
      return { phase: event.status }
    case 'assistant_delta':
      return event.text ? { phase: 'responding' } : current
    case 'assistant_message':
      return event.text.trim() ? { phase: 'responding' } : current
    case 'tool_proposed': return { phase: 'working', detail: 'Preparing action' }
    case 'tool_started':
    case 'tool_progress': return { phase: 'acting', detail: toolLabel(event.name) }
    case 'tool_result': return { phase: 'working', detail: 'Processing action result' }
    case 'tool_error': return { phase: 'working', detail: 'Processing action error' }
    case 'approval_requested': return { phase: 'approval', detail: toolLabel(event.tool) }
    case 'approval_resolved': return event.approved
      ? { phase: 'acting', detail: current?.detail }
      : { phase: 'working', detail: 'Permission declined' }
    case 'plan':
    case 'plan_step': return { phase: 'planning', detail: 'Updating plan' }
    case 'subagent_started': return { phase: 'delegating', detail: event.label }
    case 'subagent_progress': return { phase: 'delegating', detail: 'Subagent working' }
    case 'subagent_completed': return { phase: 'working', detail: 'Processing subagent result' }
    case 'error': return event.fatal ? { phase: 'failed' } : current
    case 'run_cancelled': return { phase: 'cancelled' }
    case 'run_completed': return { phase: event.status }
    default: return current
  }
}
