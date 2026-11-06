# Open-source architecture research

Research date: **2026-10-21**. Repository metadata and layouts were read from the
GitHub API and raw README/license files on that date. This is a focused
architecture review, not a line-by-line source audit. Star counts are a snapshot
and will drift.

The AgentHub Terminal implementation is original TypeScript. No source code was
copied from these projects. This document records the ideas that shaped the
design and the ideas that were deliberately not adopted.

## Projects reviewed

| # | Project | Current repository | Default branch | Language | License (verified) | Stars* |
|---|---------|--------------------|----------------|----------|--------------------|--------|
| 1 | OpenCode | `anomalyco/opencode` | `dev` | TypeScript | MIT | 219,142 |
| 2 | Pi monorepo | `badlogic/pi-mono` → redirects to `earendil-works/pi` | `main` | TypeScript | MIT | 116,779 |
| 3 | Hermes Agent | `NousResearch/hermes-agent` | `main` | Python | MIT | 255,654 |
| 4 | Gemini CLI | `google-gemini/gemini-cli` | `main` | TypeScript | Apache-2.0 | 107,478 |
| 5 | OpenAI Codex CLI | `openai/codex` | `main` | Rust | Apache-2.0 | 130,206 |
| 6 | Goose | `block/goose` → redirects to `aaif-goose/goose` | `main` | Rust | Apache-2.0 | 55,470 |
| 7 | Aider | `Aider-AI/aider` | `main` | Python | Apache-2.0 | 49,674 |
| 8 | Qwen Code | `QwenLM/qwen-code` | `main` | TypeScript | Apache-2.0 | 28,615 |
| 9 | Continue | `continuedev/continue` | `main` | TypeScript | Apache-2.0 | 36,276 |
| 10 | Agent Skills specification | `agentskills/agentskills` | `main` | Python reference tooling | Apache-2.0; docs CC-BY-4.0 | 26,326 |
| 11 | Model Context Protocol | `modelcontextprotocol` org; spec repo `modelcontextprotocol/modelcontextprotocol` | `main` | TypeScript schema | MIT → Apache-2.0 transition | 9,492 |

\*Stars read from the GitHub API on 2026-10-21.

Important repository facts verified at review time:

- `badlogic/pi-mono` redirects to `earendil-works/pi`.
- `block/goose` redirects to `aaif-goose/goose`; the README describes goose as
  part of the Agentic AI Foundation at the Linux Foundation.
- `modelcontextprotocol/specification` redirects to
  `modelcontextprotocol/modelcontextprotocol`.
- Gemini CLI's README states that unpaid/Google One users were moved to
  Antigravity CLI on 2026-06-18 and that Gemini CLI is not optimized for the
  newest Gemini models. It remains open source and useful as an architecture
  reference, but it is not a stable long-term dependency for a new product.
- Continue's README states that the repository is read-only and no longer
  actively maintained after its final 2.0.0 release.
- Aider's last push at review time was 2026-05-22, about five months before this
  review; it is mature but less actively changing than the others.
- The MCP repository license file describes a transition from MIT to
  Apache-2.0; the GitHub license API therefore reports `Other`/`NOASSERTION`
  rather than a single SPDX identifier.

## Architecture notes

### 1. OpenCode (TypeScript, MIT)

Layout: a Bun-oriented monorepo with `packages/` for `core`, `cli`, `tui`,
`server`, `sdk`, `protocol`, `plugin`, `desktop`, `app`, `web`, `session-ui`,
and supporting packages. The project ships a terminal UI, a desktop app, an HTTP
server, an SDK, and a plugin surface.

Observed ideas:

- The agent runtime, protocol, server, SDK, and terminal client are separate
  packages rather than one application module.
- Built-in `build` and `plan` agents make permission posture part of the agent
  definition: the plan agent denies edits and asks before shell commands.
- Provider and model selection are configuration concerns outside the agent
  loop.
