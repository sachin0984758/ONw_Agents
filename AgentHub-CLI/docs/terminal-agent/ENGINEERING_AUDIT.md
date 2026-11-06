# AgentHub CLI engineering audit

## Current follow-up checkpoint — 2026-11-01

The later implementation adds bounded categorized memory, dependencies and
failed/cancelled plan states, synced action journals, no-replay recovery,
read-only parallel scheduling and specialist agents, policy-mediated automatic
verification, endpoint/model-scoped capability provenance, explicit backup
retention and schema migration. Current validation: TypeScript passed, 150/150
tests passed with no skips, coverage 77.70% lines / 69.75% branches / 78.93%
functions, strict ESLint passed, and the compiled Windows package check passed.
See `REMAINING_FEATURES_2026-11-01.md` for the live-model record and exact
boundaries. This does not establish production readiness or Linux support.

Audit date: 2026-10-31

## Scope and evidence

This audit covers the standalone `AgentHub-CLI` package, its architecture,
source module inventory, current known-limitations and live-model reports, and
the existing automated tests. The baseline `npm run check` completed with
TypeScript typechecking successful and 85/85 tests passing (0 skipped). Follow-up
execution, completion-status, persistence-reporting, subagent-cancellation,
output-cap, memory-management, history-redaction, Git-inspection, and child
environment-filtering work is covered by regressions; the current `npm run
check` result is TypeScript typechecking successful and 134/134 tests passing
(0 skipped). The built-in coverage run reports 75.94% lines, 67.66% branches,
and 76.87% functions; coverage is not yet a threshold. The
live model evidence is recorded in `LOADED_MODEL_LIVE_2026-10-31.md`. This is a
source and behavior audit; it is not a penetration test or a clean-machine
release certification.

## Current architecture and capabilities

The package is a Node 24 CLI with no runtime dependencies. Development uses
TypeScript directly; npm archives ship compiled JavaScript. `bin/agenthub.mjs`
imports the source or compiled entry and invokes it in the same process.
The CLI, non-interactive print/JSON modes, and interactive TUI share the same
agent runtime. Responsibilities are separated across configuration, context,
core execution, providers, tools, policy, skills, MCP, sessions, and terminal
presentation. The detailed map is in `ARCHITECTURE.md`.

Implemented capabilities include compatible local model providers, streaming,
tool calls, file and shell tools, read-only Git inspection plus approved
explicit-path staging and staged-only commits, plans, approvals,
backups and undo, persisted sessions and memory, skills discovery/install,
configured stdio MCP tools, bounded subagents, cancellation, evidence, and
interactive, print, and JSON front ends. Live testing confirmed GPT-OSS 20B
performed actual file reads/writes, respected an approval denial, resumed a
session without replaying tools, and cancelled a run. Qwen2.5-Coder 3B streamed
chat but did not emit native tool calls in the tested LM Studio setup.

Session JSON now carries a capped audit for policy decisions, approval outcomes,
and tool starts/successes/failures. The store redacts and bounds summaries and
failure text and omits arguments and successful output. It is checkpointed with
the session rather than maintained as a separate append-only, tamper-evident
log; abrupt process loss can omit events since the last session save.
Runs with an explicit plan also return `partial` if any step is not marked
completed at run end. The model reports those statuses, so this is a
conservative incomplete-work signal rather than independent proof of correctness.

## Findings by priority

### High

1. **Shell policy is an application-level classifier, not isolation.** Common
   dangerous commands are blocked or require approval, but scripts, aliases,
   obfuscation, and other programs can bypass pattern classification. Approved
   commands run with the user's OS permissions. Keep `ask` as the default and
   document OS-level isolation for untrusted work. Evidence: `KNOWN_LIMITATIONS.md`.
2. **Live tool calling depends on model/template behavior.** Qwen returned
   tool-shaped JSON as ordinary text rather than a native tool call. The runtime
   now reports `partial` when that exact registered-tool JSON shape appears for
   a request beginning with a recognized direct action phrase; it leaves
   explanatory examples alone. A fresh real CLI run confirms no file tool
   executes and the run exits 4. The check is intentionally narrow: other task
   phrasings and ordinary prose can still be marked `completed` without
   independent semantic verification.
   Evidence: `src/core/run.ts`, `tests/agent-loop.test.ts`, and
   `LOADED_MODEL_LIVE_2026-10-31.md`.
3. **Sensitive local data is not encrypted.** Sessions, memory, backups,
   configuration, and prompt history rely on OS file permissions. Recognizable
   secrets are redacted from terminal history, but stored data remains
   unencrypted and redaction is pattern-based. Evidence: `KNOWN_LIMITATIONS.md`
   and `src/cli/tui.ts`.

