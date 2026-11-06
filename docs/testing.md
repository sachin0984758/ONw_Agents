# Testing

Run these from the complete project root:

```powershell
npm run typecheck
npm run lint
npm test
npm run audit:repository
npm run build
```

`npm test` runs the serial suite list declared in `scripts/check-project.mjs` and
records the actual suite count, exit codes, assertion counts, skips and full logs
under `.verification/modernization/tests/`. Read `results.json` for the counts
from a specific run. The new
storage/build checks cover the consolidated boundaries: chat CRUD/history,
concurrent appends, deletion versus late replies, legacy-data quarantine,
workspace paths, origin behavior, atomic-write recovery and standalone assets.

Other suites cover both session runtimes, actual file operations in throwaway
workspaces, chat attachments and multimodal transport, quiz/teaching/code
rendering, model discovery, Playground, skills, n8n, tokens, links, UI controls
and Auto's contracts/preferences/cancellation transport. External providers are
mocked where the suite says so. Some UI checks assert structure or render on the
server; they do not replace a browser interaction test.

The background-chat suite exercises the real client request store with controlled
SSE: unsubscribe/remount, simultaneous conversations, stale history, stable IDs,
attachment-preparation locking, Stop/partial retention, malformed/incomplete
streams, usage sync and per-chat mascot completion. Background continuation is
for in-app view/conversation switching in the same browser page. Reloading or
closing that page does not resume an active stream.

If LM Studio already owns port 1234, the Playground suite reports its two
provider-fixture cases as skipped rather than disconnecting the user's provider.
Read the summary and exit code together. A test process that crashes after
printing passing assertions is not a passing invocation.

## Explicit live checks

`npm run check:computer-workflow` checks the currently supported Auto workspace
contract: an approved exact file write and an actual readback in a fresh OS
temporary directory. Its scope explicitly grants `workspaceAccess: 'write'`;
turning off Read only alone does not grant workspace access. Auto's current
catalog does not expose `run_command`, so this check does not claim command
execution. Run against an isolated loopback server with `AGENTHUB_TEST_URL`.

`node --import tsx scripts/check-live-agent-skill.ts` requires an already loaded
local chat model. It creates an isolated database, workspace and validated local
skill under the OS temporary directory. Its random skill token and file contents
must reach an approved output through actual model tool calls. It also checks
denied writes and cancellation. It never downloads models or enables native
input, and approves only `proof.md` inside its temporary workspace. Evidence
defaults to `.verification/live-agent-skill.json`; set
`AGENTHUB_SKILL_EVIDENCE` to a fresh evidence file to preserve previous results.
Fixture files and the isolated DB are retained for diagnosis. This test is
excluded from the default regression run.

The existing `check:live-teaching`, `check:live-chat-quiz`, `check:live-local-models`,
`check:computer-model`, `check:computer-live`, `check:computer-permissions`,
`check:computer-sandbox` and `check:computer-workflow` commands can require loaded
models, native windows, input consent or filesystem changes. They are excluded
from the default test run. Review their fixtures and prerequisites before use;
never run native typing tests while the user or another Auto task is controlling
the computer.

`check:live-finalization` exercises the loaded local model, streaming document
input, persisted chat, five MCQs, an Advanced Step 1 gate, Playground prediction
and debugging, one opted-in roadmap lesson and a read-only model/tool session.
Set `AGENTHUB_TEST_URL` to an isolated production server and give that server a
separate `AGENT_HUB_DB_DIR`. It creates/removes its own fixture records and never
enables native input. Each workflow defaults to a 180-second client deadline;
`AGENTHUB_LIVE_TIMEOUT_MS` can explicitly set 30–600 seconds for slow local
models. Results record the deadline and elapsed time; failures are recorded
under `.verification/finalization/`, not silently skipped.

The terminal package has a separate 55-test Node suite. The legacy Sessions
layout suite is included as compatibility coverage, not current-browser
acceptance. Workspace service tests execute real bounded fixture commands and
verify project-owned task logs, capability gates and HTTP parity. Optional Bash
tests use fixture deployments; their fake Bun executable does not validate
Prisma. The container test additionally requires Docker and its runner image.

For runtime smoke checks, verify the serving root and load Chat, Sessions,
Playground, Auto and Design Studio. A successful HTTP response proves route
availability, not successful model inference or native input. The restructuring
report records exactly which checks ran and which did not.

### Four-agent live generation checks

`npx tsx scripts/check-live-four-agents.ts` uses an already loaded local chat
model through the actual Sessions route. It registers temporary folders and
uses a separate temporary database. It checks `/game`, `/website`, `/research`
and `/other`, approving only writes/edits to each fixture's explicitly named
output file. It never approves arbitrary file paths or deletes. Results are
saved in `.verification/four-agents-live.json`.

Set `AGENTHUB_TEST_AGENT=website` for the dashboard retry, or
`AGENTHUB_TEST_RACING=1` for a compact Three.js racing prototype. These are
opt-in inference tests and can take several minutes per task. Sessions model
requests allow up to ten minutes per generation; user cancellation still
aborts the request. The prior three-minute limit was reproduced timing out
while generating the dashboard before any write approval.

The generated tic-tac-toe and dashboard checker scripts execute the generated
JavaScript with small DOM fixtures. They verify event handlers and state
changes, not browser rendering. A completed generation alone does not establish
visual quality or arbitrary-game correctness.
