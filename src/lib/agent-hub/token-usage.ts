// ─── Token usage ledger (Overview "Token Monitor" + "Token Usage") ───────────
// Pure helpers behind the Overview token widgets and the client usage recorder.
//
// The ledger stores one RECORD per real model call, each with its own ISO
// completion timestamp. Today/Weekly/Forever are computed by comparing each
// record's OWN timestamp against the local day/week boundaries — nothing is
// derived from a session's `stats` (a single lifetime aggregate with one
// timestamp), so a session's whole history is never bucketed under its last
// call time and the daily/weekly totals stay correct.
//
// Values are the provider-reported `usage` when the provider sends it,
// otherwise a locally estimated value (chars / 4) flagged as `estimated`.
// Nothing here fabricates values: an empty ledger reads zero, and every helper
// tolerates missing or malformed entries.
//
// Growth is bounded by folding records older than the current local week into
// per-day aggregates (`days`). That keeps the persisted ledger tiny without
// losing history: Forever is exact, and Today/Weekly only ever read records
// from the current week or later.

import type { TokenUsageLedger, UsageDay, UsageRecord } from './types'

export type TokenPeriod = 'today' | 'week' | 'forever'

export interface PeriodUsage {
  key: TokenPeriod
  /** Display label, e.g. "Today". */
  label: string
  /** Supporting label, e.g. "tokens used". */
  sub: string
  input: number
  output: number
  total: number
  /** Model calls folded into this period (0 when nothing recorded). */
  requests: number
  /** Of `requests`, how many used locally estimated values (no provider usage). */
  estimated: number
}

