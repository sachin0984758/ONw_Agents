# Testing and verification

## Current checkpoint — 2026-11-01

Typecheck passes; coverage suite passes 150/150 tests with zero skips. Coverage
is 77.70% lines, 69.75% branches and 78.93% functions. The 134-test snapshot
below is historical. New feature-specific tests and live LM Studio results are
in `REMAINING_FEATURES_2026-11-01.md`.

## Current engineering follow-up (2026-10-31)

After the initial 85-test audit baseline, the execution and policy review added
regressions for timeout cancellation, preventing false completion after tool or
session-save failures, subagent cancellation propagation, Git global-option
policy checks, combined shell output limits, memory commands, history
redaction, child environment filtering, guarded undo, provider stream failures,
MCP shutdown, persisted audit decisions and outcomes, and explicit unfinished-
plan status handling. TypeScript and the coverage suite pass
**134/134 tests**, with zero skips. See
`ENGINEERING_AUDIT.md` and `PRODUCTION_READINESS_REPORT.md` for
the current findings and remaining limits.

Testing is split into deterministic automated tests and explicit live checks
against a real local model. Static checks and compilation are not treated as
proof that the agent works.

## Automated suite

```powershell
npm run typecheck   # tsc --noEmit
npm test            # node --test "tests/**/*.test.ts"
npm run test:coverage # same suite with Node's built-in coverage summary
npm run check       # both
npm run build       # compiled JavaScript for package installation
npm run check:package # archive and installed-command validation in a temp prefix
npm run check:local-model -- --model <loaded-model-id> # explicit real-model check
```

Last verified: **2026-10-31**, Node v24.18.0, Windows x64.

```
tests 134
pass 134
fail 0
skipped 0
typecheck: 0 errors
```

Latest coverage run: **75.94% lines, 67.66% branches, 76.87% functions** across
the files loaded by the suite. This summary is informational and does not yet
enforce a minimum threshold; the terminal output lists uncovered lines to help
target additional tests in security- and execution-critical modules.

`npm run test:coverage` runs the same deterministic suite with Node's built-in
V8 coverage reporter. It reports line, branch, and function coverage to the
terminal; it does not write generated coverage files into the repository.

### Automated coverage

