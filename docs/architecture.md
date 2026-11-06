# Architecture

AgentHub is one Next.js App Router application, with an optional Python desktop
companion and a separately runnable Node terminal agent. This cleanup retains
the existing framework conventions and feature directories; it adds no framework,
microservice platform or parallel state store.

## Entry points and dependency direction

`src/app/layout.tsx` installs theme and toast providers. `src/app/page.tsx` renders
`src/components/agent-hub/shell.tsx`; `?view=` selects the dashboard interface.
`src/app/design-studio/page.tsx` is the standalone design page. Route handlers
under `src/app/api/` own HTTP validation and delegate to the existing domain modules.

Client components use browser-safe state, contracts and API transports. Server
modules own filesystem access, provider credentials and native processes. The
audit traverses runtime imports from every client entry point and checks for
filesystem/native dependencies crossing that boundary. Type-only imports are
excluded from that runtime graph.

| Domain | Authoritative implementation |
|---|---|
| Dashboard state | `store.ts` client + `state-file.ts` server |
| Chat thread/history persistence | `chat-store.ts`, consumed by both chat routes |
| In-page background chat requests | `chat-runs.ts` owns per-conversation streams, optimistic messages, cancellation and mascot activity independently of mounted views |
| Quiz request interpretation | `chat-quiz.ts`; rendering remains in the existing chat components |
| Common host-origin policy | `request-origin.ts`; Auto keeps its additional loopback gate |
| Atomic text/JSON writes and serialization primitive | `fs-atomic.ts` |
| Workspace file and command operations | `workspace-files.ts`, `workspace-exec.ts`; HTTP adapters and server tools delegate to these |
| Durable project/DB location | `db-path.ts`; workspace override remains separate |
| Local model discovery and inference | `llm.ts`, with existing custom-model registry |
| Active coding sessions | `session/store.ts`, `runner.ts`, `runtime.ts`, `model.ts`, `tools.ts`, `workspaces.ts` |
| Task file intent and write scope | `session/file-intent.ts`; the legacy Agent Session module re-exports its stable public API |
| Legacy session outcome, highlighting and HTTP transport | `session/outcome.ts`, `session/highlighting.ts`, `session/transport.ts`; no shared state or initialization side effects |
| Lexical relative-path validation | `session/paths.ts`; workspace services retain realpath and permission checks |
| Auto computer use | `computer/runtime.ts`, `protocol.ts`, `bridge.ts`, `preferences.ts`, Python controller |
| Playground and roadmaps | Existing `playground-*`, `roadmap-library.ts`, Playground components |
| Teaching | Existing teaching framework/bank, chat teaching prompts and lesson renderers |
| Skills | Existing registry, compatibility checks, GitHub inspection and instruction loading |
| Mascot | Existing component, activity state and `public/agent-mascot/` media |

All names in the table are under `src/lib/agent-hub/` unless identified otherwise.

## Distinct implementations retained deliberately

`session-chat-view.tsx` is the current Sessions interface. The older
`sessions-view.tsx` retains unique design, teaching and team-control code and
legacy tests; it is retained as a compatibility surface. The large
`agent-session.ts` module remains used by Tasks, teaching/design pipelines and
their regression suites. It is not interchangeable with the server conversation
loop. Its broader decomposition remains technical debt; use the source file and
module map in the remediation report for its current size and responsibilities.

The terminal package has different CLI transports, permissions and persistence.
Its model client and tool executor are intentional platform-specific implementations.
Sharing them with browser/server code would currently increase coupling.

## Persistence and concurrency

Storage filenames and JSON formats are unchanged: legacy chat history and named
chat threads, coding conversations/workspaces, dashboard state, model settings,
skills, roadmaps and Auto preferences retain their existing locations.
Chat message writes and conversation rename/delete use the same serializer within
one process. Sessions and workspace registration keep their own serialized
read/modify/write cycles and consume the shared atomic writer.

This is single-process coordination. Multiple independent server processes are
not a supported concurrent-writing database deployment. Prisma is retained as
an optional deployment schema/CLI contract; its unused application singleton was
removed. It is not the application persistence layer.

The launcher sets the project root explicitly so standalone builds do not move
DB writes or Python-companion lookup into a transient build directory. Registered
user workspaces remain separate from that installation root.
Roadmap reading and synchronization use the same durable DB resolver; the
standalone server's changed current directory cannot hide the cached graphs.

## Audit

Run `npm run audit:repository` to refresh the source audit. It inventories tracked
and non-ignored untracked source, configuration, scripts and Markdown, computes
content hashes, traces imports, and reports cycles, unresolved imports and client
boundary leaks. The CSV is a structural file-by-file audit with explicit review
decisions, not a claim that every feature was manually or exhaustively exercised.
Generated dependencies/builds, runtime data, output deliverables, binary assets
and secret values are excluded from source analysis and preserved.
The audit also rejects server-service imports of App Router handlers. The
per-file decisions for the original 42 review items and subsequent orphans are
recorded in `review-decisions.json`.
