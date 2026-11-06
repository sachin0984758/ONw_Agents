# 09 — Module-by-module explanation

Each section separates purpose from verified implementation. A visible control
does not itself prove a complete integration; check the corresponding route and
the regression/live evidence.

## Chat

**Purpose/theory.** Turn-taking assistant with per-conversation history,
streaming and renderable Markdown. **Implementation.** `chat-view.tsx` calls
`/api/chat` and `/api/chat/conversations`; `chat-store.ts` persists thread data,
`chat-runs.ts` tracks active in-page streams, and `chat-quiz.ts` plus code/quiz
renderers interpret specialized output. **Example.** User asks for four DSA
questions; the route selects the configured model, streams the answer, and the
UI renders validated quiz blocks. **Failure/security.** No model means a clear
error; attachments are validated and limited. The provider body is not echoed
to the UI. **Assessment.** Strong separation between durable thread storage and
ephemeral stream snapshots; browser reload is not a durable job queue.

## Sessions

**Purpose/theory.** Coding assistant with tool calls over a registered project
and explicit action approval. **Implementation.** Current UI is
`session-chat-view.tsx`; conversation route `/api/agent-session/conversations`
delegates to `session/runtime.ts`, `runner.ts`, `model.ts`, `tools.ts`, `store.ts`
and `workspaces.ts`. **Example.** Ask it to add a small function: the model can
inspect files, propose an edit, wait for approval, apply it and re-read the
result. **Failure/security.** Tool allowlists, relative paths, workspace IDs,
capabilities, approval and stop signals apply. Arbitrary commands remain
application-level, not OS sandboxed. **Assessment.** The modular runtime is the
preferred code path, though one shell command can have wide side effects.

## Agents and task runtime

**Purpose/theory.** Display agent activity and allow users to configure/inspect
work. **Implementation.** `agents-view.tsx`, `agents-network.tsx`,
`tasks-view.tsx` and the older `agent-session.ts` provide distinct pieces. That
large runtime includes task/lesson/design logic and slash parsing. **Example.** A
teaching task may use the lesson bank before model assistance. **Limits.** This
is not a universal multi-agent scheduler. Subagent support in the separate
terminal package must not be attributed to the web dashboard.

## Teaching Agent

**Purpose/theory.** Structured learning: explanation, worked examples, checks
and progress. **Implementation.** `teach-prompt.ts`, teaching bank/framework,
chat teach modes and `agent-session.ts` lesson functions coexist. **Example.**
Teach a topic, answer a quiz and persist a progress event. **Failure/security.**
If no model is available, defined bank material may still answer; unsupported
answers should not be fabricated. **Assessment.** Split implementation is
functional but creates duplicated prompt/rendering responsibilities.

## Roadmaps

**Purpose/theory.** Represent learning steps and dependencies as a graph.
**Implementation.** `roadmap-library.ts`, Playground stores and
`scripts/sync-roadmaps.mjs` maintain local JSON caches; sync is a separate
explicit network action. **Example.** Select a roadmap, complete a node and
persist progress. **Failure/security.** Cached content remains local if remote
source is unavailable. Avoid claiming live upstream freshness without syncing.

## Playground

**Purpose/theory.** Interactive practice and code editing. **Implementation.**
`playground-view.tsx`, CodeMirror configuration, `playground-store.ts` and
`/api/playground` manage exercises and sessions. **Example.** Edit a snippet,
run an exercise evaluator and inspect feedback. AI feedback goes through the
configured model. **Limits.** It is not an isolated arbitrary-code execution
sandbox; distinguish deterministic exercise evaluation from model feedback.

## Skills Library

**Purpose/theory.** Package reusable instruction files and metadata. **Implementation.**
`skills.ts`, `skills-github.ts`, compatibility checks and `skills-view.tsx` list,
read, inspect/install and enable skills. **Example.** User selects a GitHub
repository/path and installs its instruction content. **Security.** Fetched text
is untrusted, scripts are not automatically executed, and skill instructions do
not grant tools. **Network.** GitHub access is user initiated; content is stored
locally.

## Slash commands

Web commands are parsed by `agent-session.ts` and feature handlers; terminal
commands are a separate CLI parser/TUI with a broader command set. They are not
one shared grammar. A command validates arguments then reads or mutates local
session/task state under its specific policy. Examples and supported names are
in the relevant runtime help, not inferred from another package.

## Workspace and filesystem

`workspace-files.ts`, `workspace-exec.ts`, session path validation and their
routes provide bounded list/read/write/edit/delete and command operations.
Paths are relative to a registered workspace, resolved through filesystem
realpaths, and constrained against traversal/symlink escapes. Mutations require
capabilities and approval. A workspace root is an app boundary, not an OS
container around unrelated applications.

## Windows Automation (Auto)

`auto-computer-view.tsx` communicates with `/api/computer`; `computer/runtime.ts`
plans and records tasks; `bridge.ts` and Python `controller.py` inspect windows
and dispatch approved actions. App/domain allowlists and per-action approval
apply. When approval overlays disturb focus, the bridge restores the verified
target before refreshing its UI Automation snapshot. This is visible desktop
input under the user account, not a security sandbox.

## Local Models and Settings

`models-view.tsx` discovers actual configured runtimes; `llm.ts` speaks the
compatible request format; `model-preference.ts` defaults remote permission to
false. Profile and global settings affect presentation and model selection but
do not grant tools. A model can be selected yet unavailable or unloaded; status
must come from live discovery.

## Memory, context and usage

Chat/session transcripts, skill instructions, workspace readme/context, and
terminal project/user memory are distinct mechanisms. `token-usage.ts`,
`usage-events.ts`, routes and token UI count reported or estimated usage. They
are local observability, not billing analytics or model memory. Context trimming
limits prompt payload; it does not make old content semantically equivalent to
full history.

## Additional views

Changes displays project change information. UI Components uses local components
and a user-approved registry path. n8n templates are bundled examples; the
runner connects to a user-configured instance. System Console reports local
resource metrics, not remote telemetry. Agent API exposes local dashboard
operations. Every optional network call is described in the independence audit.
