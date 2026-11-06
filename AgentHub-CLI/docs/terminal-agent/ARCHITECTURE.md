# Architecture

AgentHub Terminal is a standalone, local-first coding agent for the terminal. It
is a separate project from the AgentHub web application and does not import the
web app's browser runtime. The one integration point is the web app's Skills
compatibility API, used as an explicit HTTP adapter.

## Design constraints

- **Node.js 24, zero runtime dependencies.** Development executes TypeScript
  with explicit `.ts` imports. `npm run build` emits JavaScript to `dist/` and
  rewrites relative imports for npm installation, where Node cannot strip types.
  The launcher runs the selected entry in the same process. No bundler is used.
- **Windows first, Linux target second.** Paths, shell selection, signals, and
  Unicode are designed for Windows Terminal/PowerShell. Linux remains an
  unverified target; the Ubuntu workflow file is nested in this CLI folder,
  which currently has no independent Git root, so it has not run as hosted CI.
- **One runtime, several front ends.** The TUI, `--print`, and `--json` consume
  the same runtime events.
- **Local first.** LM Studio and Ollama are first-class. Cloud endpoints are
  skipped unless explicitly enabled.
- **Policy, not vibes.** Every tool action passes through one policy engine.
  Model output and skill text cannot grant permissions.
- **Honest reporting.** Unknown token usage is `null` and labelled estimated.
  Failed or denied work is never reported as success.

## Module map

```
bin/agenthub.mjs          same-process source/dist launcher with Node 24
src/
  cli/
    main.ts               argument -> config -> provider -> session -> mode
    args.ts               strict parser, commands, flags, usage errors
    help.ts               usage text
    tui.ts                session UI, slash commands, approvals, event rendering
    activity.ts           runtime events -> visible activity phase and detail
    terminal-ui.ts        scrolling transcript, compact composer, picker, readline input
    slash-commands.ts     shared slash command catalog, prefix matching for picker/help
    transcript.ts         styled user panels, bounded history, row wrapping
    startup.ts            banner and discovered/configured resource summaries
    headless.ts           --print and --json output, exit codes
    brokers.ts            interactive + non-interactive approval brokers
    doctor.ts             read-only diagnostics and JSON report
    evidence.ts           evidence footer formatting
    commands/             models, skills, sessions, config, memory, backups
  config/
    types.ts              AgentConfig, provider config, permission ranks
    load.ts               defaults < user < workspace < env < CLI
    migrate.ts            explicit version migration with preserved backup
  core/
    run.ts                the bounded agent loop
    events.ts             stable runtime event contract
    authorize.ts          policy engine + approval broker glue
    plan.ts               plan state machine
    ledger.ts             changed files, commands, tests evidence
    backups.ts            pre-write backup store
    journal.ts            synced write-ahead intents and no-replay recovery
    scheduler.ts          bounded independent read scheduling
    verify.ts             post-edit file and project-check verification
  providers/
    types.ts              ChatRequest/ChatResponse, messages, usage
    openai.ts             Compatible HTTP + SSE protocol adapter
    registry.ts           discovery, model selection, tool probe
    capabilities.ts       endpoint/model observations and configured capabilities
  tools/
    files.ts              list_dir, read_file, search_files, write_file, edit_file
    shell.ts              run_command with tree kill and output caps
    git.ts                read-only status/diff/log/branch/show and approved stage/commit
    plan.ts               set_plan, update_plan, show_plan
    skills.ts             list_skills, read_skill
    mcp.ts                mcp_list, mcp_call
    subagent.ts           run_subagent and bounded read-only run_agents pool
    index.ts              registry + JSON schemas
  mcp/
    client.ts             stdio JSON-RPC client, lifecycle, bounded failures
    schema.ts             bounded MCP input-schema validation
  policy/
    engine.ts             Allow / Ask / Deny, hard denies, rules, classification
  context/
    repo.ts               git, tree, package manager, instructions, memory
    prompt.ts             system prompt assembly
    budget.ts             message trimming and compaction
    memory.ts             categorized facts, explicit extraction, relevance retrieval
  skills/
    parse.ts              strict SKILL.md frontmatter validation
    discover.ts           global/project/extra roots, precedence, file inventory
    static-check.ts       format, tools, dependencies, security warnings
    install.ts            local/git install, staged update, backup/rollback
    compat.ts             HTTP client for the AgentHub app scanner
  sessions/
    store.ts              atomic JSON persistence, validation, redaction, plans
  utils/
    fsx.ts                path boundary, symlink resolution, atomic writes
    lock.ts               cross-process storage exclusion; never steals stale locks
    redact.ts             secret detection, deep redaction, output redaction
    markdown.ts           streaming Markdown/code/diff renderer (no cursor moves)
    ansi.ts, token.ts     terminal glyphs/colour, token estimation
tests/                    node:test suites with deterministic mock providers
```

