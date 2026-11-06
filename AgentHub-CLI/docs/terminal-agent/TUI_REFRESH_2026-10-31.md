# Terminal interface refresh — 2026-10-31

The global `agenthub` command now opens the AgentHub terminal interface with a
compact banner, real skill summaries, a bordered prompt anchored to the bottom,
and workspace, token usage, permission mode, provider, and model status. The
layout follows the supplied terminal reference using AgentHub branding.

## Implementation

- `src/cli/terminal-ui.ts`: scrolling transcript region, five-row composer,
  horizontal scrolling for long input, width-aware status, resize replay,
  readline editing/history, Escape, Ctrl+O, approval cancellation, and cleanup.
- `src/cli/startup.ts`: versioned banner; valid, unshadowed discovered skills;
  explicitly configured MCP server IDs. Resource summaries shorten to fit a
  standard terminal; `/skills` retains the full list.
- `src/cli/tui.ts`: routes event and command output through the screen, supplies
  current status, and passes the run cancellation signal to approval input.
  Estimated token counts have a `~` prefix. Restored counts use the same marker
  because the existing stored session format does not record reporting quality.
- `tests/terminal-ui.test.ts`: eight regression tests for layout/input behavior.
- Documentation changed: `README.md`, `docs/terminal-agent/INSTALLATION.md`,
  `ARCHITECTURE.md`, `KNOWN_LIMITATIONS.md`, `TESTING.md`, and this record.

No runtime dependency was added. The agent loop, tool policy, provider protocol,
session format, web application, and existing audit reports were preserved.

## Global command

Ran `npm link --offline --ignore-scripts --no-audit --no-fund` in this package.
The npm junction at
`C:\Users\SACHIN\AppData\Roaming\npm\node_modules\AgentHub-CLI` now targets
`C:\Users\SACHIN\OneDrive\Desktop\Test\AgentHub-CLI`.

Its previous target, `C:\Users\SACHIN\Desktop\AgentHub-CLI`, still exists.
The change replaced the command link; the older source folder was retained.
`agenthub --version` returns `0.1.0`, and `agenthub --help` succeeds.

Run `agenthub` in the folder you want it to work on, or pass `--workspace`.

## Automated verification

Environment: Windows x64, Node `v24.18.0`.

| Check | Verified result |
| --- | --- |
| `npm run check` in `AgentHub-CLI` | Typecheck passes; 63 tests pass; 0 failures, 0 skips |
| Root ESLint on the three changed CLI source files and new test file with `--max-warnings 0` | Exit 0, no warnings |
| Global launcher resolution | Junction points to this workspace; version/help work |

The new tests exercise long/wide input, narrow rows, actual readline cursor
editing and history, preserving input during resize/background output, shortcut
handlers, cancelled approval input followed by a fresh task, EOF/raw-mode
cleanup, resource filtering, control characters in status text, and a large
skill inventory that must fit above the composer in a 24-row window.

## Live Windows terminal and LM Studio verification

Used real Windows pseudo-terminal processes. No model responses were mocked in
the following checks. LM Studio was reachable at `http://127.0.0.1:1234`; its
existing cached `gpt-oss-20b` model loaded on the first request. The model API
then reported `state: loaded`, `loaded_context_length: 8192`. No model download
or software installation was performed.

| Check | Evidence |
| --- | --- |
| Normal `agenthub` startup from the repository | AgentHub banner, discovered skill names, `ask` mode, current workspace, and `(lmstudio) gpt-oss-20b` displayed |
| Real streamed response and file read | Model called `read_file` on `sample.txt`; its response included `AGENTHUB_TUI_FILE_OK`; completed in 3 steps |
| Persistence/resume | Restarted through the global command with `--resume last`; same session ID, prior completed status, and prior counts displayed |
| Cancel pending approval | Model proposed `write_file`; Escape cancelled the run, returned to the composer, and `approval.txt` did not exist |
| Approve a real write | A subsequent `write_file` proposal displayed the permission prompt; answering `y` created `approval.txt`; independently read bytes equal `AGENTHUB_TUI_APPROVAL_OK` |
| Model response after write | Model reported the file was created; persisted tool result records `Created approval.txt (24 B, +1/-1 lines)` |
| Ctrl+O and `/status` | Tool details toggled on; footer and status reflected the active session/model/mode |
| `/quit`, idle Ctrl+C, idle Ctrl+D | Processes exited 0; readline restored raw mode and the screen restored its cursor/scroll region |
| One-shot output | Real `--print` request returned `AGENTHUB_PRINT_OK`, completed in 1 step, exit 0 |

