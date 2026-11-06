> Historical evidence. This file describes an earlier implementation; use [current architecture](../architecture.md), [development](../development.md) and [testing](../testing.md) for the current project.

# AgentHub — Token Monitor / Token Usage audit

Branch: `qa/full-app-audit` · Scope: the Overview **Token Monitor** card, the
**Token Usage** gauges (Today / Weekly / Forever), the Overview **Output Tokens**
metric and the **System Console** token figure · Method: static trace **plus**
live end-to-end verification against a real local model.

This document records what was inspected, the real defect that was found, why the
numbers were wrong, the smallest coherent fix, the tests that were run, the live
verification, and what could **not** be verified.

---

## 1. Scope and method

The requirement was to determine whether the Overview token widgets accurately
track *real* token usage across Chat, Sessions (the agent runtime) and other
model-powered features, to fix confirmed defects with the smallest change, and to
report honestly.

Two passes were used:

- **Static trace** — read the widgets, the shared aggregation helper, the store,
  the seed data, the `/api/chat`, `/api/explain` and `/api/playground` routes, and
  the provider transport (`lib/agent-hub/llm.ts`).
- **Runtime verification** — sent a controlled request through the *real* pipeline
  (the running dev server against a live LM Studio model on `:1234`) and read both
  the provider response and the persisted dashboard state.

---

## 2. What the widgets claimed vs. what was true

Both widgets, and the Overview "Output Tokens" metric + System Console, summed
`state.sessions[].stats.inputTokens` / `outputTokens`. Tracing every write to those
fields found exactly two writers:

| Writer | Effect |
| --- | --- |
| `src/lib/agent-hub/seed-sessions.ts` | two hard-coded demo sessions (`hola`, `graph-query`) with fixed token values |
| `src/lib/agent-hub/store.ts` → `createSessionForAgent` | always writes `0` |

No real model call anywhere wrote them. Real provider `usage`
(`prompt_tokens` / `completion_tokens`) was **discarded**:

- `llm.ts` `streamLLM` parsed SSE deltas but ignored the `usage` frame.
- `llm.ts` `callLLM` returned only the completion text.
- the route-local `callLLM` in `/api/chat` returned only `{ reply, servedModel }`.

So the displayed figures were **fixtures, not measurements**:

| Display | Source | Meaning |
| --- | --- | --- |
| Forever **83.2k** | `20 480 + 51 200` input and `3 147 + 8 422` output from the two seeds | fabricated |
| Today / Weekly **0** | seeds' `endedAt` is `2026-04-26` — months before "today" | coincidentally "correct" |
| "3 tracked sessions" | `state.sessions.length` | registry entries, not executions |

The `TrackedSessionsPanel` itself documents that `state.sessions` are *ownership
registry entries, not live executors* — their token stats were never a real usage
source. **Root cause: the widgets read a store that no model call ever updated, and
the transport threw the real usage away.**

---

## 3. The fix — one real per-day usage ledger

### 3.1 Storage decision

A session's `stats` is a single lifetime aggregate with one `endedAt`. Accumulating
real usage there would bucket a session's *entire* history under its **last** call
time and corrupt Today/Weekly. Correct day/week boundaries need per-day (or
per-call) records.

Decision (confirmed with the product owner): keep **one** token store — a
**per-request ledger inside the existing dashboard state file**
(`db/agent-hub-state.json`), so no second DB is introduced — and record only real
model calls. Each call is stored as its **own** record carrying its **own**
completion timestamp, so Today/Weekly are computed from when each call actually
happened (the "use actual per-request usage records with their own timestamps"
requirement); a session's single lifetime aggregate is never bucketed under its
last-activity time. The seeded demo sessions stay for the Sessions view but **no
longer feed the token widgets** ("exclude from usage; keep as demo sessions").

### 3.2 Shape