`src/core` does not import `src/cli` or terminal state. `src/tools` receives a
`ToolContext` with the policy authorizer, event sink, backup store, ledger, and
skill index. This is the seam a future SDK or server could reuse.

The runtime checkpoints proposed tool batches before executing them, journals
each tool's intent/outcome, and checks interrupted writes without replaying side
effects. Optional concurrency overlaps only explicitly listed read tools in
read-only mode. Specialized pools also run read-only; mutable child tasks stay
sequential and all descendants share limits. Post-edit verification uses the
normal tool policy for tests/lint/typechecks and checks current file fingerprints
after commands. See `REMAINING_FEATURES_2026-11-01.md` for exact scope and limits.

## The run loop

`runAgent()` in `src/core/run.ts`:

1. Builds the system prompt from workspace facts, instructions, memory, active
   skills, tool policy, and the task.
2. Sends the transcript and tool schemas to the provider.
3. Streams assistant deltas, then records the assistant message.
4. If the model requested tools:
   - validates the tool name and arguments;
   - evaluates the action through the policy engine;
   - asks the approval broker when needed;
   - executes the tool with a per-tool timeout and the run's abort signal;
   - records the result (including refusals and failures) in the transcript.
5. Repeats until a final answer, a hard failure, the step budget, the wall-clock
   budget, cancellation, or a detected repeated failing call.
6. Verifies the evidence it actually has: changed files, commands, tests.
7. Persists the session and emits `run_completed` with status, usage, duration,
   limitations, and evidence.

Budget and safety behavior:

- `maxSteps` (default 12) bounds model/tool iterations.
- `maxWallClockMs` (default 15 minutes) aborts the run.
- Each command is bounded by `commandTimeoutMs` (default 120 s) and
  `maxOutputBytes` (default 200 KB).
- A per-tool hard ceiling of 10 minutes and 120,000 characters of tool output
  is applied in the loop.
- Identical failing tool calls are detected; repeated failures stop the loop
  with a limitation instead of retrying forever.
- Provider retries use exponential backoff only for no-tool-call requests.
  Once a response contains tool calls, the loop never re-sends it automatically,
  to avoid duplicating side effects.

Run status values: `running`, `completed`, `partial`, `failed`, `cancelled`.
`partial` covers budget exhaustion, blocked work, and denials that prevented a
truthful completion claim.

## Event contract

Events are defined in `src/core/events.ts` and consumed by all front ends:

`run_started`, `status`, `assistant_delta`, `assistant_message`, `tool_proposed`,
`approval_requested`, `approval_resolved`, `tool_started`, `tool_progress`,
`tool_result`, `tool_error`, `plan`, `plan_step`, `files_changed`,
`subagent_started`, `subagent_progress`, `subagent_completed`, `usage`,
`warning`, `error`, `run_completed`, `run_cancelled`.

`--json` writes one JSON object per line (NDJSON). The final line is
`run_completed` or an error/status object. `--print` writes only the final
answer to stdout and the evidence footer to stderr, unless `--no-evidence` or
`--quiet` is passed. The TUI renders the same events with different
presentation.

## Configuration flow

```
built-in defaults
  -> user config          ~/.agenthub/config.json
  -> workspace config     <workspace>/.agenthub/config.json
  -> environment          AGENTHUB_* variables
  -> CLI flags            highest precedence
```

Workspace config is treated as less trusted than user config. It can tighten
the permission mode, lower budgets, and add deny rules, but it cannot enable
cloud access, widen file boundaries, auto-approve, remove user deny rules, or
add MCP servers. Deny rules are unioned across layers. See `CONFIGURATION.md`.

## Provider boundary

All providers are OpenAI-compatible chat-completions endpoints behind
`Provider` (`listModels`, `chat`). The adapter handles:

- request construction and headers;
- SSE parsing (`data:` lines, CRLF, multiple data lines);
- assistant text deltas;
- streaming tool-call assembly by index;
- finish reasons and usage when reported;
- retries with backoff for transient failures;
- JSON fallback when a server does not stream correctly;
- honest errors with status and detail.

Discovery is a `GET /models` probe per configured provider. Cloud providers are
skipped before any network call when `allowCloud` is false. Model selection
prefers a loaded model from LM Studio, then Ollama, then custom, then cloud,
unless an explicit provider/model is configured. A requested model that is not
listed can still be sent to a reachable provider, with a warning; tool support is
never inferred from the model name. `doctor --probe` makes one explicit request
to test tool calling and records the exact model tested.

## External tools and child agents

MCP is a transport boundary, not a bypass. `src/mcp/client.ts` owns one stdio
JSON-RPC connection per `mcp_list`/`mcp_call`, with a handshake, bounded
stderr capture, timeout, cancellation, and `finally` cleanup. `src/mcp/schema.ts`
validates the server's published input schema against a deliberately small,
bounded JSON Schema subset. `src/tools/mcp.ts` validates arguments, then calls
the same central authorizer for `mcp.call`, and only then sends `tools/call`.
Workspace config cannot add an MCP server.