File operations used the temporary workspace
`C:\Users\SACHIN\AppData\Local\Temp\agenthub-tui-54365cf4e2484a51820e4ac0f08c482a\workspace`.
The live session record is
`C:\Users\SACHIN\AppData\Local\Temp\agenthub-tui-54365cf4e2484a51820e4ac0f08c482a\home\sessions\ses_mvw4xfqf_3pnyqj.json`.
It ends `completed`, with four turns, the read results, the cancelled write, and
the approved write recorded. Temporary fixture evidence was retained for review.

## Limits of this verification

- Resize and Unicode editing were exercised through automated terminal streams;
  a user-visible terminal window resize was not manually inspected this turn.
- The reference's Pi branding, extensions, update alert, and context percentage
  were not copied. Only AgentHub's real resources and known usage are shown.
- Token counts were estimated because this LM Studio response did not include
  reported usage. They are not a measured context-capacity percentage.
- The composer needs terminal cursor controls and at least seven rows.
  `--no-color` disables text color; `--print`/`--json` remain the non-interactive
  interfaces. Multiline entry retains trailing-backslash continuation.
- MCP configuration is listed as configured, not verified connected. No live
  MCP/subagent/model-provider matrix was rerun for this visual change.
- No web production build or full application audit was rerun for this terminal
  change. These results establish the tested CLI behavior, not production
  readiness of the entire repository.
- No files were discarded, and no commit or push was made.

## Follow-up: completion details stay in the bottom status bar

At the user's request, interactive replies no longer append the Changed,
Commands, Tests, Status, and Limitations report. Token usage and permission mode
remain at the bottom left; provider/model remain at the bottom right. Estimated
usage retains the `~` marker. Tool output, approval prompts, errors, persisted
evidence, and the non-interactive interfaces retain their existing behavior.

Changed `src/cli/tui.ts` and documented the display in `README.md`.
`npm run check` passes typechecking and all 63 tests with zero skips. Focused
ESLint on `src/cli/tui.ts` passes with zero warnings.

A fresh global-command Windows terminal session used the real LM Studio
`gpt-oss-20b` model and returned `FOOTER_OK`. The prompt returned immediately
below the answer, without the completion report. The bottom row displayed
`~680 in / 4 out (read-only)` on the left and `(lmstudio) gpt-oss-20b` on the
right. Session `ses_mvw5im0i_pv8yb4` used the temporary workspace/home above;
`/quit` exited 0. Existing interactive processes need a restart to load the
updated renderer.

## Follow-up: closer reference styling and keyboard scrollback

The reference styling now includes a three-row coral/blue/gold mark, muted
shortcut/help text, yellow resource headings, padded blue user-message panels,
a plain input row with a block cursor, a home-relative workspace path, and
`↑input ↓output (permission)` on the left of the footer. The selected provider
and model remain on the right. Session metadata is emitted only in verbose
mode. Completion reports remain absent from normal interactive replies.

Shift+PageUp/Shift+PageDown navigate retained transcript output, Ctrl+Home goes
to its beginning, and Ctrl+End returns to the live conversation. A centered blue
“Jump to latest message” hint appears only when this keyboard scrollback view
is active. New output does not move that view. Draft input is preserved, and
new user-message panels are rewrapped from their original text on resize.
Ctrl+C/Ctrl+D clear a nonempty draft before their idle exit behavior.

Changed `src/cli/startup.ts`, `terminal-ui.ts`, `tui.ts`, and added
`src/cli/transcript.ts`. Extended `tests/terminal-ui.test.ts` to twelve cases,
and updated README/testing/architecture/limitations documentation. The bounded
transcript retains up to 256,000 characters. It strips message cursor/title
control sequences while retaining renderer colours.

Verification: typechecking and all 67 tests pass with zero skips; focused strict
ESLint passes. In a real Windows pseudo-terminal, the global command displayed
the coloured header and blue user panel, LM Studio `gpt-oss-20b` returned
`STYLE_OK`, and the footer showed `~↑679 ↓3 (read-only)` on the left and the
provider/model on the right. No session metadata or completion report appeared
in normal chat. Shift+PageUp produced the blue jump hint; Ctrl+End returned to
the latest output. Ctrl+C cleared a draft, and Ctrl+D then exited 0 with the
cursor restored. This is keyboard scrollback; native terminal mouse-wheel
scrolling is controlled by the terminal host. Resize and wide-character panel
wrapping are covered by automated terminal streams rather than a manual window
resize. Session evidence: `ses_mvw67haa_17yul9` in the temporary home above.

## Follow-up: SA startup monogram

