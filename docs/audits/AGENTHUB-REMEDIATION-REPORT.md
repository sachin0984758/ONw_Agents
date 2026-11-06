# AgentHub Remediation and Quality Audit

**Reviewed:** 2026-10-31  
**Workspace:** `C:\Users\SACHIN\OneDrive\Desktop\Test`  
**Branch:** `qa/full-app-audit` (already 3 commits ahead of its upstream at review time)

## Chat, Sessions and Auto live verification — latest, 2026-10-31

Tested the existing production build on a separate loopback instance with a fresh
temporary DB/workspace, using loaded LM Studio `minicpm-v-4.7-35b-a3b`. The user's
instance on port 3000 was observed idle before testing and remained idle afterward.

| Surface | Actual live verification | Result |
|---|---|---|
| Chat | Observed 35 streamed delta events, exact random response code, follow-up memory, and four persisted messages. | PASS |
| Sessions | Explicit `/other` agent selected; actual input-file read, approval before the named output write, exact filesystem contents, explicit readback, saved-turn reload, soft deletion and restoration preserving the turn. | PASS |
| Auto permissions | Read-only input request refused before inference or native dispatch; off/cross-origin/invalid control requests refused. | 7 checks PASS |
| Auto native/DOM | Real new empty Notepad tab: Unicode/multiline typing, replacement, large text, stale-target refusal, native readback, capture, real pointer selection and Stop interruption. Own isolated local-browser fixture: fill/read/click/select/scroll/navigation and host restrictions. | 39 checks PASS on retry; no skips |
| Auto with loaded model | Answered from actual desktop observation, respected read-only mode, Pause/Resume reached the controller, native launch proposal reached approval and was declined without dispatch, Stop cancelled a real generation and disabled input. | 10 checks PASS |
| Auto workspace tools | Explicit temporary-folder write grant; real model proposed only the exact allowed test file, approved write, explicit readback verified against disk; no desktop input, no unexpected files, control disabled at completion. | 9 checks PASS |

**Limits and findings:** Windows initially refused the Notepad focus request; the
first acceptance invocation stopped before typing. Native foreground activation
also needed a refreshed-window retry. After that recovery, the complete 39-check
native/DOM invocation passed. This remains an intermittent focus reliability
limitation, not an unconditional unattended-desktop guarantee. The test used a new
empty tab and did not edit the document that Notepad restored on launch. The
unsaved synthetic Notepad tab remains available for inspection. Disconnect closed
the test companion's isolated browser and disabled test control.

Codex's browser-control tool reported **local browser use disabled in Work
settings**. Therefore Chat/Sessions front-end browser interaction was not inspected;
their live streaming/API/persistence/tool flows were verified. Auto's own browser
fixture was exercised through the application under test, which is separate
coverage from front-end inspection.

The old `scripts/check-computer-workflow.mjs` expected a `run_command` tool, but
Auto's current catalog imports Session file tools and exposes no command tool.
No command capability was added. The acceptance fixture was corrected to test
supported write/readback behavior, grant `workspaceAccess: 'write'` explicitly,
and use an OS temporary folder. `docs/testing.md` and `docs/auto-computer-use.md`
now state this limitation; earlier command claims in historical sections are not
current runtime evidence.

Evidence: `.verification/chat-session-auto-live-20261031/` contains
`chat-session.json`, `chat-session.log`, `auto-permissions.json/log`,
`auto-native.log` (initial focus failure), `auto-native-retry.log`,
`native-retry-acceptance.json`, `native-retry-notepad-verified.png`,
`auto-model.json/log`, and `auto-workflow.json/log`. Files named
`preexisting-not-current-*` are preserved prior artifacts and are explicitly not
evidence for this run. Existing output evidence was restored after collecting
fresh copies. The two Chat/Session smoke flows do not report elapsed timings
because that runner did not capture reliable timing values.

Application source was unchanged. The fixture/docs changes above passed strict
lint and TypeScript validation. No production-readiness or untested UI claim is
made. All test control was stopped/disconnected after verification.

## Real LM Studio verification — latest results, 2026-10-31

