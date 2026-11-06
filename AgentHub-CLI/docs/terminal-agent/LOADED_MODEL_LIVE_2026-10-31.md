# Loaded-model live verification — 2026-10-31

The later online Spark recheck is recorded in `LIVE_RECHECK_2026-10-31.md`:
17 distinct workflows have passing evidence across a broad run and a focused
approved-MCP rerun, plus a separate actual CLI request. Earlier evidence and
the intervening offline preflight remain below as historical records.

The user requested testing with the models already loaded in LM Studio. No
models were downloaded, loaded by explicit command, unloaded, or reconfigured.
No software was installed. Application code was not changed for this check.

## Environment and method

LM Studio at `http://127.0.0.1:1234/api/v0/models` reported:

| Model | State | Loaded context |
|-------|-------|----------------|
| `qwen2.5-coder-3b-instruct` (Q8_0) | loaded | 32,768 |
| `gpt-oss-20b` (MXFP4) | loaded | 8,192 |

Tests used the globally linked `agenthub` command in a Windows pseudo-terminal,
with a temporary workspace/home and `ask` permissions. Model selection used
`/model`; skills used `/skill`. Real model responses, stored tool calls/results,
and file bytes were inspected. No mock responses were used.

Evidence root:
`C:\Users\SACHIN\AppData\Local\Temp\agenthub-loaded-f73fc6f4823b42498c4a6238d24915f1`

The workspace contained `proof.txt` with the randomly generated marker
`MODEL_FILE_128a34685696`. The marker was not included in the model's read
request. A temporary `live-check` skill instructed the model to return
`SKILL_LIVE_READY` when asked to prove activation.

## Qwen2.5-Coder 3B

Session: `ses_mvwghsjd_2jjtve`.

- Connection and streamed text succeeded. A separate no-tools request through
  AgentHub's real provider adapter returned exactly `QWEN_CHAT_OK` in five text
  chunks (`qwen-chat.json` under the evidence root).
- `/model qwen2.5-coder-3b-instruct` selected the model; `/skill live-check`
  loaded and saved its instruction text.
- The skill-response task failed: the model returned a fenced JSON example
  naming `list_skills`, not the required marker and not a native tool call.
- The file-read task failed: the model returned fenced JSON naming `read_file`
  and `proof.txt`. No tool executed and the random file marker was not read.
- A separate tool-use probe returned fenced `get_clock` JSON as ordinary text.
  Probe result: `inconclusive`, stored in `qwen-probe.json`.

This verifies plain chat connectivity, not the coding-agent tool workflow for
this model/configuration. The cause has not been isolated between model
behavior and LM Studio's selected chat template/tool configuration. Native
tool calls were absent in both the agent session and the minimal probe.

AgentHub currently labels such text-only turns Completed because the provider
ended its answer normally. This does not mean the requested file operation
completed. Arbitrary JSON in answer text was not executed as a command.

## GPT-OSS 20B

Session: `ses_mvwgjb7u_8bjwra` (created with `/clear`, then switched to GPT-OSS).

- Skill response passed: actual answer exactly `SKILL_LIVE_READY`.
- File read passed: native `read_file` calls executed and returned the random
  marker. The final answer contained `MODEL_FILE_128a34685696`.
- Approved file write passed: `approved.txt` did not exist while Waiting for
  approval was displayed. Answering `y` executed `write_file`; direct filesystem
  inspection confirmed exact content `APPROVAL_LIVE_OK`. The run completed.
- The model repeated both the read and the write once. The repeated write was
  a no-op because the file already had the requested contents. These runs
  demonstrate working tools, but not optimal model efficiency.

- Denied write passed: the real model requested `write_file` for `denied.txt`.
  Answering `n` returned `ERROR: The user denied this action.` to the model. It
  stopped without retrying; the run was persisted as `partial` and the UI showed
  Incomplete. Filesystem inspection confirmed that `denied.txt` did not exist.
- `/quit` saved and exited 0. A fresh global-command process with `--resume
  ses_mvwgjb7u_8bjwra` restored four turns, usage, the active skill, and the
  previous partial status. Before the next request, the transcript contained
  five historical tool calls; none ran merely because the session resumed.
