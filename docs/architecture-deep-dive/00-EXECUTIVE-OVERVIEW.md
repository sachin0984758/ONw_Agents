# 00 — Executive overview

## Beginner view

AgentHub is a local web dashboard for several related work modes: ordinary
assistant chat, coding conversations with approved tools, learning and practice
features, skill management, task views, and supervised desktop automation. A
person opens the dashboard in a browser; feature pages send requests to the
local Next.js server; that server can call a model server running on the same
computer and save project state to local files.

It is more than a basic chatbot because some workflows retain context, stream
responses, call tools, ask before making changes, and persist sessions. They are
not all one interchangeable agent. Chat, Sessions, the older Tasks/teaching
runtime, Auto, the terminal package and the MCP package use distinct loops and
permission models.

## Engineering view

The web tier is a Next.js App Router application. `src/app/page.tsx` renders
`Shell`; `src/components/agent-hub/shell.tsx` maps navigation state to feature
components; route handlers in `src/app/api/` validate HTTP requests; server-only
domain code in `src/lib/agent-hub/` owns inference, tools, policy, persistence
and runtime coordination. Client state uses React hooks and Zustand. JSON
storage is the primary persistence implementation, not Prisma.

The system is local-first in its default inference and storage posture: local
providers are LM Studio and Ollama; the default shared preference disallows
remote model endpoints. User-configured compatible remote endpoints are a
separate explicit opt-in. GitHub skill inspection, remote UI registries, roadmap
sync, and user-configured n8n are other deliberate network paths; see the
independence audit. The web app does not silently launch `AgentHub-CLI/` or
`lmstudio-local-agent/`.

## Users and problem

The intended user is a developer or learner who wants one local control surface
for model chat, coding assistance, study, project work, and supervised computer
actions. The application reduces context switching, but it does not provide
OS-level isolation or guarantee an agent’s code is correct. Tool changes remain
subject to application-level workspace and approval rules.

## Capability status

| Capability | Evidence/status |
|---|---|
| Chat, thread persistence and SSE | Implemented; deterministic suites cover formatting, streaming and history. Real model success depends on a reachable configured runtime. |
| Sessions coding loop | Implemented with filesystem and command tools, workspace selection, approvals and persisted conversations. Model quality and long-run reliability remain model-dependent. |
| Teaching/Tasks | Implemented in the legacy `agent-session.ts` domain and current UI, with lesson/quiz suites; distinct from Sessions. |
| Auto desktop control | Implemented through a local companion with allowlists, scopes and approvals. Native input is not an OS sandbox. |
| Playground/Roadmaps/Skills | Implemented with local persistence; some imports/sync/registry functions contact user-selected external sources. |
| Terminal agent | Separate Node CLI project, with its own permission policy, config and tests. |
| Python MCP project agent | Separate optional package, not an automatic dependency of the dashboard. |
| VM isolation | Prepared tooling only; no installed/started guest was verified by this audit. |

## What would be required to rebuild it

Start with the request/permission contracts and storage boundaries, not the
visual shell. Then build the dashboard shell, one route/service pair, one local
model adapter, one durable chat store, and one safe tool. Add distinct agent
loops only after their permissions and recovery semantics are tested. The
reconstruction sequence is in [chapter 15](15-REBUILD-FROM-SCRATCH-GUIDE.md).

## Source map

Start at `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/agent-hub/shell.tsx`,
`src/lib/agent-hub/llm.ts`, `src/lib/agent-hub/chat-store.ts`, `src/lib/agent-hub/session/`,
`src/lib/agent-hub/computer/`, `AgentHub-CLI/`, and `lmstudio-local-agent/`.
The overview intentionally distinguishes these processes rather than attributing
all repository capabilities to the browser app.
