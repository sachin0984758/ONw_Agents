#!/usr/bin/env node
// ─── Token usage ledger checks ───────────────────────────────────────────────
// Exercises the pure helpers behind the Overview Token Monitor / Token Usage
// gauges, the client display sync, and the server-side writer guards:
//   node scripts/check-token-usage.mjs
// No test framework — plain Node, exit code 1 on any failure.

import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import ts from 'typescript'

let passed = 0
let failed = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function importTs(relPath) {
  const src = path.join(process.cwd(), relPath)
  const source = await fs.readFile(src, 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const tmp = path.join(os.tmpdir(), `tok-${path.basename(relPath)}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)
  await fs.writeFile(tmp, compiled, 'utf-8')
  return import(pathToFileURL(tmp).href)
}

const mod = await importTs('src/lib/agent-hub/token-usage.ts')
const sync = await importTs('src/lib/agent-hub/usage-sync.ts')

const {
  parseSessionTimestamp,
  localDateKey,
  startOfLocalDay,
  startOfLocalWeek,
  niceScaleCeil,
  emptyLedger,
  appendUsageRecord,
  compactLedger,
  computeUsagePeriods,
  ledgerTotals,
} = mod

// Local-time ISOs: parse back to the same local date the helpers use.
const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime() // Thu 15 Oct 2026, local noon
const iso = (ms) => new Date(ms).toISOString()

console.log('Token usage ledger suite')

// ── The old session-timestamp parser is gone (usage is ledger-based now) ─────
ok('parseSessionTimestamp no longer exported', parseSessionTimestamp === undefined)

// ── localDateKey ─────────────────────────────────────────────────────────────
ok('localDateKey is YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(localDateKey(NOW)))
ok('localDateKey uses the local date', localDateKey(NOW) === '2026-10-15')
ok('localDateKey: just after local midnight', localDateKey(new Date(2026, 9, 15, 0, 0, 1).getTime()) === '2026-10-15')

// ── startOfLocalDay / startOfLocalWeek ───────────────────────────────────────
ok('startOfLocalDay = local midnight', startOfLocalDay(NOW) === new Date(2026, 9, 15, 0, 0, 0, 0).getTime())
ok('startOfLocalWeek = Monday (ISO)', startOfLocalWeek(NOW) === new Date(2026, 9, 12, 0, 0, 0, 0).getTime())
const SUN = new Date(2026, 9, 18, 9, 0, 0).getTime()
ok('startOfLocalWeek: Sunday still maps to Monday', startOfLocalWeek(SUN) === new Date(2026, 9, 12, 0, 0, 0, 0).getTime())
const MON = new Date(2026, 9, 19, 0, 0, 1).getTime()
ok('startOfLocalWeek: next Monday rolls to itself', startOfLocalWeek(MON) === new Date(2026, 9, 19, 0, 0, 0, 0).getTime())

// ── niceScaleCeil ────────────────────────────────────────────────────────────
ok('niceScaleCeil(0) = 1', niceScaleCeil(0) === 1)
ok('niceScaleCeil(-5) = 1', niceScaleCeil(-5) === 1)
ok('niceScaleCeil(83249) = 100000', niceScaleCeil(83249) === 100000)
ok('niceScaleCeil(1000) = 1000', niceScaleCeil(1000) === 1000)
ok('niceScaleCeil(1200) = 2000', niceScaleCeil(1200) === 2000)
ok('niceScaleCeil(3000) = 5000', niceScaleCeil(3000) === 5000)
ok('niceScaleCeil(7000) = 10000', niceScaleCeil(7000) === 10000)
ok('niceScaleCeil(6) = 10', niceScaleCeil(6) === 10)

// ── emptyLedger ──────────────────────────────────────────────────────────────
{
  const e = emptyLedger()
  ok('emptyLedger has records + days arrays', Array.isArray(e.records) && Array.isArray(e.days))
  ok('emptyLedger reads zero', ledgerTotals(e).total === 0 && ledgerTotals(e).requests === 0)
}

// ── appendUsageRecord: one timestamped record per call ───────────────────────
{
  let ledger = appendUsageRecord(undefined, { input: 1000, output: 100, model: 'lmstudio · qwen' }, NOW)
  ok('append creates exactly one record', ledger.records.length === 1 && ledger.days.length === 0)
  ok('record carries its own timestamp', ledger.records[0].at === iso(NOW))
  ok('record stores input/output', ledger.records[0].input === 1000 && ledger.records[0].output === 100)
  ok('record stores the model label', ledger.records[0].model === 'lmstudio · qwen')
  ok('record defaults estimated to false', ledger.records[0].estimated === false)
  ok('append stamps updatedAt', ledger.updatedAt === iso(NOW))

  ledger = appendUsageRecord(ledger, { input: 500, output: 50, estimated: true, model: 'lmstudio · qwen' }, NOW + 60_000)
  ok('a second call appends a second record', ledger.records.length === 2)
  ok('records stay time-sorted', ledger.records[0].at <= ledger.records[1].at)
  ok('records are NOT summed into one bucket', ledger.records[0].input === 1000 && ledger.records[1].input === 500)
  ok('estimated is per-record', ledger.records[1].estimated === true)

  // A call on a different local day is simply another record.
  const next = new Date(2026, 9, 16, 9, 0, 0).getTime()
  ledger = appendUsageRecord(ledger, { input: 10, output: 1 }, next)
  ok('calls on different days stay distinct records', ledger.records.length === 3)

  // Zero-token samples are a no-op (failed/empty responses never fabricate usage).
  const before = ledger
  const after = appendUsageRecord(before, { input: 0, output: 0 }, NOW)
  ok('append: zero sample returns the same ledger (no record)', after === before)

  // Negative / non-finite values are clamped away.
  const clamped = appendUsageRecord(undefined, { input: -5, output: 3 }, NOW)
  ok('append clamps negative input to 0', clamped.records[0].input === 0 && clamped.records[0].output === 3)

  // Model label is trimmed + length-capped.
  const longName = 'x'.repeat(120)
  const capped = appendUsageRecord(undefined, { input: 1, output: 1, model: longName }, NOW)
  ok('model label capped at 80 chars', capped.records[0].model.length === 80)
}

// ── compaction: old records fold into per-day aggregates, totals preserved ───
{
  const OLD = new Date(2026, 9, 2, 10, 0, 0).getTime() // Fri 2 Oct — previous week
  let ledger = appendUsageRecord(undefined, { input: 100, output: 10, model: 'a' }, OLD)
  ok('old call starts as a record', ledger.records.length === 1 && ledger.days.length === 0)

  // A later call in the current week compacts the previous week away.
  ledger = appendUsageRecord(ledger, { input: 200, output: 20, model: 'b' }, NOW)
  ok('old record compacted into a day aggregate', ledger.records.length === 1 && ledger.days.length === 1)
  ok('day aggregate keeps the old local date', ledger.days[0].date === '2026-10-02')
  ok('day aggregate preserves the old totals', ledger.days[0].input === 100 && ledger.days[0].output === 10 && ledger.days[0].requests === 1)
  ok('current-week call stays a record', ledger.records[0].input === 200)

  const totals = ledgerTotals(ledger)
  ok('compaction preserves all-time totals', totals.input === 300 && totals.output === 30 && totals.total === 330)
  ok('compaction preserves request count', totals.requests === 2)

  // Compaction is idempotent — re-running never double-counts.
  const again = compactLedger(ledger, NOW)
  const t2 = ledgerTotals(again)
  ok('compaction is idempotent (no double count)', t2.input === 300 && t2.requests === 2)

  // now <= 0 leaves the ledger untouched (no fabricated boundaries).
  const untouched = compactLedger(ledger, 0)
  ok('compactLedger(now=0) is a no-op', untouched === ledger)

  // Today/Weekly read the retained per-request window only.
  const buckets = Object.fromEntries(computeUsagePeriods(ledger, NOW).map((b) => [b.key, b]))
  ok('today ignores compacted past days', buckets.today.input === 200 && buckets.today.output === 20)
  ok('weekly ignores compacted past days', buckets.week.input === 200)
  ok('forever includes compacted past days', buckets.forever.input === 300)
}

// ── computeUsagePeriods: buckets each record by its OWN timestamp ────────────
{
  const YESTERDAY = new Date(2026, 9, 14, 8, 0, 0).getTime() // Tue 14 Oct (this week)
  const LAST_WEEK = new Date(2026, 9, 5, 8, 0, 0).getTime() // Mon 5 Oct (last week)

  // One session-wide lifetime aggregate is deliberately NOT the input: each
  // call has its own timestamp, so today/weekly never inherit a later time.
  const ledger = {
    days: [{ date: '2026-09-20', input: 4000, output: 400, requests: 1, estimated: 0 }],
    records: [
      { at: iso(LAST_WEEK), input: 3000, output: 300, model: 'm', estimated: false },
      { at: iso(YESTERDAY), input: 2000, output: 200, model: 'm', estimated: true },
      { at: iso(NOW), input: 1000, output: 100, model: 'm', estimated: false },
    ],
    updatedAt: iso(NOW),
  }

  const buckets = computeUsagePeriods(ledger, NOW)
  const by = Object.fromEntries(buckets.map((b) => [b.key, b]))

  ok('returns exactly 3 buckets', buckets.length === 3)
  ok('bucket order today/week/forever', buckets.map((b) => b.key).join(',') === 'today,week,forever')
  ok('labels present', by.today.label === 'Today' && by.week.label === 'Weekly' && by.forever.label === 'Forever')

  ok('today counts only the record made today', by.today.input === 1000 && by.today.output === 100 && by.today.total === 1100)
  ok('weekly counts every record since Monday', by.week.input === 3000 && by.week.output === 300 && by.week.total === 3300)
  ok('forever sums records + older day aggregates', by.forever.input === 10000 && by.forever.output === 1000 && by.forever.total === 11000)
  ok('period counts requests', by.forever.requests === 4 && by.today.requests === 1)
  ok('period counts estimated, never above requests', by.forever.estimated === 1 && by.week.estimated === 1)

  for (const b of buckets) ok(`total == input + output for ${b.key}`, b.total === b.input + b.output)

  // now = 0 → time-independent snapshot (SSR/first paint), forever unchanged.
  const cold = Object.fromEntries(computeUsagePeriods(ledger, 0).map((b) => [b.key, b]))
  ok('now=0 → today 0', cold.today.total === 0)
  ok('now=0 → weekly 0', cold.week.total === 0)
  ok('now=0 → forever unchanged', cold.forever.total === 11000)

  // Empty / missing history must not throw and must read zero.
  ok('empty ledger → all zero', computeUsagePeriods(emptyLedger(), NOW).every((b) => b.total === 0))
  ok('undefined ledger → all zero', computeUsagePeriods(undefined, NOW).every((b) => b.total === 0))

  // Malformed entries are ignored, not counted and never crash.
  const dirty = computeUsagePeriods(
    {
      days: [null, {}, { date: 'nope', input: 9, output: 9 }],
      records: [null, { at: 'not-a-date', input: 5, output: 7 }, { at: iso(NOW), input: 5, output: 7 }],
    },
    NOW,
  )
  const dirtyBy = Object.fromEntries(dirty.map((b) => [b.key, b]))
  ok('malformed days ignored', dirtyBy.today.total === 12)
  ok('unparseable-timestamp record counts in forever only', dirtyBy.forever.total === 24 && dirtyBy.week.total === 12)
  ok('zero-token record adds no request', computeUsagePeriods({ days: [], records: [{ at: iso(NOW), input: 0, output: 0 }] }, NOW)[0].requests === 0)

  // A malformed day whose estimated count exceeds requests is clamped down.
  const over = computeUsagePeriods({ days: [{ date: '2026-10-15', input: 1, output: 1, requests: 1, estimated: 99 }], records: [] }, NOW)
  ok('estimated clamped to requests', over[0].estimated === 1)
}

// ── ledgerTotals ─────────────────────────────────────────────────────────────
{
  const t = ledgerTotals({
    days: [{ date: '2026-10-14', input: 6, output: 2, requests: 1, estimated: 0 }],
    records: [
      { at: iso(NOW), input: 10, output: 4, model: 'm', estimated: true },
      { at: iso(NOW), input: 0, output: 0 }, // dropped: no tokens
    ],
  })
  ok('ledgerTotals sums records + days', t.input === 16 && t.output === 6)
  ok('ledgerTotals total = input + output', t.total === 22)
  ok('ledgerTotals counts requests + estimated', t.requests === 2 && t.estimated === 1)
  ok('ledgerTotals on undefined reads zero', ledgerTotals(undefined).total === 0)
}

// ── usage sync: server-recorded ledger → immediate UI display ────────────────
{
  const seen = []
  sync.setUsageSyncListener((l) => seen.push(l))
  sync.syncUsage({ records: [{ at: iso(NOW), input: 12, output: 3 }], days: [], updatedAt: iso(NOW) })
  ok('sync forwards a ledger snapshot', seen.length === 1 && seen[0].records.length === 1)

  sync.syncUsage(null)
  sync.syncUsage(undefined)
  ok('sync ignores empty ledgers', seen.length === 1)

  sync.setUsageSyncListener(null)
  let threw = false
  try {
    sync.syncUsage({ records: [], days: [], updatedAt: '' })
  } catch {
    threw = true
  }
  ok('sync is a safe no-op with no listener', threw === false && seen.length === 1)
}

// ── Source guards: the widgets read the per-request ledger, not session stats ─
{
  const read = (p) => fs.readFile(path.join(process.cwd(), p), 'utf-8')
  const meter = await read('src/components/agent-hub/token-meter.tsx')
  const period = await read('src/components/agent-hub/period-token-monitor.tsx')
  const overview = await read('src/components/agent-hub/overview.tsx')

  ok('Token Monitor reads state.tokenUsage', /state\.tokenUsage/.test(meter))
  ok('Token Monitor no longer sums session stats', !/stats\?\.(input|output)Tokens|stats\.(input|output)Tokens/.test(meter))
  ok('Token Usage reads state.tokenUsage', /tokenUsage/.test(period))
  ok('Token Usage no longer buckets session stats', !/state\.sessions|computePeriodUsage\(/.test(period))
  ok('Token Usage passes the whole ledger (records + days)', /computeUsagePeriods\(ledger, now\)/.test(period))
  ok('Overview metric reads the ledger', /state\.tokenUsage/.test(overview))
  ok('Overview no longer sums session outputTokens', !/s\.stats\?\.outputTokens/.test(overview))

  // The Overview "Sessions" metric must not present a demo stat as real.
  ok('Overview excludes demo sessions and seeded running-agent metrics', !/state\.sessions|counts\.running/.test(overview))

  // ── Server is the SOLE writer of the ledger ───────────────────────────────
  const agentRoute = await read('src/app/api/agent/route.ts')
  const chatRoute = await read('src/app/api/chat/route.ts')
  const explainRoute = await read('src/app/api/explain/route.ts')
  const playgroundRoute = await read('src/app/api/playground/route.ts')
  const stateFile = await read('src/lib/agent-hub/state-file.ts')
  const store = await read('src/lib/agent-hub/store.ts')

  ok('state-file exposes recordServerUsage', /export async function recordServerUsage/.test(stateFile))
  ok('state-file shares one state-file queue', /globalThis/.test(stateFile))
  const llm = await read('src/lib/agent-hub/llm.ts')
  ok('shared model client records every generation server-side', /await recordServerUsage\(/.test(llm))
  ok('chat route returns usage without double recording', /readState\(\)/.test(chatRoute) && !/recordServerUsage\(/.test(chatRoute))
  ok('explain and Playground return usage without double recording', [explainRoute, playgroundRoute].every((source) => /readState\(\)/.test(source) && !/recordServerUsage\(/.test(source)))
  ok('chat route returns the updated ledger', /tokenUsage,/.test(chatRoute))
  ok('agent POST preserves the server ledger', /tokenUsage = current\.tokenUsage/.test(agentRoute))
  ok('client store no longer appends usage', !/appendUsageRecord/.test(store))
  ok('client store applies the server ledger', /applyTokenUsage/.test(store))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('Failures:', failures.join('; '))
  process.exit(1)
}