Replaced the geometric mark with a three-row `SA` monogram at the user's
request, retaining the existing colours and header height. ASCII mode displays
`S A`. Updated `src/cli/startup.ts` and the README preview. Typechecking, focused
strict ESLint, and all twelve existing terminal UI tests pass. Printed previews
confirmed the Unicode and ASCII marks. No live-model rerun was needed for this
logo-only change.

## Follow-up: live activity on the input border

The top input border now contains an animated spinner, phase label, elapsed
seconds for the current phase, and a short action description. Working covers
workspace/skill preparation; Thinking is a pending model request; Responding
means answer text is arriving; Acting describes a tool operation. Planning,
Delegating, Waiting for approval, and Cancelling follow their corresponding
events. Completed, Incomplete, Failed, and Cancelled stop the animation.
Thinking is an activity label, not a display of private model reasoning.

The timer repaints only the border, preserving transcript cursor bookkeeping,
scrollback, draft input, approval answers, and resize behavior. Repeated events
in the same phase do not restart the timer. Cancellation becomes available
during workspace preparation, and late model/tool events cannot replace the
Cancelling label before the terminal run event. Timers stop on close. The
bottom token/model footer and absence of the completion report are preserved.

Files changed for this follow-up:

- Added `src/cli/activity.ts` and `tests/activity.test.ts`.
- Updated `src/cli/terminal-ui.ts`, `src/cli/tui.ts`, and
  `tests/terminal-ui.test.ts`.
- Updated `README.md`, `docs/terminal-agent/ARCHITECTURE.md`,
  `docs/terminal-agent/TESTING.md`, and this record.

Verification: `npm run check` passes typechecking and all 73 tests with zero
skips. Focused ESLint passes with zero warnings. Added integration coverage uses
the real agent loop, permission broker, file tools, and event stream with a
mock model; separate controlled-timer tests check animation, cleanup, approval
input/cursor preservation, narrow widths, and ASCII decoration.

Live verification used the globally linked `agenthub` command in an isolated
Windows pseudo-terminal with LM Studio `gpt-oss-20b`. The existing local model
was available but initially unloaded; a real request loaded it without any
download or installation. Evidence is session `ses_mvw6wnbs_17tc7w`, under
`C:\Users\SACHIN\AppData\Local\Temp\agenthub-activity-4fbe3269d7884d22b89e1813213d3a31\home`.

- A real `read_file` call read `sample.txt`, and the model returned the exact
  marker `AGENTHUB_ACTIVITY_READ_OK`. Working, Thinking, Responding, and
  Completed appeared above the input.
- A shell-tool request displayed Waiting for approval with the editable
  yes/always/no prompt. Answering `y` switched to Acting / Running command.
  A real subprocess ran and recorded exit 0 in the session ledger.
- The model proposed a second command. Escape at that approval prompt showed
  Cancelling then Cancelled, cancelled the pending action, and saved the
  session as `cancelled`. `/status` worked afterward and `/quit` exited 0.

Limits of this check: the model initially asked for confirmation in its answer
instead of calling the tool. After a follow-up it used the actual broker. The
nested PowerShell command returned its script text as stdout instead of the
intended standalone marker; the proposed retry was cancelled. This verifies
the live activity and approval transitions, not shell-quoting correctness.
Planning, delegation, partial/failure states, and resize are covered by
automated tests, not this LM Studio run. No whole-application production
readiness claim is made. Existing repository work and historical records were
preserved; nothing was committed or pushed.

## Follow-up: slash command picker and compact spacing

Typing `/` now opens a picker above the input with command descriptions. Prefix
typing filters the shared command catalog; Up/Down select and scroll through
matches, Tab completes (adding a space for arguments), Enter runs, and Escape
dismisses without clearing the draft. A second Escape retains the normal clear
behavior. Exact `/skill` takes precedence over `/skills`. Unknown commands and
arguments retain ordinary input handling. Approval and multiline prompts do
not open the picker. `/help` uses the same catalog.

The composer follows short transcript output instead of leaving unused rows
between the answer and input. It reaches the bottom when the window fills.
Token/model alignment moves with the composer. Blue user messages retain
horizontal padding but no extra empty blue rows, and an extra startup blank
line was removed. Startup output is batched into a single write. Opening or
closing the picker reflows the retained transcript; draft, scrollback,
activity animation, and resizing continue to work.

Changed `src/cli/terminal-ui.ts`, `transcript.ts`, `tui.ts`,
`tests/terminal-ui.test.ts`, and added `src/cli/slash-commands.ts`. Updated
README, architecture, testing, limitations, and this verification record.

Verification: typechecking and all 78 automated tests pass, with zero skips;
focused strict ESLint passes with zero warnings. Five new terminal cases cover
matching/exact names, navigation/completion/submission, paged selection and
Escape, resize/prompt isolation, and compact spacing. Real decoded Escape is
tested because Node marks it as a meta key on Windows; it must still dismiss
the picker before normal input clearing.

