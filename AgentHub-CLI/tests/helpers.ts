import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentConfig, ProviderConfig } from '../src/config/types.ts'
import type { ChatRequest, ChatResponse, ModelInfo, Provider } from '../src/providers/types.ts'
import type { ResolvedTarget } from '../src/providers/registry.ts'
import type { RepoContext } from '../src/context/repo.ts'
import type { SkillIndex } from '../src/skills/discover.ts'
import type { ApprovalBroker, ApprovalOutcome, ApprovalRequest } from '../src/policy/engine.ts'

export async function tempDir(prefix = 'agenthub-test-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 })
}

export function testConfig(workspace: string, home: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    home,
    workspace,
    provider: 'mock',
    model: 'mock-model',
    providers: [],
    mcpServers: [],
    permissionMode: 'auto',
    autoApprove: false,
    maxSteps: 4,
    maxWallClockMs: 30_000,
    commandTimeoutMs: 5_000,
    maxOutputBytes: 200_000,
    contextTokens: 20_000,
    skillsDirs: [path.join(home, 'skills'), path.join(workspace, '.agenthub', 'skills')],
    appUrl: 'http://127.0.0.1:9',
    sessionsDir: path.join(home, 'sessions'),
    backupsDir: path.join(home, 'backups'),
    memory: false,
    theme: 'auto',
    color: false,
    ascii: true,
    backups: true,
    shell: 'cmd',
    allowOutsideWorkspaceReads: false,
    allowCloud: false,
    denyRules: [],
    allowRules: [],
    quiet: true,
    verbose: false,
    userConfigPath: path.join(home, 'config.json'),
    workspaceConfigPath: path.join(workspace, '.agenthub', 'config.json'),
    configWarnings: [],
    ...overrides,
  }
}

export function repoContext(workspace: string): RepoContext {
  return {
    root: workspace,
    isGit: false,
    branch: null,
    packageManager: null,
    scripts: {},
    languages: [],
    tree: '',
    treeCount: 0,
    instructions: [],
    memory: [],
    notes: [],
  }
}

export function emptySkills(): SkillIndex {
  return { entries: [], invalid: [], dirs: [], warnings: [], scannedAt: new Date().toISOString() }
}

export class MockProvider implements Provider {
  readonly config: ProviderConfig
  readonly label = 'mock'
  readonly calls: ChatRequest[] = []
  private readonly handler: (request: ChatRequest, index: number) => Promise<ChatResponse> | ChatResponse

  constructor(handler: (request: ChatRequest, index: number) => Promise<ChatResponse> | ChatResponse) {
    this.handler = handler
    this.config = {
      id: 'mock',
      label: 'Mock',
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9/v1',
      local: true,
    }
  }

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([])
  }

  chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls.push(request)
    return Promise.resolve(this.handler(request, this.calls.length - 1))
  }
}

export function mockTarget(provider: MockProvider, model = 'mock-model'): ResolvedTarget {
  return {
    provider,
    providerConfig: provider.config,
    model,
    models: [],
  }
}

export function textResponse(content: string, usage = { input: 10, output: 4 }): ChatResponse {
  return {
    content,
    toolCalls: [],
    usage,
    model: 'mock-model',
    finishReason: 'stop',
  }
}

export function toolResponse(name: string, args: Record<string, unknown>, usage = { input: 10, output: 4 }): ChatResponse {
  return {
    content: '',
    toolCalls: [
      {
        id: 'call_test_1',
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
    usage,
    model: 'mock-model',
    finishReason: 'tool_calls',
  }
}

export class DenyingBroker implements ApprovalBroker {
  readonly requests: ApprovalRequest[] = []

  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    this.requests.push(req)
    return { approved: false, remember: false }
  }
}

export class ApprovingBroker implements ApprovalBroker {
  readonly requests: ApprovalRequest[] = []

  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    this.requests.push(req)
    return { approved: true, remember: false }
  }
}
