# AgentHub Terminal

A local-first coding agent for the terminal. Windows-first, Node 24, and zero
runtime dependencies. Development runs TypeScript directly; npm archives ship
compiled JavaScript.

```text
 █▀▀ ▄▀▄ AgentHub v0.1.0
 ▀▀█ █▄█ escape interrupt · ctrl+c/ctrl+d clear/exit
 ▄▄█ █ █ /help commands · ctrl+o more · \ multiline

[Skills]
  (discovered skills appear here)

────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────
C:\path\to\project
↑0 ↓0 (ask)                               (lmstudio) local-model
```

## What it does

The latest bounded memory, planning, concurrency, recovery and verification
features are documented in [the implementation report](docs/terminal-agent/REMAINING_FEATURES_2026-11-01.md).
Use `agenthub --review "focus area"` for a one-shot read-only review;
`agenthub config migrate --dry-run` previews schema migration with no writes.
`agenthub backups prune --dry-run` previews retention; applying it requires
`--yes`. Automatic post-edit checks follow the normal command permission policy.

- Streams answers and tool calls from LM Studio, Ollama, or any
  OpenAI-compatible endpoint.
- Reads, searches, edits, and writes files inside the workspace with path and
  symlink defenses.
- Runs commands with approval, backups, timeouts, output caps, and process-tree
  cancellation.
- Enforces the run deadline during model calls, tools, and approval waits, and
  limits tool calls within each batch. A cancelled approval cannot authorize a
  later write.
- Inspects Git; explicit staging and commits go through the approval policy.
  No dedicated tool pushes.
- Plans multi-step work, persists the plan, records evidence, and reports
  `completed`, `partial`, `failed`, or `cancelled` honestly.
- Discovers Agent Skills, installs from Git, updates with a compatibility
  recheck and rollback backup, and reuses the existing AgentHub scanner.
- Connects to explicitly configured MCP stdio servers. Tool arguments are
  schema-validated before the central policy is asked, and every call is real —
  there are no simulated MCP results.
- Runs bounded child agents through `run_subagent` with the same workspace and
  permissions as the parent, visible progress, cancellation, and merged
  evidence.
- Keeps sessions, memory, and backups locally. Persisted session transcripts,
  tool-call arguments, titles, and ledger fields are deep-redacted, and plans
  are restored on resume without replaying tools.
- Adds a 500-entry, redacted per-session audit of policy decisions, approvals,
  and tool outcomes; it excludes arguments and successful tool output.
- Supports an interactive TUI with streamed Markdown/code/diff rendering,
  `--print`, `--json`, and `--resume`.

## Quick start

```powershell
cd C:\path\to\AgentHub\AgentHub-CLI
npm ci
npm link

# Start the LM Studio local server and load an existing model, then:
agenthub doctor
agenthub
```

Before installing an archive, run `npm run check:package`. It builds and packs
the CLI, installs into a temporary prefix, and checks the installed command and
approved/denied tool writes using a local test server. It leaves your normal
global installation unchanged. `npm pack` builds automatically through prepack.

For a real loaded LM Studio model, run
`npm run check:local-model -- --model <loaded-model-id> --extended`. This uses an isolated
workspace to check chat/streaming, skills, file reads, approval, denial, failures,
session persistence, shell commands, undo, search, Git, MCP, subagents and
cancellation. It downloads and loads no model; unavailable providers
are reported as BLOCKED.

`npm run check:remaining-live` checks the new memory, dependency-plan, automatic
verification, review, specialist-pool and recovery paths with the currently
loaded model. It uses temporary workspaces and never changes loaded models.

One-shot:

```powershell
node src/cli/main.ts --print "Summarise this repository"
node src/cli/main.ts --json --yes "Run the tests and report failures"
node src/cli/main.ts --resume last
```

## Commands

