# 18 — Architecture glossary

| Term | Meaning here |
|---|---|
| App Router | Next.js directory-driven page and HTTP-route architecture under `src/app/`. |
| Route handler | Server function for an HTTP path such as `/api/chat`. |
| Domain service | Server module that implements feature behavior independently of HTTP details. |
| Runtime/provider | A local or explicitly configured server that supplies model inference. |
| OpenAI-compatible | A request/response wire protocol supported by local and remote servers; not a statement about the server operator. |
| Model discovery | Querying a configured runtime for its model inventory/status. |
| Loaded model | A model the runtime confirms is resident/available for inference, not merely downloaded. |
| SSE | Server-Sent Events: one-way streamed HTTP events used for incremental response updates. |
| Tool calling | Structured model proposal that application policy validates before execution. |
| Approval broker | Runtime state that waits for a user's decision on a proposed action. |
| Workspace | A registered project root that app-owned file services use as a boundary. |
| Capability | A specific permission to read, modify, execute or control an app. |
| Atomic write | Replace a file in a way that avoids leaving a partially written file after interruption. |
| UI Automation (UIA) | Windows accessibility/control tree interface used to inspect and operate app windows. |
| Loopback | A network host resolving to the same machine, such as `127.0.0.1` or `::1`. |
| Local-first | Defaults favor data and model execution on the user's machine; does not imply zero network features. |
| Prompt injection | Malicious/irrelevant text in user content or tool output that tries to override model behavior. |
| Context window | Finite amount of text/tokens the model can process in one inference request. |
| Local storage | Browser-owned key/value storage; distinct from server JSON records. |
| MCP | Model Context Protocol; used by the optional Python MCP package and optionally by the terminal agent. |
| Native companion | Separate local process that performs OS-specific work on behalf of the web server. |
| Postcondition | Observable state that demonstrates an operation actually took effect. |
| Idempotency | Property that repeating an operation has the same effect as doing it once. |
| Opt-in network path | A connection initiated only after the user configures/selects/approves the destination. |