- A server/API boundary allows multiple clients to share one runtime.

Adopted: presentation-independent runtime, a shared event/protocol shape,
explicit permission modes, and read-only planning as a first-class posture.

Not adopted: Bun-specific execution, a desktop/web client, a plugin browser,
and a large server deployment surface. AgentHub Terminal is deliberately a
single-process local CLI with only the modules it needs.

### 2. Pi monorepo (TypeScript, MIT)

Layout: `packages/agent`, `ai`, `tui`, `coding-agent`, `mcp`, `chord`,
`durable`, `evals`, `telemetry`, and `env`. README highlights a unified LLM API,
agent loop, TUI, coding-agent CLI, extensions, skills, prompt templates, themes,
print/JSON modes, RPC, and a TypeScript SDK. Node.js 22.19+ is required.

Observed ideas:

- A small agent core with a separate terminal renderer and a separate model API.
- Multiple trustworthy front ends over the same loop: interactive, print, JSON,
  RPC, SDK.
- Extensibility through documented packages and skills rather than a monolithic
  plugin API.
- Deliberately omits sub-agents and plan mode; extensibility is the answer.

Adopted: the strict `cli` / `core` / `providers` / `tools` / `policy` split,
NDJSON output, a print mode, and a provider interface that is independent of the
UI. Also adopted the principle that a missing advanced feature should be
documented rather than faked.

Not adopted: hot-reloadable extension packages, RPC, telemetry, and an npm-based
plugin supply chain. These add attack surface before the core loop is proven.

### 3. Hermes Agent (Python, MIT)

Layout: a large Python codebase with `agent/`, `hermes_cli/`, `gateway/`,
`tools/`, skills, memory, sessions, sandboxes, and platform adapters. The README
describes a learning loop: curated memory, automatic skill creation after
complex tasks, skill improvement during use, FTS5 search over prior sessions,
subagents, scheduled jobs, and multiple terminal/sandbox backends.

Observed ideas:

- Memory is curated and periodically reviewed, not an unbounded transcript.
- Procedural knowledge is promoted into skills; session history is searchable.
- Subagents are isolated and bounded.
- Execution backends are pluggable (local, Docker, SSH, sandboxes).
- Multi-channel delivery is separated from the agent core.

Adopted: project-scoped, inspectable memory; the separation between memory,
skills, and session history; one bounded child-agent level; and the rule that
agent-created skills require review. Not adopted: parallel agent teams,
background job scheduling, and remote sandbox backends.

Not adopted: an always-on gateway, chat-platform integrations, automatic
self-modification of installed skills, remote sandbox backends, and background
scheduling. AgentHub Terminal does not run unattended.

### 4. Gemini CLI (TypeScript, Apache-2.0)

Layout: `packages/core`, `cli`, `a2a-server`, `sdk`, `devtools`, `vscode-ide-companion`,
plus integration, memory, performance, and evaluation suites. The README
documents MCP support, checkpointing, sandboxing, and IDE integration.

Observed ideas:

- A clean core/cli split with a testable core package.
- Integration tests and a separate memory-test suite.
- Checkpointing before risky operations.
- Sandbox and approval concepts layered around tool execution.
- MCP as an extension boundary, not as the core tool interface.

Adopted: core/cli separation, explicit checkpoint/backup behavior, integration
tests with deterministic providers, and MCP-left-for-later discipline.

Not adopted: the A2A server, IDE companion, vendor-specific model assumptions,
and the upstream product transition. The README's deprecation notice is a
warning against coupling a new CLI to one vendor's roadmap.

### 5. OpenAI Codex CLI (Rust, Apache-2.0)

Layout: a Rust workspace under `codex-rs/` with `core`, `tui`, `exec`, `cli`,
`apply-patch`, `execpolicy`, `protocol`, `mcp`, model/provider crates, and
platform sandbox crates including `linux-sandbox`, `windows-sandbox-rs`, and
`windows-sandbox-service`.

