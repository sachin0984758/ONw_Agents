# Development

## Prerequisites

- Node.js 24+
- npm 11+ (only for `typescript` and `@types/node`)
- Git (for repository context and git tools)
- Optional: LM Studio, Ollama, or another OpenAI-compatible endpoint

```powershell
npm install
npm run check
```

`npm run check` runs the type checker and the test suite.

## Source development and package build

This project runs TypeScript directly through Node's built-in type stripping.
That imposes rules which the type checker enforces:

- **Explicit `.ts` extensions** in relative imports:
  `import { x } from './x.ts'`.
- **Erasable syntax only** (`erasableSyntaxOnly`): no `enum`, no `namespace`,
  no parameter properties, no decorators that require emit.
- **Type-only imports** must use `import type` (`verbatimModuleSyntax`).
- **`noUncheckedIndexedAccess`** is on: array/object indexing yields
  `T | undefined`. Handle it instead of using `!` casually.
- **No CommonJS.** The package is `"type": "module"`.
- Targets ES2024, module resolution NodeNext.

`npm start` executes `src/cli/main.ts` directly. `npm run build` emits JavaScript
to ignored `dist/` through `tsconfig.build.json`, rewriting relative `.ts`
imports to `.js`. This is necessary because Node refuses type stripping under
`node_modules`. There is no bundler or runtime dependency.

## Layout and responsibilities

| Path | Owns | Must not own |
|------|------|--------------|
| `src/cli` | arguments, config loading, command dispatch, TUI, output | tool implementations, provider HTTP |
| `src/core` | agent loop, events, approvals glue, plan, ledger, backups | terminal rendering |
| `src/providers` | HTTP, SSE, model discovery, selection | tool policy |
| `src/tools` | schemas and implementations | permission decisions |
| `src/policy` | allow/ask/deny, hard denies, command classification | execution |
| `src/context` | repo map, system prompt, trimming | session persistence |
| `src/skills` | parsing, discovery, static checks, install/update/rollback, app adapter | executing skill scripts |
| `src/mcp` | stdio JSON-RPC client, schema validation, bounded failures | permission decisions |
| `src/sessions` | atomic persistence, validation, redaction, plan restore | replaying tools |
| `src/utils` | path safety, deep redaction, Markdown, ANSI, token estimates | product policy |

`src/core/run.ts` is the reference composition point. It receives a
`RunOptions` object; it does not read `process.argv`, the terminal, or config
files directly. Keep it that way so the loop remains testable.

## Add a tool

1. Create or extend a file under `src/tools/`.
2. Define an `AgentTool` with a precise JSON schema.
3. Validate every input with `requireString`, `optionalNumber`, `enumValue`,
   etc. from `tools/validate.ts`.
4. Resolve paths with `resolveInside(ctx.workspace, ...)`.
5. Call `ctx.authorize(action, toolName, detail)` **before** any side effect.
6. Use `ctx.signal` for cancellation, and record evidence in `ctx.ledger`.
7. Return `{ ok, content, error?, truncated? }`. Never throw for an expected
   user/tool error; return `ok: false` with an explanation.
8. Register the tool in `src/tools/index.ts`.
9. Add a policy action if the tool needs a new kind (this forces exhaustive
   handling in `describeAction` and policy evaluation).
10. Add tests. At minimum: schema validation, a denied path, and a successful
    path.

MCP tools (`mcp_list`, `mcp_call`) and subagents (`run_subagent`) follow the same
rule. MCP argument validation happens before `authorize`; the approval happens
before `tools/call`. A subagent uses the parent config and broker and must never
construct a looser policy. See [MCP and subagents](MCP_AND_SUBAGENTS.md).

Skeleton:

```ts
import type { AgentTool, ToolResult } from './types.ts'
import { requireString } from './validate.ts'
import { resolveInside } from '../utils/fsx.ts'

export const echoFileTool: AgentTool = {
  name: 'echo_file',
  description: 'Return the first line of a file. Read-only.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
  async run(input, ctx): Promise<ToolResult> {
    const rel = requireString(input, 'path', { max: 1000 })
    const abs = await resolveInside(ctx.workspace, rel)
    const auth = await ctx.authorize({ kind: 'fs.read', path: abs, display: rel }, 'echo_file')
    if (!auth.ok) return { ok: false, content: '', error: auth.reason }
    // ... read with ctx.signal awareness, cap output, redact secrets
    return { ok: true, content: 'first line' }
  },
}
```

Do not add a tool that bypasses `authorize`. Do not put permission logic inside
the tool.

## Add a provider

Most providers need no code. Add a config entry with `kind:
"openai-compatible"` and a base URL. If the provider needs a new authentication
scheme or non-standard transport, extend the protocol adapter or implement
the `Provider` interface from `providers/types.ts`:

