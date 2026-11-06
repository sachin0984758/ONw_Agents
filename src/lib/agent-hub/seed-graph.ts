import type { CodeGraph } from './types'

// The graph starts empty until repository analysis supplies real project data.
export const seedGraph: CodeGraph = {
  repo: 'AgentHub',
  branch: 'main',
  nodeCount: 0,
  edgeCount: 0,
  semanticReady: false,
  renderMs: 0,
  nodes: [],
  edges: [],
}
