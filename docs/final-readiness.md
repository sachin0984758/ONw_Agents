# Final readiness — 2026-10-27

Consolidation is applied in the complete OneDrive checkout. The production build,
automated regressions and production smoke checks pass. **This is not a claim of
full production readiness:** live model acceptance, native control, optional
deployment tooling and dependency advisories have separate qualifications below.

## Repository statistics

| Metric | Final result |
|---|---|
| Text files structurally audited / retained | 363 / 363, including preserved user document helpers |
| Primary audit classifications | KEEP 320, MERGE 23, REFACTOR 9, MOVE 8, REVIEW 3 |
| Original 42 REVIEW items | 39 resolved; three VM preparation files retained with reasons |
| Files deleted this phase | 38; baseline hashes and snapshots retained |
| Files moved this phase | 0; eight earlier documentation moves preserved |
| Consolidation classification | 23 consumers/modules; includes 19 earlier consumers and four additional shared-service/data-path entries |
| Direct packages | 41 removed; one explicit Node type package added; npm tree valid |
| Deterministic verification | 1,607 app assertions + 55 CLI tests + 33 production smoke checks passed; zero failed |
| Default-suite skips | 14, explicitly explained below |
| Live model acceptance | Two of five completed rerun workflows passed; three failed; three further workflows not completed in rerun. Independent short native streaming probe passed |
| Environment gaps | Native control/VM isolation, Docker deployment and Bun-lock validation blocked or not tested |

The inventory covers tracked/non-ignored text source, configuration, tests and
documentation. Dependencies, generated builds, runtime DB, binary assets, user
output and secret values are excluded. Structural auditing is not manual,
exhaustive execution of every feature. The source snapshot has 366 files;
306 retain identical bytes, 22 were modified, and 38 proven unused files were
removed. Ten new application/test/documentation files were added. Additional
document-generation helpers under `tmp/` were preserved as user work and are
not claimed as authored AgentHub changes. The npm lockfile was updated normally.

No commit, push, reset, clean, database migration, model load/unload, permission
expansion or VM installation was performed. Source snapshots and before/after
evidence remain in `.verification/finalization/`.

## Resulting architecture

```text
Test/
├── src/app/                         # App Router pages and HTTP adapters
├── src/components/
│   ├── agent-hub/                   # Chat, Sessions, Auto, Playground
│   │   ├── explain/                 # Diagram/block rendering
│   │   ├── playground/              # Editor, tutor, visual roadmap
│   │   └── teaching/                # Legacy lesson interface
│   ├── design-studio/               # Designer and site rendering
│   └── ui/                          # Used UI primitives
├── src/lib/agent-hub/
│   ├── session/                     # Server runner, model, tools, approvals, store
│   ├── computer/                    # Auto policies, runtime and companion bridge
│   ├── workspace-files.ts           # Authoritative workspace file operations
│   ├── workspace-exec.ts            # Authoritative command/task service
│   ├── workspace-result.ts          # Transport-neutral service result
│   ├── chat-store.ts / chat-quiz.ts  # Shared persistence and quiz contracts
│   ├── llm.ts / db-path.ts          # Model transport and durable data location
│   └── ...                          # Skills, teaching, design, roadmap domains
├── AgentHub-CLI/               # Independent Node CLI and tests
├── agenthub-computer/               # Optional Python companion and requirements
├── agenthub-vm/                     # Unverified preparation; remains stopped
├── scripts/                        # Build, audit and automated/opt-in live checks
├── tests/ / .zscripts/              # Optional deployment tests/tooling
├── examples/websocket/              # Explicitly optional, independent example
├── prisma/schema.prisma             # Optional deployment schema, not app storage
├── docs/                            # Current guides, decisions, audit and history
├── public/                          # Existing served media preserved
└── db/ / output/ / tmp/             # Local data and user work preserved
```

Client components consume browser-safe contracts and API transports. Core server
tools now depend on workspace services rather than importing HTTP route handlers.
The audit reports no cycles, unresolved local imports, client filesystem/native
leaks or server-service imports of App Router handlers.