**The local-model blocker is now resolved for the tested workflows.** LM Studio was reachable and `minicpm-v-4.7-35b-a3b` was loaded. The model was used as found; no model downloads, installs, loading/unloading, or model switching were performed. Older BLOCKED entries below describe the earlier unavailable-provider snapshot.

| Actual local inference test | Verified result |
|---|---|
| Model discovery | Loaded, chat-compatible MiniCPM model discovered through the application's real provider stack. Ollama remained unavailable. |
| Streaming, document input, token usage and chat persistence | PASS: streamed the exact attached verification code, reported tokens, and saved both chat messages. |
| Interactive quizzes and teaching gate | PASS: five complete scoreable MCQs; Advanced Step 1 returned a question and stopped before later steps. |
| Playground prediction and debugging | PASS: predicted `5` and identified division by zero using actual local inference. |
| Cached roadmap lesson | PASS on retest with its required cache fixture present: local graph, Introduction topic, branch choices, no external links, and 1,055 actual model tokens. |
| Session creation, real tool call and persistence | PASS: selected a temporary folder, created a real session, called `read_file`, returned exact fixture bytes and reloaded the saved completed turn. |
| Explicit agent selection and skill execution | PASS: `/other` selected the General Task Agent, activated the validated temporary `audit-proof` skill, read a random input, and wrote the skill's independent random token plus the input. The token was available only through skill instructions, not the user prompt. |
| Approval and output verification | PASS: the file did not exist before approval; only the named temporary `proof.md` write was approved. Actual filesystem bytes and the model's subsequent `read_file` of that output were verified. |
| Denial and cancellation | PASS: a real proposed write was declined, no `denied.md` was created, and the model reported the refusal. A separate real generation was cancelled and its cancelled turn persisted. |

The broad acceptance run initially passed 7/8 workflows. Its sole failure was a missing cached roadmap in the deliberately fresh test database, before inference. The existing public `data-analyst` graph and cache index were copied into that isolated DB; the separate actual-model retest passed. The original failure is preserved in evidence. This was test fixture preparation, not an application or model fix. Effective coverage is all eight broad workflows plus all three added skill/approval/cancellation cases.

Evidence is preserved in `.verification/lmstudio-connected-20261031/`: `live-results.json`, `run.log`, `roadmap-retest.json`, `agent-skill-results.json`, and `agent-skill-run.log`. Existing finalization results were backed up and restored. Test databases, workspaces and the local skill library were isolated from user data; fixture artifacts remain under the OS temporary directory for diagnosis. The production test server was stopped afterward.

Added `scripts/check-live-agent-skill.ts` and documented its opt-in invocation in `docs/testing.md`. Final `npm run typecheck` and `npm run lint` pass with zero warnings. No application implementation change was needed for these live results; previously passing default suites/build were not repeated unnecessarily.

Remaining limits: this verifies one loaded model, explicit `/other` agent selection, and instruction-based skill activation, not every model or agent, arbitrary skill scripts, restart recovery, native computer control, or visual browser behavior. The large stateful orchestration module and owner review of inherited changes remain open. These results do not establish production readiness.

## Final remaining-issues follow-up — 2026-10-31

This section supersedes the earlier snapshot below. The historical findings and results remain preserved for comparison.

