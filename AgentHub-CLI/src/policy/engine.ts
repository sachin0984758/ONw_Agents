import path from 'node:path'
import type { AgentConfig, PermissionMode } from '../config/types.ts'

export type PolicyDecision = 'allow' | 'ask' | 'deny'
export type Risk = 'low' | 'medium' | 'high'

export type PolicyAction =
  | { kind: 'fs.read'; path: string; display: string }
  | { kind: 'fs.list'; path: string; display: string }
  | { kind: 'fs.write'; path: string; display: string; existed: boolean }
  | { kind: 'shell.run'; command: string; cwd: string }
  | { kind: 'git.read'; command: string }
  | { kind: 'git.write'; command: string }
  | { kind: 'skill.load'; name: string; path: string }
  | { kind: 'memory.write'; scope: 'user' | 'project' }
  | { kind: 'mcp.call'; server: string; tool: string; readOnly: boolean }
  | { kind: 'network'; url: string }

export interface PolicyResult {
  decision: PolicyDecision
  rule: string
  reason: string
  /** A hard deny cannot be overridden by approval, auto-approve or bypass mode. */
  hard: boolean
  risk: Risk
}

export interface ApprovalRequest {
  id: string
  tool: string
  summary: string
  detail: string
  risk: Risk
  action: PolicyAction
}

export interface ApprovalOutcome {
  approved: boolean
  remember: boolean
}

export interface ApprovalBroker {
  request(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalOutcome>
}

const SECRET_BASENAMES = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  '.npmrc',
  '.netrc',
  '.pgpass',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
])

export function isSecretPath(abs: string): boolean {
  const base = path.basename(abs).toLowerCase()
  if (SECRET_BASENAMES.has(base)) return true
  if (base.startsWith('.env')) {
    return !/\.(example|sample|template|dist)$/.test(base)
  }
  if (/\.(pem|key|pfx|p12|keystore)$/.test(base)) return true
  return false
}

function lower(s: string): string {
  return s.toLowerCase()
}

function globMatch(pattern: string, value: string): boolean {
  const p = lower(pattern)
  const v = lower(value)
  if (!p.includes('*')) return v.includes(p)
  const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return re.test(v)
}

const SAFE_READ_COMMANDS: RegExp[] = [
  /^git\s+(status|diff|log|show|branch\s+--show-current|rev-parse|ls-files|remote\s+-v)(\s|$)/i,
  /^(node|npm|npx|pnpm|yarn|python|python3|go|rustc|cargo|tsc|git)\s+(--version|-v|version)$/i,
  /^pwd$/i,
  /^echo\s+[^|&;<>]*$/i,
]

const HARD_DENY: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+(?:\/|~|\*|[a-z]:[\\/])(?:\s|$)/i, reason: 'recursive deletion of a root or home path' },
  { re: /\b(rmdir|rd)\s+\/s\s+\/q\s+[a-z]:\\?\s*$/i, reason: 'recursive deletion of a drive root' },
  { re: /\bformat(?:\.com)?\s+[a-z]:/i, reason: 'disk formatting' },
  { re: /\bmkfs(?:\.[a-z0-9]+)?\b/i, reason: 'filesystem creation' },
  { re: /\bdiskpart\b/i, reason: 'disk partitioning' },
  { re: /\bshutdown\b|\brestart-computer\b|\bstop-computer\b/i, reason: 'machine shutdown' },
  { re: /\breg\s+delete\b/i, reason: 'registry deletion' },
  { re: /\bbcdedit\b|\bcipher\s+\/w\b/i, reason: 'system-level modification' },
  { re: /\bremove-item\b[^\n]*(-recurse[^\n]*-force|-force[^\n]*-recurse)[^\n]*(?:[a-z]:\\?|~|\/)(?:\s|$)/i, reason: 'recursive deletion of a root or home path' },
  { re: /\bgit\s+push\b/i, reason: 'pushing is never performed by this agent' },
  // Git accepts global options (notably -C/-c/--git-dir/--work-tree) before
  // the subcommand. Keep push hard-denied when those options are present.
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'discarding working-tree changes' },
  { re: /\bgit\s+clean\s+-[a-z]*[fdx]/i, reason: 'deleting untracked files' },
  { re: /\bgit\s+checkout\s+--\s+\./i, reason: 'discarding working-tree changes' },
  { re: /\bgit\s+restore\s+\.\s*$/i, reason: 'discarding working-tree changes' },
  { re: /\b(curl|wget)\b[^\n|]*\|\s*(?:ba|z|k)?sh\b/i, reason: 'piping a download into a shell' },
  { re: /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/i, reason: 'publishing a package' },
  { re: /:\(\)\s*\{[^}]*\|[^}]*&[^}]*\}/, reason: 'fork bomb' },
  { re: /\b(?:cat|type|more|less|get-content)\b[^\n]*(?:^|[\\/])\.env(?:\.[a-z0-9]+)?(?:\s|$)/i, reason: 'reading a secrets file through the shell' },
]