Observed ideas:

- The protocol and event types are explicit workspace crates.
- A dedicated patch format (`apply-patch`) instead of free-form rewriting.
- A policy crate (`execpolicy`) separate from command execution.
- OS-specific sandbox crates are honest about being platform-specific.
- Headless execution (`exec`) and interactive TUI share the core.

Adopted: typed events, a validated edit tool, a central policy engine, and an
explicit headless mode. The Windows-first requirement is treated as a design
constraint, not an afterthought.

Not adopted: Rust, a Bazel-first build, OpenAI-account authentication, and an
OS sandbox claim. AgentHub Terminal documents that application policy is not an
OS sandbox.

### 6. Goose (Rust, Apache-2.0)

Layout: crates including `goose`, `goose-cli`, `goose-agent`, `goose-mcp`,
`goose-providers`, `goose-provider-types`, `goose-context-management`, and
`goose-sdk`. README emphasizes a desktop app, CLI, API, 15+ providers, and 70+
MCP extensions.

Observed ideas:

- Provider types and provider implementations are separate crates.
- MCP is the extension mechanism, with many integrations behind one interface.
- Context management is its own concern.
- The same agent serves desktop, CLI, and API clients.

Adopted: provider configuration as data, context budgeting as a separate module,
and the rule that extensions must pass through the same policy engine.

Not adopted: MCP-first extensibility, a desktop application, and a large
provider matrix. A small, honest provider set with real discovery is more useful
than a long list of untested integrations.

### 7. Aider (Python, Apache-2.0)

Layout: `aider/` with `coders/`, `repomap.py`, `repo.py`, `commands.py`,
`linter.py`, `diffs.py`, `history.py`, `models.py`, and `io.py`; tests and
benchmarks live alongside.

Observed ideas:

- A repository map built with tree-sitter and ranked by relevance is a core
  context primitive, not a prompt afterthought.
- Multiple edit formats let the agent match the model's strengths.
- Lint/test runs are part of the edit loop, and failures feed back.
- Git is used for diffs and undo, but the user remains in control.
- The terminal UI is a conversation, not a full-screen dashboard.

Adopted: a compact repository map, focused file ranges, model-appropriate edit
tools, and verification after edits. Backups supplement Git rather than
replacing it.

Not adopted: automatic commits on every change, voice input, browser
copy/paste, and a Python implementation. Automatic commits would violate the
requirement that changes stay uncommitted for review.

### 8. Qwen Code (TypeScript, Apache-2.0)

Layout: a pnpm monorepo with `packages/core`, `cli`, `sdk-typescript`,
`sdk-python`, `sdk-java`, `acp-bridge`, `desktop`, `web-shell`, `channels`,
`browser-use`, and IDE integrations. README advertises auto-memory, auto-skills,
subagents, agent teams, MCP, and multi-protocol providers.

Observed ideas:

- A shared core with several SDKs and shells.
- Provider flexibility across OpenAI, Anthropic, Gemini, Qwen, and local
  endpoints.
- Skills and subagents as first-class product concepts.
- An explicit bridge protocol for editor integration.

Adopted: multi-protocol provider flexibility through one OpenAI-compatible
adapter plus explicit endpoints, and a skills/subagent roadmap that does not
block the core.

Not adopted: the very broad surface (mobile, browser, chat channels), automatic
skill creation without review, and multiple SDKs. Scope discipline is a feature.

### 9. Continue (TypeScript, Apache-2.0)

Layout: `core/` with `llm/`, `context/`, `tools/`, `indexing/`, `autocomplete/`,
`edit/`, `protocol/`, and `config/`; plus `extensions/`, `gui/`, `packages/`,
and `binary/`.

Observed ideas:

- Model providers are adapters under a common interface.
- Context providers are composable and independently testable.
- Tools, edit, and autocomplete are separate capabilities.
- The same core serves VS Code, JetBrains, and a CLI.