### Medium

4. **Tool timeouts previously did not cancel the in-flight operation.** The
   runtime raced the tool promise against a timeout but passed the parent run
   signal directly to the tool. A timed-out operation could therefore continue
   after the run reported its timeout. The runtime now gives each tool call a
   linked signal and aborts it on timeout or user cancellation. A regression
   test verifies the timeout signal is delivered. This remains cooperative:
   tools or child processes that ignore cancellation cannot be forcibly stopped
   by this JavaScript signal alone. Evidence: `src/core/run.ts` and
   `tests/agent-loop.test.ts`.

5. **A final model response could hide an earlier tool failure.** A normal
   answer after an unknown tool, invalid arguments, or a failed tool previously
   retained the `completed` status. The runtime now marks such a run `partial`
   and adds a limitation so model text alone cannot turn failed tool execution
   into a success claim. This is deliberately conservative: even a later
   successful alternative leaves the run partial for human verification.
   Evidence: `src/core/run.ts`, `tests/agent-loop.test.ts`, and
   `tests/mcp-subagent.test.ts`.

6. **A final session write failure could leave a run labeled completed.** The
   CLI emitted a warning but kept the successful run status even though the
   conversation could not be resumed. It now reports that run as partial and
   includes a redacted persistence error in the limitations. A regression test
   simulates a full disk. Evidence: `src/core/run.ts` and
   `tests/agent-loop.test.ts`.

7. **Subagent work did not inherit the enclosing tool-call timeout signal.**
   Parent-run cancellation worked, but a per-tool timeout could stop waiting
   while a child agent continued. The child now receives a signal combining
   parent-run cancellation with the subagent tool's own cancellation. A focused
   test verifies signal forwarding. Evidence: `src/core/run.ts`,
   `src/tools/subagent.ts`, and `tests/mcp-subagent.test.ts`.

8. **Git global options could evade the push hard deny.** The original command
   check matched `git push` directly but missed forms such as `git -C repo push`
   under `auto` or `bypass`. The hard deny now also catches Git commands with
   global options before `push`; regression cases cover `-C`, `-c`, and
   `--git-dir`. Common Git global options are normalized before applying the
   existing subcommand rules, so reset/clean/restore and staging classifications
   also apply. This remains pattern-based command analysis, not a shell sandbox.
   Evidence: `src/policy/engine.ts` and `tests/policy.test.ts`.

9. **Shell output could exceed the configured cap across both streams.** The
   allowance applied separately to stdout and stderr, so commands writing to
   both could retain twice the configured amount. The shell runner now enforces
   one combined byte budget with a subprocess regression test. Evidence:
   `src/tools/shell.ts` and `tests/shell.test.ts`.

10. **MCP and child agents expand the process trust boundary.** MCP servers are
   local programs with the user's authority, and child agents share parent
   permissions and workspace. Current scope is explicitly configured stdio
   tools, not full MCP protocol support. Evidence: `KNOWN_LIMITATIONS.md` and
   `MCP_AND_SUBAGENTS.md`.
11. **Provider behavior is not uniform.** Tool calling, context length, token
   reporting, and cancellation vary by provider/model. The provider registry
   probes some capabilities, but live support must remain configuration- and
   model-specific. Evidence: provider docs and live model report.
12. **Release posture is local-development quality.** The package is private,
   has no published distribution, and has not been clean-machine release tested
   for the current source snapshot. The CLI package has no independent Git
   history. Preserve these boundaries in release claims. Evidence:
   `KNOWN_LIMITATIONS.md`.
13. **Context and memory have bounded/simple retrieval.** Explicit memory
   entries can now be listed, searched by case-insensitive substring, and
   deleted. This does not provide semantic memory extraction/relevance ranking
   or guarantee every instruction survives arbitrary long conversations.
   Evidence: `src/cli/commands/memory.ts`, `src/cli/tui.ts`, and tests.
14. **Writes and undo could overwrite edits made during approval or after an
   AgentHub write, and corrupt backup indexes were treated as empty.** Writes
   now re-read and compare the file after approval; backup entries record the
   expected post-write and saved-original fingerprints; restore refuses a
   conflict, an altered backup, or a legacy entry without a fingerprint. Index
   parse/validation errors now fail closed. Regression tests cover modified
   existing files, created files, tampered backups, legacy entries, corrupt
   indexes, stale approvals, denied writes, and CRLF edits. There remains a narrow race for edits from another process between
   verification and replacement. Evidence: `src/core/backups.ts`,
   `src/tools/files.ts`, `tests/backups.test.ts`, `tests/file-tools.test.ts`,
   and `tests/agent-loop.test.ts`.
