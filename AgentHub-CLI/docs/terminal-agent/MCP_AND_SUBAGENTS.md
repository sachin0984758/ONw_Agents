# MCP and subagents

Both features are real runtime integrations. Neither falls back to placeholders,
canned output, or a simulated success path.

## MCP: Model Context Protocol

### Scope

Implemented:

- MCP **stdio** transport with JSON-RPC 2.0 over newline-delimited JSON.
- `initialize` / `notifications/initialized`.
- `tools/list` and `tools/call`.
- Per-server command, arguments, environment, working directory, and timeout.
- Tool input-schema validation before approval or execution.
- Central policy action `mcp.call`, including read-only mode handling.
- Safe connection, protocol, timeout, and cancellation failures.
- Proof through a real child-process fixture server in the test suite.

Not implemented:

- HTTP/SSE MCP transport, OAuth, remote discovery, or server marketplaces.
- MCP resources, prompts, sampling, roots, logging, progress notifications, or
  subscriptions.
- Persistent connections. Each `mcp_list` or `mcp_call` starts and stops its own
  server process.
- Handing MCP tools to the model as first-class tools. The model uses the fixed
  `mcp_list` and `mcp_call` tools; the server's tool list is data returned by a
  tool call.
- Full JSON Schema. Unsupported constructs such as `$ref`, `oneOf`, `anyOf`,
  `allOf`, `not`, conditionals, `patternProperties`, and `propertyNames` are
  rejected rather than guessed.

### Configuration

MCP servers are **user configuration only**. A workspace config that declares
`mcpServers` gets a warning and the entry is ignored. This stops a repository
from starting an arbitrary process merely because the agent was launched in it.

```json
{
  "mcpServers": [
    {
      "id": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\work"],
      "cwd": ".",
      "timeoutMs": 30000,
      "env": {
        "LOG_LEVEL": "error"
      }
    }
  ]
}
```

| Field | Required | Rules |
|-------|----------|-------|
| `id` | yes | lowercase letters, digits, hyphens; max 40 characters |
| `command` | yes | executable passed directly to `spawn` (no implicit shell) |
| `args` | no | array of strings |
| `env` | no | string values merged over inherited variables after common credential-like names are filtered |
| `cwd` | no | resolved relative to the user config directory |
| `timeoutMs` | no | 1,000–600,000 ms; defaults to 20 s for startup/listing and 60 s for a call |

`agenthub config` lists server ids, commands, argument counts, and environment
key names. It deliberately does **not** print environment values.

On Windows, commands that are `.cmd` shims (for example some `npx` installs) may
need an explicit executable path or `cmd.exe /d /s /c ...`. There is no hidden
shell layer.

### Execution flow

1. `mcp_list` starts each selected server, performs the handshake, calls
   `tools/list`, prints names/descriptions/schemas, and stops the server.
2. `mcp_call` starts the server and lists tools again.
3. The requested arguments are checked against the published input schema.
   Invalid arguments are rejected **before** approval and before `tools/call`.
4. `ctx.authorize({ kind: 'mcp.call', ... })` asks the central policy engine.
5. Only after approval is `tools/call` sent.
6. Text content is returned to the model. Images are replaced with an omission
   marker so binary data is not dumped into the transcript.
7. The server process is stopped in `finally`, including cancellation and error
   paths.

### Permission behavior

| Mode | Read-only hint | Other tools |
|------|----------------|-------------|
| `read-only` | allow | hard deny |
| `ask` | ask | ask |
| `auto` | ask | ask |
| `bypass` | allow | allow |

The read-only hint is self-declared by the server (`annotations.readOnlyHint`).
It is a hint, not a proof. A server can lie; only connect servers you trust.

MCP is outside workspace path policy. A filesystem MCP server may be configured
to reach paths this agent's own `read_file`/`write_file` tools would deny. The
configuration is therefore a security boundary decision made by the user.

### Failure behavior

Connection failures return a tool error containing the server id and a bounded,
redacted stderr tail. Timeouts, malformed JSON-RPC responses, non-zero exits,
and `isError` tool results are reported as failures. A failure never becomes an
invented success, and the parent run records the limitation/partial status
according to the normal loop rules.

### Secrets

`env` values live in the user config and are not encrypted. Prefer environment
variables inherited from the parent process where possible. MCP server stderr is
redacted before display, but a server can still print a secret that the pattern
redactor does not recognize.

## Subagents

### What a child agent is

`run_subagent` starts another `runAgent` call in the same process with:

- the same workspace, provider, model, skills, and repository context;
- the parent's permission mode, approval broker, and cancellation signal;
- a fresh `StoredSession` persisted under the normal sessions directory;
- a bounded step budget, wall-clock budget, and context budget;
- no ability to approve its own action or change policy.

The child is a real agent loop: it can read, write, run commands, plan, and load
skills subject to the same policy. Its final text, changed files, and commands
are returned to the parent tool result and merged into the parent ledger.

### Bounds

| Bound | Value |
|-------|-------|
| Nesting depth | parent depth 0; two child levels; deeper attempts fail safely |
| Child steps | requested value, capped by the parent's `maxSteps` and at most 8 |
| Child wall clock | parent's remaining wall clock, capped at 5 minutes |
| Child context | parent `contextTokens`, capped at 12,000 |
| Concurrency | shared `agentConcurrency` (1–4); `maxAgents` (1–16) bounds total descendants |
| Approval | parent broker; a prompt is shown in the parent TUI |
| Cancellation | same `AbortSignal`; cancelling the parent cancels the child |
| Permissions | coder inherits parent; all other specialist roles tighten to read-only |

### Visibility

The parent event stream carries:

- `subagent_started` (label, task preview, step budget);
- `subagent_progress` (tools, failures, nested activity);
- `subagent_completed` (status, duration, redacted text, evidence).

These events appear in the TUI and in `--json` NDJSON output. Child sessions can
be listed and inspected with `agenthub sessions`.

### Limitations

- Child output is returned as one tool result; intermediate child assistant text
  is not streamed into the parent transcript.
- A child cannot choose a different model or provider.
- `run_agents` provides up to four independent read-only specialist assignments,
  aggregated in input order. Roles are planner/researcher/reviewer/tester/debugger;
  testers inspect tests under read-only policy. Use `run_subagent` with coder
  for sequential edits/approved commands. No persistent team is created.
- The parent cannot change a child's task after it starts.
- Parent and child write to the same workspace; there is no worktree isolation or
  conflict detection.
- A child failure does not roll back successful child writes.
- The parent tool call is `ok: false` unless the child ends `completed`, but the
  parent model still sees the child's evidence and can decide what to do next.

## Verification

`tests/mcp-subagent.test.ts` starts a real stdio MCP server and proves:

- initialization, listing, schema display, and a successful call;
- approval happens once for `mcp_call` and not for `mcp_list`;
- missing required arguments are rejected before approval;
- a missing server and an unstartable command fail safely;
- read-only policy denies side-effecting tools and allows declared read-only
  tools;
- a child agent writes a file, persists its own session, appears in events, and
  has its evidence merged into the parent.

This section describes deterministic integration coverage. Existing Spark
MCP/child evidence is in `LIVE_RECHECK_2026-10-31.md`; new pool coverage is tracked
separately in `REMAINING_FEATURES_2026-11-01.md`. Physical TUI testing and arbitrary
external server deployments remain distinct validation gaps.