Adopted: provider adapters, a context module, and tool isolation. The codebase
was useful as a comparison even though it is now read-only.

Not adopted: IDE-first architecture, indexing/embeddings, and autocomplete. The
terminal agent should not carry a GUI-oriented dependency graph.

### 10. Agent Skills specification (Apache-2.0 code, CC-BY-4.0 docs)

The specification defines a skill as a folder with a required `SKILL.md`
containing `name` and `description` metadata plus instructions, with optional
`scripts/`, `references/`, `assets/`, and other resources. It defines three
stages: discovery (name/description only), activation (full `SKILL.md`), and
execution (optional scripts/resources loaded on demand).

Adopted directly:

- `SKILL.md` is required and frontmatter is validated.
- Discovery loads metadata only; full instructions load on activation.
- Referenced files are path-validated and never loaded implicitly.
- Scripts are inert until a separate, approved execution path runs them.
- Global and project skill roots have explicit precedence.

The specification describes a format, not a security model. AgentHub Terminal
adds its own policy boundary around skill loading and script execution.

### 11. Model Context Protocol (MIT → Apache-2.0 transition)

The repository contains the specification, TypeScript-first schema, JSON Schema,
and documentation, with versioned schemas from 2024-11-05 through 2026-07-28
and a draft. MCP standardizes JSON-RPC connections that expose tools, resources,
and prompts to a host.

Adopted: the conceptual separation between the agent's native tool registry and
external tool servers, and the intention to treat every external tool through
the same policy engine.

Adopted with a deliberately narrow subset: stdio JSON-RPC tools only, with
explicit user configuration, per-call lifecycle, schema validation, bounded
failures, and central policy. HTTP transport, OAuth, resources, prompts,
sampling, and persistent connections remain out of scope. The exact boundary is
documented in `MCP_AND_SUBAGENTS.md` and `KNOWN_LIMITATIONS.md`.

## Comparison matrix

| Concern | AgentHub Terminal | OpenCode | Pi | Hermes | Gemini CLI | Codex | Goose | Aider | Qwen Code | Continue |
|---|---|---|---|---|---|---|---|---|---|---|
| Primary language | TypeScript (Node 24) | TypeScript/Bun | TypeScript | Python | TypeScript | Rust | Rust | Python | TypeScript | TypeScript |
| Runtime dependencies | Zero | Many | Many | Many | Many | Binary | Binary | Many | Many | Many |
| UI | Readline TUI + print/JSON | TUI/desktop/web | TUI/print/JSON/RPC | TUI/multi-channel | TUI | TUI/exec | Desktop/CLI/API | TUI | TUI/desktop/web | IDE/CLI |
| Core/UI separation | Yes | Yes | Yes | Partial | Yes | Yes | Yes | Partial | Yes | Yes |
| Provider abstraction | One OpenAI-compatible adapter + explicit endpoints | Yes | Yes | Yes | Gemini-centric | Multi-provider | Yes | Yes | Multi-protocol | Yes |
| Central policy engine | Yes | Yes | Yes | Yes | Yes | `execpolicy` | Yes | Approval modes | Yes | Yes |
| Skill format | Agent Skills | Skills/plugins | Skills | Agent Skills-compatible | Extensions | Skills | MCP extensions | No skill spec | Skills | Skills/rules |
| MCP | stdio tools only | Yes | Yes | Yes | Yes | Yes | Yes (core) | No | Yes | Partial |
| Subagents | One bounded child level | Yes | No (by design) | Yes | Yes | Yes | Yes | No | Yes | Partial |
| Memory | Project/user Markdown | Config/session | Session | Rich curated memory | GEMINI.md | Memories | Config | Chat history | Auto-memory | Rules/context |
| Session persistence | JSON, resume without replay | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| OS sandbox | No (policy only) | Sandbox options | No | Multiple backends | Sandbox | Platform sandboxes | No | No | Sandbox | No |
| License | MIT | MIT | MIT | MIT | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 |

