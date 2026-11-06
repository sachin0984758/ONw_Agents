import type { ApprovalBroker, ApprovalOutcome, ApprovalRequest } from '../policy/engine.ts'

export class HeadlessApprovalBroker implements ApprovalBroker {
  private readonly autoApprove: boolean
  private readonly onNotice: (message: string) => void
  private readonly seen = new Set<string>()

  constructor(autoApprove: boolean, onNotice: (message: string) => void) {
    this.autoApprove = autoApprove
    this.onNotice = onNotice
  }

  async request(req: ApprovalRequest): Promise<ApprovalOutcome> {
    if (this.autoApprove) {
      return { approved: true, remember: false }
    }
    const key = `${req.tool}:${req.summary}`
    if (!this.seen.has(key)) {
      this.seen.add(key)
      this.onNotice(
        [
          `Approval required for ${req.tool}: ${req.summary}`,
          req.detail,
          'This non-interactive run denied the action. Re-run interactively, or pass --yes to auto-approve (hard security denials still apply).',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
    return { approved: false, remember: false }
  }
}

export type ApprovalPrompt = (req: ApprovalRequest, signal: AbortSignal) => Promise<ApprovalOutcome>

export class InteractiveApprovalBroker implements ApprovalBroker {
  private readonly prompt: ApprovalPrompt

  constructor(prompt: ApprovalPrompt) {
    this.prompt = prompt
  }

  request(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalOutcome> {
    return this.prompt(req, signal)
  }
}

export class StaticApprovalBroker implements ApprovalBroker {
  private readonly outcome: ApprovalOutcome

  constructor(outcome: ApprovalOutcome) {
    this.outcome = outcome
  }

  async request(): Promise<ApprovalOutcome> {
    return this.outcome
  }
}
