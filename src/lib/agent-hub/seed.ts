import type { HubState } from './types'
import { seedAgents, seedAgentChat } from './seed-agents'
import { seedSessions } from './seed-sessions'
import { seedModels } from './seed-models'
import { seedGraph } from './seed-graph'
import { seedChanges } from './seed-changes'
import { seedWorkflow } from './seed-workflow'

// Neutral example plan steps for an unconfigured first run.
// NOTE: updatedAt must stay deterministic (no new Date() at module scope) —
// the seed is evaluated independently on the server (SSR) and in the browser
// (hydration); a dynamic value here causes a React hydration mismatch.
// Any real state persisted by the agent API carries a newer timestamp, so it
// always wins over this seed via hydrateIfNewer().
export const seedState: HubState = {
  version: 1,
  updatedAt: '2026-10-12T00:00:00.000Z',
  projectName: 'Large Project',
  agents: seedAgents,
  agentChat: seedAgentChat,
  sessions: seedSessions,
  // Real, per-request token usage recorded from actual model calls. Starts
  // empty: the seeded demo sessions above are fixtures and never feed this
  // ledger, and Today/Weekly are computed from each record's own timestamp.
  tokenUsage: { records: [], days: [], updatedAt: '' },
  models: seedModels,
  customModels: [],
  graph: seedGraph,
  plan: {
    file: 'plan.md',
    autoRun: true,
    pendingChanges: 2,
    commits: 14,
    steps: [
      {
        id: 's1',
        name: 'Requirements',
        status: 'completed',
        detail: 'Gather functional and non-functional requirements from stakeholders.',
      },
      {
        id: 's2',
        name: 'Tech Specification',
        status: 'in-progress',
        detail: 'Define architecture, data models, APIs and tooling choices.',
      },
      {
        id: 's3',
        name: 'Planning',
        status: 'not-started',
        detail: 'Break the specification into agent-assigned work packages.',
      },
      {
        id: 's4',
        name: 'Implementation',
        status: 'not-started',
        detail: 'Execute the plan with the multi-agent workspace.',
      },
    ],
  },
  changes: seedChanges,
  workflow: seedWorkflow,
  settings: {
    codeExecution: true,
    networkEgress: true,
    allowlistMode: 'package-managers',
    additionalDomains: ['internal.company.dev'],
  },
}
