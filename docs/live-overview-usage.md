# Live Overview usage and telemetry

## Fix

The stored ledger contained 24,528 tokens while Overview displayed zero. A
usage-only write advanced `tokenUsage.updatedAt` without advancing the dashboard
timestamp, so client hydration discarded it. Coding sessions and Auto also used
a model adapter that never persisted usage.

Token writes now update the dashboard timestamp. The client also accepts a newer
ledger independently and rejects older ledger snapshots. Accounting runs once
per actual model generation in the shared Chat/teaching/Playground client and
the coding/Auto adapter. Repair attempts count separately. The final provider
usage frame is requested and persisted; an absent usage frame is explicitly
marked estimated. Auto vision records provider-reported usage too.

No historical token values were invented or backfilled. Past calls that were
never metered cannot be reconstructed exactly from their visible answer text.
Calls made directly in LM Studio or another application are outside AgentHub's
ledger.

## Update policy

| Data | Update method |
| --- | --- |
| Token totals and active inference | One `/api/usage` SSE connection, pushed when a request starts, ends or records usage |
| CPU, RAM, GPU telemetry | Every 3 seconds while Overview is visible; serial requests |
| Loaded local models | One shared provider check every 5 seconds on Overview; 15 seconds for the sidebar alone |
| Externally changed saved configuration | Every 10 seconds while the page is visible |
| Today/week time boundaries | Local clock refresh; no provider call |

Hidden tabs close the usage stream and suspend hardware/provider/state polling.
Returning reconnects and reads the durable ledger. Model inference continues;
closing the monitoring stream never cancels a model request.

CPU utilization now uses deltas between actual OS counter samples. Overview no
longer presents sample session counts, configured-agent statuses, placeholder
activity or estimated dollar savings as live measurements. Existing agent,
session, plan and changes pages remain accessible.

## Verification

- `node scripts/check-token-usage.mjs`: 88 checks passed.
- `node scripts/check-runtime-models.mjs`: 24 checks passed.
- `node node_modules/tsx/dist/cli.mjs scripts/check-live-usage.ts`: 21 checks
  passed using an isolated temporary database and a real HTTP fixture. Covers
  provider usage, estimates, retries, cancellation, concurrent writes, timestamp
  hydration, stale snapshots, SSE updates and CPU deltas.
- Browser evidence: `.verification/overview-usage/results.json` and screenshots
  in the same directory. Fifteen checks passed, including stored totals, a real
  MiniCPM request, automatic SSE updates, shared provider requests, light/dark
  and mobile rendering, hidden-tab suspension and reconnect.
- In that live test MiniCPM returned no visible answer after a retry. The two
  attempts were correctly metered as two actual generations; this test confirms
  usage tracking, not successful answer generation. The browser showed 19,443
  input and 5,773 output tokens (25,216 total) at that verification point.
- Chat isolation: 45 passed. Playground: 239 passed, 2 preexisting skips.
  Skills: 172 passed. App TypeScript and scoped ESLint checks passed.