/** One successful model call, reported by a client call site. */
export interface UsageSample {
  input: number
  output: number
  /** true when the provider omitted `usage` and the values are estimated. */
  estimated?: boolean
  /** Model/provider label that served the reply (for auditability). */
  model?: string
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
/** Model labels are only for audit; cap the stored length. */
const MAX_MODEL_LEN = 80

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/** A well-shaped empty ledger. */
export function emptyLedger(): TokenUsageLedger {
  return { records: [], days: [], updatedAt: '' }
}

/** Coerce possibly-missing/invalid input into a shaped ledger (identity when already valid). */
function asLedger(ledger: TokenUsageLedger | undefined | null): TokenUsageLedger {
  if (ledger && Array.isArray(ledger.records) && Array.isArray(ledger.days)) return ledger
  return emptyLedger()
}

/** Local calendar date for an epoch-ms timestamp, as 'YYYY-MM-DD'. */
export function localDateKey(now: number): string {
  const d = new Date(now)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Start of the current local calendar day, as epoch-ms. */
export function startOfLocalDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Start of the current local calendar week, as epoch-ms.
 * The app has no locale/week-start setting (it formats with 'en-US'), so this
 * documents Monday as the default week start (ISO 8601).
 */
export function startOfLocalWeek(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday = 0 … Sunday = 6
  return d.getTime()
}

/**
 * Round a value up to a "nice" 1/2/5 × 10^n ceiling so gauge fills on a shared
 * axis stay readable when no real limit is configured.
 */
export function niceScaleCeil(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(n))
  const d = n / p
  const step = d <= 1 ? 1 : d <= 2 ? 2 : d <= 5 ? 5 : 10
  return step * p
}

/** Local date key ('YYYY-MM-DD') for a record's own timestamp, or '' when unparseable. */
function recordDateKey(record: UsageRecord): string {
  if (!record || typeof record.at !== 'string') return ''
  const ms = Date.parse(record.at)
  return Number.isFinite(ms) ? localDateKey(ms) : ''
}

/**
 * Fold records older than the current local week into per-day aggregates,
 * returning a NEW ledger. Totals are preserved exactly; only sub-day detail
 * for already-past weeks is dropped. Never called with a fabricated `now`
 * (now <= 0 leaves the ledger untouched).
 */
export function compactLedger(ledger: TokenUsageLedger, now: number): TokenUsageLedger {
  const base = asLedger(ledger)
  if (!Number.isFinite(now) || now <= 0) return base

  const weekStartKey = localDateKey(startOfLocalWeek(now))
  const days: UsageDay[] = base.days.map((d) => ({ ...d }))
  const byDate = new Map(days.map((d) => [d.date, d]))
  const records: UsageRecord[] = []

  for (const r of base.records) {
    const key = recordDateKey(r)
    const input = num(r.input)
    const output = num(r.output)
    const requests = input === 0 && output === 0 ? 0 : 1
    if (key && key < weekStartKey) {
      let day = byDate.get(key)
      if (!day) {
        day = { date: key, input: 0, output: 0, requests: 0, estimated: 0 }
        byDate.set(key, day)
        days.push(day)
      }
      day.input += input
      day.output += output
      day.requests += requests
      if (r.estimated === true && requests === 1) day.estimated += 1
    } else {
      records.push(r)
    }
  }

  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { records, days, updatedAt: base.updatedAt }
}

/**
 * Append one successful model call to the ledger, returning a NEW ledger
 * (pure — safe to test without a store). The record carries its own completion
 * timestamp (`now`). A call with no tokens is a no-op that returns the input
 * ledger unchanged, so failed/empty responses never create a record.
 */
export function appendUsageRecord(
  ledger: TokenUsageLedger | undefined | null,
  sample: UsageSample,
  now: number,
): TokenUsageLedger {
  const base = asLedger(ledger)
  const input = num(sample.input)
  const output = num(sample.output)
  if (input === 0 && output === 0) return base

  const at = new Date(Number.isFinite(now) ? now : Date.now()).toISOString()
  const record: UsageRecord = {
    at,
    input,
    output,
    model: (sample.model ?? '').trim().slice(0, MAX_MODEL_LEN),
    estimated: sample.estimated === true,
  }
  return compactLedger(
    { records: [...base.records, record], days: base.days, updatedAt: at },
    now,
  )
}

/**
 * Sum the ledger into Today / Weekly / Forever.
 *
 * Every record is bucketed by its OWN local timestamp. Input and output are
 * accumulated independently, so `total` is always exactly `input + output`.
 * Week boundaries are LOCAL and weekly starts Monday.
 *
 * `now` is a client timestamp. Pass 0 to get a time-independent snapshot
 * (Today/Weekly = 0) so the server render and the first client render match.
 */
export function computeUsagePeriods(ledger: TokenUsageLedger | undefined | null, now: number): PeriodUsage[] {
  const base = asLedger(ledger)
  const dated = Number.isFinite(now) && now > 0
  const todayKey = dated ? localDateKey(now) : ''
  const weekStartKey = dated ? localDateKey(startOfLocalWeek(now)) : ''

  let ti = 0, to = 0, tr = 0, te = 0
  let wi = 0, wo = 0, wr = 0, we = 0
  let fi = 0, fo = 0, fr = 0, fe = 0

  const accumulate = (input: number, output: number, requests: number, estimated: number, key: string) => {
    fi += input; fo += output; fr += requests; fe += estimated
    if (!dated || !key) return
    if (key >= weekStartKey) { wi += input; wo += output; wr += requests; we += estimated }
    if (key === todayKey) { ti += input; to += output; tr += requests; te += estimated }
  }

  // Older (compacted) per-day aggregates.
  for (const d of base.days) {
    if (!d || typeof d.date !== 'string' || !DAY_KEY_RE.test(d.date)) continue
    const requests = num(d.requests)
    accumulate(num(d.input), num(d.output), requests, Math.min(num(d.estimated), requests), d.date)
  }

  // Per-request records (the retained recent window).
  for (const r of base.records) {
    if (!r) continue
    const input = num(r.input)
    const output = num(r.output)
    const requests = input === 0 && output === 0 ? 0 : 1
    const estimated = requests === 1 && r.estimated === true ? 1 : 0
    accumulate(input, output, requests, estimated, recordDateKey(r))
  }

  const mk = (key: TokenPeriod, label: string, sub: string, input: number, output: number, requests: number, estimated: number): PeriodUsage => ({
    key,
    label,
    sub,
    input,
    output,
    total: input + output,
    requests,
    estimated,
  })

  return [
    mk('today', 'Today', 'tokens used', ti, to, tr, te),
    mk('week', 'Weekly', 'this week', wi, wo, wr, we),
    mk('forever', 'Forever', 'all-time total', fi, fo, fr, fe),
  ]
}

/** All-time input/output totals across the ledger (used by the Overview metric). */
export function ledgerTotals(ledger: TokenUsageLedger | undefined | null): { input: number; output: number; total: number; requests: number; estimated: number } {
  const base = asLedger(ledger)
  let input = 0, output = 0, requests = 0, estimated = 0

  for (const d of base.days) {
    if (!d || typeof d.date !== 'string') continue
    input += num(d.input)
    output += num(d.output)
    const req = num(d.requests)
    requests += req
    estimated += Math.min(num(d.estimated), req)
  }

  for (const r of base.records) {
    if (!r) continue
    const i = num(r.input)
    const o = num(r.output)
    if (i === 0 && o === 0) continue
    input += i
    output += o
    requests += 1
    if (r.estimated === true) estimated += 1
  }

  return { input, output, total: input + output, requests, estimated }
}
