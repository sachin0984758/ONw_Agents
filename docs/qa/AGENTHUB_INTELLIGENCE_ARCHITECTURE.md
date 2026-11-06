# AgentHub Intelligence Architecture Audit

**Checkpoint:** 2026-10-29  
**Scope:** Current shared runtime and the Chat, Sessions, Auto, and Roadmap/Teaching paths. This is an evidence-based checkpoint, not a security certification or release sign-off.

## Architecture found

AgentHub is a Next.js App Router application with server-owned providers, filesystem access, and native computer-control adapters. The current request paths share local provider discovery and inference in `src/lib/agent-hub/llm.ts`, with routing policy in `model-routing.ts`. The experiences keep separate orchestration because their permissions and persistence needs differ:

| Experience | Current path | Data and execution boundary |
| --- | --- | --- |
| Chat | `api/chat` → `chat-runs.ts` (browser lifecycle) → `model-routing.ts` / `llm.ts` | Conversation history is separate per chat; SSE updates can continue across in-page view changes. Stateless calls exclude persisted Chat history. |
| Sessions | `api/agent-session/conversations` → `session/runner.ts`, `session/model.ts`, `session/tools.ts` | Session turns and workspace registration are stored separately. File tools resolve a registered workspace and require explicit write permission and approval. Shell commands are intentionally unavailable in Agent Sessions. |
| Auto | `api/computer` → `computer/runtime.ts` → shared model responder plus the Python/native bridge | Desktop input is separately scoped, permission-gated, and approved per action. Bounded task history is durable; restart recovery marks unfinished tasks partial and discards all live authority instead of resuming execution. |
| Roadmap / Teaching | `api/playground`, `roadmap-library.ts`, `teaching-framework.ts`, and Chat teaching prompts/renderers | Roadmap graph traversal and lesson progress are local and structured. Some lesson text is model-generated; the graph resolver supplies local branches and prerequisites. |

The provider client records duration, time to first token, generation time, token usage, status, and failure stage without logging prompt text. `model-routing.ts` restricts remote providers unless remote inference is explicitly enabled; Auto has an additional local-only policy.

## Baseline and changes in this checkpoint

The initial static checks found two lint errors: the mascot read a DOM ref during render, and Chat used `activeConversation` before its declaration. An unknown Sessions tool name was also path-validated before rejection, throwing on a missing path. The isolated-session tests were coupled to a running local model, and two Chat route harnesses had not included the shared pause-control module.

Changes made:

- The mascot measures its size after render with `ResizeObserver`; Chat resolves its active conversation before constructing callbacks.
- Sessions rejects unknown tools before validating file paths, returning the expected bounded “Unknown tool” result.
- Chat makes one format-repair request if an MCQ draft fails structural validation. The stream emits a replace event only after a valid repair; the client replaces the draft instead of appending a second answer. An incomplete repair is rejected and not saved.
- Test harnesses now include `chat-control.ts`; Sessions uses a deterministic fake loaded-model response, so the folder-boundary suite runs while LM Studio is offline.
- Roadmap lesson history, active topic, graph selection, and explicit completion IDs now round-trip through the existing per-practice store with bounded field validation; no second persistence backend was added.
- The live finalization harness imports the quiz parser directly, avoiding a client-component CSS import in Node.
- The idle mascot uses a compact, low-opacity resting appearance and expands on hover/focus, avoiding a dominant overlay while preserving its saved position and controls.
- Chat now persists an explicit Concise/Standard/Detailed/Comprehensive answer-length setting separately from thinking effort; the route keeps both instructions when prompt-guided thinking is selected.
- Auto task lifecycle is durably recorded in a bounded, versioned history file; interrupted tasks are visibly recovered as partial, while screenshots, pending approvals, and live desktop permissions are never restored.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero errors and three warnings in example-project files under `lmstudio-local-agent/workspace/projects/`.
- `npm test`: 30 suites passed; 1,770 checks passed; 14 skipped. Includes deterministic Auto persistence/restart-recovery integration tests and concurrent atomic-write coverage.
- `npm run audit:repository`: 534 source files; no import cycles, unresolved local imports, or client/server leaks; 3 review items remain.
- Isolated production build with a separate Next cache: passed, including TypeScript and all 24 generated static pages.
- Isolated live run with LM Studio `spark-x2.6-4b`: streamed Chat/history, five MCQs, Advanced Step 1, Playground prediction, Roadmap Introduction choices, and a selected-folder Session read passed. Playground bug-finding first hit an output cap and then passed on a retry with a 3,000-token budget.

## Current limits

The live evidence used an isolated database and server, which were stopped after testing. MCQ generation passed with the real model, but malformed-quiz repair remains fixture-tested only. Sessions real-model mutation approval, Auto native-control acceptance, and an Auto server-restart workflow remain untested. Responsive, keyboard-only, screen-reader, and load/stress audits remain open.

The current browser acceptance pass inspected Chat, Auto, and Playground at 1280×720, Sessions at 713×720, and read accessibility trees for all four. Follow-up screenshots confirmed the idle mascot is a small subdued mark, then returns to full visibility on hover or keyboard focus. Chat's response-depth picker was exercised in the browser and its selection survived reload; the original Standard preference was restored. Keyboard-only navigation and screen-reader behavior remain untested. The focused UI interaction suite now has 60 checks.

## Next verification steps

Next, test Sessions write/delete approvals in a disposable selected folder and Auto native behavior only after confirming there is no active user task. Capture a browser screenshot and exercise Chat, Session, Auto, and Roadmap controls at desktop and narrow widths. Keep local-model outcomes separate from mock-provider and source-level results.