## Consolidation and fixes

| Before | Result |
|---|---|
| File/command logic lived in HTTP routes; server tools imported those routes | Two shared services; thin, origin-checked HTTP adapters; current Sessions, Auto and legacy HTTP callers use the same operations |
| Timestamp-only workspace temporary writes duplicated JSON storage machinery | Shared atomic text/JSON writer with unique names and failed-write cleanup |
| Background command task map crossed workspace boundaries | Task listing, logs and stop operations are restricted to the owning project |
| Recursive tree/search/name operations could follow outside junctions | Recursive traversal skips links; resolved targets enforce secret/protected-location checks, including internal aliases |
| Streaming/Playground provider calls omitted cancellation | Signals propagate to provider fetch and fallbacks; closing Chat SSE cancels upstream without invented history/usage; eight network regression checks pass |
| Roadmap cache used `process.cwd()` | Reader and sync script share durable DB resolution; standalone no longer hides the cache when it changes cwd |
| Broad build tracing and inferred parent workspace | Explicit project roots, runtime-data exclusions and targeted runtime-file annotations; zero final build warnings; 26 server traces checked |
| 42 generic review entries | 31 unused files deleted, seven optional contracts retained with evidence, one compatibility test corrected; three VM files remain REVIEW |
| Unused template dependencies | 41 direct packages removed; explicit Node 24 types added; npm dependency tree validates |

Seven further orphan files were deleted after their unused template consumers
were removed. The 38 deletions comprise 35 UI templates, `use-mobile`, the unused
`use-explain` hook and the unused Prisma singleton. Existing explanation APIs and
renderers remain. Each decision and baseline hash is in
[review-decisions.json](review-decisions.json); package decisions are in
[dependency-decisions.json](dependency-decisions.json).

The earlier shared chat store, quiz contracts, origin policy, relative-path
validation, serialized session storage and Tasks/legacy Sessions snapshot remain
authoritative. Their earlier cleanup is not counted as new work here.

## Legacy and optional code

`session-chat-view.tsx` is mounted for Sessions. The older `sessions-view.tsx`
remains an unmounted compatibility surface containing unique team, design and
teaching panels. `agent-session.ts` still supports Tasks, the teaching/design
pipelines and legacy regressions. These are distinct orchestration responsibilities;
they were not deleted or replaced with the older worktree. Their broader
decomposition remains technical debt. The corrected legacy layout suite is now
included in the default test run.

Prisma schema/CLI scripts, Caddy, the paired Socket.IO example and Bash deployment
tests have real configuration/entry-point consumers. They are retained rather
than treated as active Windows application features. The three remaining REVIEW
files are `agenthub-vm/Prepare-IsolatedVM.ps1`, `Verify-IsolatedVM.ps1` and
`README.md`: cancellation of VM setup and unavailable guest enforcement prevent
real isolation verification. They were not executed.

## Verification

| Check | Final evidence |
|---|---|
| TypeScript, lint, whitespace check | Passed |
| Root application suite | 25/25 suites, 1,607 assertions passed, zero failed; 14 explicitly skipped |
| Earlier restructuring baseline | 22/22 suites, 1,527 assertions, 12 skips; final run adds service, cancellation and legacy compatibility coverage |
| Skip explanation | 12 optional legacy live-server checks; two Playground provider-fixture branches because real LM Studio owns port 1234, affecting 22 conditional assertions |
| Independent terminal package | Typecheck and 55 tests passed |
| Production build and packaging | Passed; zero warnings; 26 traces contain no runtime DB, `.env`, private skills, output or verification files |
| Isolated production HTTP smoke | 33 passed: pages, CRUD, serving root, origin/path/read-only protection, Auto off and durable roadmap graph |
| Optional deployment checks | Two Bash fixture suites passed via existing Git Bash; database suite mocks Bun/Prisma, Python staging uses real temporary files |
| Prisma | Schema validates; no push/reset/migration performed |
| Python companion prerequisites | All six declared distributions detected in the existing virtual environment; this does not establish native input behavior |
| Import analysis | No unresolved imports, cycles, client/server filesystem leaks or server-to-route dependency inversion |
| Browser | Chat auto-detect shows `flint`; slash chooser/selection, roadmap opt-in, Python autocomplete and Tab acceptance verified; Auto remains disconnected/off; no browser errors observed |