| File | Tests | Coverage |
|------|-------|----------|
| `tests/backups.test.ts` | 5 | verified undo, preservation of edited files, tampered/legacy backup refusal, corrupt index failure |
| `tests/file-tools.test.ts` | 4 | stale approval abort, CRLF-preserving edit and undo, policy-denied write leaves no change, ambiguous edit refusal and explicit replace-all |
| `tests/args.test.ts` | 9 | defaults, `--json` implying non-interactive, skills flags, numeric validation, values starting with `-`, unknown flags, `--`, `--resume last`, global flags before the command |
| `tests/cli.test.ts` | 6 | exit-code mapping, doctor failure on an inconclusive probe or blocked session storage, headless SIGINT event through the real launcher and saved cancellation, print/JSON output, denied write exit and no file creation |
| `tests/terminal-ui.test.ts` | 20 | compact composer and spacing, editing/history, long and wide input, narrow status rows, resize, shortcuts, approval cancellation, EOF/cleanup, startup resource accuracy, blue rows, styled transcript wrapping, scrollback/jump, draft clear/exit, activity timer cleanup, input preservation during animation, ASCII activity, slash filtering/exact matching, keyboard selection/completion/submission, picker dismissal/paging/resize and prompt isolation |
| `tests/activity.test.ts` | 3 | agent-loop events drive model/tool/approval/completion phases; cancellation resists late events; planning, delegation, denial, failure, incomplete states |
| `tests/slash-commands.test.ts` | 8 | all 18 commands through the actual TUI; memory list/search/delete for project and user scope; real Git diff, file restore, skills, session save/resume/compact; HTTP provider switching; invalid selection rollback; plan titles; cumulative usage; empty/error states; permission validation; duplicate skills; backup boundaries; persistence failure exit status |
| `tests/config.test.ts` | 4 | workspace config can tighten but not loosen; CLI precedence and cloud staying off; user-only MCP config; invalid MCP definitions rejected |
| `tests/policy.test.ts` | 8 | traversal/absolute escapes, symlink/junction escape, secret names, hard denies under `bypass`, read-only mode, ask mode, custom deny rules, command classification |
| `tests/providers.test.ts` | 5 | SSE text streaming, tool-call assembly, usage, CRLF/multi-line data, malformed events, stream errors, effective loaded LM Studio context |
| `tests/provider-retry.test.ts` | 7 | retry after HTTP 500 and before-output timeout; auth errors do not retry or leak keys; partial timeout/disconnect and cancellation do not replay text; model-discovery body timeout |
| `tests/context.test.ts` | 6 | secret/history redaction, context trimming preserving the system/first/current tasks, compaction without orphan tool results, colour override |
| `tests/skills.test.ts` | 5 | strict frontmatter, install + discovery, symlink escape, staged update/compatibility/rollback with no scripts, activation cannot add permissions |
| `tests/agent-loop.test.ts` | 19 | tool execution and evidence; global deadline; late output/approval; batch cap; partial token reporting; protected context refuses oversized requests; token-truncated answers/batches cannot complete or write; audit; failures; plans; cancellation; resume |
| `tests/memory.test.ts` | 3 | JSON on duplicates, rejection, missing entries and size failure; exact deduplication; file preservation at capacity |
| `tests/provider-capability.test.ts` | 2 | requested probe tool and argument validation; valid native tool result |
| `tests/git-tools.test.ts` | 2 | temporary repository branch/show, denied and approved stage/commit, path-option injection rejection, and refusal to commit staged changes outside a nested workspace |
| `tests/persistence.test.ts` | 4 | deep redaction of transcript/tool arguments/ledger/audit/title with recovery; bounded audit and legacy-session compatibility; plan/status restore without replay; corrupt/malformed sessions fail clearly and list safely |
| `tests/mcp-subagent.test.ts` | 8 | ambient credential filtering with explicit server env preservation; pending requests are rejected on close; real stdio MCP initialization/list/call through policy; schema rejection and safe connection failure; read-only policy; independent child agent, events, session, evidence merge |
| `tests/markdown.test.ts` | 3 | streaming headings/lists/fences/diffs without cursor control; ASCII rendering; partial-line flush and unterminated fence |
| `tests/shell.test.ts` | 3 | common credential-name filtering, spawned child environment, combined stdout/stderr byte cap |

Deterministic tests use temporary workspaces and mock providers. The only socket
tests bind `127.0.0.1` with an ephemeral port and close the server in `finally`.
No test needs network access or a model.

### Clean-install verification

On 2026-10-21 the project was copied to a fresh temporary directory without
`node_modules`, `.agenthub`, or `.git`, then verified with:

```powershell
npm ci
npm run check
node src/cli/main.ts --version
node src/cli/main.ts config --json
```

Result: 3 packages installed, 0 vulnerabilities, typecheck 0 errors, 55/55 tests
passed, version `0.1.0`, and valid JSON configuration. This was a local Windows
clean install, not a hosted CI run.

### Current-source clean-copy verification — 2026-10-31

The current CLI snapshot was copied to a new Windows temporary directory,
excluding `node_modules` and `.agenthub`, then checked with:

```powershell
npm ci --ignore-scripts
npm run check
node src/cli/main.ts --version
node src/cli/main.ts config --json
```

Three locked packages installed; npm reported zero known vulnerabilities.
TypeScript passed, all 117 tests passed with no skips, the version printed
`0.1.0`, and config output was valid JSON. This confirms a clean current-source
copy on Windows with Node 24.18.0. It does not validate a global package
installation or Linux. Linux validation is pending because this host has no
usable WSL distribution. The Ubuntu workflow is nested under `AgentHub-CLI`,
which has no independent Git root, so hosted CI has not run.

### Final archive validation — 2026-10-31