Subagents call `runAgent()` recursively with the same provider, workspace,
skills, permission mode, approval broker, and abort signal. The parent passes
only tighter budgets: one child level, at most 8 steps, the parent's remaining
wall clock capped at 5 minutes, and at most 12,000 context tokens. Child events
are projected into the parent stream; the child has its own persisted session;
its final text and evidence are merged into the parent ledger. There is no
parallel pool and no separate sandbox. See
[MCP and subagents](MCP_AND_SUBAGENTS.md).

## Tools and policy

Tools are registered in `src/tools/index.ts` with JSON schemas. Each tool calls
`ctx.authorize(action, tool, detail)` before doing anything privileged. The
authorizer evaluates policy, emits an approval event, and invokes the broker.
`--yes` and `auto` mode can approve `ask` decisions; they cannot override a hard
deny. See `TOOLS_AND_PERMISSIONS.md` for the full matrix.

Path safety is enforced in two layers:

1. `resolveInside()` normalizes and resolves the path, rejects traversal and
   absolute escapes, and resolves symlinks/junctions so the final target must
   remain inside the workspace.
2. The policy engine separately denies secret files, `.git` writes, and reads or
   writes outside the workspace.

## Sessions and resume

Sessions are JSON files under `~/.agenthub/sessions`, written atomically with an
`fsync` before replacement (where the filesystem permits it). Stored fields are
validated on load. Transcripts are truncated and secret-redacted, including tool
arguments, titles, and ledger command/file evidence. Plans are stored and
restored. File mode is requested as `0600`; Windows still relies on ACLs.

Resume loads the transcript and plan and starts a **new** turn. It never replays
prior tool calls. The restored plan is context, not evidence that earlier work
finished. If the recorded workspace differs from the current one, a warning is
printed and tools use the current workspace. Corrupt or schema-invalid session
files produce a clear error and are left untouched; `sessions list` skips them.

## Backups and evidence

Before overwriting or editing an existing file, `BackupStore` writes a copy under
`~/.agenthub/backups/<workspace-id>/` and records it in the session evidence.
New files are recorded as `created`. The run ledger tracks changed files,
commands (exit code, duration, timeout), and commands classified as tests.
`/undo` in the TUI restores the most recent backup. Backups supplement Git; the
agent never commits, pushes, resets, or cleans a repository.

## Skills

Skills are discovered from:

1. `~/.agenthub/skills` (user)
2. `<workspace>/.agenthub/skills` (workspace)
3. extra directories from `--skills-dir` / `AGENTHUB_SKILLS_DIRS`

Project skills shadow same-named user skills; extra directories are lowest
precedence. Discovery reads metadata and a file inventory only. Full
`SKILL.md` text is loaded by `read_skill` when the model or user activates it.
The tool result is explicitly marked untrusted and includes a policy reminder.
Scripts are listed, never executed automatically.

Repository compatibility checks are delegated to the existing AgentHub web app
via `GET /api/skills?op=compat...`, implemented in
`agent-session-project/src/lib/agent-hub/skills-compat.ts`. The terminal project
does not reimplement the scanner.

## TUI

The TUI is a readline-based conversation, not a full-screen application:

- streaming Markdown rendered line-by-line: headings, lists, quotes, fenced code,
  inline code/bold/links, and colored unified diffs;
- tool activity with truncated output (verbose toggles detail) and a periodic
  "still running" progress line for long tools;
- colored diffs and evidence;
- approval prompts with yes/always/no;
- slash commands for model, provider, status, skills, plan, diff, undo,
  permissions, usage, compact, clear, resume, sessions, verbose, quit;
- Ctrl+C cancels an active run, then closes on a second press;
- multiline input via a trailing backslash;
- history at `~/.agenthub/history`;
- resize flushes a partial Markdown line safely; scrollback reflow is left to the
  terminal.

The renderer never moves the cursor, enters an alternate screen, or erases
scrollback. The readline interface owns input and is closed in a `finally` block
after cancellation, errors, or normal exit. A `SIGTERM` handler and a progress
timer cleanup path prevent terminal/process leaks.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | completed |
| 1 | failed, or a check found a problem |
| 2 | usage or configuration error |
| 3 | cancelled |
| 4 | partial (budget exhausted, blocked, or denied) |

## Why this shape

The original web app's runtime is browser-oriented and coupled to its UI. A
standalone Node process needs its own loop, provider client, and persistence, but
it does not need a second skills format or a second compatibility scanner.
Separating `core` from `cli` keeps the loop testable without a terminal, while
the explicit app adapter satisfies the reuse requirement without forking the web
app.