| Task | Status | Current evidence |
|---|---|---|
| Real local-model verification | **BLOCKED** | Actual provider discovery returned LM Studio unavailable and Ollama unavailable, both with zero models. The isolated production API returned zero loaded models/online providers; real session creation returned HTTP 400 with `No local model provider is reachable. Start LM Studio or Ollama, then retry.` No inference, model tool call, model agent selection, or model skill execution is claimed. |
| Working-tree review | **Inventory completed; intent review remains open** | Every original status entry is classified in `AGENTHUB-WORKING-TREE.csv`, expanded into per-file records. Hash/content-pattern review covers eligible text and binary files; sensitive filenames are not read, symlinks are not followed, and large files are labeled metadata-only. This is not a claim of exhaustive human semantic review or known authorship. |
| Incremental session refactor | **Three extractions completed; broader debt PARTIAL** | Extracted pure outcome calculation, code highlighting, and HTTP transport. Each extraction separately passed 462 runtime assertions before proceeding. Existing exported interfaces are preserved. The main module decreased from approximately 4,650 to 4,504 lines by the same PowerShell counting method. Shared singleton orchestration, agent roster, approvals and task state remain together. |
| Three image warnings | **FIXED with one documented exception** | Profile images use `next/image` with their existing 40/32 pixel sizing, classes, and original unoptimized bytes. Live screenshots retain native image geometry for pixel-coordinate click mapping; they decode asynchronously and use one scoped, explained lint exception. Screenshots are not proxied/recompressed. Final lint has zero errors and zero warnings. No browser visual-quality test is claimed. |
| Final validation | **PASS for available checks** | Root typecheck, lint, all 33 suites/1,882 assertions/zero skips, terminal typecheck and 55 tests, production build, and structural import scan all pass. Real-model workflows remain blocked as above. |

### Real-model prerequisites and reproducible commands

The discovery evidence was captured at `2026-10-31T07:15:58Z`; the production API attempt was captured at `2026-10-31T07:16:20Z`. Neither configured provider was reachable. A process check also found no LM Studio, llmster, Ollama, llama-server, or lms process. No model or software was downloaded or installed.

To unblock: start LM Studio's local OpenAI-compatible server at the endpoint expected by this checkout (`http://127.0.0.1:1234/v1`), load an already-installed chat-compatible model, and confirm it appears in discovery as available and loaded. Ollama on its configured local endpoint is an alternative. A provider listing a model is insufficient unless it can actually serve that model. Then start a separate loopback AgentHub instance with an isolated `AGENT_HUB_DB_DIR` and temporary `AGENT_SESSION_WORKSPACE`, set `AGENTHUB_TEST_URL` to its URL, and run:

```powershell
npm run check:live-finalization
node --import tsx scripts/check-live-four-agents.ts
```

The first exercises real streamed responses, persistence, teaching/Playground and a read-only agent/tool workflow. The second uses temporary registered folders and approves only each fixture's specifically named file mutations. Real model skill execution and model failure/approval behavior must also be observed before claiming the complete requested workflow has passed. The already-passing mocked provider and terminal fixtures do not substitute for those observations.

### Reviewable working-tree groups

The initial 275 status entries were preserved. The new review script adds one status entry; manifests provide the snapshot count and timestamp. Directory entries are expanded into individual files. Review the CSV by `category`, with the inherited `entry` column preserving the original status grouping:

1. Root dependency/configuration changes.
2. Application implementation and verification/build tooling.
3. Companion packages reviewed independently from the application.
4. Documentation/history and binary/design assets.
5. Embedded user deliverables kept separately from application changes.
6. All inherited deletions, whose intent remains an owner decision.

The 42 inherited deletions include legacy views, UI wrappers, one hook, the unused database singleton and an empty placeholder. The structural scan finds no unresolved imports, but that cannot establish whether the owner wants those removals. They were left intact. Historical reports were preserved. No reset, clean, staging, commit, or push was performed.

The credential-pattern candidates are deliberate fixtures at `agenthub-terminal/tests/context.test.ts` and `scripts/check-ui-components.ts`; their contents are explicitly invalid/test key material or rejection markers. No actual credential was identified by this pattern scan. The manifest records limitations rather than asserting absence of every possible secret. Runtime data and ignored build artifacts remain outside the proposed source groups.

### Exact follow-up changes and evidence

