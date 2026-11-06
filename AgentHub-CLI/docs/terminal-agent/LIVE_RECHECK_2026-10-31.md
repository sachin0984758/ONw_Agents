# Live local-model recheck — 2026-10-31

LM Studio was online at `http://127.0.0.1:1234/v1`. The already loaded model was
`spark-x2.6-4b`, with 11,264 loaded context tokens. No model was downloaded,
loaded, unloaded or switched. All test files, Git initialization, MCP fixture
processes, sessions and backups were confined to temporary directories.

## Real model results

The broad run passed 16 of 17 checks. Its MCP positive case was accidentally
configured with a denying approval broker; AgentHub correctly blocked that
call. A focused rerun with approval limited to the owned fixture server/tool
passed. Thus all 17 distinct checks have passing evidence across two runs;
this is not a claim of one uninterrupted 17/17 run.

| Check | Verified behavior |
|---|---|
| Chat and streaming | Actual model text arrived in streamed deltas |
| Skills | Native list_skills/read_skill calls; model returned a marker only present in the installed temporary skill |
| File read | Native read_file returned a randomly generated marker not included in the request |
| Approved file write | Approval requested before the file existed; write_file created exact expected bytes |
| Denied file write | Approval was denied; no file was created; the run was correctly partial |
| Tool failure | Missing-file read produced a real tool error and partial status |
| Session persistence and audit | Six turns reloaded with the active skill and approved/denied audit decisions |
| Session recall | Model returned the earlier file marker from reloaded history with no tools replayed |
| Approved shell command | Real run_command executed echo LIVE_COMMAND_OK; exit 0 and output verified |
| Denied shell command | No command execution evidence; partial status after denial |
| Edit and undo | Native read/edit/read calls changed exact bytes; BackupStore restored the original bytes |
| Directory listing and search | Native list_dir/search_files calls returned a random search marker |
| Planning | Native set_plan/update_plan calls persisted a completed step |
| Git inspection | Real git_status inspected the temporary repository; no staging or commits |
| MCP | Native mcp_list/mcp_call invoked a real stdio test server and returned a marker absent from the user request; server call log verified |
| Subagent | Real child model execution read the proof file; child result and parent answer included the marker |
| Cancellation | Aborting after a real streamed delta stopped the run and persisted cancelled status |

The approval decisions above were supplied through the real policy/broker
interface by a test broker. This does not claim fresh human keyboard approval
or native physical-terminal signal testing. MCP used an owned local test server;
the model provider was real throughout. Undo was checked through BackupStore,
not a fresh physical-terminal `/undo` interaction.

## Actual CLI launcher

A separate `node bin/agenthub.mjs --json ...` process selected Spark, streamed
events, called read_file, returned a random file marker and saved one completed
turn. Exit code was 0; every stdout line was JSON, with no ANSI decorations.
This used the actual CLI configuration/discovery/launcher path.

## Evidence locations

- Initial run: `C:\Users\SACHIN\AppData\Local\Temp\agenthub-live-validation-OfqRCx\results.json`.
  Chat, skill, read and approved-write checks passed; the denied-write request
  timed out before proposing a tool. That timeout is retained as a failure;
  its precise latency cause was not isolated.
- Broad run: `C:\Users\SACHIN\AppData\Local\Temp\agenthub-live-validation-9yePPh\results.json`.
  Sixteen checks passed; the MCP call was denied by the test broker.
- Focused approved MCP rerun: `C:\Users\SACHIN\AppData\Local\Temp\agenthub-live-validation-vmnz3J\results.json`.
  The positive MCP check passed.
- CLI launcher: `C:\Users\SACHIN\AppData\Local\Temp\agenthub-live-cli-78120c248b234253b95c7030d19e3bb2\results.json`,
  with events.jsonl and the stored session alongside it.

The script can reproduce the full run:

```powershell
npm run check:local-model -- --model spark-x2.6-4b --extended
```

A focused MCP check uses `--extended --only "real-model MCP discovery and call"`.
Failures are recorded and subsequent cases continue. The script does not turn
a failed or unavailable check into a passing result.

The final `doctor --json --probe` also passed with native `get_clock` support
and reported the loaded 11,264-token context. A persistent summary is saved at
`SPARK_LIVE_RESULTS_2026-10-31.json`; it retains the broad run's 16 PASS / 1 FAIL
and the focused approved MCP PASS rather than rewriting the original outcome.

## Automated checks after the source fixes

Typechecking and strict lint passed. The full suite passed 134/134 tests with
zero skips; line/branch/function coverage was 75.94% / 67.66% / 76.87%. The
compiled package/archive and isolated installed-command checks also passed.
No owned MCP fixture processes remained after validation. No files were staged,
committed or pushed.

Changed application files: `src/providers/openai.ts`, `src/core/run.ts`,
`src/context/budget.ts`, and the stale build note in `src/cli/help.ts`.
Regressions were added in `tests/providers.test.ts`, `tests/agent-loop.test.ts`
and `tests/context.test.ts`. The explicit live script was extended to cover the
remaining implemented workflows and support focused reruns. Current testing,
audit, readiness, continuation and limitation documents were updated while
retaining historical records.

## Source defects found and fixed during this review

- LM Studio discovery preferred theoretical maximum context over the actual
  loaded context. It now uses the positive loaded limit for loaded models.
- The run loop did not account for tool definitions and response reserve when
  budgeting context. It now trims against an effective message budget capped
  by the discovered limit, and refuses an oversized protected prompt.
- Context trimming could remove the current user task after several tool
  groups. It now protects both the first and latest user messages.
- A token-limited answer could be marked completed, and a token-limited tool
  batch could still mutate a file. Both now stop as partial; calls from a
  truncated batch are not executed.

Regressions were observed failing before the fixes, then passing. Token
estimates remain approximate; these controls are not a guarantee for every
provider tokenizer or template.

## What remains absent or unverified

`REQUIREMENTS_GAPS_2026-10-31.md` lists source-confirmed implementation gaps.
Automatic memory extraction/relevance/expiration, dependency-aware plans,
controlled parallel scheduling, crash-recovery journals and automatic semantic
completion verification are not supplied by a successful live test. Linux,
broader provider coverage, native terminal signaling and stress/security review
remain unverified. These results do not establish production readiness.