`npm run check:package` passed on Windows/Node 24.18.0 after the package build
was added. The earlier archive failed with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`; it now ships compiled `dist/`
instead of TypeScript source. The test builds and packs the CLI, verifies the
file allowlist, installs to a fresh prefix with spaces, then invokes the actual
generated command. Version, help, JSON configuration, a denied write with no
file created, and an approved write with exact file bytes all passed. The tool
workflow here uses a deterministic local HTTP provider, not a real model.

The 129-test suite and TypeScript check passed on the source snapshot. Strict
lint passed for `src`, `tests`, `bin`, and `scripts`; npm audit reported zero
known vulnerabilities. The older clean-copy result above is historical and
has not been relabeled as the newer snapshot. A subsequent fresh copy with its
own `npm ci --ignore-scripts` dependencies passed `npm run check` with 129/129
tests and `npm run check:package`; its evidence path is recorded in
`FINAL_VALIDATION_2026-10-31.md`.

At that earlier checkpoint, `npm run check:local-model` reported BLOCKED because LM Studio
was unreachable at `http://127.0.0.1:1234/v1/models`. It did not download or load
a model. Once an installed tool-capable model is loaded, this command checks
real chat/streaming, skills, file reads, approved/denied writes, tool failure,
and persisted sessions/audits in temporary directories. The extended Spark
recheck now has passing evidence for 17 distinct workflows across two runs,
including real MCP/subagent calls, commands, editing/undo, search, planning,
Git status and runtime cancellation. A separate real CLI JSON/file request
passed too. See `LIVE_RECHECK_2026-10-31.md`; native physical signal delivery
remains unverified.

### Integration behavior proven by fakes

- The model requests `read_file` and receives the real file content.
- The model requests `write_file`; policy and approval run before the file is
  touched.
- An approved write creates the file and records changed-file evidence.
- A denied shell/write returns a tool error and creates no file/command evidence.
- Cancellation aborts the provider request and stores `cancelled`.
- A resumed session includes prior turns in the new request and does not replay
  prior tool calls.
- A failed tool is returned to the model instead of crashing the loop.
- A persisted transcript keeps valid JSON after deep redaction and can be
  resumed without replaying prior tools.
- Plan steps and run status survive save/load; a resumed run emits the restored
  plan and sends only one new provider request.
- Corrupt JSON and invalid message shapes are rejected without modifying the
  file; `sessions list` skips them and still lists healthy sessions.
- A real stdio MCP fixture server is initialized and called. Schema-invalid
  arguments never reach approval. A missing executable fails safely.
- MCP read-only policy allows only self-declared read-only tools.
- A child agent writes a file, gets its own persisted session, emits
  start/progress/completion events, and merges changed-file evidence into the
  parent.

## Live model verification

Latest check with the user's currently loaded models:
[2026-10-31 loaded-model results](LOADED_MODEL_LIVE_2026-10-31.md). GPT-OSS 20B
executed real reads and an approved write; denial prevented a second file.
Qwen2.5-Coder 3B streamed plain chat but emitted tool JSON as ordinary text,
so its coding-agent tool workflow did not pass in the tested configuration.
The older verification matrix below is retained with its original context.

Environment:

| Item | Value |
|------|-------|
| Provider | LM Studio |
| Endpoint | `http://127.0.0.1:1234/v1` |
| Model | `gpt-oss-20b` |
| Loaded context | 131,072 |
| Tool probe | `supported` (returned `get_clock`) |
| AgentHub app | `http://127.0.0.1:3000`, reachable |

Commands and results:

| Check | Command | Result |
|-------|---------|--------|
| Smoke answer | `--print "Reply with exactly AGENTHUB_SMOKE_OK"` | correct answer |
| Read tool | `--json "Read package.json ... report name"` | `read_file` executed, `AgentHub-CLI`, exit 0 |
| Write tool | `--json --yes "Use write_file to create ..."` | file created, evidence listed, exit 0 |
| Denial | `--json` write without `--yes` | `write_file` denied, no file, exit 4 (`partial`) |
| Resume | `--resume last --json "..."` | 1 step, prior transcript present, no tool replay, exit 0 |
| Skill activation | `--json --yes "Call list_skills ... read_skill ..."` | `list_skills` → `read_skill`, full instructions in the request, heading quoted correctly |
| Doctor JSON | `--json doctor` | valid JSON, selected `lmstudio / gpt-oss-20b`, exit 0 |
| Models | `models` | listed loaded `gpt-oss-20b` at 131k ctx, skipped cloud, exit 0 |
| Tool probe | `doctor --probe` | `supported`, exact model recorded, exit 0 |
| Usage error | `--max-steps 0` | clear message, exit 2 |

