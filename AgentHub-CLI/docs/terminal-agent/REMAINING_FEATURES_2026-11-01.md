# Remaining-feature implementation — 2026-11-01

All changes in this continuation are inside AgentHub-CLI. Parent application
files, historical evidence, installed models and user data were preserved.
No commits, staging, pushes, installation of Linux, or actual user-backup
pruning were performed.

## Implemented scope

| Previous gap | Implemented behavior | Practical boundary |
|---|---|---|
| Layered memory | Exact explicit-request extraction, four categories, normalized deduplication, updates/deletion/expiry, lexical ranking and configurable retrieval budget | No inferred facts or embeddings; automatic extraction is user-config opt-in |
| Dependency planning | Optional dependency graph, cycle/reference checks, prerequisite enforcement, failed/cancelled states, downstream invalidation and atomic plan replacement | Plan execution remains model-directed; the runtime does not invent a dependency graph |
| Controlled parallel work | Bounded independent read tools in read-only mode; specialized read-only agent pool with shared total/concurrency/depth limits | Coding/mutation tools stay sequential; no worktrees or automatic write-conflict resolution |
| Durable recovery | Required pre-batch checkpoint, synced write-ahead per-action journal, observed-byte reconciliation and no automatic replay | Unknown shell/MCP/edit outcomes require inspection; this is not universal transaction rollback |
| Independent verification | Automatic policy-mediated project checks, JSON validation and post-check file fingerprints; dedicated read-only review mode | No general proof of semantic task fulfillment; missing/failed/denied checks downgrade to partial |
| Capability registry | Configured streaming/tools/JSON/vision/reasoning flags, endpoint/model-scoped observations, provenance and seven-day expiry | JSON/vision/reasoning remain unknown unless explicitly configured; registry does not implement multimedia APIs |
| Backup retention | Configurable count/bytes/age; preview-first explicit pruning, fingerprint checks, manifest, orphan reporting, latest undo preservation | No silent deletion; unknown/tampered/orphan files stay untouched; quotas can block new edits |
| Config migration | Version 1, legacy loading, explicit preview/migration with byte-preserving private backup and unknown-key preservation | Future schemas rejected; no automatic overwriting on load |

## Validation checkpoint

The first expanded automated run passed **148/148 tests**, zero failures/skips.
Coverage was **77.38% lines / 69.35% branches / 78.75% functions**. Strict ESLint
passed with no findings (the inherited Next.js config prints a pages-directory
notice). `npm run check:package` passed compiled build, archive checks, isolated
Windows installation, installed-command and approved/denied tool checks.

New deterministic tests cover memory provenance/isolation/expiry/locking,
config migration safety, capability provenance, interruption reconciliation,
bounded concurrency and draining failed workers, explicit retention preserving
undo, post-edit test failure and approval denial, specialist permission limits,
parallel read ordering, and checkpoint failure preventing mutation. Plan
regressions were executed failing before the implementation and passing after.

`scripts/check-remaining-features.mjs` performs fresh real-model checks in an
isolated temporary workspace. The initial Spark x2.6 4B run passed eight checks
including explicit memory extraction, fresh-session retrieval, dependent plans,
automatic test execution, parallel reviewer/researcher children, read-only code
review, interrupted-write reconciliation and persisted streaming/tool
capabilities. That run preceded the final memory-approval regression; the
second run below is authoritative for the final code.

**Final fresh live-model run: PASS, 8/8 checks, Spark x2.6 4B, 2026-11-01.**
It ran after memory extraction was routed through the central approval policy.
The exact result and per-check session IDs are in
`SPARK_REMAINING_FEATURES_2026-11-01.json`; event streams and sessions are
retained in its temporary evidence folder. Checks confirm explicit memory
approval and next-session retrieval, dependency ordering, a real test command
after a write, two parallel read-only specialist children, a read-only code
review, interrupted-write recognition without replay, and persisted
streaming/tool observations. LM Studio reported token usage as estimated.

**Windows rerun: PASS, 8/8 checks, Spark x2.6 4B, 2026-11-01.** The saved
result is `SPARK_REMAINING_FEATURES_2026-11-01_FINAL.json`; full event streams
and sessions remain in `C:\Users\SACHIN\AppData\Local\Temp\agenthub-remaining-live-xcHqK1`.
This rerun additionally confirms the review fixture uses an independent proof
marker and the plan check accounts for correctly rejected premature dependency
updates. No model download or installation was needed.