- Added `src/lib/agent-hub/session/outcome.ts`, `session/highlighting.ts`, and `session/transport.ts`; mechanically moved existing implementations without changing their logic. `agent-session.ts` imports/re-exports the same public interfaces.
- Updated `scripts/agent-session-regression.mjs` and `scripts/check-agent-session-files-e2e.mjs` to compile the new modules into disposable test runtimes. Existing outcome/highlighting/transport regression coverage passed after each move; no high-risk state/approval rewrite was attempted.
- Updated `src/components/agent-hub/shell.tsx` and `auto-computer-view.tsx` for the image handling described above.
- Added `scripts/review-working-tree.mjs`, `docs/audits/AGENTHUB-WORKING-TREE.csv`, and `AGENTHUB-WORKING-TREE.json`; updated `docs/architecture.md` and this report.
- Final root evidence: `.verification/remaining-final-tests/results.json` and its per-suite logs — 33/33, 1,882 assertions, zero skips. The prior default evidence directory was restored after the run.
- Per-extraction evidence: `.verification/remaining-outcome.log`, `remaining-highlighting.log`, and `remaining-transport.log` — each 462 passed, zero failed with the server absent. Final production-backed runtime coverage is 474 assertions within the complete suite.
- Provider evidence: `.verification/remaining-provider-discovery.json` and `.verification/remaining-real-model-attempt.json`.
- Structural evidence: `.verification/remaining-structure.log` — 559 audited source files, zero cycles, unresolved imports, client/server leaks, or server-route imports. Existing user audit CSV/JSON artifacts were restored after collecting these results.
- Final production output: `.next-final-remaining-20261031`; TypeScript configuration bytes were restored after Next's generated-path update. The isolated server used fresh test data and a temporary workspace and was stopped after verification.

The code remains suitable for continued local development/QA. Production readiness and a real model-to-agent-to-tool result are not established. Further decomposition of stateful orchestration and owner review of inherited changes remain open.

## 1. Executive summary

The stricter lint and TypeScript checks pass, the production build succeeds, and the final root suite passes all 33 suites and 1,882 assertions with no skipped checks while the local server is available. The terminal package passes all 55 tests. HTTP-backed file, command, origin, and session-runtime regression checks also pass.

**Quality score: 8.5/10.** The score reflects verified local behavior and stronger static checks. It is held below 9 by the still-large legacy session module, the pre-existing dirty working tree whose changes cannot all be attributed, and the absence of a reachable local model for real inference workflows. This score is not a production-readiness claim.

| Audit problem | Status | Action and verification | Remaining risk |
|---|---|---|---|
| Weak ESLint protection | **FIXED** | Enabled unused-variable, unsafe-`any`, undefined-identifier, and React Hook checks; lint exits successfully. | Three localized Next `<img>` warnings remain for live image/data-URI display. |
| Outdated documentation | **FIXED** | Replaced fragile suite/module counts with source-of-truth references and documented the current architecture. | Feature-specific live-model claims remain limited by the unavailable provider. |
| Oversized `agent-session.ts` | **PARTIAL** | Moved pure request intent and file-scope policy into `session/file-intent.ts`; kept existing exports and verified regressions. | `agent-session.ts` remains about 4,650 lines and still combines runtime state, agent selection, orchestration, tools, teaching/design, and API transport. |
| Local-only security boundary | **FIXED** | Enforced loopback Host/URL, matching port, strict Origin shape, Fetch Metadata checks, and guarded n8n GET. Added hostile-origin and malformed-origin checks. | This is a local request boundary, not authentication. |
| Unreviewed working tree | **PARTIAL** | Captured final inventory, reviewed structural scan, restored six historical reports, scanned source for credential patterns, and preserved all unrelated changes. | The tree was already broadly modified; authorship and intent for every inherited file cannot be established from this checkout. |
| Incomplete live checks | **FIXED for runnable checks** | Started the project launcher on loopback with an isolated DB; all 12 previously skipped checks ran and passed. | Real local-model inference and native computer control remain blocked/unverified because those resources were unavailable. |

## 2. Original findings and verified causes

### Lint

The old ESLint configuration suppressed useful checks. The revised configuration retains the Next core-web-vitals and TypeScript presets, explicitly enables React Hooks rules and unused/`any` checks, and enables `no-undef` for JavaScript-family files with browser and Node globals. It ignores generated output, dependencies, local verification data, examples, and user-created runnable sample projects. No blanket rule suppression was added.

The stricter pass found dead imports and variables, explicit `any` types in n8n/chart handling, stale effect dependencies, a mutable-ref cleanup warning, and small purity/markup issues. These were fixed. Hook effects now use stable callbacks or stable dependencies; the session-chat event listener reads the current send callback through a ref to avoid reinstalling the listener on every render.

