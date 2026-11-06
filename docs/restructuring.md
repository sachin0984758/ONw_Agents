# Repository restructuring — 2026-10-26

## Scope and baseline

The active repository is `C:/Users/SACHIN/OneDrive/Desktop/Test`, branch
`qa/full-app-audit`. The application is Next.js 16.4.3 / React 19 / TypeScript,
running on Node 24.18.0 with npm 11.16.0. Entry points are `src/app/page.tsx`,
`layout.tsx`, `design-studio/page.tsx`, the App Router API handlers and
`scripts/start-local.mjs`. Python and the independent terminal package are optional.

The initial working tree already contained extensive tracked and untracked
feature changes. Those were preserved; no commit, reset, clean, checkout or push
was performed. The baseline file list, status, source snapshots and command logs
are in `.verification/modernization/`. Secret values and runtime databases were
excluded from inspection/snapshots. Public media and user output were preserved.

Discovery covered the whole tracked/non-ignored source inventory, including the
terminal package, infrastructure, tests, scripts, configuration and Markdown.
An initial 344-file text scan was extended to include shell tests, requirements
and extensionless configuration. The final [file-by-file CSV](repository-audit.csv)
records structural classification and hashes. This is targeted semantic inspection
plus a complete structural source audit, not a claim of manually reading every
line or exercising every user workflow.

| Baseline check | Result before cleanup |
|---|---|
| TypeScript | Passed |
| Lint | Failed: generated `output/computer-use/workspaces/.../auto-smoke.cjs` was treated as app source |
| Build | Next compilation succeeded; Windows failed on the final Unix `cp` command |
| Legacy agent regression | 457 passed; optional live-server checks skipped |
| Chat isolation | 45 passed |
| Session controls / real fixture file operations | 39 / 67 passed |
| Terminal package | 55 passed |

During baseline capture, one Node startup failed under memory pressure; retrying
serially worked. One multimodal invocation printed 26 passing checks but then
aborted in Node's Windows async-handle shutdown. It was recorded as a failed
invocation, not a pass; both subsequent complete application test runs exited
successfully. No model was unloaded or system setting changed to run checks.

## Before and after

| Responsibility | Before | After |
|---|---|---|
| Chat persistence | Separate thread schemas/readers in two HTTP handlers | `chat-store.ts` owns shared thread/history paths, CRUD, bounds and serialization |
| Chat quiz contract | Mixed into an 851-line transport/storage/model handler | Pure request/topic/format functions in `chat-quiz.ts`; transport route is smaller |
| Origin policy | Repeated equivalent host comparisons across routes | One `request-origin.ts`; Auto retains its stricter localhost/consent checks |
| Relative workspace paths | Duplicate normalizers in tool/store modules | `session/paths.ts`; original error messages and downstream realpath checks retained |
| JSON writes | Handwritten temporary-file sequences in session/workspace stores | Existing `fs-atomic.ts` used consistently; failed writes clean their own temporary file |
| Session fallback snapshot | Identical initialization in Tasks and legacy Sessions | Shared `session-state.ts`; legacy functionality retained |
| Installation versus selected folder | Companion lookup reused default workspace resolution | Companion resolves the installation root independently from user workspaces |
| Windows build | Unix `cp`; hardcoded `.next` asset location | Node build/staging script supports Windows and `NEXT_DIST_DIR` |
| Developer checks | Many individually named commands; no root test/typecheck entry | `npm test`, `npm run typecheck`, and reproducible repository audit |
| Documentation | No root README; historical reports mixed with current guides | Current README/architecture/development/testing; eight reports preserved in `docs/history/` |

No data/schema migration is required. Public API paths, payloads, model providers,
storage filenames, JSON formats, workspaces, approval gates, roadmap content,
teaching modes, quizzes, code rendering and mascot assets retain their contracts.
Chat rename/delete now share the chat writer's serializer; this improves
single-process coordination without introducing a second store.

## Cleanup statistics

Counts refer to source/configuration/documentation files, excluding dependencies,
generated builds, secret values, runtime data, binary media and output deliverables.
The audit CSV itself is an output of the audit and is excluded from its own count.

| Metric | Result |
|---|---|
| Files structurally audited | 366 |
| Files retained at their final paths | 366, including the 8 relocated documents |
| Files moved | 8 documentation files; the original root walkthrough also has a short compatibility pointer |
| Files with responsibilities merged | 19 consumers; these files remain, with shared implementation extracted |
| Files refactored under the audit's primary classification | 6 |
| Files deleted | 0 |
| Files requiring review | 42, retained |
| Dependencies removed | 0 |
| Exact duplicate source files | 0 found before or after |
| Application assertions passed | 1,527 across 22 suites; 12 optional live-server checks skipped |
| Additional verification | 55 terminal tests and 25 production smoke checks passed |

Classification counts overlap operational statistics: a merged consumer remains
a retained file. The initial working-tree changes are not counted as new work
in this report.

## Resulting directory structure

