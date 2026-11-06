// Secret redaction for logs, session files and rendered tool output.
// This is defence in depth, not a guarantee: the policy engine is what keeps
// secrets out of the agent's reach in the first place.

const PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_*.-]{6,}/g, 'sk-***REDACTED***'],
  [/\b(ghp_[A-Za-z0-9]{20,})\b/g, 'ghp_***REDACTED***'],
  [/\b(github_pat_[A-Za-z0-9_]{20,})\b/g, 'github_pat_***REDACTED***'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, 'AKIA***REDACTED***'],
  [/\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, 'xox*-***REDACTED***'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, '***PRIVATE KEY REDACTED***'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, '$1***REDACTED***'],
  [/\b(api[_-]?key\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{12,}/gi, '$1***REDACTED***'],
  [/\b(token\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{12,}/gi, '$1***REDACTED***'],
  [/\b(secret\s*[:=]\s*["']?)[A-Za-z0-9._~+/-]{12,}/gi, '$1***REDACTED***'],
  [/\b(password\s*[:=]\s*["']?)[^\s"']{8,}/gi, '$1***REDACTED***'],
]

export function redactSecrets(input: string): string {
  let out = input
  for (const [re, replacement] of PATTERNS) {
    out = out.replace(re, replacement)
  }
  return out
}

/** Redact recognizable credentials before terminal input history is persisted. */
export function redactHistory(history: readonly string[]): string[] {
  return history.map(redactSecrets)
}

export function looksLikeSecret(input: string): boolean {
  return PATTERNS.some(([re]) => {
    re.lastIndex = 0
    const hit = re.test(input)
    re.lastIndex = 0
    return hit
  })
}

/**
 * Recursively redact string values while preserving object/array shape. This is
 * used for persisted transcripts where tool-call arguments must stay valid
 * JSON. Redaction is deliberately value-only: changing keys could invalidate
 * schemas or corrupt recovery.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactSecrets(value) as T
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(item)
    }
    return out as T
  }
  return value
}