Three warnings remain for `<img>` in Auto and Shell. These display frequently refreshed screenshots or user profile/data-URI imagery; they are performance warnings, not lint errors. The strict rules listed above are enabled and pass.

### Documentation

`docs/testing.md` now points to `scripts/check-project.mjs` and that run's `results.json` instead of asserting a fixed suite count. `docs/architecture.md` no longer embeds a stale `agent-session.ts` line count and now lists the extracted file-intent module.

### Session module map and extraction

The legacy module imports the Design Studio, teaching, skills, and usage domains and maintains process-local runtime state. Its responsibilities include:

- session config, status, subscriptions, mode/effort, memory, workspace and persisted preferences;
- built-in/custom agent roster, selection mode, enablement, models and team snapshots;
- run planning, orchestration, cancellation, approvals, retries, verification and final outcome;
- tool definitions and dispatch, workspace/file/command API wrappers, change tracking and path scope enforcement;
- context/token accounting, truncation coaching, syntax checking and secret redaction;
- teaching/lesson and design request handling, skill selection/loading, and usage synchronization.

`session/file-intent.ts` now owns the pure request classification and write-scope rules (`detectFileIntent`, `getFileScope`, `isPathInScope`, count detection and supporting path parsing). The legacy module re-exports its prior public API, so callers and test imports remain stable. The extraction is intentionally limited: the rest of the module shares singleton state and runtime coordination, so moving it without further characterization risks changing approvals, persisted preferences, and task completion behavior.

## 3. Local-only security review

`request-origin.ts` now rejects malformed requests and non-loopback hosts. It validates both the request URL and actual `Host` as loopback and requires their ports to agree. Next dev can canonicalize the URL host to `localhost` while the socket Host is `127.0.0.1`; the policy accepts that alias only when both are loopback and the port is the same. When an `Origin` is present, it must be a valid bare origin with the same scheme and actual Host. Paths, query strings, fragments, credentials, `null`, malformed URLs, hostile origins, and cross-site/same-site Fetch Metadata are rejected. Origin-less CLI requests remain supported only on loopback.

Sensitive local API routes use this shared guard, including chat and conversation CRUD, agent/session/workspace/file/exec/model routes, skills, Playground, custom models, model preference, usage, system metrics, capabilities, UI components, and n8n. The n8n GET handler had not applied the guard even though its POST/DELETE handlers did; GET is now guarded because status, workflow, and execution records can contain local information.

The normal launcher binds Next to `127.0.0.1`; the Python computer companion also binds to `127.0.0.1`. Computer browser navigation checks allowed domains, blocks mutating network methods, and closes WebSockets through browser routing. Workspace traversal, junction escape, secret-file restrictions, `node_modules`/database write blocks, approval gates, cancellation, and out-of-scope write refusal are covered by existing regression tests.

This design does **not** authenticate users or protect against another process already running as the same local user. A user who launches Next with a custom public bind address bypasses the normal local-only launcher assumption. No WebSocket application endpoint was found; the computer browser explicitly blocks page WebSockets.

## 4. Working-tree inventory and preservation

The supplied starting audit described 270 changed/untracked entries (82 modified, 48 deleted, 140 untracked). During the resumed review, six deleted historical reports were restored with `git restore --worktree` on those exact paths:

- `docs/full-application-qa-audit.md`
- `docs/targeted-ui-runtime-fixes.md`
- `docs/teaching-agent-audit.md`
- `docs/teaching-agent-research.md`
- `docs/token-usage-audit.md`
- `docs/ui-interaction-audit.md`

The final pre-report snapshot contained 274 paths: 95 modified, 42 deleted, and 137 untracked. This report adds one new untracked file. The existing branch remains ahead by 3; no commit or push was made. No reset/clean operation was run.

The tree includes application source, scripts, documentation, assets, the separate terminal package, computer companion, VM/workflow packages, embedded sample projects, and deleted UI wrappers. Much of that state predated this remediation. It was preserved rather than reset or attributed wholesale to this work. `db/`, `output/`, and `tmp/` are now ignored to keep local runtime records, deliverables, and scratch data out of version control; only `db/.env.example` is tracked among those locations.

