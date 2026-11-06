# 14 — Software engineering theory applied to AgentHub

This chapter separates general concepts from verified implementation.

| Concept | Definition and importance | AgentHub example | Common mistake |
|---|---|---|---|
| Layered architecture | Divide presentation, transport, domain and persistence so responsibilities are testable. | Feature components call App Router handlers, which delegate to `src/lib/agent-hub/`. | Importing filesystem code into a client bundle. |
| Client/server boundary | Browser code is untrusted and cannot own secrets or native access. | Client posts to `/api/chat`; only server code reads model keys and JSON files. | Putting credentials in localStorage or `NEXT_PUBLIC_` variables. |
| State management | Separate transient interaction state from durable domain records. | Chat run snapshots are separate from `chat-store.ts`; session history is server-backed. | Treating a mounted component as a durable task queue. |
| Async programming | Await network, file and process operations without blocking the event loop. | Fetch inference, SSE, async JSON writes and subprocess control. | Forgetting abort/timeout paths or assuming completion on request dispatch. |
| Streaming / event-driven systems | Send partial results as they become available. | Chat SSE streams text/status/usage; UI merges deltas. | Calling partial output a complete answer after disconnect. |
| Local inference | A model runtime serves requests on the machine or network endpoint. | LM Studio/Ollama inventories and compatible chat completion requests. | Confusing an API protocol with the company hosting a model. |
| Context windows | Prompts are finite; old data must be selected, trimmed or summarized. | Recent turns, workspace instructions, tools and skills form context; terminal trims messages. | Assuming the model remembers every stored conversation. |
| Tool calling | Model proposes structured actions; application validates and executes them. | Session tool schema -> approval -> workspace service -> observed result. | Letting model text directly invoke arbitrary functions. |
| Persistence | Durable records outlive a request or view. | Atomic JSON stores under `db/`; localStorage for selected UI preference. | Assuming an in-memory map survives reload/process crash. |
| Authorization and capability | A request needs a concrete capability at execution time. | Workspace grant, app allowlist and approval gate. | Treating model choice or folder selection as complete security. |
| Process management | Spawn, bound, observe, cancel and reap child processes. | Terminal shell runner and Windows companion subprocess lifecycle. | Unbounded output, orphan processes or unsafe cwd. |
| Reliability | Recover honestly from partial failure and preserve evidence. | Abort signals, task states, sanitized errors, atomic writes and postcondition checks. | Retrying non-idempotent actions without checking if they already happened. |
| Testing | Test contracts at unit, integration, end-to-end and live levels. | Root regression suite, native computer checks and real model opt-in tests. | Treating mocked success or HTTP 200 as a live integration pass. |
| Build/deployment | Transform source into an artifact with reproducible runtime assumptions. | `scripts/build.mjs` invokes Next and stages standalone assets. | Sharing `.next` cache between concurrent builds or omitting local companion. |

## How components communicate

The basic operation is a request-response pipeline. The client builds typed JSON;
the route validates it; a service performs the domain operation; persistence or
a model/tool adapter returns a result; the route maps the result to JSON or SSE;
the client updates UI state. Each boundary is an opportunity to validate,
cancel, authorize and record evidence.

## Security as policy, not prompt text

Prompts instruct a model to behave, but a server-side policy decides whether a
tool can run. This is a core AI-systems principle: language instructions are
probabilistic; permission checks must be deterministic and outside the model.
AgentHub follows this pattern with schema/path checks and approval brokers, but
the application itself is not an operating-system sandbox.

## Scalability considerations

Single-user local JSON storage keeps setup simple. Multiple concurrent server
instances would need shared transactional storage and distributed task state.
Desktop automation is inherently single-user/interactive. Local inference can
be GPU/RAM-bound; request concurrency should be bounded by the runtime. The
terminal and dashboard duplicate some model/runtime abstractions because they
have different execution contracts; consolidating them prematurely could weaken
their independent permission models.