Token usage from LM Studio was not reported, so runs correctly showed
"Token usage is estimated". It was never presented as billing data.

## Current TUI verification (2026-10-31)

The compact composer, command picker, startup summary, and activity indicator
have twenty-three regression tests. `npm run check` currently passes typechecking
and 85 tests, with zero skips. The tests cover editing/history, long and wide input,
narrow status rows, resize/input preservation, shortcuts, approval cancellation,
EOF, cleanup, accurate resource summaries, and event-driven activity states.
Controlled timer tests verify that animation touches only the top input border,
preserves approval input/cursor position, and stops after completion or close.
Command tests drive actual key sequences through the editor, including Tab,
Enter, arrows, and Escape. They verify that exact `/skill` does not execute
`/skills`, arguments remain editable, and menus stay out of approval prompts.

Seven additional command integration tests run the real TUI with injected
terminal streams. They invoke every catalog entry and inspect the resulting
filesystem, stored session, configuration, and HTTP provider requests. Mock
model responses are confined to deterministic tests; the live verification
record distinguishes these from LM Studio results.

See [the current live verification record](TUI_REFRESH_2026-10-31.md) for the
Windows terminal and LM Studio checks. The interactive view now emits cursor
controls even with `--no-color`; the option disables text color only.

## Historical TUI verification (2026-10-21)

The following records describe the earlier line-oriented UI, before the fixed
bottom composer was introduced. They are preserved as historical evidence.

The readline TUI was driven through a real Windows pseudo-terminal
(`pywinpty`, installed only as a temporary verification tool). This is not a
project dependency.

Verified:

- banner shows workspace, model, mode;
- `/help`, `/status`, `/skills` render correctly;
- a real model task completes and prints the evidence footer;
- an approval prompt appears for `write_file`, including risk, path, reason and
  diff; answering `y` creates the file; status `completed`;
- Ctrl+C during a run cancels it, signs the tool result as cancelled, saves the
  session, and returns to the prompt;
- Ctrl+C while idle exits gracefully with "Session saved. Goodbye.";
- `/quit` exits and the process returns to the shell;
- no raw-mode leak: the application does not leave the terminal in a hidden
  cursor/alternate-screen state (it does not enter one).

Resize behavior: the TUI is line-oriented and lets the terminal wrap/reflow; it
does not implement a full-screen alternate buffer. Resize flushes a partial
Markdown line; this was exercised through a real Windows pseudo-terminal.

### Live Windows PTY verification

On 2026-10-21 a real Windows pseudo-terminal was created with Python `pywinpty`
3.1.0. A temporary local OpenAI-compatible mock provider streamed a Markdown
answer containing a heading, bold/inline code, a bullet list, a fenced
TypeScript block, and a unified diff. The harness:

1. started the TUI with `--ascii --no-color` and an isolated `AGENTHUB_HOME`;
2. entered a two-line task using the trailing-backslash continuation;
3. changed the PTY window size from 30×100 to 35×120 during the stream;
4. sent `/quit` and required a clean exit status 0.

Observed: heading and list rendered, code fence and diff colored/styled without
raw ``` fences, `PTY-MARKDOWN-OK` appeared, the mock server received both task
lines, the process exited cleanly, and the captured ASCII-mode output contained
**no non-ASCII characters and no ANSI escape sequences**. This proves the
Markdown renderer, multiline input, resize flush, and normal TUI cleanup in a
real terminal. It does not prove every terminal emulator, the long-running
progress line, or cancellation cleanup; those remain separate checks.

## Skills verification

- `skills check --repo https://github.com/anthropics/skills` listed 20 candidates
  and exited 0 with guidance to use `--dir`.
- `--dir skills/docx` produced the app scanner report; overall `incompatible`
  now exits 1 (before the fix it exited 0).
- `--json` report included source commit, revision key, environment fingerprint,
  and per-category statuses.
- Installed `slack-gif-creator` from the same repository at commit
  `dbd4588f9e1033efb41dad4bef2f7947c8993d44` (7 files, 43.9 KB).
- `skills list`, `inspect`, and static `check` worked; the skill was
  `needs-review` because it ships four Python scripts. Nothing executed them.
- Reinstall after the `--dir` bug fix selected only that subtree; install
  recorded the commit and did not invoke a package manager.
