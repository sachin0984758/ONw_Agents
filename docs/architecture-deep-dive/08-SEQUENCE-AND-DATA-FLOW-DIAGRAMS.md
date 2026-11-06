# 08 — Sequence and data-flow diagrams

## Chat sequence: streamed response

```mermaid
sequenceDiagram
  participant User
  participant UI as chat-view and chat-runs
  participant Route as /api/chat
  participant Store as chat-store
  participant Policy as model-routing
  participant LLM as llm transport
  participant Runtime as local model server
  User->>UI: submit text and optional attachments
  UI->>UI: create optimistic turn and run id
  UI->>Route: POST request
  Route->>Store: load conversation/history
  Route->>Policy: resolve model and permission
  Policy-->>Route: target or error
  Route->>LLM: context and abort signal
  LLM->>Runtime: compatible completion request
  loop response chunks
    Runtime-->>LLM: delta and optional usage
    LLM-->>Route: text/usage events
    Route-->>UI: SSE event
    UI->>UI: merge partial assistant message
  end
  Route->>Store: persist final state
  Route-->>UI: completion event
  UI-->>User: render Markdown, code or quiz
```

The route can branch for attachments, teach mode, quiz repair and coding-agent
settings. Cancellation aborts upstream work. If a stream ends after partial
output, the UI retains partial state and should not present it as verified.

## Sessions tool sequence

```mermaid
sequenceDiagram
  participant User
  participant View as session-chat-view
  participant API as session conversation route
  participant Loop as session runtime and runner
  participant Model as configured local model
  participant Broker as approval broker
  participant Tool as workspace tool
  participant Disk as workspace and JSON store
  User->>View: send task
  View->>API: send action with conversation id
  API->>Loop: load state and start turn
  Loop->>Disk: read conversation/workspace metadata
  Loop->>Model: context and tool schemas
  Model-->>Loop: answer or tool request
  opt Approval required
    Loop->>Broker: publish exact proposed action
    Broker-->>View: approval event
    User->>View: approve or deny
    View->>API: decision
    API->>Broker: resolve decision
  end
  Loop->>Tool: execute validated action
  Tool->>Disk: bounded read/write/command
  Disk-->>Tool: output/evidence
  Tool-->>Loop: observed result
  Loop->>Model: follow-up with tool result
  Loop->>Disk: persist transcript/state
  Loop-->>View: events and final result
```

## Auto sequence

```mermaid
sequenceDiagram
  participant UI as Auto view
  participant API as /api/computer
  participant Runtime as Auto runtime
  participant Model as local model
  participant User
  participant Bridge as loopback computer bridge
  participant Win as allowlisted Windows app
  UI->>API: start task and select model
  API->>Runtime: validate scope and start
  Runtime->>Bridge: inspect permitted targets
  Bridge-->>Runtime: snapshot
  Runtime->>Model: task and observed UI
  Model-->>Runtime: proposed action
  Runtime->>User: request approval for input
  User-->>Runtime: approve or deny
  Runtime->>Bridge: hand off exact approved target
  Bridge->>Win: restore/focus/dock, then dispatch
  Win-->>Bridge: resulting UI state
  Bridge-->>Runtime: refreshed observation and verification
  Runtime-->>UI: task events/status
```

## Data flow and trust boundaries

```mermaid
flowchart LR
  U[User text and files] --> UI[Browser state]
  UI --> API[Local API validation]
  API --> CTX[Context assembly]
  CTX --> LOCAL[Loopback model]
  LOCAL --> API
  API --> UI
  API --> TOOL[Approved tools]
  TOOL --> WS[Selected workspace]
  API --> DB[Local JSON state]
  API -. explicit remote preference .-> REMOTE[Configured compatible endpoint]
  SK[User-selected skill URL] --> GH[GitHub API/raw content]
  ROAD[Manual roadmap sync] --> RH[Roadmap source]
  UI --> REG[Approved UI registry request]
  N8N[User-configured n8n instance] <--> API
  WIN[Desktop app state] <--> COMP[Local computer companion]
```

The user, browser, local server, model runtime, model-produced tool proposal and
workspace files are separate trust domains. Model and tool output are untrusted.
A selected folder narrows workspace services; it does not restrict every native
process at the OS level. The separate independence audit lists the external
network paths and which require user action.

## Request and event shapes

General Chat accepts JSON carrying a message, optional settings and
attachments; responses can be JSON or SSE. Current Sessions sends an action
(`create`, `send`, `approve`, `stop`, etc.) with a conversation ID; the server
owns the execution loop. Auto requests include task/model/profile and record
approval events. Exact schemas reside in route files and shared validators;
these diagrams are not API contracts.
