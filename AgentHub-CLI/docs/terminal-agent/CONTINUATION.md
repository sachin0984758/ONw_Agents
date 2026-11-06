# AgentHub CLI continuation

Current follow-up checkpoint: 2026-11-01. The 2026-10-31 sections below are
preserved as history; current implementation and validation are in
`REMAINING_FEATURES_2026-11-01.md`.

Updated: 2026-10-31

## Status

The engineering prompt is still in progress. The CLI is useful for a local,
developer-operated preview, but it is not certified for production, unattended
execution, or untrusted repositories. Do not represent the entire master prompt
as complete.

## Verified snapshot

- TypeScript check passed; `npm run test:coverage` passed 134/134 tests, 0 skipped.
- Coverage: 75.94% line, 67.66% branch, and 76.87%
  function coverage. No threshold is enforced.
- The suite includes a real stdio MCP fixture that confirms common ambient
  credential-like variables are filtered and explicitly configured server
  variables are retained.
- Live model evidence and its model-specific limitations are recorded in
  `LOADED_MODEL_LIVE_2026-10-31.md`; the automated suite itself uses mocks.
- Latest real-model check: Spark x2.6 4B is loaded with 11,264 context. Seventeen
  distinct workflows have passing evidence across a broad run and a focused
  approved MCP rerun. A separate actual CLI JSON/file-read request also passed.
  Earlier timeout and denied-MCP evidence is retained. See
  `LIVE_RECHECK_2026-10-31.md` and `REQUIREMENTS_GAPS_2026-10-31.md`.
- The fresh source copy and the compiled npm archive both passed Windows
  validation, including the installed command and approved/denied tool writes
  against a deterministic provider. `npm run check:package` reproduces this.

## Completed engineering work recorded in this audit

- Added linked per-tool cancellation, honest partial status after tool or final
  session-save failures, and cancellation propagation to subagents.
- Hardened Git global-option classification; added read-only Git inspection,
  explicit-path staging, and staged-only commits gated by approval.
- Added project/user memory list, search, and delete commands.
- Redacted recognizable secrets from persisted terminal history.
- Enforced one shared stdout/stderr output cap for shell commands.
- Filtered common credential-like names from ambient shell and MCP child
  environments while retaining explicit per-server MCP variables.
- Added the `test:coverage` script using Node's built-in coverage reporter.
- Made `/undo` verify the current post-write file and saved original by SHA-256;
  a later user edit is preserved, and corrupt or legacy-unverified backup
  records fail closed.
- Added a post-approval file snapshot check so `write_file` and `edit_file`
  abort when a file changes while approval is pending.
- Prevented provider retries after a stream emits output; body timeouts retry
  only before output, and model-list body timeouts are reported explicitly.
- Made MCP client shutdown reject outstanding requests and clear request timers
  immediately.
- Added a bounded, redacted session audit for policy decisions, approval
  outcomes, and tool starts/successes/failures with duration. It excludes tool
  arguments and successful output; older sessions load with an empty audit.
- Updated the audit, readiness, configuration, MCP, limitations, and test
  documentation to reflect verified behavior and limits.

## Current limitations and unfinished master-prompt requirements

- The file-write/undo race review is complete. Existing snapshot and fingerprint
  checks catch observed changes, but Node's portable filesystem API provides no
  atomic compare-and-swap for file contents. A cooperative lock cannot stop
  unrelated editors, so no stronger cross-process guarantee was added; the
  residual window remains documented.
- Environment filtering is heuristic, not process isolation. Approved shell
  commands and configured MCP programs still run with the current OS user's
  authority; explicitly configured MCP secrets are passed to that server.
- Fingerprint and post-approval snapshot checks protect user changes observed
  before the final write/undo operation, but another process can still race a
  write between verification and replacement; legacy backups
  without fingerprints are intentionally not auto-restored.
- Memory is user-curated and substring-searched. Automatic extraction,
  relevance ranking, deduplication, expiration, and configurable budgets are
  unfinished.
- Unfinished explicit plan steps and direct action requests answered only with
  registered-tool-shaped JSON now downgrade a run to `partial`. Full
  dependency-aware replanning, safe retry policies, duplicate-action detection,
  checkpoint recovery, and independent semantic completion verification are
  not established end to end; normal prose can still be semantically wrong.
- Model and tool behavior remains provider/template-specific. The documented
  Qwen2.5-Coder live test streamed text but did not produce native tool calls;
  Spark passed live MCP and subagent checks using owned temporary fixtures.
  Other provider/model combinations remain unverified.
- The session audit is capped at 500 entries and saved at normal session
  checkpoints. It is not a separate append-only log, so abrupt process loss can
  omit events since the last save; policy entries are not linked to tool-call
  IDs.
- Coverage is 75.94% by lines, 67.66% by branches, and 76.87% by functions;
  no threshold is enforced. Several modules, including
  filesystem tools, provider registry, skills installation, and CLI subcommands,
  have uncovered paths; prioritize security and failure handling rather than a
  blanket percentage target.
- Current-source Windows clean-copy validation passed. Linux validation is
  still pending: this host has WSL but no installed Linux distribution. The Ubuntu workflow
  is nested inside the CLI folder, which has no independent Git root, so there
  has been no hosted run. Stress testing and release certification remain
  incomplete.

## Files changed in this continuation

- Added `src/utils/env.ts`; updated `src/tools/shell.ts` and
  `src/mcp/client.ts` for child environment filtering.