The source scanner audited 553 files: 505 KEEP, 3 REVIEW, 8 MOVE, 9 REFACTOR, and 28 MERGE classifications. It found no dependency cycles, unresolved local imports, client/server leaks, or server-route imports. It reported one duplicate `postcss.config.mjs` pair in embedded sample projects. The CSV and `.verification/finalization/audit-after.json` were existing user artifacts; their exact copies were restored after collecting the fresh scan summary. This report records the current results.

A filename/value-safe pattern scan found private-key marker strings only in two security/parser test fixtures; no actual credential was identified. The scan excluded `.env` files and local `db/`, `output/`, `tmp/`, build, dependency, and verification data so it did not expose or inspect private runtime records. `git diff --check` completed without whitespace errors.

## 5. Files edited for this remediation

This is the set directly edited or added for the remediation. It does not reattribute the rest of the already-dirty tree.

**Policy, docs, and module split:** `.gitignore`, `eslint.config.mjs`, `package.json`, `package-lock.json`, `docs/testing.md`, `docs/architecture.md`, `docs/audits/AGENTHUB-REMEDIATION-REPORT.md`, `src/lib/agent-hub/request-origin.ts`, `src/lib/agent-hub/agent-session.ts`, `src/lib/agent-hub/session/file-intent.ts`.

**API/security and UI/type fixes:** `src/app/api/agent/route.ts`, `src/app/api/agent-session/conversations/route.ts`, `src/app/api/agent-session/workspaces/route.ts`, `src/app/api/chat/route.ts`, `src/app/api/chat/conversations/route.ts`, `src/app/api/computer/route.ts`, `src/app/api/n8n/route.ts`, `src/components/agent-hub/agent-api-view.tsx`, `src/components/agent-hub/agent-mascot.tsx`, `src/components/agent-hub/agent-sessions.tsx`, `src/components/agent-hub/auto-computer-view.tsx`, `src/components/agent-hub/chat-view.tsx`, `src/components/agent-hub/explain/blocks.tsx`, `src/components/agent-hub/models-view.tsx`, `src/components/agent-hub/n8n-runner.tsx`, `src/components/agent-hub/playground/code-editor.tsx`, `src/components/agent-hub/session-chat-view.tsx`, `src/components/agent-hub/sessions-view.tsx`, `src/components/agent-hub/shell.tsx`, `src/components/agent-hub/skills-view.tsx`, `src/components/agent-hub/tasks-view.tsx`, `src/components/design-studio/site-renderer.tsx`, `src/hooks/use-toast.ts`, `src/lib/agent-hub/computer/model-runtime.ts`, `src/lib/agent-hub/design-engine.ts`, `src/lib/agent-hub/design-intent.ts`, `src/lib/agent-hub/n8n.ts`, `src/lib/agent-hub/skills-registry.ts`, `src/lib/agent-hub/teaching-framework.ts`, `src/lib/agent-hub/workspace-files.ts`.

**Checks and test harnesses:** `scripts/agent-session-regression.mjs`, `scripts/build-n8n-templates.mjs`, `scripts/check-agent-session-files-e2e.mjs`, `scripts/check-chat-attachments.mjs`, `scripts/check-chat-isolation.mjs`, `scripts/check-chat-multimodal.mjs`, `scripts/check-chat-normalize.mjs`, `scripts/check-deep-links.mjs`, `scripts/check-ownership-e2e.mjs`, `scripts/check-playground.mjs`, `scripts/check-runtime-models.mjs`, `scripts/check-sessions-layout.mjs`, `scripts/check-skills.mjs`, `scripts/check-storage-boundaries.ts`, `scripts/check-token-usage.mjs`, `scripts/check-ui-interactions.mjs`, `scripts/verify-verification-suite.mjs`.