```ts
interface UsageRecord {          // one REAL model call, with its own timestamp
  at: string                     // ISO completion time
  input: number                  // prompt tokens (provider-reported, or estimated)
  output: number                 // completion tokens
  model: string                  // model/provider label that served the reply
  estimated: boolean             // true when the provider omitted `usage`
}
interface UsageDay {             // per-day aggregate of records older than the window
  date: string                   // local 'YYYY-MM-DD'
  input: number
  output: number
  requests: number
  estimated: number
}
interface TokenUsageLedger { records: UsageRecord[]; days: UsageDay[]; updatedAt: string }
```

Today/Weekly read **`records`** — each bucketed by its own `at` timestamp — and the
all-time total also folds in the compacted `days`. To bound the file, records older
than the **current local week** are folded losslessly into `days` on the next
write; that can never affect Today or Weekly, which only ever read the current week
or later. Totals and the request count are preserved exactly.

### 3.3 Recording path — the server is the sole writer

Provider `usage` is extracted at the transport and returned to the caller, and the
**server** (not the browser) folds it into the ledger. Every UI model call already
goes through a server route, so recording in the route captures Chat, Sessions,
Playground and Explain **and** direct machine callers (`curl POST /api/chat`) — with
exactly one writer, so double counting is structurally impossible:

- `llm.ts` — `readUsage()` extracts OpenAI-compatible `usage`; `callLLM` gained an
  `onUsage` callback; `streamLLM` requests `stream_options.include_usage` and emits
  a final `{ type: 'usage' }` chunk. `estimateUsage()` (chars ÷ 4) is the labelled
  fallback used only when a provider omits usage.
- `src/lib/agent-hub/state-file.ts` — **new** server module that owns
  `db/agent-hub-state.json`: `readState` / `writeState` plus `recordServerUsage()`,
  which appends one timestamped record via the pure `appendUsageRecord()`. All
  read-merge-write cycles on the file (this module **and** `/api/agent`) share **one
  process-global queue** (`globalThis`), because Next compiles each route as its own
  bundle and a module-level singleton could be duplicated per route.
- `/api/chat`, `/api/explain`, `/api/playground` call `recordServerUsage()` after a
  successful completion (provider `usage`, or a labelled estimate) and return the
  updated ledger (`tokenUsage`) in the response.
- `/api/agent` POST ignores any client-sent `tokenUsage` (`merged.tokenUsage =
  current.tokenUsage`), so a full-state POST can never clobber the server ledger;
  DELETE still resets it.
- `src/lib/agent-hub/usage-sync.ts` — **new** standalone, dependency-free display
  channel: the call sites hand the server-returned ledger to
  `syncUsage()`, and the store applies it for an immediate Overview update. It never
  persists (display only), so it cannot race the server.