Latest Windows validation after the lock and terminal UI changes: typecheck passed and
**152/152 automated tests passed with zero skips**; strict ESLint exited 0 (the
inherited configuration prints its missing-pages-directory notice).
`npm run check:package` passed on Windows Node 24.18.0 with 103 archive files
and isolated installed-command checks; `npm audit --no-fund --no-progress`
reported zero vulnerabilities. The extended local-model CLI matrix
passed **17/17 checks** on Spark x2.6 4B; see
`SPARK_LOCAL_CLI_2026-11-01_EXTENDED.json`. A real pseudo-terminal launch also
returned `TTY_OK`, ran `/help`, and exited with Ctrl+D using a temporary home;
session evidence is `WINDOWS_TTY_SMOKE_2026-11-01.json`. The footer now reports
the provider-confirmed loaded model and measured run duration, refreshes local
model state every 10 seconds, and labels unverified selections honestly; its
live Spark result is recorded in `WINDOWS_LIVE_MODEL_FOOTER_2026-11-01.json`.

`npm run check:windows-stress` passed with 2,500 generated repository files
(the context scanner respected its 160-entry cap), 150 unique concurrent memory
facts, and 100 session save/load/list operations with up to 20 simultaneous
writes. Its evidence is in `WINDOWS_STRESS_2026-11-01.json`. The first stress
attempt exposed Windows `EPERM` lock collisions and the previous 3-second lock
wait was too short for the memory workload. The lock now treats `EPERM` as
contention only if the lock file exists, keeps real permission errors intact,
and waits up to 15 seconds; the final stress rerun passed in 4.8 seconds for
memory writes.

Still unverified: Linux and hosted CI, native Windows Terminal behavior outside
the test pseudo-terminal, arbitrary third-party MCP servers, cloud/Ollama
provider matrices, and independent adversarial security review. Do not call
this production-ready until those reviews are completed.

## Source changes in this continuation

Added:

- `src/config/migrate.ts`
- `src/context/memory.ts`
- `src/core/journal.ts`
- `src/core/scheduler.ts`
- `src/core/verify.ts`
- `src/providers/capabilities.ts`
- `src/utils/lock.ts`
- `src/cli/commands/backups.ts`
- `scripts/check-windows-stress.mjs`
- `tests/advanced.test.ts`, `tests/plan.test.ts`
- `scripts/check-remaining-features.mjs`
- `docs/terminal-agent/WINDOWS_TTY_SMOKE_2026-11-01.json`
- `docs/terminal-agent/SPARK_REMAINING_FEATURES_2026-11-01_FINAL.json`
- `docs/terminal-agent/SPARK_LOCAL_CLI_2026-11-01_EXTENDED.json`
- `docs/terminal-agent/WINDOWS_STRESS_2026-11-01.json`
- `docs/terminal-agent/WINDOWS_LIVE_MODEL_FOOTER_2026-11-01.json`
- This report, `MEMORY.md`, and `SESSIONS.md`.

Updated:

- `src/config/types.ts`, `src/config/load.ts`
- `src/core/events.ts`, `src/core/plan.ts`, `src/core/run.ts`, `src/core/backups.ts`
- `src/tools/types.ts`, `src/tools/plan.ts`, `src/tools/subagent.ts`, `src/tools/files.ts`
- `src/providers/types.ts`, `src/providers/registry.ts`, `src/providers/openai.ts`
- `src/sessions/store.ts`, `src/context/prompt.ts`
- `src/cli/args.ts`, `src/cli/main.ts`, `src/cli/help.ts`
- `src/cli/tui.ts`, `src/cli/terminal-ui.ts`, `src/cli/transcript.ts`, `tests/terminal-ui.test.ts`
- `src/cli/commands/config.ts`, `src/cli/commands/memory.ts`, `src/cli/commands/sessions.ts`
- `package.json`, README and the linked architecture/configuration/testing/audit/limitations/provider/tool/subagent/readiness/continuation documentation.

## External validation still open

Linux/hosted CI, physical-terminal OS signals, arbitrary third-party MCP servers,
cloud/Ollama matrix, long-session/large-repository stress and independent
adversarial review remain unverified. Keep the assessment at a local developer
preview; do not call this production-ready.