**Terminal lint fixes:** `agenthub-terminal/src/cli/commands/doctor.ts`, `agenthub-terminal/src/cli/commands/headless.ts`, `agenthub-terminal/src/cli/commands/models.ts`, `agenthub-terminal/src/cli/commands/sessions.ts`, `agenthub-terminal/src/cli/tui.ts`, `agenthub-terminal/src/core/run.ts`, `agenthub-terminal/src/skills/discover.ts`, `agenthub-terminal/src/skills/install.ts`, `agenthub-terminal/src/tools/files.ts`, `agenthub-terminal/src/tools/git.ts`, `agenthub-terminal/src/tools/shell.ts`.

## 6. Verification results

| Check | Starting audit | Final run |
|---|---|---|
| Root TypeScript | PASS | PASS (`npm run typecheck`) |
| ESLint | 0 errors, but important rules disabled | PASS, 0 errors and 3 image-performance warnings (`npm run lint`) |
| Root regression | 33/33 suites, 1,858 assertions; 12 live checks skipped | 33/33 suites, 1,882 assertions; 0 skipped (`npm test`, server running) |
| Production build | PASS | PASS (`npm run build`, isolated `NEXT_DIST_DIR`) |
| Terminal package | 55/55 tests | PASS, typecheck plus 55/55 tests (`npm run check`) |
| Storage/origin/build boundaries | Earlier audit coverage | 48/48 checks pass |
| n8n integration contract | Earlier audit coverage | 28/28 checks pass against its local mock n8n server |
| Repository structural scan | 577 files in the supplied audit | 553 source files; no cycles, unresolved imports, client/server leaks, or route imports |
| Live Agent Session regression | 12 live checks skipped | 474/474 checks pass against `http://127.0.0.1:3001`; previous 12 live checks now execute |
| HTTP smoke and hostile origins | Server unavailable | `/`, Design Studio, and 11 API routes return 200; six protected API paths return 403 for a hostile Origin |

Final root test logs and `results.json` are in `.verification/audit-run-final-postextract-20261031/`. The old `.verification/modernization/tests/` artifacts were backed up and restored after each full run so prior user evidence was not overwritten.

## 7. Plug-and-play workflow review

The final unit/regression suites exercise local model discovery contracts, explicit model preferences, agent auto/manual selection, tool registration/invocation, skill inspection/install/enable/remove, file operations, workspace isolation, approvals, verification evidence, token accounting, Playground analysis contracts, and n8n workflow classification. Most of these use deterministic mock providers or route fixtures; they prove the harness behavior, not successful inference against a real model or a live n8n service.

The HTTP live run verified actual file write/read/edit/delete, command execution, secret and generated-directory blocks, provider-error redaction, chat GET, local session API availability, and same-origin protection. The session-creation request was attempted and the API returned its explicit “No local model provider is reachable” error. `/api/runtime/models` reported zero loaded and zero online providers. Therefore no real user prompt → local model → agent → tool → output-verification generation was completed. `check-live-finalization`, four-agent generation, live n8n, and native computer input were not run without their required local model, n8n instance, or authorized interactive runtime.

## 8. Remaining issues and readiness

- **PARTIAL — legacy session decomposition:** the pure scope-policy extraction is tested and stable, but the remaining 4,650-line module still owns too many runtime responsibilities.
- **PARTIAL — working-tree attribution:** inherited source, sample projects, user deliverables, and deletions are still mixed with this remediation. Review them as a separate change set before merge; do not assume every dirty file belongs to this task.
- **BLOCKED — real model inference:** start LM Studio or Ollama with a chat-compatible model, then rerun `scripts/check-live-finalization.tsx` with `AGENTHUB_TEST_URL` and an isolated `AGENT_HUB_DB_DIR`. The server must be loopback-only.
- **BLOCKED — external/native integrations:** real n8n requires an authorized test instance and credentials; native browser/input checks require their installed runtime and user-safe control of the desktop.
- **FIXED — local request protections:** security coverage is appropriate for local-first use, but there is no authentication system and this audit does not claim one.

**Readiness:** Suitable for continued local development and QA based on the verified code/build checks. Do not label it production-ready from these results: the model-backed live workflows remain unverified, no authentication exists, and the broad inherited working tree still needs an ownership/review decision.
