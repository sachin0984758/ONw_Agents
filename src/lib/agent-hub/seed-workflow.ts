import type { Workflow } from './types'

// Workflows are user-configured; do not seed third-party service examples as
// if AgentHub already had those connections configured.
export const seedWorkflow: Workflow = {
  name: 'No workflow configured',
  nodes: [],
  edges: [],
  agent: {
    name: 'AgentHub',
    active: false,
    instructions: '',
    successRate: 0,
    responseTimeSec: 0,
    processed: 0,
    accuracy: 0,
    files: [],
  },
}
