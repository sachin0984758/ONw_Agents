# Configuration

Configuration is JSON. There are two files and five layers.

## Precedence

```
built-in defaults
  < user config        ~/.agenthub/config.json
  < workspace config   <workspace>/.agenthub/config.json
  < environment        AGENTHUB_* variables
  < CLI flags
```

The workspace file is treated as less trusted. It can only tighten security:

- `permissionMode` can only become stricter.
- Budgets and context limits can only decrease.
- `deny` rules are added; they cannot remove user deny rules.
- `allow` rules are ignored with a warning and must live in the user config.
- `allowCloud` is ignored with a warning.
- `allowOutsideWorkspaceReads` can only turn the permission **off**.
- Backups can be enabled but not disabled by a workspace.
- `mcpServers` is ignored with a warning; MCP processes may only be configured
  at the user level.

Provider and model selection may be set in a workspace, because cloud use still
requires the user-level cloud gate.

## State locations

| Path | Purpose |
|---|---|
| `~/.agenthub/config.json` | user configuration |
| `<workspace>/.agenthub/config.json` | optional workspace configuration |
| `~/.agenthub/sessions/` | session JSON files |
| `~/.agenthub/backups/` | pre-write file backups and skill/session removal backups |
| `~/.agenthub/skills/` | user-level skills |
| `<workspace>/.agenthub/skills/` | project-level skills |
| `~/.agenthub/memory.md` | user memory |
| `<workspace>/.agenthub/memory.md` | project memory |
| `~/.agenthub/history` | TUI input history |

`AGENTHUB_HOME` changes the `~/.agenthub` root. All paths support `~` and are
resolved relative to the config file that declares them.

## All keys

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `schemaVersion` | integer | legacy 0 | Current schema 1. `config migrate [--user] --dry-run` previews; omit dry-run for explicit migration with a private backup. Loading never rewrites files. |
| `toolConcurrency` | integer | `1` | 1–8 independent read tools in read-only mode. Mutation/approval-bearing batches remain sequential. |
| `agentConcurrency` | integer | `1` | 1–4 simultaneously active children across the entire run tree. |
| `maxAgents` | integer | `4` | 1–16 total children across the run tree; nesting also capped at two child levels. |
| `memoryBudgetBytes` | integer | `6000` | 256–16000 bytes of whole, lexically ranked memory entries. |
| `memoryAutoExtract` | boolean | `false` | User-only opt-in extraction of explicit `remember category: fact` user lines. |
| `verification` | boolean | `true` | User-only automatic post-edit checks; normal permissions apply. Missing/denied/failed code checks downgrade completion. |
| `backupMaxEntries` | integer | `200` | Retention target (1–10000); one pending slot permits preserving the newest undo point before explicit pruning. |
| `backupMaxBytes` | integer | `104857600` | Backup quota (1024–1000000000). New backups fail before exceeding it; no silent deletion. |
| `backupMaxAgeDays` | integer | `90` | Explicit prune age (1–3650 days); newest undo and unknown files preserved. |
| `provider` | string | `"auto"` | Preferred runtime id (`lmstudio`, `ollama`, `custom`, or a custom id). |
| `model` | string | `""` | Model id. `provider/model` is accepted. Empty means auto-select. |
| `providers` | array | LM Studio, Ollama, local custom endpoint | Runtime definitions (see below). Entries merge by `id`. |
| `mcpServers` | array | `[]` | Explicit stdio MCP servers (user config only; see below). Entries merge by `id`. |
| `permissionMode` | string | `"ask"` | `read-only`, `ask`, `auto`, `bypass`. |
| `maxSteps` | integer | `12` | Model/tool iterations per run (1–200). |
| `maxWallClockMs` | integer | `900000` | Run wall-clock budget (1 s–1 h). |
| `commandTimeoutMs` | integer | `120000` | Per-command timeout (1 s–1 h). |
| `maxOutputBytes` | integer | `200000` | Captured command/tool output cap (1 KB–5 MB). |
| `contextTokens` | integer | `16000` | Prompt budget used for trimming (1,000–2,000,000). |
| `skillsDirs` | string[] | user + workspace skills | Extra skill roots. Appended, not replaced. |
| `appUrl` | string | `http://127.0.0.1:3000` | AgentHub app used by `skills check --repo`. |
| `sessionsDir` | string | `~/.agenthub/sessions` | Session storage. |
| `backupsDir` | string | `~/.agenthub/backups` | Backup storage. |
| `memory` | boolean | `true` | Load project/user memory into the prompt. |
| `theme` | string | `"auto"` | `auto` or `mono`. |
| `color` | boolean | auto | Force ANSI colour on/off. Unset follows TTY detection and `NO_COLOR`. |
| `ascii` | boolean | auto | Use ASCII glyphs instead of Unicode. |
| `backups` | boolean | `true` | Back up existing files before overwrite/edit. |
| `shell` | string | `"auto"` | `auto`, `cmd`, `powershell`, `bash`. |
| `allowOutsideWorkspaceReads` | boolean | `false` | Allow read/list tools outside the workspace. |
| `allowCloud` | boolean | `false` | Allow non-local endpoints (user config or `--allow-cloud` only). |
| `deny` | string[] | `[]` | Glob/substring rules that force a **hard** deny. |
| `allow` | string[] | `[]` | Rules that upgrade `ask` to `allow` (never overrides hard denies). |
| `quiet` | boolean | `false` | Only final answer and errors. |
| `verbose` | boolean | `false` | More tool/provider detail. |

