# 07 — Complete workflow flowcharts

These diagrams describe implementation paths at a useful level; they omit
framework internals. Exact schemas and side effects are in the linked routes and
domain services.

## 1. Application startup

```mermaid
flowchart TD
  A[Run npm dev/start] --> B[Launcher resolves root and port]
  B --> C[Next starts on loopback]
  C --> D[Root layout loads theme, CSS and shell]
  D --> E[Shell resolves view and preferences]
  E --> F[Feature requests current state]
  F --> G{Service available?}
  G -- yes --> H[Render live status]
  G -- no --> I[Render unavailable/error state]
```

## 2. Navigation

```mermaid
flowchart TD
  A[Click nav, search result, profile shortcut or g+number] --> B{Editable field focused?}
  B -- yes --> C[Leave shortcut to editor]
  B -- no --> D[Resolve ViewId]
  D --> E[Update shell navigation state]
  E --> F[Mount feature view]
  F --> G[Load view-specific state]
```

## 3. Local model discovery and selection

```mermaid
flowchart TD
  A[Open Models or request status] --> B[Probe fixed local endpoints]
  B --> C{Provider responds?}
  C -- no --> D[Offline; do not invent a loaded model]
  C -- yes --> E[Read inventory and loaded-state metadata]
  E --> F{Requested model set?}
  F -- yes --> G[Resolve exact ID or report unavailable]
  F -- no --> H[Select local default]
  G --> I[Apply local-only/remote-consent policy]
  H --> I
  I --> J[Return actual model status]
```

## 4. Chat send and receive

```mermaid
flowchart TD
  A[Submit message] --> B[Validate draft and attachments]
  B --> C[Create optimistic message and run id]
  C --> D[POST /api/chat]
  D --> E[Validate origin, schema and conversation]
  E --> F[Load context and route model]
  F --> G{Tool/quiz-repair step required?}
  G -- yes --> H[Run permitted domain step]
  G -- no --> I[Call model]
  H --> I
  I --> J{Streaming?}
  J -- yes --> K[Parse SSE and merge deltas]
  J -- no --> L[Parse JSON response]
  K --> M[Finalize and persist]
  L --> M
  D -. error .-> N[Render safe error]
```

## 5. Agent task execution (Sessions)

```mermaid
flowchart TD
  A[Send coding request] --> B[Load workspace grant and conversation]
  B --> C[Build workspace context]
  C --> D[Call selected model]
  D --> E{Tool call?}
  E -- no --> F[Finalize and persist]
  E -- yes --> G[Validate tool schema and path]
  G --> H{Needs approval?}
  H -- yes --> I[Wait for approve/deny/stop]
  H -- no --> J[Execute bounded tool]
  I -- approved --> J
  I -- denied --> K[Record denial]
  J --> L[Observe output]
  L --> M{Budget or cancellation?}
  M -- no --> D
  M -- yes --> F
```

## 6. Terminal command execution

```mermaid
flowchart TD
  A[Model proposes run_command] --> B[Validate schema and workspace cwd]
  B --> C[Classify command and hard-deny rules]
  C --> D{Denied?}
  D -- yes --> E[Return denial; do not spawn]
  D -- no --> F{Approval needed?}
  F -- yes --> G[Wait for broker decision]
  F -- no --> H[Spawn bounded child]
  G -- rejected --> E
  G -- approved --> H
  H --> I[Capture capped output, timeout and exit]
  I --> J[Record evidence and result]
```

## 7. Workspace file operation

```mermaid
flowchart TD
  A[Receive relative path] --> B[Normalize path]
  B --> C[Resolve selected workspace and real path]
  C --> D{Traversal, symlink escape or protected path?}
  D -- yes --> E[Reject]
  D -- no --> F{Read or mutation?}
  F -- read --> G[Return bounded content]
  F -- mutation --> H[Check capability and approval]
  H --> I[Atomic write/edit/delete within service boundary]
  I --> J[Return changed-path evidence]
```

## 8. Skills installation and invocation

```mermaid
flowchart TD
  A[User selects local skill or repository URL] --> B[Validate repository/ref/path]
  B --> C[Fetch selected repository content]
  C --> D[Inspect instructions and scripts]
  D --> E[Store metadata and content locally]
  E --> F[User enables skill]
  F --> G[Check compatibility and instruction boundaries]
  G --> H[Add instructions to applicable model context]
  H --> I[Tools still require normal policy]
```

## 9. Slash command

```mermaid
flowchart TD
  A[Input begins with slash] --> B[Parse command name and args]
  B --> C{Known command?}
  C -- no --> D[Return help or unknown-command result]
  C -- yes --> E[Validate arguments]
  E --> F[Run command handler]
  F --> G{Mutation or side effect?}
  G -- yes --> H[Apply relevant permission/confirmation]
  G -- no --> I[Format result]
  H --> I
```

## 10. Session creation and persistence

```mermaid
flowchart TD
  A[Create or open session] --> B[Validate id and workspace selection]
  B --> C[Load conversation and settings]
  C --> D[Render messages]
  D --> E[Send, rename, pause or delete]
  E --> F[Route action to session service]
  F --> G[Serialize read-modify-write]
  G --> H[Atomically persist JSON]
  H --> I[Refresh client snapshot]
```

## 11. Roadmap and teaching

```mermaid
flowchart TD
  A[Choose roadmap or topic] --> B[Load local roadmap/teaching bank]
  B --> C{Explicit external sync?}
  C -- yes --> D[Fetch configured source]
  C -- no --> E[Use local material]
  D --> E
  E --> F[Present step or lesson]
  F --> G[User answers]
  G --> H[Grade against bank or configured model task]
  H --> I[Persist progress]
  I --> J[Suggest/reveal next step]
```

## 12. Playground

```mermaid
flowchart TD
  A[Open practice session] --> B[Load or create local session]
  B --> C[Choose exercise and language]
  C --> D[Edit in CodeMirror]
  D --> E{Run exercise or ask AI?}
  E -- exercise --> F[Evaluate expected result]
  E -- AI --> G[Route prompt to configured model]
  F --> H[Show result/feedback]
  G --> H
  H --> I[Save session/progress]
```

## 13. Windows automation

```mermaid
flowchart TD
  A[Submit Auto task] --> B[Check model and computer scope]
  B --> C[Observe allowlisted windows/apps]
  C --> D[Local model proposes an action]
  D --> E[Validate app, target, bounds and permissions]
  E --> F{Input action?}
  F -- yes --> G[Ask for one-time user approval]
  F -- no --> H[Run permitted observation]
  G -- denied --> I[Record denial or stop]
  G -- approved --> J[Restore/focus target and dispatch input]
  H --> K[Inspect resulting state]
  J --> K
  K --> L{Verified and continuing?}
  L -- yes --> D
  L -- no --> M[Report outcome; revoke on stop]
```

## 14. Failure, cancellation and recovery

```mermaid
flowchart TD
  A[Request/tool running] --> B{Abort, stop or timeout?}
  B -- no --> C{Success?}
  C -- yes --> D[Persist final state and return]
  C -- no --> E[Sanitize error and retain partial evidence]
  B -- yes --> F[Abort request/process/bridge action]
  F --> G[Mark cancelled or partial]
  E --> H{Safe retry?}
  H -- yes --> I[Retry within configured bound]
  H -- no --> J[Surface failure without claiming success]
  I --> A
```

The charts are conceptual summaries. Exact action schemas, approval IDs and
retry behavior belong to the referenced route/service files and companion
protocol; read those before adding a tool.