15. **Provider timeouts and disconnects after streaming began could replay
   partial output.** Body timeouts were not distinguished from network errors,
   so emitted text could be followed by an automatic retry. Streaming now marks
   partial output non-retryable, retries a body timeout only before output, and
   maps discovery body timeouts explicitly. MCP `close()` also now rejects
   pending requests and clears their timers immediately. Tests cover timeout,
   disconnect, cancellation, model discovery, and MCP close. Evidence:
   `src/providers/openai.ts`, `src/mcp/client.ts`,
   `tests/provider-retry.test.ts`, and `tests/mcp-subagent.test.ts`.

### Low

16. **The interactive picker suggests command names only.** It does not
   autocomplete arguments such as models, skills, or paths. This is documented
   and does not block command execution. Evidence: `KNOWN_LIMITATIONS.md`.
17. **Git mutation tools are limited to explicit staging and commit.** Both use
   `git.write` approval; workspace-root staging is refused, pathspecs are
   literal, commits refuse pre-staged paths outside a nested workspace, commit
   hooks are disclosed, and no tool pushes. Reset/clean and remote operations
   have no dedicated tools. Evidence: `src/tools/git.ts` and
   `tests/git-tools.test.ts`.
18. **Child environment filtering is only name-based.** Shell and MCP children
   omit common credential-like variables inherited from the AgentHub process;
   explicit MCP server variables are preserved for configured connections.
   Unrecognized secret names can pass through, and child programs still run as
   the current OS user. This reduces ambient exposure without providing process
   isolation. Evidence: `src/utils/env.ts`, `src/tools/shell.ts`,
   `src/mcp/client.ts`, `tests/shell.test.ts`, and `tests/mcp-subagent.test.ts`.

## Recommended implementation order

1. Keep `ask` defaults, hard denies and workspace/symlink checks; add targeted
   adversarial regression cases before changing policy behavior.
2. Extend honest incomplete status for observable execution gaps. A direct
   action request answered with registered-tool-shaped JSON is now marked
   partial, while explanatory examples remain normal answers. Do not infer
   general task success from prose; semantic fulfillment remains unverified.
3. Continue targeted fault-injection tests for uncovered security- and
   execution-critical paths. Existing regressions now cover malformed stream
   and discovery responses, timeouts/cancellation, corrupt session and backup
   data, stale approvals, denied writes, and persistence failures. Use coverage
   to choose the next high-risk gaps rather than pursuing a blanket percentage.
4. Continue capability checks against real provider/model combinations. The
   doctor tool probe is implemented; current Qwen returned tool-shaped JSON as
   text, while GPT-OSS passed the documented workflow when it was loaded.
5. Clarify local data retention and history controls; keep pattern-based
   redaction documented and consider configurable retention.
6. Validate installation on Linux. Windows source and installed npm-archive
   checks passed on 2026-10-31 after fixing Node's refusal to strip TypeScript
   under node_modules. Linux testing is pending because WSL has no installed
   distribution. The Ubuntu workflow
   file is nested under the CLI folder, which has no independent Git root, so
   hosted CI has not run. Keep the package private until a release workflow is
   explicitly established.

## Not established by this audit

This audit does not establish that every compatible model can call tools, that
all adversarial shell inputs are safe, that every MCP server is trustworthy, or
that the package is production-ready for untrusted repositories. The full
source has not received an independent security review.

The later Spark live recheck and five additional regression tests are recorded
in `LIVE_RECHECK_2026-10-31.md`. They cover effective loaded context, total
message/tool budgeting, preservation of the current user request, token-limited
answers, and refusal to execute a truncated tool batch. The source-confirmed
unimplemented requirements are in `REQUIREMENTS_GAPS_2026-10-31.md`.

## Final remediation evidence

New regressions failed before changes and now pass for: a model call exceeding
the run deadline; an oversized single tool batch exceeding the call cap; a
late approval writing after the deadline; inconsistent memory JSON responses;
substring deduplication dropping a distinct memory; doctor reporting success
despite an inconclusive probe or unusable session storage; and false-positive
tool-capability reporting for wrong tools/invalid arguments.

An actual npm archive initially failed to start with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Clean JavaScript compilation
and archive-only distribution fix that failure. The installed command now
passes smoke tests and actual approved/denied writes against a deterministic
HTTP provider. The real-model repeatable script currently reports BLOCKED
because LM Studio is offline. Full evidence and open requirements are in
`FINAL_VALIDATION_2026-10-31.md`.