- Conversation recall passed after restarting: the model returned exactly
  `MODEL_FILE_128a34685696` from saved history without rereading the file. The
  stored tool-call count remained five.
- Cancellation passed: Escape while a new model request showed Thinking
  interrupted it and returned to usable input with Cancelled. Stored status
  was `cancelled`; the session contained six turns. `/status` worked afterward,
  and `/quit` saved and exited 0 again.

Final result: GPT-OSS passed this local-model-to-agent-to-tool check. Qwen
passed basic chat but failed the agent tool/skill tasks in the tested setup.
These results do not establish that Qwen can never support tools; only that
the current model/template configuration did not emit native tool calls.

## Scope

This is a live verification record for these loaded models and this local
configuration. It does not replace the existing deterministic test suite or
claim that every model supports the agent workflow. Estimated token usage is
not provider-reported usage. All test writes were confined to the temporary
workspace and AgentHub home; existing user sessions and project files were
preserved.

## Follow-up live recheck — 2026-10-31

Immediately before this check, `agenthub doctor` reached LM Studio at
`http://127.0.0.1:1234/v1` and listed seven models. Only
`qwen2.5-coder-3b-instruct` was loaded (32,768 context); GPT-OSS 20B and the
other listed models were not loaded. No model was downloaded or switched.

A fresh `runAgent` session used the real LM Studio provider adapter and a
random marker in a temporary workspace, with `read-only` permissions. Qwen
streamed 83 characters, but proposed no tool calls, never started `read_file`,
and did not return the marker. No tool result or error event occurred. The run
reported `completed` even though the requested file read did not happen. The
session was saved and reloaded with one turn. Since no operation was attempted,
the persisted audit correctly had zero entries.

This recheck confirms current Qwen chat connectivity and session persistence;
it does not pass the model-to-tool workflow. The earlier GPT-OSS workflow
evidence above remains valid for its prior loaded configuration, but GPT-OSS
was not loaded during this recheck. AgentHub's normal completion status still
does not verify that a natural-language request was semantically fulfilled.

## CLI doctor probe — 2026-10-31 15:17 UTC

Ran `node bin/agenthub.mjs doctor --json --probe --provider lmstudio
--model qwen2.5-coder-3b-instruct` against the live local server. The command
exited 0, LM Studio discovery succeeded, and seven models were listed; only
Qwen2.5-Coder 3B was loaded with 32,768 context. Cloud access remained off and
the permission mode was `ask`.

The real tool probe was **inconclusive**: Qwen returned fenced JSON describing
a `get_clock` call as ordinary text. AgentHub did not execute a tool. The
doctor's overall `ok: true` means the workspace and selected provider/model
were available; it does not mean tool calling passed. Ollama, the configured
custom endpoint, and the AgentHub web app's skills endpoint were unreachable
during this probe. No model was downloaded or switched.

## Live CLI request after the partial-status guard — 2026-10-31

Ran the actual CLI with Qwen, `read-only` permissions, and an isolated temporary
workspace/home. `proof.txt` contained a random marker. The direct request was to
read that file and return its contents exactly. Qwen returned a fenced JSON
object naming `read_file` as ordinary assistant text; the provider emitted no
native tool call. AgentHub started zero tools, returned no file marker, and left
the file unchanged.

The live `run_completed` event and persisted session now both report `partial`;
the limitation says the model returned a tool-shaped response as text and no
tool was executed. The CLI exited with code 4. The session contains one turn
and an empty tool audit, consistent with no operation being attempted. This
verifies honest handling of this specific model failure; it does not make Qwen
tool-capable or prove the request succeeded.

## Latest integration preflight — 2026-10-31

The new repeatable `npm run check:local-model` command was executed after the
execution-budget and archive fixes. It stopped with status BLOCKED because
`http://127.0.0.1:1234/v1/models` was unreachable. No model was loaded,
downloaded, or selected for inference. Evidence is saved in
`C:\Users\SACHIN\AppData\Local\Temp\agenthub-live-validation-5r9wbX\results.json`.

The six subsequent live test stages in that command were not run. Historical
GPT-OSS/Qwen results above retain their original scope. The diagnostic command
now also exits nonzero when an explicitly requested native tool probe is
inconclusive or session storage is unusable; a reachable model alone is no
longer sufficient for `doctor --probe` success.
