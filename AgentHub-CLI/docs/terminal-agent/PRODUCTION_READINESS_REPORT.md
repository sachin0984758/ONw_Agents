# AgentHub CLI production-readiness report

Assessment date: 2026-10-31

## Updated implementation checkpoint — 2026-11-01

The 2026-10-31 scores and evidence below are historical. Bounded memory,
dependency plans, action recovery, read-only concurrency/specialist pools,
post-edit verification, provider capability provenance, explicit backup
retention and configuration migration were added in the next continuation.
Current automated validation is 150/150 tests, zero skips; coverage is
77.70% lines, 69.75% branches, 78.93% functions. A fresh Spark live recheck
passed 8/8 and is recorded in `REMAINING_FEATURES_2026-11-01.md`; Linux and broader provider
coverage remain unverified. Treat the local preview score as unchanged until
the remaining boundaries receive independent review.

## Result

**Overall: 7/10 for a local, developer-operated preview; not production-ready
for unattended or untrusted use.** The CLI has meaningful architecture,
permission checks, persistence, cancellation, and automated coverage. The
rating is limited by the shell trust boundary, lack of encrypted local storage,
provider/model variability, and incomplete clean-machine release validation.

## Area scores

| Area | Score | Evidence and limit |
|---|---:|---|
| Architecture | 8/10 | Clear module boundaries and shared runtime fronts; no independent external review. |
| Security | 6/10 | Central policy, hard denies, workspace checks and redaction exist; shell is not OS-isolated and classifiers/redaction are pattern-based. |
| Execution reliability | 7/10 | Bounded loop, cancellation, evidence and failure states are covered; unfinished explicit plans downgrade to partial, while semantic task fulfillment still cannot be independently proven. |
| Provider integration | 8/10 | Spark passed the local model/tool workflow, with historical GPT-OSS success and Qwen failure recorded; broader provider/model coverage remains unverified. |
| Tool system | 8/10 | Validated schemas, policy-mediated execution, bounded output and file/Git/plan/skill/MCP tools; Git writes are limited to approved explicit staging and staged-only commit. Cancellation remains cooperative. |
| Memory | 6/10 | Local memory commands and session recall work; no automatic high-confidence extraction or semantic relevance ranking. |
| Context management | 7/10 | Token estimation, trimming and compaction are tested; estimates may be approximate and long-run quality is not proven. |
| MCP | 7/10 | A real model discovered/called an owned stdio server with approved policy; broader protocol features and arbitrary servers remain unverified. |
| Skills | 8/10 | Discovery, static checks, install/update/rollback and activation are tested; publisher signatures/provenance are not verified. |
| Sessions | 8/10 | Atomic local persistence, validation, redaction, resume, no-replay behavior, and a bounded session audit are tested; data is not encrypted or tamper-evident. |
| Testing | 7/10 | Typecheck and 134 deterministic tests pass with 75.94% line coverage; adversarial, large-repository and full provider matrix remain incomplete. |
| Documentation | 8/10 | Architecture, setup, configuration, security limitations and live-model evidence are documented; some release claims remain unverified. |
| Developer experience | 8/10 | Interactive picker, progress, approvals, model/usage footer, print and JSON modes; argument completion and full terminal integration are limited. |
| Distribution | 7/10 | A compiled npm archive installs into a fresh Windows prefix and passes actual command/tool checks; Linux, hosted CI and publication are unverified. |

Scores describe the present tested implementation, not the number of requested
features. See `ENGINEERING_AUDIT.md` for findings and priorities.

## Validation evidence

- TypeScript checking and `npm run test:coverage`: passed on 2026-10-31;
  all 134 tests passed, with no skips. Coverage includes execution and
  persistence failures, Git safety, memory, history redaction, output caps,
  and shell/MCP child-environment filtering.
- `npm run test:coverage`: passed; Node reported 75.94% line, 67.66% branch,
  and 76.87% function coverage. This is reported without a minimum threshold.
- `npm audit --package-lock-only --audit-level=moderate`: passed on 2026-10-31;
  the current lockfile reported zero known vulnerabilities. No packages were
  installed or updated by this check.
- Strict ESLint (`--max-warnings 0`) and `node bin/agenthub.mjs --version` also
  passed on 2026-10-31. `npm run check:package` builds compiled JavaScript,
  verifies the npm archive contents, installs in an isolated Windows prefix
  with spaces, and checks version/help/JSON config and denied/approved writes
  through the installed command using a local deterministic provider.
- A current-source clean-copy check on Windows installed the three locked
  packages, reported zero known vulnerabilities, passed `npm run check` with
  117/117 tests and no skips, and returned the expected version and valid JSON
  config. That earlier result is historical; the newer archive check above
  verifies the installed command after the build fix. Linux remains unverified. The Ubuntu workflow
  is nested in the CLI directory without its own Git root, so hosted CI has not
  run.
- Live local-model evidence: `LOADED_MODEL_LIVE_2026-10-31.md`. GPT-OSS 20B
  passed real tool reads, approved/denied writes, session resume, and
  cancellation in a temporary workspace when it was loaded. In the fresh
  recheck, only Qwen2.5-Coder 3B was loaded; it streamed a reply but emitted no
  tool call for a read request. A new live CLI check now records that direct
  action as `partial` with exit code 4 instead of implying the read succeeded.
  Qwen's current setup still does not pass the tool workflow.