- `skills remove` required `--yes` and left a timestamped backup.
- Live activation used the real model path, not just parsing.
- Deterministic update coverage installs a local skill, previews an update
  (`--dry-run`), verifies added/modified/removed summaries, applies it with a
  backup, confirms policy mode/rules are unchanged, confirms no script ran, and
  rolls back to the previous files and metadata.
- A skill containing `allowed-tools: [bash]`, a bypass instruction, and an
  executable script was activated through `read_skill`; no script ran and the
  permission mode stayed `ask`.

## Sessions, memory, backups

- `sessions show last` displayed turns, usage, tool calls, and status.
- Session save/load tests prove tool-call arguments, titles, and ledger commands
  are redacted while remaining valid JSON, and that restored plans preserve step
  status without replaying tools.
- `sessions remove <id> --yes` moved a backup JSON to
  `~/.agenthub/backups/sessions/`.
- `memory add "..."` wrote a project bullet; `memory list` showed it;
  `memory remove 1` removed it.
- `memory add "API key sk-..."` was refused as secret-like.
- Pre-write backups were listed in evidence and `/undo` is wired to the most
  recent backup.
- Resume worked after adding a second turn; no destructive call replayed.

## Existing AgentHub application regression

The web application was not intentionally modified for the terminal release, but
its uncommitted Skills compatibility work is the adapter dependency. Verified in
`C:\Users\SACHIN\Desktop\agent-session-project`:

| Check | Result |
|-------|--------|
| `npm run check:skills` | 172 passed, 0 failed |
| `npm run check:agent-session` | 455 passed, 0 failed |
| `npm run check:sessions-layout` | 54 passed, 0 failed |
| `npm run check:deep-links` | 15 passed, 0 failed |
| `npx tsc --noEmit` | 0 errors |
| `npx next build` | succeeded, all routes compiled |

`npm run build` itself still ends with Unix `cp` commands that fail on
Windows/PowerShell. This is pre-existing and unrelated to the terminal project;
`npx next build` verifies the production compilation. The script was left
unchanged to avoid an unrelated edit.

All application changes remain uncommitted and unpushed.

## Exit codes exercised

| Code | Live check | Result |
|------|------------|--------|
| 0 | successful `--print`, `doctor`, `models`, `skills check` (compatible/guidance) | pass |
| 1 | `skills check --repo ... --dir skills/docx` (`incompatible`) | pass |
| 2 | `--max-steps 0` | pass |
| 3 | unit mapping `cancelled → 3`; TUI cancellation path | mapped/tested |
| 4 | denied write in `--json` mode | pass |

Exit code 3 is covered by mapping, TUI cancellation and a headless SIGINT event
harness through the real launcher. Physical OS signal delivery remains unverified.

## What is not covered

- OS-level sandboxing (the product explicitly does not claim it).
- Cloud providers (no consent/key configured; intentionally skipped).
- Every model and provider. LM Studio is the verified live provider.
- Broad external MCP/subagent deployments. Spark passed the owned stdio fixture
  and live child-agent workflow; a physical-terminal TUI exercise is not claimed.
- Hosted CI. The workflow exists but has not run because the project has no Git
  repository or remote.
- Install/update from every Git host. GitHub and local directories were tested.
- Exhaustive shell-injection bypass analysis. The classifier is defence in
  depth, not a proof.
- Long-running multi-hour sessions and very large repositories.
- Interactive approval of every tool type. Write approval was verified; command
  approval uses the same broker and was verified with a fake.

## Reproducing the verification

```powershell
cd C:\Users\SACHIN\Desktop\AgentHub-CLI
npm install
npm run check

lms server start
lms load gpt-oss-20b --context-length 131072 --gpu max --ttl 3600
node src/cli/main.ts doctor --probe
node src/cli/main.ts --print "Reply with exactly READY"
node src/cli/main.ts --json --yes "Use write_file to create verify.txt containing: ok"
node src/cli/main.ts skills update <installed-skill> --dry-run

cd C:\Users\SACHIN\Desktop\agent-session-project
npm run check:skills
npm run check:agent-session
npx next build
```

Remove any verification files created in the workspace afterward. The test
suite itself always cleans its temporary directories.
