# Final validation checkpoint — AgentHub CLI

Historical 129-test checkpoint. The later online Spark follow-up passed 134
automated tests and has passing evidence for 17 distinct real-model workflows
across two runs, plus an actual CLI JSON request. Current results and remaining
requirements are in `LIVE_RECHECK_2026-10-31.md` and
`REQUIREMENTS_GAPS_2026-10-31.md`. The offline status below is retained as history.

Date: 2026-10-31. Targets: Windows and Linux. All repository edits in this
checkpoint are confined to `AgentHub-CLI`, as requested by the user. No commit,
push, publishing, model download, model load, or system configuration change
was performed.

## Verified changes

| Problem reproduced before the fix | Current behavior and evidence |
|---|---|
| A model request could outlive the run budget and still complete | A run-wide abort signal stops waiting on the active request; late text is ignored; budget exhaustion is persisted as partial |
| A single model response could execute beyond the tool-call limit | Every call in the batch checks the remaining budget; unexecuted calls receive interruption placeholders so the stored session remains valid |
| An approval arriving after the deadline could create a file | Approval waits observe the per-call cancellation signal, cancellation is audited, late approval is ignored, and file writes check cancellation before effects |
| A partially reported usage object was marked fully reported | Usage events now mark estimates when either token counter is absent |
| Memory JSON mode printed human text on several operational paths | Duplicate, denied-secret, missing-entry and capacity results are JSON; distinct substring entries are preserved |
| Doctor could succeed with unavailable session storage or an inconclusive tool probe | Doctor exits nonzero for these failures; native tool probes validate the requested tool name and arguments |
| A real npm archive could not start under node_modules | A clean TypeScript build emits JavaScript and rewrites imports; the archive ships compiled files; the launcher invokes main in the same process |
| Package installation had only been checked as a source copy/link | The actual archive is installed into an isolated prefix with spaces; its generated command passes version/help/config and real file-write effects using a deterministic provider |

The regressions for the bugs above were executed against the previous behavior
and failed, then passed after the fixes. The archive failure was observed as
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` before compiled packaging.

## Results executed on Windows

| Check | Result |
|---|---|
| TypeScript typecheck | Passed |
| Full suite with coverage | 129 passed, 0 failed, 0 skipped |
| Line / branch / function coverage | 75.22% / 67.08% / 76.40% |
| Strict ESLint for src, tests, bin and scripts | Passed; shared Next config prints its pre-existing missing-pages notice |
| Clean compiled production build | Passed via the package verification command |
| Archive content allowlist | Passed; source/tests/scripts/private runtime folders excluded |
| Installed global-style command, isolated temp prefix | Passed version, help and JSON config |
| Installed command and tool execution | Denied write creates no file; explicitly approved write creates exact expected bytes; deterministic local provider |
| Headless interruption through the actual launcher | SIGINT event harness exits 3 and saves cancelled status; native physical signal delivery remains unverified |
| npm dependency audit | Zero known vulnerabilities in the locked dependency set |
| Fresh source copy with its own dependencies | npm ci, typechecking, all 129 tests and archive/install checks passed |
| Real LM Studio integration attempt | BLOCKED: connection to 127.0.0.1:1234/v1/models failed |
| Linux execution | BLOCKED: no installed WSL distribution; no Docker/Podman runtime found |
| Hosted Linux CI | Not run; the workflow is nested under the CLI folder and no root-level edit was authorized |

`npm run check:package` creates and removes its own temporary install prefix.
It does not modify the normal global command. `npm run check:local-model`
creates a separate temporary workspace/home and retains a JSON evidence report.
Its current run stopped at preflight; the later live stages have not passed in
this checkpoint. Earlier GPT-OSS and Qwen evidence remains in the live-model
report with its original configuration and dates.

The fresh-copy command log is retained at
`C:\Users\SACHIN\AppData\Local\Temp\agenthub-final-clean-61acb542518d4aa29dff7d63a4e474f0\verification.log`.

## Exact setup for blocked checks

For real model validation, start the LM Studio server at
`http://127.0.0.1:1234/v1` and load an already installed tool-capable model.
Then run from the CLI checkout:

```powershell
npm run check:local-model -- --model <loaded-model-id>
```

The script confirms a loaded model before inference. It exercises chat and
streaming, skill execution, a random-marker file read, approved and denied
writes, tool failure, and session/audit reload. It does not load or download a
model. The latest blocked evidence is at
`C:\Users\SACHIN\AppData\Local\Temp\agenthub-live-validation-5r9wbX\results.json`.

For Linux validation, use an existing Linux machine/environment with Node 24,
npm and Git, copy this checkout without node_modules/dist, then execute:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run test:coverage
npm run check:package
```

The Ubuntu workflow for a standalone CLI repository is
`.github/workflows/ci.yml`. A containing-repository version is prepared at
`docs/terminal-agent/ci-parent-workflow.yml`; the user requested keeping edits
inside the CLI folder, so it has not been placed at the parent root. No hosted
run or Linux result is claimed.

## Requirements still open

The previous “20% remaining” estimates were informal, not a counted acceptance
metric. The full master prompt is not complete. Remaining requests include:

- Automatic memory extraction, relevance scoring/retrieval, expiration and
  configurable memory budgets. Current storage is curated Markdown with
  exact deduplication, substring search, scope isolation and a 64 KB cap.
- Dependency-aware plan execution, configurable controlled parallelism,
  specialized agent pools, and durable recovery checkpoints. Current execution
  is sequential and bounded; subagents share the central policy.
- Independent verification of natural-language task fulfillment. Failures,
  denials, unfinished plans and a narrow tool-shaped-text case are detected;
  ordinary prose is not proof of completion.
- Real-model MCP/subagent workflows, a broader provider matrix, native terminal
  signal testing, stress/long-session tests and independent adversarial review.
- Configurable on-disk retention/pruning for backup files and historical data;
  existing backups are preserved and no automatic deletion was added.

Application-level shell classification, pattern-based redaction, unencrypted
local storage and the final filesystem check-to-write race remain documented
limitations. No claim of production readiness or full master-prompt completion
is made. The current readiness score remains 7/10 for a local developer preview.

## Files changed in this checkpoint

- `src/core/cancellation.ts` added; `src/core/run.ts`,
  `src/core/authorize.ts`, `src/tools/files.ts` updated for execution limits,
  cancellation and usage reporting.
- `src/cli/commands/memory.ts`, `src/cli/doctor.ts`,
  `src/providers/registry.ts` updated for automation and diagnostic correctness.
- `bin/agenthub.mjs`, `package.json`, `tsconfig.build.json`,
  `scripts/build.mjs`, `scripts/check-package.mjs` updated/added for packaging.
- `.gitignore` excludes generated npm tarballs as well as dist output.
- `scripts/check-local-model.mjs` added for explicit real integration checks.
- `tests/agent-loop.test.ts`, `tests/cli.test.ts` extended;
  `tests/memory.test.ts`, `tests/provider-capability.test.ts` added.
- `.github/workflows/ci.yml` extended with archive validation;
  `docs/terminal-agent/ci-parent-workflow.yml` prepared but not installed.
- `README.md`, architecture/development/installation/testing docs, engineering
  audit, continuation, known limitations, live-model report and readiness
  report updated. Historical reports were retained.

The containing repository's older working-tree manifest is historical. It was
not rewritten after the user's instruction to keep this checkpoint's edits
inside the CLI folder. Parent working-tree contents were preserved.