Live Windows pseudo-terminal checks used the globally linked command with an
isolated home/workspace at
`C:\Users\SACHIN\AppData\Local\Temp\agenthub-picker-1b616bb97601425ab8f8f58c1ce2d14b`.
`/` listed 17 commands; Down+Tab inserted `/model `; `/us`+Enter ran `/usage`.
LM Studio `gpt-oss-20b` returned exactly `PICKER_LAYOUT_OK` in session
`ses_mvw7bzkq_z8vp29` (completed, one turn). The answer was followed by one
blank row and the activity/input border. In a fresh process, `/p` showed three
matches, Escape kept `/p` while closing the menu, and backspace+Up+Enter chose
`/quit` from the full list and exited cleanly. No software was installed.

Limits: this is a keyboard command-name picker, not argument completion or a
mouse menu. The live check used an 80-column terminal; narrow/wide input and
resize are covered by automated stream tests. Existing repository work and
historical reports were preserved. No commit or push was made.

## Follow-up: verify all slash command handlers

All 17 catalog commands now have integration coverage through `runTui`, using
temporary terminal streams, real files, Git, session storage, backup restore,
and skill discovery. Provider-switch tests use an isolated HTTP server and
assert that the subsequent request reaches the selected endpoint/model. A
mock model drives the deterministic agent-loop plan and usage checks.

Fixed the following issues identified by execution and code review:

- Failed provider/model switches no longer leave config and the active target
  inconsistent. `/model` lists reachable models without changing the selection;
  explicit switches require a listed model. `/provider` shows the active ID.
- Command exceptions return to the prompt instead of closing the terminal.
  Model discovery accepts cancellation. Exit reports session-save failures with
  a nonzero status instead of printing a false success message.
- `/plan` reads stored plan steps, preserving titles after status updates.
- `/permissions` rejects inherited object names such as `toString`, and saves
  valid changes. `/status` separates installed and activated skills.
- `/clear` saves both the outgoing and new empty sessions and clears the
  displayed transcript. `/resume last` selects another saved session; it retains
  current model, workspace, and permissions and never replays tools.
- `/usage` accumulates session tokens across turns and keeps run/request counts
  separate. Clear/resume no longer expose another session's last-request count.
  Restored/estimated totals retain their estimate label.
- Skill activation is saved before becoming active and repeated activation does
  not insert duplicate instructions. Compaction also saves before replacing
  in-memory messages.
- `/undo` validates original and backup paths before restoring, reports missing
  backups, and leaves the terminal usable after an error. `/diff` disables Git
  external diff/text conversion helpers, redacts recognizable secrets, and gives
  a clear non-Git-workspace message.

Files changed: `src/cli/tui.ts`, `src/cli/terminal-ui.ts`,
`src/cli/transcript.ts`, `src/core/run.ts`, `src/core/backups.ts`; added
`tests/slash-commands.test.ts`. Updated README, testing, and this record.

Verification: `npm run check` passes typechecking and **85/85 tests**, zero
skips. Focused strict ESLint passes with zero warnings. Seven new integration
cases cover all commands, state rollback, live plan updates, backup boundaries,
cumulative usage, empty states, and storage failures. Initial tests reproduced
the provider-state, plan-title, command-exit, and token-reset defects before the
fixes. No new runtime dependencies were added.

The global `agenthub` command was also exercised in a real Windows
pseudo-terminal against LM Studio. Test data was isolated under
`C:\Users\SACHIN\AppData\Local\Temp\agenthub-commands-c26d3998149f4e8f8240b2f0e8959c3f`.
Session `ses_mvw7s5b4_u8w8yk` contained a fixture plan and skill. Live checks
confirmed `/help`, `/status`, `/provider`, `/skills`, `/skill command-check`,
`/plan`, `/diff`, `/undo`, `/permissions read-only`, `/usage`, `/compact`,
`/clear`, `/sessions`, `/resume`, and `/verbose`. The restored sample file was
read back as `ORIGINAL_COMMAND_FILE`.

After the tool session expired between chat turns, the saved session was
reopened. `/model gpt-oss-20b` selected the listed model, `/model` listed
available models, and an invalid provider left LM Studio selected. A subsequent
real request returned exactly `COMMANDS_LIVE_OK`. `/quit` saved and exited 0.
Together the two terminal processes exercised all 17 catalog commands. Real
provider-to-provider switching and deliberate storage failures were covered by
automated fixtures, not external providers. Existing user work and historical
reports were preserved; no commit, push, download, or installation occurred.