const RISKY: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(npm|pnpm|yarn)\s+(install|i|add|update|upgrade)\b/i, reason: 'installs or updates packages (network + arbitrary install scripts)' },
  { re: /\b(pip|pip3|poetry|uv)\s+(install|add|sync)\b/i, reason: 'installs Python packages' },
  { re: /\b(cargo|go|gem|composer)\s+(install|add|get)\b/i, reason: 'installs packages' },
  { re: /\b(winget|choco|scoop|apt|apt-get|brew)\s+(install|upgrade|add)\b/i, reason: 'installs system packages' },
  { re: /\bgit\s+(commit|merge|rebase|stash|tag|cherry-pick|revert|checkout|switch|branch\s+-[dD])\b/i, reason: 'modifies repository history or the working tree' },
  { re: /\bgit\s+add\b/i, reason: 'stages files' },
  { re: /\b(rm|del|erase|rmdir|rd|remove-item|move|mv|robocopy|xcopy)\b/i, reason: 'deletes or moves files' },
  { re: /\b(docker|podman|kubectl|helm|terraform|aws|gcloud|az)\b/i, reason: 'external infrastructure side effects' },
  { re: /\b(taskkill|stop-process|kill)\b/i, reason: 'terminates processes' },
  { re: /\b(set-executionpolicy|chmod|chown|icacls|takeown|attrib)\b/i, reason: 'changes permissions or security settings' },
  { re: /\b(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)\b/i, reason: 'network access' },
  { re: /\b(node|python|python3|ruby|perl|powershell|pwsh|cmd)\s+(-e|-c|\/c)\b/i, reason: 'executes inline code that can bypass path policy' },
  { re: /(?:^|[^>])>{1,2}\s*[^&|]/, reason: 'shell redirection writes files outside the tool policy' },
  { re: /\|\s*(?:ba|z|k)?sh\b/i, reason: 'pipes into a shell' },
  { re: /\bnpx\b/i, reason: 'may download and execute a package' },
]

