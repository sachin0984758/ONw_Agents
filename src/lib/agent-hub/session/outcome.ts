// Independent outcome helpers; no session state or initialization side effects.

export type RunOutcomeStatus = 'completed' | 'partial' | 'failed'

export interface RunOutcome {
  status: RunOutcomeStatus
  /** Evidence-based summary ('' when the run is fully clean). */
  summary: string
  /** True only when the run is `completed`. */
  verified: boolean
}

export function deriveRunOutcome(input: {
  completed: number
  failed: number
  skipped: number
  verification?: { passed: boolean; preExisting: boolean; baselineUnknown: boolean } | null
}): RunOutcome {
  const { completed, failed, skipped, verification } = input
  const total = completed + failed + skipped
  // Verification blocks success only when it failed for a NEW reason.
  const verificationBlocking = verification ? !verification.passed && !verification.preExisting : false

  if (completed === 0) {
    return {
      status: 'failed',
      summary: `No step succeeded (${failed} failed, ${skipped} skipped).`,
      verified: false,
    }
  }
  if (failed === 0 && skipped === 0 && !verificationBlocking) {
    return { status: 'completed', summary: '', verified: true }
  }
  const bits: string[] = []
  if (failed > 0) bits.push(`${failed} step${failed === 1 ? '' : 's'} failed`)
  if (verificationBlocking) bits.push('verification failed')
  if (verification && !verification.passed && verification.preExisting) bits.push('verification failure is pre-existing')
  if (skipped > 0) bits.push(`${skipped} step${skipped === 1 ? '' : 's'} skipped`)
  return {
    status: 'partial',
    summary: `Partially completed (${completed}/${total} steps): ${bits.join(', ')}.`,
    verified: false,
  }
}