```text
Test/
├── AGENTS.md
├── README.md
├── PROJECT_WALKTHROUGH.md         # current orientation pointer
├── package.json / package-lock.json / bun.lock
├── next.config.ts / tsconfig.json / eslint.config.mjs
├── src/
│   ├── app/                      # pages, layout, styles, API routes
│   ├── components/
│   │   ├── agent-hub/            # existing feature views and shared session state
│   │   ├── design-studio/
│   │   └── ui/
│   ├── hooks/
│   ├── lib/
│   │   └── agent-hub/
│   │       ├── chat-store.ts / chat-quiz.ts / request-origin.ts
│   │       ├── db-path.ts / fs-atomic.ts
│   │       ├── session/          # conversations, tools, paths, workspaces, approvals
│   │       └── computer/         # Auto bridge/runtime/contracts/preferences
│   └── types/
├── scripts/                      # build, startup, setup, audit, regression checks
├── docs/
│   ├── architecture.md / development.md / testing.md
│   ├── restructuring.md / repository-audit.csv
│   ├── auto-computer-use.md / chat-teaching-format.md / n8n-setup.md
│   └── history/                  # 8 preserved reports
├── agenthub-computer/            # Python companion + requirements
├── AgentHub-CLI/            # independent CLI + tests
├── agenthub-vm/                  # prepared only; installation remains cancelled
├── tests/ / examples/ / mini-services/ / prisma/
├── public/                       # original assets preserved
├── db/ / output/                 # local data and deliverables preserved
├── Caddyfile / components.json / postcss.config.mjs / tailwind.config.ts
├── run.bat
└── worklog.md                    # original notes retained, archive paths updated
```

The tree groups related filenames on a line and omits generated/dependency
directories. It describes existing directories, not a proposed replacement layout.

## Verification and limitations

| Final check | Observed result |
|---|---|
| TypeScript / ESLint | Passed |
| Default application tests | 22/22 suites, 1,527 passing checks, 12 skips |
| Independent terminal tests | 55/55 passed; terminal source unchanged |
| Production build | Passed with `.next-modernization`, separate from the running dev cache |
| Production runtime | Bound to `127.0.0.1:3107`; 25 smoke checks passed with isolated DB storage |
| Actual serving root | Production and original dev server reported the complete OneDrive project |
| Browser | Chat, Sessions, Playground and Auto inspected; production Playground screenshot saved |
| Import graph | No cycles, unresolved local imports or client-to-native/filesystem leaks detected |
| Git diff | Whitespace check passed; existing dirty tree retained; no Git history operations |

Evidence is under `.verification/modernization/`: before/after logs,
`tests/results.json`, `audit-after.json`, `production-smoke.json`, and
`production-playground.png`. Temporary test chats were created only in the isolated
production fixture and removed by their exact generated IDs. No user chat or
project file was deleted by the smoke check.

The 12 skips are legacy checks expecting a server on port 3001. The initial
Playground run also skipped two provider-fixture cases while port 1234 was in
use; the final run exercised those cases and passed 260 Playground assertions.
Those provider cases use mocks. At final browser verification no loaded local
model was detected, so fresh model inference and real desktop-input workflows
were not rerun or represented as verified by this restructuring.

The build still emits 11 dynamic-filesystem tracing warnings from file/skill
access and an external-lockfile warning. It passes, but broad filesystem tracing
and portable standalone packaging remain deployment concerns. The locally
installed Python environment intentionally stays outside Next's traced bundle.

The isolated production test server was stopped through its own terminal session;
the original development server remains running on port 3000. Automatic approval
review rejected a combined process-stop/recursive-cleanup command without a
specific reason. Generated audit caches and replay scripts were left intact under
ignored verification/build paths; no source or user-data cleanup was attempted
through an alternative destructive command.

## Remaining review decisions

- The large legacy `agent-session.ts` and old Sessions component retain unique
  teaching/design/team behavior. Retire them only after migrating those consumers
  and replacing their legacy tests. The active shell imports only the current view.
- Unreferenced shadcn primitives and `use-explain.ts` are retained as uncertain
  library/integration code. Filename/import similarity alone is not deletion proof.
- Prisma scaffolding, the Bun lockfile, sample WebSocket code, Caddy and Bash
  deployment tests remain optional/legacy integrations; no destructive database
  scripts were executed and no package removal was guessed.
- JSON serializers coordinate one server process, not multiple competing hosts.
  Public hosting still requires a broader authentication/isolation design.
- Existing filesystem-policy enforcement remains in its file/exec route modules;
  extracting those into independent services is future work, not concealed by a
  wrapper-only relocation.
- VM installation remains cancelled. This cleanup grants no additional native
  application permissions and does not implement a guest isolation boundary.

## Change manifest

| Action | Files / responsibility |
|---|---|
| Add authoritative modules | `src/lib/agent-hub/{chat-store,chat-quiz,request-origin}.ts`, `session/paths.ts`, `src/components/agent-hub/session-state.ts` |
| Consolidate callers | Both chat routes, common API origin consumers, Tasks/legacy Sessions, session store/tools/workspaces |
| Refactor infrastructure | `fs-atomic.ts`, `db-path.ts`, computer bridge installation-root lookup, startup/build scripts, lint scope |
| Add verification entry points | `scripts/build.mjs`, `check-project.mjs`, `check-storage-boundaries.ts`, `audit-repository.mjs`; package scripts |
| Update fixture imports | Chat, file-operation, Playground and Skills test harnesses import the actual extracted modules |
| Archive | Seven historical `docs/*.md` reports to `docs/history/`; original walkthrough to `docs/history/project-walkthrough-2026-10-24.md` |
| Preserve compatibility | Root walkthrough pointer, existing package manager/lockfiles, routes, schemas, errors and data formats |
| Delete | No source files, dependencies, user notes, runtime databases or deliverables |

Only documentation links changed location. Start from the new README; existing
API clients and saved sessions need no migration.
