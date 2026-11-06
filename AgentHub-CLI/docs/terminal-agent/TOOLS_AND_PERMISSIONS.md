# Tools and permissions

Every privileged action goes through one policy engine. A tool cannot execute
first and ask later, and neither model text nor a skill's `SKILL.md` can grant a
permission.

## Tools

| Tool | Purpose | Key inputs | Policy action |
|------|---------|------------|---------------|
| `list_dir` | List files/directories | `path` (default `.`), `depth` 1–3 | `fs.list` |
| `read_file` | Read a text file or line range | `path`, `start_line`, `end_line` | `fs.read` |
| `search_files` | Search contents | `query`, `path`, `glob`, `regex`, `case_sensitive`, `max_results` | `fs.list` |
| `write_file` | Create or replace a file | `path`, `content`, `reason` | `fs.write` |
| `edit_file` | Replace exact text | `path`, `old_text`, `new_text`, `replace_all` | `fs.write` |
| `run_command` | Run a shell command | `command`, `cwd`, `timeout_ms`, `reason` | `shell.run` |
| `git_status` | Branch and working-tree status | — | `git.read` |
| `git_diff` | Unified diff | `path`, `staged` | `git.read` |
| `git_log` | Recent commits | `count` (max 50) | `git.read` |
| `git_branch` | Local branch list and current branch | — | `git.read` |
| `git_show` | Commit summary and changed-file statistics | `commit` ref | `git.read` |
| `git_stage` | Stage explicit workspace paths; workspace-root staging is refused | `paths` (1–50) | `git.write` + approval |
| `git_commit` | Commit existing staged changes; never pushes | `message` | `git.write` + approval |
| `set_plan` | Create/replace a dependency-validated plan | `steps` (1–20), optional `dependencies` (1-based arrays) | none |
| `update_plan` | Update a step | `index`, `status`, `note` | none |
| `show_plan` | Show the plan | — | none |
| `list_skills` | List installed skills | — | none |
| `read_skill` | Load full skill instructions | `name` | `skill.load` |
| `mcp_list` | List tools on configured MCP servers | `server` (optional) | none |
| `mcp_call` | Call one MCP tool | `server`, `tool`, `arguments` | `mcp.call` |
| `run_subagent` | Run a bounded child agent | `task`, `label`, `max_steps`, `role` | inherited policy; non-coder read-only |
| `run_agents` | Up to four independent specialist assignments | `tasks` containing task/role | read-only, shared central bounds |

There is no generic "network" or "open URL" tool. Network access happens through
`run_command` (classified as risky), provider requests (explicitly configured
endpoint), or an MCP server the user configured. MCP is not covered by workspace
path policy.

### MCP tools

`mcp_list` starts each explicitly configured stdio server, lists its tools and
input schemas, and stops it. `mcp_call` starts the server again, validates the
arguments against the published schema, asks the central policy engine, and only
then calls the tool. Schema-invalid calls never reach approval or execution.
Connection, timeout, protocol, and tool errors are returned as real failures.

MCP configuration lives only in the user config; a workspace `mcpServers` entry
is ignored. Read-only mode allows only tools whose server declares
`annotations.readOnlyHint` and hard-denies other MCP calls. The hint is
self-declared by the server, not verified. See
[MCP and subagents](MCP_AND_SUBAGENTS.md).

### Subagents

`run_subagent` runs a fresh child agent with the same workspace, provider,
permission mode, approval broker, and cancellation signal as the parent. It
cannot grant itself broader permissions. The child has its own session and a
bounded step/wall-clock/context budget, emits visible progress events, and
returns its final text plus changed-file/command evidence, which the parent
merges into its ledger. `run_agents` adds a bounded read-only specialist pool;
there is no separate filesystem sandbox. Automatic verification uses the same
file-read/Git/shell policy; it cannot approve its own checks. Automatic explicit
memory extraction uses `memory.write` and never overrides read-only policy.

## Permission modes