- The latest Spark live recheck has passing evidence for 17 distinct workflow
  checks across a broad run and a focused approved-MCP rerun. The first MCP
  positive test used a denying broker, and that failure was preserved. An
  actual CLI JSON request also passed real file reading and persistence. See
  `LIVE_RECHECK_2026-10-31.md` for exact evidence and limits.
- Global `agenthub --help`: launcher worked after the CLI directory was
  separated as `AgentHub-CLI`.

## Remaining release blockers and limitations

- No OS-level sandbox for approved shell commands or configured MCP processes.
  Name-based filtering removes common ambient credential variables; explicit
  MCP server variables are preserved and unknown secret names may pass through.
- Undo verifies the recorded current and saved-original fingerprints. Legacy
  backup entries without fingerprints are refused; concurrent external edits
  in the small verification-to-replacement window remain a filesystem race.
  File writes also re-read after approval and abort on a stale snapshot, with a
  similar final-window race for non-cooperating external writers.
- Pattern-based command risk classification and secret redaction cannot
  guarantee detection of obfuscated commands or novel secret formats. A Git
  push bypass through common Git global options was closed and tested, but this
  does not make command classification a security boundary.
- Local session, memory, history, configuration and backup data are not
  encrypted.
- The audit is session-bound and checkpointed, not an append-only external log;
  abrupt process loss can omit events since the latest session save.
- Tool support varies across models and chat templates; the Qwen test did not
  produce native calls.
- Full adversarial security review, cross-platform clean install, stress tests,
  and live MCP/subagent checks are not complete.
- Package is private and should not be described as release-certified.

## Files changed in this assessment

The final remediation adds `src/core/cancellation.ts`, enforces active-run
deadlines and batch tool limits, cancels approval waits, prevents late writes,
and marks partially reported usage as estimated. Memory JSON and exact
deduplication are fixed. Doctor validates the tool probe and storage before
reporting success. Packaging adds `tsconfig.build.json`, clean compilation,
archive verification, a same-process launcher, and a repeatable real-model
validation command. See `FINAL_VALIDATION_2026-10-31.md` for the exact file list
and the failed-before/passed-after evidence.

- Added `docs/terminal-agent/ENGINEERING_AUDIT.md`.
- Added `docs/terminal-agent/PRODUCTION_READINESS_REPORT.md`.
- `src/core/run.ts`: each tool receives a per-call abort signal linked to the
  run signal; timeouts abort that signal, runs with tool failures cannot end
  with a `completed` status, final save failures are reported as partial, and
  subagents inherit the parent tool's cancellation signal.
- `tests/agent-loop.test.ts` and `tests/mcp-subagent.test.ts`: regression tests
  cover timeout cancellation, tool failure status, persistence failure, and
  subagent signal forwarding.
- `src/policy/engine.ts` and `tests/policy.test.ts`: Git subcommands are checked
  after common global options, including push hard-denial and staging risk.
- `src/tools/shell.ts` and `tests/shell.test.ts`: shell stdout and stderr now
  share one configured output byte limit.
- `src/utils/env.ts`, `src/tools/shell.ts`, and `src/mcp/client.ts`: shell and
  MCP child processes filter common credential-like names from the inherited
  environment; explicitly configured MCP variables remain available.
  `tests/shell.test.ts` and `tests/mcp-subagent.test.ts` verify the behavior.
- `src/providers/openai.ts` and `tests/provider-retry.test.ts`: distinguish
  body timeouts from partial streamed output, retry only before any output, and
  cover model-discovery body timeouts.
- `src/mcp/client.ts` and `tests/mcp-subagent.test.ts`: client shutdown now
  fails outstanding requests immediately and clears their timeout timers.
- `src/core/backups.ts`, `src/tools/files.ts`, and
  `tests/backups.test.ts`: undo checks the current file and saved-original
  fingerprints, refuses later user edits and legacy unverified entries, and
  fails closed on corrupt backup indexes. File-tool tests cover stale approval,
  denied writes, CRLF-preserving edits and undo, ambiguous replacement refusal,
  and explicit replace-all behavior.
- `src/cli/tui.ts`, `src/cli/commands/memory.ts`, `src/cli/slash-commands.ts`,
  and `tests/slash-commands.test.ts`: interactive project/user memory can be
  listed, searched, and deleted.
- `src/utils/redact.ts`, `src/cli/tui.ts`, and `tests/context.test.ts`: common
  recognizable secret forms are redacted before terminal history is saved.
- `src/tools/git.ts` and `tests/git-tools.test.ts`: added branch and commit
  inspection plus explicit-path staging and staged-only commits through the
  `git.write` approval policy. Temp-repository tests verify denied mutations
  leave the index/history unchanged, approved changes take effect, and nested
  workspaces cannot commit pre-staged paths from outside the workspace.
- The audit and readiness reports above.

Timeout cancellation relies on the tool honoring its abort signal. A tool that
ignores it may continue internally; the runtime cannot provide operating-system
process isolation for arbitrary tool implementations. A recovered task with any
failed tool call is conservatively reported as partial and needs human review.
