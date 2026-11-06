import { getAgentSessionState, type AgentSessionState } from '@/lib/agent-hub/agent-session'

export function initialAgentState(): AgentSessionState {
  try {
    return getAgentSessionState()
  } catch {
    return {
      task: null,
      isRunning: false,
      cancelRequested: false,
      pendingApproval: null,
      mode: 'edit',
      effort: null,
      memoryNote: '',
      smolPlan: [],
      contextEvicted: 0,
      agentModels: {},
      selectionMode: 'auto',
      agentEnabled: {},
      runTeam: [],
      agents: [],
      workspace: '.',
      workspaceInfo: null,
      lastModel: null,
      codingSessions: [],
      activeCodingSessionId: null,
      learningProgress: { version: 1, topics: {}, history: [] },
      skillStats: null,
      skillInstallHint: null,
    }
  }
}