- Call sites wired to `syncUsage()`: **Chat** (`chat-view.tsx`), **Sessions / design
  / teaching** (the agent runtime's `callLLM` in `agent-session.ts`), **Playground**
  (`playground-view.tsx`) and **Explain** (`explain/use-explain.ts`).

### 3.4 Widgets read the ledger

- `token-usage.ts` — `localDateKey`, `appendUsageRecord`, `compactLedger`,
  `computeUsagePeriods`, `ledgerTotals` replace the session-based
  `computePeriodUsage` / `parseSessionTimestamp`. `computeUsagePeriods` buckets each
  record by its **own** timestamp; weekly starts **Monday** (ISO) and day
  boundaries are **local**.
- `token-meter.tsx`, `period-token-monitor.tsx`, `overview.tsx` now read
  `state.tokenUsage` only; the widget "N tracked sessions" label becomes "N recorded
  calls", estimated calls are surfaced honestly, and the Overview "Sessions" metric
  sub-label — a demo-session statistic (`toolCalls`) — is now explicitly marked
  "· sample data".
- `system-console.tsx` — the "This launch" line used to print the *same* number for
  both input and output; it now receives `inputTokens` and `outputTokens`
  separately and labels them correctly.

### 3.5 Honesty properties

- Each call is stored with its **own** completion timestamp; Today/Weekly are
  computed from those timestamps, never from a session's last activity.
- The **server is the sole writer** of `tokenUsage`: `/api/agent` POSTs ignore
  client-sent ledgers and the client display channel never persists, so a call is
  recorded exactly once — no double counting — and direct API callers are counted
  too.
- `total` is always exactly `input + output` (accumulated independently).
- A zero-token sample is dropped — failed / empty / aborted calls never fabricate
  usage, and a refused call records nothing.
- Provider-reported vs. locally estimated is tracked **per record** (`estimated`)
  and shown in the Token Monitor.
- Malformed / missing records and days are sanitised in `normalize.ts` and ignored
  by the aggregation — never a crash, never invented numbers.
- The seeded demo token values are preserved in the DB (historical data intact) but
  are excluded from usage.
- Provider **online/offline** status comes from a live server probe of each
  configured endpoint (`/api/agent-session/models`); a provider is never shown
  online merely because its URL is configured (the component's built-in `1234` /
  `11434` list is only the offline fallback *name* list). Provider status is fully
  independent of the ledger, so a provider going offline never zeroes recorded
  history.

---

## 4. Tests

| Suite | Result |
| --- | --- |
| `node scripts/check-token-usage.mjs` (rewritten, 88 checks) | **88 / 0** |
| `node scripts/agent-session-regression.mjs` | **417 / 0** |
| `node scripts/check-ui-interactions.mjs` | **44 / 0** |
| `node scripts/check-playground.mjs` | **186 / 0** (2 skipped) |
| `node scripts/check-sessions-layout.mjs` | **45 / 0** |
| `node scripts/check-chat-normalize.mjs` | **21 / 0** |
| `node scripts/check-chat-isolation.mjs` | **20 / 0** |
| `npx tsc --noEmit` | clean |
| `npx eslint .` | clean |
| `npx next build` | success (Turbopack) |

`check-token-usage.mjs` now covers: local-date keys, Monday week start, per-request
records (each carrying its own timestamp), lossless compaction of past-week records
into per-day aggregates (and that compaction is idempotent), `total == input +
output`, `now = 0` snapshot, empty/malformed records and days, estimated-clamp, the
display-sync no-op paths, and **source guards** asserting the widgets read
`state.tokenUsage` (the whole ledger), no longer sum session stats, that the three
model routes call `recordServerUsage()` and return the ledger, that `/api/agent`
POST preserves the server ledger (`tokenUsage = current.tokenUsage`), and that the
client store no longer appends usage.

`scripts/agent-session-regression.mjs` was updated to compile the renamed
`usage-sync` module into its temp runtime. `scripts/check-chat-isolation.mjs` and
`scripts/check-playground.mjs` — which run the **real** route modules against mock
providers — had their temp-build module lists extended with `state-file` and its
transitive deps (`seed*`, `normalize`, `token-usage`).

---

## 5. Live end-to-end verification

A controlled request was sent **directly to the API** (dev server on `:3000`, live
LM Studio on `:1234`) with no browser involved — the case the previous client-side
recorder could not see:

```
POST /api/chat  { message: "Reply with exactly: ok", stateless: true }   (curl)
  → usage:      { inputTokens: 137, outputTokens: 2, totalTokens: 139 }  estimated: false
  → tokenUsage: { records: [ { at: "2026-10-18T12:42:26.564Z", input: 137, output: 2,
                               model: "LM Studio · qwen2.5-coder-3b-instruct", estimated: false } ],
                  days: [], updatedAt: "2026-10-18T12:42:26.564Z" }
```

The server **recorded the direct API call**, and `GET /api/agent` confirmed the
record persisted in `db/agent-hub-state.json`. A client-style full-state POST that
carried a **stale (empty) ledger** was then sent — the server ignored it and the
record survived:

```
GET /api/agent after curl          → records: 1 (input 137 / output 2)
POST /api/agent { tokenUsage: empty }   ← clobber attempt
GET /api/agent after clobber       → records: 1 (unchanged)
```

The Overview then rendered (values read from the live DOM of a fresh page load):

```
Token Monitor     1 recorded call · INPUT 137 · OUTPUT 2 · TOTAL 139
                  LM Studio: 9 online · Ollama: offline
Token Usage       1 recorded call · Today 139 · Weekly 139 · Forever 139
                  "139 tokens · 137 in / 2 out" (×3)
```

Both widgets agree, Today/Weekly/Forever are consistent, and the figures are
provider-reported (`estimated: false`) and tied to the call's own timestamp. A
provider that omits usage would be recorded with `estimated: true` and labelled in
the UI. The provider line matched reality (nine loaded models on `:1234`; nothing
listening on `:11434`), so status is probe-based, not configuration-based.

The live test wrote to the real `db/` (one stateless call — no Chat history — and its
ledger record). Those artifacts were removed afterwards: the ledger was reset to
empty (`{ records: [], days: [], updatedAt: "" }`) — restoring the pre-audit
database. (Stateless calls never touch `db/chat-history.json`.)

---

## 6. Limitations / what could not be verified

- **Recording is server-side, but UI freshness is client-assisted.** The ledger is
  written only by the server routes, so direct machine callers (`curl POST /api/chat`)
  are counted too. The **numbers** the widgets show update instantly from the ledger
  the route returns; a browser that never receives a route response (e.g. it was
  closed mid-call) still sees the record on its next `/api/agent` poll (≤10 s).
- **No per-call request id is retained.** Each record stores its own timestamp,
  token counts, model label and estimated flag, but no request/session id and no
  sub-millisecond ordering. That is sufficient for Today/Weekly/Forever, but not for
  per-call drill-down.
- **Compaction is time-windowed.** Per-request records are kept for the current
  local week; older ones are folded into per-day aggregates on the next write. Day
  totals stay exact (Forever is correct), and Today/Weekly — which only read the
  current week — are unaffected; but per-request detail for past weeks is not kept.
- **Retries/follow-ups.** An explicit retry is a new successful call and counts
  once; a stream that is aborted before the provider emits usage is not counted
  (rather than estimated), so no partial-call fabrication.
- **No provider was available during part of the audit** other than the live LM
  Studio instance used above; Ollama's port (`:11434`, from `LOCAL_PROVIDERS`) was
  not exercised live. The provider-status probe already reads that configured
  endpoint rather than a hard-coded port.

---

## 7. Files changed

- `src/lib/agent-hub/types.ts` — `UsageRecord` / `UsageDay` / `TokenUsageLedger`, `HubState.tokenUsage`
- `src/lib/agent-hub/seed.ts` — empty ledger seed
- `src/lib/agent-hub/normalize.ts` — ledger hardening (records + days)
- `src/lib/agent-hub/token-usage.ts` — per-request append, week-window compaction, period aggregation (rewritten)
- `src/lib/agent-hub/state-file.ts` — **new** server-owned state file + `recordServerUsage()` (shared queue)
- `src/lib/agent-hub/usage-sync.ts` — **new** decoupled client display channel (server ledger → UI)
- `src/lib/agent-hub/store.ts` — `applyTokenUsage` action + sync listener (client no longer writes the ledger)
- `src/lib/agent-hub/llm.ts` — `readUsage` / `estimateUsage`, usage chunk, `include_usage`
- `src/lib/agent-hub/agent-session.ts` — apply the server-returned ledger from the runtime model call
- `src/app/api/chat/route.ts`, `src/app/api/explain/route.ts`, `src/app/api/playground/route.ts` — record usage server-side + return the updated ledger
- `src/app/api/agent/route.ts` — uses the shared state file; POST preserves the server-owned ledger
- `src/components/agent-hub/chat-view.tsx`, `explain/use-explain.ts`, `playground-view.tsx` — apply the returned ledger
- `src/components/agent-hub/token-meter.tsx`, `period-token-monitor.tsx`, `overview.tsx`, `system-console.tsx` — read the ledger; honest labels
- `scripts/check-token-usage.mjs`, `scripts/agent-session-regression.mjs` — tests