| Mode | Reads inside workspace | Writes | Shell | Typical use |
|------|------------------------|--------|-------|-------------|
| `read-only` | allow | **deny** (hard) | only a small safe read-only allow-list | audit/review |
| `ask` (default) | allow | ask | ask | supervised work |
| `auto` | allow | allow | allow unless the command is risky | trusted local automation |
| `bypass` | allow | allow | allow unless hard-denied | deliberate, short sessions |

`bypass` is not a sandbox escape. Hard denies still apply. `--yes` approves
`ask` decisions for a non-interactive run; it cannot approve a hard deny.

## Decision semantics

Each action becomes a target key, for example:

```
fs.read:src/index.ts
fs.write:src/index.ts
shell.run:npm test
skill.load:pdf
mcp.call:filesystem/read_file
```

The engine evaluates in this order:

1. **Custom deny rules** — a match is a hard deny.
2. **Intrinsic checks** — secret files, workspace boundary, `.git` writes,
   permission mode, command classification.
3. **Custom allow rules** — upgrade `ask` to `allow`, never upgrade `deny`.
4. **Session memory** — an approval marked "always" for this run.

Results are `allow`, `ask`, or `deny`. A `deny` result with `hard: true` cannot
be overridden by any approval path.

## Hard denies

These are enforced regardless of mode, `--yes`, allow rules, or model output:

- Reading or writing secret-like files:
  - `.env` and `.env.*` (except `.example`, `.sample`, `.template`, `.dist`);
  - `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`;
  - `.npmrc`, `.netrc`, `.pgpass`, `credentials`, `credentials.json`,
    `secrets.json`, `secrets.yaml`, `secrets.yml`;
  - `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.keystore`.
- Writes outside the workspace; reads outside it unless
  `allowOutsideWorkspaceReads` is enabled.