The bordered input follows short conversations with one blank line after the
latest reply, and settles at the bottom once the conversation fills the window.
The token and model footer moves with it. Use Up/Down for history, Escape to clear input or cancel
a run, Ctrl+O to toggle tool details, and `/quit` to exit. Ctrl+C/Ctrl+D clear a
draft first; with empty input they exit. Approvals
appear in the same composer; Escape cancels the pending action. End a line with
`\` to continue it. Token counts prefixed with `~` are estimates (also used for
restored counts whose original reporting quality was not saved).

Type `/` to open the command picker above the input. Keep typing to filter it
(for example, `/mo` shows `/model`). Up/Down select, Tab completes the command,
and Enter runs the selected command. Tab adds a space for commands that accept
arguments. Escape closes the picker while keeping your draft; a second Escape
clears it. The picker stays out of approval and multiline prompts.

All 18 picker commands have executable handlers and integration coverage:

| Slash command | Behavior |
|---------------|----------|
| `/help` | List commands and shortcuts |
| `/model [id]` | Show the current model and available models, or switch to a listed model |
| `/provider [id]` | Show the active/configured providers, or switch provider (`auto` supported) |
| `/status` | Show workspace, session, model, permissions, skills, and usage |
| `/skills` | Discover and list installed skills |
| `/skill <name>` | Load a skill once into the session |
| `/memory [list|search <text>|delete <index>] [--user]` | View, search, or delete project or user memory |
| `/plan` | Show saved step titles, statuses, and notes |
| `/diff` | Show unstaged Git changes; explain when the workspace has no Git repository |
| `/undo` | Restore the latest file backup, or remove a file created by the agent |
| `/permissions [mode]` | Show or change `read-only`, `ask`, `auto`, or `bypass` |
| `/usage` | Show session totals separately from the last run and request |
| `/compact` | Reduce older conversation messages and save the result |
| `/clear` | Save the previous session, clear the display, and create a saved empty session |
| `/resume [id\|last]` | Resume a saved conversation; `last` selects the most recent other session |
| `/sessions` | List up to 20 saved sessions |
| `/verbose` | Toggle tool-output details |
| `/quit` | Save and exit (`/exit` is an alias) |

Model/provider switches take effect after validation and saving succeed.
Invalid selections leave the active connection intact. Resuming a conversation
keeps the current workspace, model, and permissions; it never replays tools.
Command errors return to the input. `/undo` requires an available backup and
checks that both restoration paths stay within their respective directories.

Interactive replies do not print a completion report underneath the answer.
Token usage and permission mode stay at the bottom left; the provider and model
stay at the bottom right. Tool progress, approvals, and errors still appear when
they occur. Use `/usage` or `/status` for additional details.

The top input border shows an animated activity indicator and elapsed time:
Working during preparation, Thinking while waiting for the model, Responding
while text arrives, Acting during tool execution, Planning, Delegating, and
Waiting for approval. The label follows runtime events; Thinking does not
display the model's private reasoning. Cancellation shows Cancelling, then
Cancelled. Completed, Incomplete, and Failed are stationary end states. The
indicator stops animating when the task ends and leaves the input available.

Your submitted messages appear in compact blue rows without vertical padding.
The prompt uses a plain input
line with a block cursor. Scroll back with Shift+PageUp/Shift+PageDown or jump
to the oldest retained output with Ctrl+Home. A centered “Jump to latest
message” hint appears while viewing older output; Ctrl+End returns to the live
conversation. Draft input remains available while navigating. Panels rewrap
when the terminal is resized. The workspace path uses `~` for your home folder.

Discovered valid skills, the selected provider, and explicitly configured MCP
servers are listed at startup. The footer shows the selected provider/model.
Session IDs are shown only in verbose mode or `/status`. There is no
update notice or invented context-capacity percentage. `--ascii` changes the
decoration; `--no-color` removes text color. Interactive mode still uses terminal
cursor controls. Use `--print` or `--json` for plain output or automation.

| Command | Purpose |
|---------|---------|
| `agenthub` | interactive TUI |
| `agenthub --print <task>` | one-shot answer |
| `agenthub --json <task>` | NDJSON events |
| `agenthub doctor [--probe]` | diagnostics |
| `agenthub models` | reachable models |
| `agenthub skills list\|inspect\|check\|install\|update\|rollback\|remove` | Skills Library |
| `agenthub sessions list\|show\|remove` | history |
| `agenthub memory list\|add\|remove` | project/user memory |
| `agenthub config` | effective configuration |

Exit codes: `0` completed, `1` failed/check problem, `2` usage/config, `3`
cancelled, `4` partial.

## Safety

- Permission modes: `read-only`, `ask` (default), `auto`, `bypass`.
- Hard denies cannot be approved: secret files, workspace escapes, `.git`
  writes, `git push`, destructive resets, root deletion, disk formatting.
- Cloud endpoints are skipped unless the user explicitly enables them.
- Skills are instructions only. Scripts never run automatically. Updating a
  skill cannot change permission policy.
- MCP servers can only be added in the user config; workspace config cannot add
  one. MCP calls are schema-checked and require central policy approval.
- Subagents inherit the parent's permission mode and broker. They cannot grant
  themselves broader permissions.
- This is **application-level policy, not an OS sandbox**. MCP servers and shell
  commands run with your OS user permissions.

Read [Known limitations](docs/terminal-agent/KNOWN_LIMITATIONS.md) before using
`auto`, `bypass`, `--yes`, MCP, or subagents.

## Documentation

- [Architecture](docs/terminal-agent/ARCHITECTURE.md)
- [Installation](docs/terminal-agent/INSTALLATION.md)
- [Configuration](docs/terminal-agent/CONFIGURATION.md)
- [Tools and permissions](docs/terminal-agent/TOOLS_AND_PERMISSIONS.md)
- [Skills](docs/terminal-agent/SKILLS.md)
- [MCP and subagents](docs/terminal-agent/MCP_AND_SUBAGENTS.md)
- [Model providers](docs/terminal-agent/MODEL_PROVIDERS.md)
- [Development](docs/terminal-agent/DEVELOPMENT.md)
- [Testing and verification](docs/terminal-agent/TESTING.md)
- [Known limitations](docs/terminal-agent/KNOWN_LIMITATIONS.md)
- [Licensing](docs/terminal-agent/LICENSING.md)
- [Open-source architecture research](docs/terminal-agent/OPEN_SOURCE_ARCHITECTURE_RESEARCH.md)

## Development

```powershell
npm run check      # typecheck + 67 tests
npm test
npx tsc --noEmit -p tsconfig.json
```

Source is executed directly by Node's type stripping. Relative imports use
explicit `.ts` extensions; there is no bundler or `dist/`.

## Status

Version 0.1.0. Verified live with LM Studio `gpt-oss-20b` on Windows for the
core agent loop, tools, approvals, sessions, and skills. Markdown rendering,
multiline input, resize, ASCII fallback, and clean `/quit` were verified through
a real Windows pseudo-terminal on 2026-10-21. MCP, subagents, and skill
update/rollback are covered by deterministic integration tests; they have not
yet been exercised through a live-model TUI session. Cloud providers and Ollama
remain unverified.

The terminal layout was updated on 2026-10-31. See
[the verification record](docs/terminal-agent/TUI_REFRESH_2026-10-31.md) for the
current checks and limitations.

Licensed under the MIT License. This private package is part of the AgentHub
workspace and has not been published to npm.