Unknown top-level keys are reported as warnings and ignored rather than
silently accepted. Unknown provider fields are reported the same way.

Concurrency/retention/memory budgets can only decrease in workspace config.
`memoryAutoExtract` and `verification` cannot be changed by workspace content.
Provider entries can declare a `capabilities` object with boolean `streaming`,
`tools`, `json`, `vision`, `reasoning` keys. Declarations are labelled configured,
not detected. Actual SSE and valid native tool observations are saved separately
in `~/.agenthub/capabilities.json`, scoped to endpoint/model and expiring after
seven days. No capability is inferred from a model name. Registry flags do not
add image or structured-output request support to the text-only adapter.

See `MEMORY.md` for structured memory and `SESSIONS.md` for journal locations.

## Provider entries

```json
{
  "providers": [
    {
      "id": "lmstudio",
      "label": "LM Studio",
      "kind": "openai-compatible",
      "baseUrl": "http://127.0.0.1:1234/v1",
      "local": true,
      "timeoutMs": 120000
    },
    {
      "id": "my-server",
      "label": "Team inference server",
      "kind": "openai-compatible",
      "baseUrl": "https://inference.example.com/v1",
      "apiKeyEnv": "TEAM_API_KEY",
      "local": false,
      "models": ["qwen3-coder-30b"],
      "headers": { "X-Team": "platform" }
    }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Stable identifier used by `--provider` and `provider/model`. |
| `kind` | yes | Only `openai-compatible` is implemented. |
| `baseUrl` | yes | Must include `/v1` if the server expects it. |
| `label` | no | Human-readable name. |
| `apiKeyEnv` | no | Environment variable holding the key. Never put a key in the file. |
| `apiKey` | no | Ignored with a warning. Use `apiKeyEnv`; keys belong in the environment. |
| `models` | no | Advisory list; discovery still uses `/models`. |
| `headers` | no | Extra request headers. |
| `timeoutMs` | no | Per-request timeout hint. |
| `local` | no | Legacy display hint only. Security classification always comes from the URL host; this flag cannot enable a remote endpoint. |

Provider entries merge by `id`. Non-loopback endpoints are skipped before
discovery unless remote inference is explicitly enabled in user-level config or
on the command line. Workspace config cannot grant that permission.

## MCP servers

MCP is configured only in the user config. A workspace `mcpServers` entry is
ignored with a warning. See [MCP and subagents](MCP_AND_SUBAGENTS.md) for the
protocol and policy behavior.

```json
{
  "mcpServers": [
    {
      "id": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\work"],
      "cwd": ".",
      "timeoutMs": 30000,
      "env": { "LOG_LEVEL": "error" }
    }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | `^[a-z0-9][a-z0-9-]{0,39}$`, unique |
| `command` | yes | Executable spawned directly; no implicit shell |
| `args` | no | Array of strings |
| `env` | no | String values merged over inherited variables after common credential-like names are filtered |
| `cwd` | no | Resolved relative to the user config directory |
| `timeoutMs` | no | 1,000–600,000 ms |

Unknown MCP fields produce warnings. Invalid ids, duplicate ids, missing
commands, non-string arguments/environment values, and out-of-range timeouts are
configuration errors. `agenthub config` prints argument counts and environment
**key names**, but never MCP argument values or environment values. Both are
plaintext in the config file and are not encrypted.

## Environment variables

| Variable | Equivalent |
|---|---|
| `AGENTHUB_HOME` | state root (default `~/.agenthub`) |
| `AGENTHUB_WORKSPACE` | `--workspace` |
| `AGENTHUB_PROVIDER` | `--provider` |
| `AGENTHUB_MODEL` | `--model` |
| `AGENTHUB_PERMISSION` | `--permission` |
| `AGENTHUB_APP_URL` | `--app-url` |
| `AGENTHUB_THEME` | `--theme` |
| `AGENTHUB_SHELL` | `--shell` |
| `AGENTHUB_MAX_STEPS` | `--max-steps` |
| `AGENTHUB_COMMAND_TIMEOUT_MS` | command timeout in ms |
| `AGENTHUB_CONTEXT_TOKENS` | context budget |
| `AGENTHUB_NO_MEMORY` | truthy disables memory |
| `AGENTHUB_ALLOW_CLOUD` | truthy enables cloud |
| `AGENTHUB_SKILLS_DIRS` | path-delimited extra skill roots |
| `AGENTHUB_BASE_URL` | override the custom provider's base URL |
| `AGENTHUB_API_KEY` | key for the custom provider / `AGENTHUB_BASE_URL` |

Boolean environment values accept `1`, `true`, `yes`, `on` and `0`, `false`,
`no`, `off` (case-insensitive, surrounding spaces ignored). Invalid values are
configuration errors.

## Allow and deny rules

Rules are matched against an action key such as:

```
fs.write:src/generated/output.ts
shell.run:npm install left-pad
network:https://example.com
skill.load:pdf
```

`*` is a glob wildcard; a rule without `*` is a case-insensitive substring match.
Deny rules always win, including over `--yes` and `bypass` mode. Allow rules
upgrade an `ask` decision to `allow` but cannot upgrade a `deny`.

Example:

```json
{
  "deny": ["shell.run:git push", "fs.write:.github/workflows/*"],
  "allow": ["shell.run:npm test", "shell.run:node --test*"]
}
```

Do not use allow rules to bypass hard security checks. They cannot: secret files,
workspace escapes, `.git` writes, and destructive shell patterns stay denied.

## Memory configuration

Memory is enabled by default. Disable per run with `--no-memory` or globally
with `"memory": false`. Memory files are plain Markdown bullet lists:

```markdown
- Prefer pnpm in this repository.
- The API lives under src/server.
```

Memory is loaded into the system prompt, is project-scoped by default, and is
inspectable/deletable through `agenthub memory`. Secret-like entries are
rejected. Memory is never written automatically by a model in this release;
`memory.write` exists in the policy engine for future explicit workflows.

## Examples

### Conservative local setup

```json
{
  "provider": "lmstudio",
  "model": "gpt-oss-20b",
  "permissionMode": "ask",
  "maxSteps": 16,
  "contextTokens": 32000,
  "allowCloud": false
}
```

### Read-only analysis

```json
{
  "permissionMode": "read-only",
  "allowOutsideWorkspaceReads": false
}
```

### Explicit remote endpoint use

User config only:

```json
{
  "providers": [
    {
      "id": "team-inference",
      "kind": "openai-compatible",
      "baseUrl": "https://inference.example.com/v1",
      "apiKeyEnv": "TEAM_INFERENCE_KEY",
      "local": false
    }
  ],
  "allowCloud": true
}
```

Then run with `--provider team-inference --model <model>`. The runtime never
adds this remote endpoint by default; user-level `allowCloud` or `--allow-cloud`
is required, and workspace config cannot grant it.

## Inspecting the effective configuration

```powershell
node src/cli/main.ts config
node src/cli/main.ts config --json
node src/cli/main.ts doctor
node src/cli/main.ts doctor --json
```

`config` prints the merged result and redacts secrets. `doctor` additionally
probes providers and reports whether a usable model exists.

## Validation rules

- Unknown top-level keys and provider fields produce warnings, not silent
  acceptance or fatal errors.
- `model` must match `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$` when set.
- Numeric limits must be integers inside their documented range.
- Provider `id` must be a non-empty safe identifier.
- A provider must have `kind: "openai-compatible"` and an `http(s)` base URL.
- MCP server ids are unique lowercase identifiers; `command` is required and
  `args`/`env` must be string collections.
- Workspace-only attempts to widen security produce warnings, not silent
  acceptance. This includes `mcpServers`, `allowCloud`, `allow` rules, and
  loosening budgets/permissions.

Configuration errors exit with code **2** and list every problem found.