## Design decisions adopted

1. **One runtime, several front ends.** `src/core/run.ts` emits typed events.
   The TUI, `--print`, and `--json` consume the same events and the same loop.
2. **A single policy engine.** Every tool action becomes a `PolicyAction` and is
   evaluated by `src/policy/engine.ts`. Skills and model output cannot grant
   permissions.
3. **Provider boundaries at the adapter.** All providers speak an
   OpenAI-compatible chat-completions shape; provider-specific endpoints and
   headers are configuration, not branches in the agent loop.
4. **Local-first with explicit cloud consent.** Cloud endpoints are skipped
   during discovery unless `allowCloud` is enabled, and sending content to a
   non-local endpoint requires a separate runtime gate.
5. **Repository map, not repository dump.** The context builder produces a
   compact tree, instructions, memory, package metadata, and scripts. Tools read
   bounded ranges on demand.
6. **Backups before writes.** Every write/edit records a backup entry and emits
   evidence. Git is inspected but never committed, pushed, reset, or cleaned by
   the agent.
7. **Skills are instructions.** Discovery is metadata-only, activation is
   explicit, and scripts are never executed automatically.
8. **Honest usage reporting.** Provider-reported usage is used when present;
   otherwise the UI says "estimated".
9. **Resume without replay.** Sessions store the transcript and evidence, but a
   resumed run starts a new model turn and never re-executes prior tool calls.

## Ideas deliberately not adopted

- **Automatic Git commits** (Aider). Changes must remain reviewable and
  uncommitted.
- **Automatic skill creation and self-modification** (Hermes, Qwen Code).
  Agent-proposed skills are a documented future feature requiring review.
- **Unbounded MCP and subagent frameworks** (Goose, Codex, Gemini CLI, OpenCode,
  Hermes, Qwen Code). The project implements a bounded stdio tools-only MCP
  client and one level of real child agents, not remote transports, plugin
  ecosystems, or parallel agent teams.
- **OS-level sandboxing** (Codex, Gemini CLI, Hermes). Not claimed. The policy
  engine is application-level control, not kernel isolation.
- **Hot-reloadable third-party plugins** (Pi, OpenCode). Too much attack surface
  for a first release.
- **Desktop, web, chat-channel, and IDE surfaces** (OpenCode, Goose, Qwen Code,
  Continue). Out of scope for a terminal-first product.
- **Embedding-based code indexing** (Continue). A deterministic repository map
  and text search are sufficient for the supported workspace sizes and avoid a
  new service dependency.
- **Vendor-specific authentication flows** (Codex, Gemini CLI). Cloud providers
  use an API-key environment variable and are opt-in.

## Verification and limitations of this research

- Metadata, licenses, READMEs, and top-level package layouts were fetched live.
- License conclusions come from the repository `LICENSE` file, not only the
  GitHub badge. The MCP transition is called out explicitly.
- No project's source code was copied. Ideas were reimplemented from public
  documentation and observable architecture.
- This review did not execute the other projects, benchmark them, or audit every
  source file. Feature claims in their READMEs are reported as claims, not as
  independently verified behavior.
- Repository names and licenses can change. Re-check before reusing any code or
  text from these projects.

## References

- https://github.com/anomalyco/opencode
- https://github.com/badlogic/pi-mono (→ https://github.com/earendil-works/pi)
- https://github.com/NousResearch/hermes-agent
- https://github.com/google-gemini/gemini-cli
- https://github.com/openai/codex
- https://github.com/block/goose (→ https://github.com/aaif-goose/goose)
- https://github.com/Aider-AI/aider
- https://github.com/QwenLM/qwen-code
- https://github.com/continuedev/continue
- https://github.com/agentskills/agentskills
- https://github.com/modelcontextprotocol/modelcontextprotocol