export function classifyCommand(command: string): { hardDeny?: string; risky?: string; safeRead: boolean } {
  // Normalize common Git global options so the policy checks the Git
  // subcommand itself (`git -C repo push`, `git -c key=value add`, etc.).
  const trimmed = command
    .replace(
      /\b(git(?:\.exe)?)\s+(?:(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--(?:git-dir|work-tree)(?:=\S+|\s+"[^"]*"|\s+'[^']*'|\s+\S+)|--(?:no-pager|no-optional-locks|literal-pathspecs))\s+)*/gi,
      '$1 ',
    )
    .trim()
  for (const rule of HARD_DENY) {
    if (rule.re.test(trimmed)) return { hardDeny: rule.reason, safeRead: false }
  }
  for (const rule of RISKY) {
    if (rule.re.test(trimmed)) return { risky: rule.reason, safeRead: false }
  }
  const safeRead = SAFE_READ_COMMANDS.some((re) => re.test(trimmed))
  return { safeRead }
}

export function describeAction(action: PolicyAction): { summary: string; detail: string } {
  switch (action.kind) {
    case 'fs.read':
      return { summary: `Read ${action.display}`, detail: action.path }
    case 'fs.list':
      return { summary: `List ${action.display}`, detail: action.path }
    case 'fs.write':
      return {
        summary: `${action.existed ? 'Modify' : 'Create'} ${action.display}`,
        detail: action.path,
      }
    case 'shell.run':
      return { summary: `Run command`, detail: `${action.command}\n(cwd: ${action.cwd})` }
    case 'git.read':
      return { summary: `Git ${action.command}`, detail: action.command }
    case 'git.write':
      return { summary: `Git ${action.command}`, detail: action.command }
    case 'skill.load':
      return { summary: `Load skill ${action.name}`, detail: action.path }
    case 'memory.write':
      return { summary: `Write ${action.scope} memory`, detail: action.scope }
    case 'mcp.call':
      return {
        summary: `Call MCP tool ${action.server}/${action.tool}`,
        detail: `Server: ${action.server}\nTool: ${action.tool}\nRead-only hint: ${action.readOnly ? 'yes' : 'no or unknown'}\nMCP tools run outside the workspace path policy.`,
      }
    case 'network':
      return { summary: `Network request`, detail: action.url }
  }
}

export class PolicyEngine {
  readonly config: AgentConfig
  private readonly remember = new Set<string>()

  constructor(config: AgentConfig) {
    this.config = config
  }

  rememberApproval(key: string): void {
    this.remember.add(key)
  }

  approvalKey(action: PolicyAction): string {
    return `${action.kind}:${this.targetOf(action)}`
  }

  isRemembered(key: string): boolean {
    return this.remember.has(key)
  }

  evaluate(action: PolicyAction): PolicyResult {
    const target = this.targetOf(action)
    const key = `${action.kind}:${target}`

    for (const rule of this.config.denyRules) {
      if (globMatch(rule, key)) {
        return {
          decision: 'deny',
          rule: `custom-deny:${rule}`,
          reason: 'Blocked by a user deny rule.',
          hard: true,
          risk: 'high',
        }
      }
    }

    let result: PolicyResult
    switch (action.kind) {
      case 'fs.read':
        result = this.evaluateRead(action.path)
        break
      case 'fs.list':
        result = this.evaluateRead(action.path)
        break
      case 'fs.write':
        result = this.evaluateWrite(action.path, action.existed)
        break
      case 'shell.run':
        result = this.evaluateShell(action.command)
        break
      case 'git.read':
        result = { decision: 'allow', rule: 'git-read', reason: 'Read-only repository inspection.', hard: false, risk: 'low' }
        break
      case 'git.write':
        result = this.evaluateGitWrite(action.command)
        break
      case 'skill.load':
        result = { decision: 'allow', rule: 'skill-text', reason: 'Skill instructions are loaded as untrusted text; scripts are never executed.', hard: false, risk: 'low' }
        break
      case 'memory.write':
        result = this.config.permissionMode === 'read-only'
          ? { decision: 'deny', rule: 'read-only', reason: 'Memory writes are disabled in read-only mode.', hard: true, risk: 'low' }
          : { decision: 'ask', rule: 'memory', reason: 'Memory changes are curated and require approval.', hard: false, risk: 'low' }
        break
      case 'mcp.call':
        if (this.config.permissionMode === 'read-only' && !action.readOnly) {
          result = {
            decision: 'deny',
            rule: 'read-only',
            reason: 'MCP tools that are not declared read-only are disabled in read-only mode.',
            hard: true,
            risk: 'medium',
          }
        } else if (this.config.permissionMode === 'bypass') {
          result = { decision: 'allow', rule: 'mcp-bypass', reason: 'Bypass mode.', hard: false, risk: 'high' }
        } else if (this.config.permissionMode === 'read-only' && action.readOnly) {
          result = { decision: 'allow', rule: 'mcp-read-only', reason: 'The server declares this tool read-only.', hard: false, risk: 'low' }
        } else {
          result = {
            decision: 'ask',
            rule: 'mcp-call',
            reason: 'MCP tools execute code outside the workspace with your user permissions.',
            hard: false,
            risk: action.readOnly ? 'low' : 'high',
          }
        }
        break
      case 'network':
        result = { decision: 'ask', rule: 'network', reason: 'Network access requires approval.', hard: false, risk: 'medium' }
        break
    }

    const allow = this.config.allowRules.find((r) => globMatch(r, key))
    if (allow && !result.hard && result.decision !== 'allow') {
      return { ...result, decision: 'allow', rule: `custom-allow:${allow}`, reason: 'Allowed by a user allow rule.' }
    }
    if (result.decision === 'ask' && this.remember.has(key)) {
      return { ...result, decision: 'allow', rule: `${result.rule}:remembered`, reason: 'Previously approved for this run.' }
    }
    return result
  }

  private targetOf(action: PolicyAction): string {
    switch (action.kind) {
      case 'fs.read':
      case 'fs.list':
      case 'fs.write':
        return action.display
      case 'shell.run':
        return action.command
      case 'git.read':
      case 'git.write':
        return action.command
      case 'skill.load':
        return action.name
      case 'memory.write':
        return action.scope
      case 'mcp.call':
        return `${action.server}/${action.tool}`
      case 'network':
        return action.url
    }
  }

  private outsideWorkspace(abs: string): boolean {
    const rel = path.relative(this.config.workspace, abs)
    if (!rel) return false
    return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
  }

  private evaluateRead(abs: string): PolicyResult {
    if (isSecretPath(abs)) {
      return { decision: 'deny', rule: 'secret-file', reason: 'Secrets files are never readable through tools.', hard: true, risk: 'high' }
    }
    if (this.outsideWorkspace(abs) && !this.config.allowOutsideWorkspaceReads) {
      return {
        decision: 'deny',
        rule: 'workspace-boundary',
        reason: 'Reading outside the workspace is disabled (allowOutsideWorkspaceReads).',
        hard: true,
        risk: 'medium',
      }
    }
    return { decision: 'allow', rule: 'read-inside-workspace', reason: 'Read access inside the workspace.', hard: false, risk: 'low' }
  }

  private evaluateWrite(abs: string, existed: boolean): PolicyResult {
    if (this.outsideWorkspace(abs)) {
      return { decision: 'deny', rule: 'workspace-boundary', reason: 'Writes outside the workspace are not allowed.', hard: true, risk: 'high' }
    }
    const rel = path.relative(this.config.workspace, abs).split(path.sep).join('/')
    if (rel === '.git' || rel.startsWith('.git/')) {
      return { decision: 'deny', rule: 'git-internals', reason: 'Writing inside .git is not allowed.', hard: true, risk: 'high' }
    }
    if (isSecretPath(abs)) {
      return { decision: 'deny', rule: 'secret-file', reason: 'Writing secrets files is not allowed.', hard: true, risk: 'high' }
    }
    if (this.config.permissionMode === 'read-only') {
      return { decision: 'deny', rule: 'read-only', reason: 'The workspace is in read-only mode.', hard: true, risk: 'medium' }
    }
    if (this.config.permissionMode === 'ask') {
      return { decision: 'ask', rule: 'write-ask', reason: 'File changes require approval.', hard: false, risk: existed ? 'medium' : 'low' }
    }
    return {
      decision: 'allow',
      rule: 'write-allowed',
      reason: this.config.permissionMode === 'bypass' ? 'Bypass mode.' : 'Writes are allowed in auto mode.',
      hard: false,
      risk: existed ? 'medium' : 'low',
    }
  }

  private evaluateShell(command: string): PolicyResult {
    const classified = classifyCommand(command)
    if (classified.hardDeny) {
      return { decision: 'deny', rule: 'hard-deny', reason: classified.hardDeny, hard: true, risk: 'high' }
    }
    if (this.config.permissionMode === 'read-only') {
      if (classified.safeRead) {
        return { decision: 'allow', rule: 'shell-read-only-safe', reason: 'Read-only inspection command.', hard: false, risk: 'low' }
      }
      return {
        decision: 'deny',
        rule: 'read-only',
        reason: 'Shell execution is disabled in read-only mode (only a small read-only allow-list runs).',
        hard: true,
        risk: 'medium',
      }
    }
    if (this.config.permissionMode === 'ask') {
      return { decision: 'ask', rule: 'shell-ask', reason: 'Shell commands require approval.', hard: false, risk: classified.risky ? 'high' : 'medium' }
    }
    if (this.config.permissionMode === 'auto') {
      if (classified.risky) {
        return { decision: 'ask', rule: 'shell-risky', reason: classified.risky, hard: false, risk: 'high' }
      }
      return { decision: 'allow', rule: 'shell-auto', reason: 'Shell command allowed in auto mode.', hard: false, risk: 'medium' }
    }
    return { decision: 'allow', rule: 'shell-bypass', reason: 'Bypass mode.', hard: false, risk: 'high' }
  }

  private evaluateGitWrite(command: string): PolicyResult {
    if (/^git\s+push\b/i.test(command)) {
      return { decision: 'deny', rule: 'no-push', reason: 'Pushing is never performed by this agent.', hard: true, risk: 'high' }
    }
    if (/^git\s+(commit|merge|rebase|stash|tag|cherry-pick|revert|add)\b/i.test(command)) {
      if (this.config.permissionMode === 'read-only') {
        return { decision: 'deny', rule: 'read-only', reason: 'Repository changes are disabled in read-only mode.', hard: true, risk: 'medium' }
      }
      return { decision: 'ask', rule: 'git-write', reason: 'Repository changes require approval.', hard: false, risk: 'medium' }
    }
    return { decision: 'ask', rule: 'git-write', reason: 'Git command requires approval.', hard: false, risk: 'medium' }
  }
}

export function permissionLabel(mode: PermissionMode): string {
  switch (mode) {
    case 'read-only':
      return 'read-only'
    case 'ask':
      return 'ask'
    case 'auto':
      return 'auto'
    case 'bypass':
      return 'bypass'
  }
}