- Updated `tests/shell.test.ts`, `tests/mcp-subagent.test.ts`,
  `tests/agent-loop.test.ts`, and `tests/slash-commands.test.ts`; added
  `tests/backups.test.ts` and expanded `tests/file-tools.test.ts` for
  environment, real stdio-server, safe-undo, stale-write, denied-write,
  CRLF-edit, ambiguous-edit, and replace-all regressions.
- Updated `src/core/backups.ts` and `src/tools/files.ts` for fingerprint-guarded
  backup restoration.
- Updated `src/providers/openai.ts` and `src/mcp/client.ts`; added provider
  timeout, partial-stream, and MCP close regressions in
  `tests/provider-retry.test.ts` and `tests/mcp-subagent.test.ts`.
- Added `src/core/audit.ts`; wired policy and tool events through
  `src/core/authorize.ts` and `src/core/run.ts`; persisted bounded, redacted
  entries with legacy-session compatibility in `src/sessions/store.ts`. Added
  approval, outcome, redaction, limit, and compatibility regression tests.
- `src/core/run.ts` now reports `partial` when a planned step is pending,
  active, skipped, or blocked at run end; a regression covers this behavior.
- Updated `package.json` with `test:coverage`.
- Updated the CLI `README.md`, `docs/terminal-agent/CONTINUATION.md`,
  `TESTING.md`, `ENGINEERING_AUDIT.md`, `PRODUCTION_READINESS_REPORT.md`,
  `KNOWN_LIMITATIONS.md`, and `LOADED_MODEL_LIVE_2026-10-31.md` with verified
  audit, completion-status, and live-model results.

## Exact next steps

1. Use coverage to strengthen security-critical paths and keep the exact
   numbers current in `TESTING.md`.
2. Re-run the live tool workflow if GPT-OSS or another tool-capable model is
   loaded; do not download or switch models for this check.
3. Validate the current package snapshot on Linux. This host has no usable WSL
   distribution, and the nested Ubuntu workflow cannot run from the parent
   repository's current Git root.

The current full-scope acceptance list is in `FINAL_VALIDATION_2026-10-31.md`.
Earlier progress percentages were informal estimates and must not be treated
as proof that the remaining master-prompt features were implemented.

## Worktree caution

No files were committed or pushed. `AgentHub-CLI` is a separate, currently
untracked directory in the parent workspace's Git working tree, which also
contains other existing user changes. Preserve those changes; do not stage,
discard, or reorganize the parent worktree as part of this continuation.

## Latest verification checkpoint — 2026-10-31

The entries below describe the preceding 117-test checkpoint. The newer
129-test validation, additional fixes, package build, and current external
blockers are recorded in `FINAL_VALIDATION_2026-10-31.md`. The user declined
edits outside `AgentHub-CLI`; no parent-root workflow was installed.

- Re-ran `npm run check`: TypeScript passed and 117/117 tests passed, with no
  skips. Re-ran `npm run test:coverage`: 72.88% line, 67.02% branch, and
  75.46% function coverage. Strict ESLint (`--max-warnings 0`) exited 0; the
  shared Next.js config printed its existing missing-`pages` notice, with no
  lint findings. `npm audit --package-lock-only --audit-level=moderate` found
  zero known vulnerabilities without installing or updating packages.
  `node bin/agenthub.mjs --version` printed `0.1.0`.
- A clean current-source copy in a Windows temp folder installed three locked
  packages with `npm ci --ignore-scripts`, passed the same 117-test check, and
  returned the expected version and config JSON. Linux, hosted CI, and
  global-install release tests remain outstanding.
- The parent repository's `git diff --check` passed for tracked changes. Git
  printed LF-to-CRLF conversion notices for some existing working-copy files;
  it reported no whitespace errors.
- `AgentHub-CLI/package.json` has no `build` script; this CLI runs TypeScript
  through Node 24, so there is no separate CLI production build to report.
- A fresh live `doctor --json --probe` reached LM Studio and selected the
  loaded Qwen model. Its real tool-call probe was inconclusive because the
  model returned tool-shaped JSON as text. See
  `LOADED_MODEL_LIVE_2026-10-31.md`; the earlier GPT-OSS tool workflow passed
  when that model was loaded.
- A live CLI read request against Qwen returned tool-shaped JSON without a
  native call; no tool ran, the random file marker stayed unread, and the file
  stayed unchanged. The run and saved session were `partial`, exit code 4.
  This verifies honest failure reporting, not Qwen tool support.
- Reviewed the containing `Test` repository working tree without staging,
  committing, or discarding changes. The current snapshot has 277 Git status
  entries expanded to 584 file paths, including 42 tracked deletions. Every
  path is classified in `../../docs/audits/AGENTHUB-WORKING-TREE-CONTINUATION-20261031.csv`
  and its JSON summary. Two credential-pattern hits are deliberate test
  fixtures containing private-key markers; no credential values were recorded.
  The scan is pattern-based and does not verify authorship or semantic intent.
- This checkpoint updated `src/core/run.ts` to mark explicit direct-action
  requests `partial` when the model prints an exact registered-tool JSON
  envelope as text. Added regressions in `tests/agent-loop.test.ts` for that
  case and for ordinary JSON examples remaining completed answers. The live
  Qwen probe confirms the no-tool path. This is a narrow leading-phrase and
  response-shape check; it does not provide general semantic completion proof.
  The 117-test suite and clean-copy check passed after the source change.