- Writes inside `.git`.
- Shell commands matching destructive patterns, including:
  - recursive deletion of a root/home path (`rm -rf /`, `rm -rf ~`,
    `Remove-Item -Recurse -Force C:\`);
  - drive formatting, `mkfs`, `diskpart`, shutdown/restart;
  - `reg delete`, `bcdedit`, `cipher /w`;
  - `git push`, `git reset --hard`, `git clean -fdx`,
    `git checkout -- .`, `git restore .`;
  - `npm|yarn|pnpm publish`;
  - piping a download into a shell (`curl ... | sh`);
  - reading `.env` through `cat`/`type`/`Get-Content`;
  - fork bombs.

These are pattern-based protections, not a proof. Obfuscated commands can evade
classification, which is why the agent is not an OS sandbox and why `ask`
remains the default.

## Ask decisions

In `ask` mode, writes and shell commands require approval. In `auto` mode, risky
commands still require approval. Risky patterns include package installation,
Git history changes, file deletion/moves, container/cloud tooling, process
killing, permission changes, downloads, inline code execution, shell
redirection, piping to a shell, and `npx`. MCP calls are side effects outside the
workspace and require approval in both `ask` and `auto` mode.

The approval prompt shows:

- the tool name;
- a one-line summary;
- the exact target (file path, command and working directory, skill name);
- a risk level (`low`, `medium`, `high`);
- the diff for writes/edits when available.

Choices are approve once, approve for this run ("always"), or deny. Denial is
reported to the model as a tool error; the model may adapt, but it cannot retry
its way past a hard deny.

Non-interactive modes (`--print`, `--json`) deny `ask` actions by default. Use
`--yes` to approve them. The final status is `partial` when a denial prevented
the task from being completed, so automation does not mistake it for success.

## Path safety

`resolveInside(workspace, input)`:

1. expands `~`;
2. resolves the path against the workspace;
3. rejects paths that escape after normalization (`..`, absolute paths);
4. resolves symlinks/junctions and re-checks the real target;
5. rejects NUL bytes and empty values where a path is required.

The policy engine independently checks the resulting absolute path against the
workspace and secret-file rules. This defence in depth matters because a write
tool could be added later that forgets one check.

Reads are bounded to 512 KB and 2,000 lines per call. Searches skip files over
1 MB and binary content. Writes are capped at 1 MB of content. Output is capped
at 160 KB with head/tail truncation.

## Editing behavior

`write_file` replaces the whole file. It preserves the existing line-ending
style (CRLF vs LF) when modifying an existing file. If the content is identical,
it reports "No change" and does not touch the file.

`edit_file` requires exact text. It:

- fails if `old_text` is absent, with a request to re-read the file;
- fails if it matches more than once unless `replace_all` is true;
- normalizes CRLF when the target uses CRLF;
- shows a diff before approval;
- writes atomically.

There is no fuzzy patch, no automatic formatting, and no whole-repository
rewrite tool.

## Backups and undo

Before overwriting or editing an existing file, the backup store copies the
original to:

```
~/.agenthub/backups/<workspace-id>/
```

The changed-file evidence records the backup path. In the TUI, `/undo` restores
the most recent backup. `write_file` on a new file records `created` with no
backup. Backups are best-effort and reported as warnings if they fail.

The agent never runs `git commit`, `git add`, `git reset`, or `git push` on its
own. It may run them through `run_command` only if the policy allows the command
and, in `ask` mode, the user approves it. Even then, `git push` and destructive
reset/clean patterns are hard-denied.

## Shell semantics on Windows

`--shell auto` uses:

- `cmd.exe /d /s /c <command>` by default on Windows;
- PowerShell only when selected with `--shell powershell`;
- `bash.exe -lc` only when selected with `--shell bash`.

On Linux the default is `/bin/sh -lc`. PowerShell on non-Windows uses
`pwsh`.

Commands run with your OS user permissions. They are **not** sandboxed. The tool
uses `windowsHide`, disables Git pagers and prompts, sets `NO_COLOR`, and kills
the process tree on timeout or cancellation (`taskkill /T /F` on Windows,
process-group kill elsewhere). A command that times out exits with code 124; a
cancelled command exits 130 and is reported as cancelled.

The working directory must be inside the workspace and must exist. An empty
`cwd` means the workspace root.

## Git tools

`git_status`, `git_diff`, `git_log`, `git_branch`, and `git_show` are read-only
and allowed in every mode (including `read-only`). They run with
`GIT_TERMINAL_PROMPT=0` so they cannot block on credentials. They do not fetch,
pull, or contact a remote. `git_stage` and `git_commit` use the central
`git.write` policy and require approval; `read-only` denies them, and commits
only use changes already staged. No Git tool pushes or contacts a remote.

The `git.write` policy denies `git push`, asks for other mutations, and denies
mutations in read-only mode. Shell Git commands remain governed by the shell
classifier and hard-deny list.

## Evidence

At the end of a run, the CLI reports:

- changed files (`created`, `modified`, `deleted`) with diffs in the TUI;
- commands with exit code, duration, and timeout state;
- which commands were classified as tests;
- limitations such as "no test or check command was run after the file
  changes", estimated token usage, budget exhaustion, or a denial.

A run that changed files without verification is `completed` only if the model
answered; the limitation is still shown. Budget/denial/blocked outcomes are
`partial`. A tool or provider failure that ends the run is `failed`.

## What this is not

- **Not an OS sandbox.** A permitted command runs with your full user rights.
  Use a container, VM, or restricted Windows account if you need isolation.
- **Not a sandbox for MCP.** An approved MCP tool runs inside the configured
  server process with your OS user permissions and may reach paths and networks
  that the built-in file tools would deny.
- **Not a perfect command classifier.** Patterns catch common destructive
  commands; they do not prove safety.
- **Not a secret scanner for all content.** Output redaction catches recognizable
  token shapes, but a permitted command can still print a secret to a file or
  the terminal.
- **Not a replacement for review.** Read the diff and the evidence before
  keeping a change.