The final-build rerun used an explicitly recorded 360-second client allowance.
It was stopped after repeated failures; pending checks were not converted into
passes. The original full eight-workflow attempt used 180 seconds.

| Final-build live workflow | Result | Elapsed |
|---|---|---|
| Loaded model discovery | PASS: LM Studio `flint` | 0.1 s |
| Streamed document + token usage + persisted history | PASS: verification code returned, 142 provider tokens, two saved messages | 29.1 s |
| Five interactive MCQs | FAIL: HTTP fetch failed before a complete reply; five-question generation is not certified | 302.9 s |
| Advanced Step 1 | FAIL: concept, analogy and confirmation question returned, but required Step 1 heading was missing | 278.4 s |
| Playground prediction | FAIL: HTTP fetch failed before a complete reply | 303.0 s |
| Playground debugging | Interrupted during the rerun; earlier 180-second attempt timed out | NOT VERIFIED |
| Roadmap model lesson | Not rerun after the repeated failures; earlier attempt timed out. Graph loading itself passes production smoke | NOT VERIFIED |
| Model-driven session tool completion | Not rerun after the repeated failures; earlier attempt timed out. Scripted tool/real-filesystem suites pass | NOT VERIFIED |
| Separate final shared-stream adapter probe | PASS: actual `OK.`, 51 provider tokens | 19.4 s |

The missing Advanced heading and long model-request failures are real remaining
acceptance issues. They were not hidden by changing assertions or substituting
canned content. Slow non-streaming calls can outlive a client deadline; complete
real-provider cancellation and request-budget behavior still need verification.
The test-only servers and QA process were stopped; the normal app remains on
`http://127.0.0.1:3000` with its original data. Its API reports the complete project
root, three stored conversations and 56 legacy messages; its Chat settings visibly
show `Default (auto-detect: flint)`.


| Functional area | Verification class and limits |
|---|---|
| Local model detection/selection | Real LM Studio inventory and rendered Chat/Auto selection; `flint` loaded |
| Local inference | Real non-streamed `LOCAL_READY` and final shared-stream `OK`; final short stream used 51 provider tokens in 19.4 seconds |
| Chat, streaming, persistence and tokens | Real streamed text-document response, provider usage and two saved/reloaded messages; separate production CRUD smoke and 88 ledger assertions |
| Coding sessions and tool execution | Real session/file fixtures and persistence covered; actual local-model/tool completion is reported separately in the live table |
| Commands and file CRUD | Real bounded Node processes, exit codes/output caps, create/read/edit/delete and junction tests in disposable workspaces; model planning is scripted where identified by each suite |
| Skills | 172 automated assertions; real temporary installation/validation/activation data with mocked GitHub responses. Fresh public GitHub installation and arbitrary skill side effects were not exercised |
| Playground, prediction and debugging | Real browser editor/Tab interaction, storage/prompt/transport tests; live model results listed separately. Predictions remain labelled estimates and do not execute code |
| Teaching and roadmaps | Real cached graph/durable path and opt-in controls, synthetic isolated graph tests and rendering/prompt tests; full Advanced Steps 2–5 and every roadmap are not live-certified |
| Attachments | Live text document; PDF/DOCX/ZIP/image parsing and transport automated. Native image understanding was not tested on the loaded text model |
| Approvals and computer routing | Real HTTP denials and permission-state checks plus scripted model/native transport tests. No native permission was granted for testing |
| Desktop interaction and VM isolation | BLOCKED: Auto is disconnected/off; no consent expansion. No native typing/clicking/launching or real VM confinement tested |
| Other optional integrations | Ollama, external custom providers, real n8n webhooks, Socket.IO deployment and the Docker runner were not exercised |