```ts
interface Provider {
  readonly config: ProviderConfig
  readonly label: string
  listModels(signal: AbortSignal): Promise<ModelInfo[]>
  chat(request: ChatRequest): Promise<ChatResponse>
}
```

Rules:

- never log or store API keys;
- honor `request.signal`;
- report usage only when the server did;
- distinguish retryable from non-retryable errors;
- do not silently retry a response that may have executed a tool;
- keep provider-specific logic out of `core/run.ts`.

Add a deterministic test with a local HTTP server for success, a retryable
failure, and an auth failure.

## Add a command

1. Add the name to `Command` and `COMMANDS` in `src/cli/args.ts`.
2. Implement `runXCommand(config, args, signal)` under `src/cli/commands/`.
3. Dispatch it in the `switch` in `src/cli/main.ts`.
4. Return a meaningful exit code.
5. Support `--json` where the output is machine-consumed.
6. Add it to `src/cli/help.ts`.
7. Add argument-parsing tests.

Commands should be read-only unless the name says otherwise. Destructive
commands must require `--yes`.

## Add a slash command

Add a `case` in `handleSlash()` in `src/cli/tui.ts`, print a short result, and
return `true` to keep the loop alive (or `false` to exit). Keep commands
consistent with the CLI where they overlap (`/status`, `/skills`, `/sessions`).
Do not put multi-step approval flows inside a slash command.

## Add an event

1. Add a typed interface to `src/core/events.ts` and include it in `AgentEvent`.
2. Emit it from the runtime or a tool.
3. Handle it in `cli/headless.ts` (JSON pass-through and print filtering).
4. Render it in `cli/tui.ts`.
5. Decide whether it belongs in the evidence footer.

Events must be serializable. Do not put class instances, functions, or
unredacted secrets in an event.

## Policy changes

`PolicyAction` is a discriminated union. Adding a kind forces updates to
`targetOf`, `describeAction`, and `evaluate`. Keep this exhaustive switch
exhaustive; the compiler is the guard.

When changing a default:

- prefer stricter behavior;
- update `CONFIGURATION.md` and `TOOLS_AND_PERMISSIONS.md`;
- add a test that proves a hard deny cannot be overridden.

## Testing and debugging

```powershell
npm run typecheck
npm test
node --test --test-name-pattern "path resolution" "tests/**/*.test.ts"
node src/cli/main.ts doctor
node src/cli/main.ts doctor --json
node src/cli/main.ts --json "read package.json and report the name"
```

- `--json` is the best debugging view: it shows every proposed tool, argument,
  approval, result, usage, and the final status.
- `--verbose` increases tool-output detail in the TUI.
- `config` shows the merged configuration and redacts provider keys and MCP
  environment values (it prints MCP key names only).
- Do not add telemetry. Logs stay local.
- The TUI itself can be exercised through a Windows pseudo-terminal. During this
  release a temporary Python `pywinpty` harness sent slash commands and keystrokes
  to a real TUI process. It is a verification tool, not a project dependency.

## Code style

- Small modules with explicit types at boundaries.
- Prefer returning errors over throwing for expected failures; throw for
  programming errors and invalid usage.
- Keep user-facing text specific. "Denied by workspace boundary" is better than
  "error".
- No non-ASCII glyphs in protocol output; the TUI may use glyphs with an ASCII
  fallback.
- Comments explain why, not what.
- New behavior needs a test; changed behavior needs an updated test.

## Security review checklist

- Does the new code call `authorize` before any effect?
- Does it resolve paths with `resolveInside`?
- Does it respect `ctx.signal` and timeouts?
- Does it cap output and redact secrets?
- Can the model influence a permission, a path, or a shell string?
- Does it write outside the workspace or into `.git`?
- Does it add a dependency? Avoid runtime dependencies.
- Does it auto-commit, push, or delete without approval? It must not.
- Is the failure reported honestly, including `partial` where appropriate?

## Packaging

The package is private and MIT-licensed. `bin/agenthub.mjs` imports the source
entry in a checkout or the compiled entry in an archive, then invokes `main`
in the same process. This preserves signals and exit codes without a child
launcher process. `npm pack` runs the build via prepack; a files allowlist ships
`bin`, `dist`, and documentation. `npm run check:package` builds, packs, installs
to an isolated prefix, and tests the actual command plus denied/approved tool
writes. There is no publish step or bundled binary.

CI is defined in `.github/workflows/ci.yml`: Node 24 on Windows and Ubuntu,
`npm ci`, `npm run check`, a startup smoke test, and `npm run check:package`.
It has not run in a hosted environment because the CLI has no independent Git
root. `ci-parent-workflow.yml` in these docs is prepared for the containing
repository, but placing it outside the CLI folder was declined by the user.

If you change the entry point or Node requirement, update `package.json`,
`help.ts`, `INSTALLATION.md`, and the doctor runtime check together. If you add a
dependency or copied third-party code, update `LICENSING.md` and `LICENSE`.