The initial 180-second live run passed discovery/document streaming and timed out
on six longer workflows. Those failures remain in
`.verification/finalization/live-results-before-transport-fix.json`. Reruns must
retain their actual deadline and elapsed times; a slow answer is not a fast pass.
The opt-in QA cleanup was corrected to wait for Stop to settle before deleting
its own session; the application’s running-session deletion guard remains intact.

## Remaining risks

- The original scan found seven package advisories. The reliability follow-up
  fixes the production Prism/sharp findings and moves unused Prisma tooling to
  dev dependencies. The current production scan is clean; a full dev-inclusive
  scan retains three high Prisma/deepmerge advisories. Prisma 7 is a major
  migration and was not applied without compatibility testing.
- `package-lock.json` is the verified npm lock. `bun.lock` is intentional because
  `.zscripts/` invokes Bun, but remains stale; Bun is unavailable here. Optional
  frozen-lock deployment is not approved by the npm checks.
- File restrictions and approvals are local application controls, not an OS
  sandbox. Shell/native programs can write outside a cwd; hostile concurrent
  filesystem changes and general public hosting require stronger isolation.
- JSON serialization coordinates one server process. Concurrent production
  processes sharing a DB are unsupported; tests used separate data directories.
- Native Auto, actual guest isolation, every teaching step/topic, external
  integrations and all mascot animation states remain outside verified coverage.
- The terminal runtime and legacy teaching/design orchestration remain separate;
  migrating their unique consumers needs its own compatibility work.

Current operating guides: [architecture](architecture.md),
[development](development.md), [testing](testing.md). Per-file current inventory:
[repository-audit.csv](repository-audit.csv). Test logs and before/after evidence:
`../.verification/finalization/`; default-suite logs:
`../.verification/modernization/tests/`. Browser evidence includes
`production-chat-autodetect.jpg`, `production-playground.jpg` and `production-auto.jpg` in the finalization folder.

## Reliability follow-up — 2026-10-27

The streaming adapter now consumes provider SSE for both streaming Chat and
callers that need a final string, uses a configurable bounded deadline, records
request timing and provider-reported usage without logging prompt/response
contents, reports truncated or incomplete streams as failures, and aborts cleanly
on cancellation. Chat gives MCQ requests a count-based output budget and validates
the parsed interactive questions before marking the turn complete. Advanced
Teaching applies a deterministic Step 1–5 heading and tracks one-step
confirmations in server-side request context. Provider reasoning text is no longer
sent to the browser; the UI receives only the activity-state event.

| Verification | Result | What it proves / does not prove |
|---|---|---|
| Default automated suite | 28/28 suites, 1,663 assertions, 14 documented skips, zero failures | Fixtures, routes, stream failures/cancellation, quiz parsing/scoring, lesson steps, Playground and other included app contracts; not live model quality |
| Production build | PASS with Next.js 16.4.3 | App compiles and emits standalone production output |
| TypeScript / ESLint | PASS | Static checks on the final source |
| Production dependency audit | 0 advisories | `npm audit --omit=dev`; full dev-inclusive audit still reports three high Prisma/deepmerge findings in optional Prisma tooling |
| LM Studio model inventory | PASS: `flint` is loaded | Real provider inventory only |
| Live five-question MCQ attempt | FAIL: LM Studio returned `finish_reason: length` at the 1,100-token task budget after 203.7 s; no complete quiz | A complete, scored interactive five-question quiz is not certified on `flint`; the app now surfaces partial-output failure instead of reporting success |
| Native desktop / browser visual acceptance | NOT RUN | The prior instruction selected automated checks only; no native input or UI access was used |

The standalone live helper also previously hit the output-token limit at 1,800
tokens after 208.5 seconds. LM Studio did not report usage on either failed
attempt, so output-token count and generation throughput are unknown. The new
metrics correctly avoid estimating those values as if they came from the
provider. This remains a model/task-specific quality and latency limitation;
the remaining work is to verify a compatible model or provider-side reasoning
configuration that completes the five-question format within its output cap.

Additional current-run logs: `.verification/reliability/` (build, audit,
typecheck, lint, stream fixture, and live quiz probe).
