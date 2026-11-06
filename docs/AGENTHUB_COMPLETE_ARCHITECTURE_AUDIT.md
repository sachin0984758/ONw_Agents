# AgentHub Complete Architecture, Capability & Readiness Audit

**Audit date:** 2026-10-28  
**Repository:** `C:\Users\SACHIN\OneDrive\Desktop\Test`  
**Scope:** Read-only inspection of the checkout as it existed for this audit. No application code or configuration was changed. The only additions are this report and `AGENTHUB_GAME_STUDIO_READINESS.md`.

## Evidence labels and limits

- **VERIFIED** means directly confirmed in source or by a command executed for this report. It does not imply every user-facing flow was exercised.
- **IMPLEMENTED, UNTESTED** means an implementation path was found, but this audit did not execute that feature end to end.
- **PARTIAL** means the feature exists with material limits described here.
- **MISSING** means no implementation was found in the inspected checkout.
- **UNKNOWN** means the available source or verification does not settle the question.

The checkout was already heavily modified before this audit began: `git status --short` showed many modified, deleted, and untracked paths, including application code, documentation, runtime data, and standalone projects. The baseline cannot be attributed to this audit. The two report files are additive; all existing work was left alone. Generated dependencies, build output, caches, databases, binary media, user deliverables, and downloaded third-party template repository contents are excluded from detailed source review. Their manifests/locations were inspected where relevant. `lmstudio-local-agent/workspace/projects/*/dist` exists as generated example output and is not treated as dashboard source.

## 1. Executive summary

AgentHub is a local-first Next.js 16 App Router dashboard with several distinct AI experiences. The general Chat sends OpenAI-compatible chat requests through a shared local/custom provider layer. The current Sessions experience is a separate server-side coding-agent loop with multi-turn tool use, per-session workspace grants, approval prompts, filesystem operations, shell execution, saved conversations, stop controls, and a bounded 32-step default. Tasks/teaching/design retain a large earlier `agent-session.ts` runtime. These are separate execution paths, not one universal agent framework.

There are also two independent companions in this repository: `AgentHub-CLI/`, a separately packaged Node CLI agent; and `lmstudio-local-agent/`, a Python MCP server with fixed project actions, game-task ledger tools, and game-development skills. The Python MCP server has a more constrained project build/preview interface than the dashboard shell runner, but the dashboard does not start or call it automatically. Their capabilities must not be attributed to the web app.

The dashboard can read and search a selected project, create/edit/delete bounded text files after session approval, and run approved shell commands subject to app-level checks. It does not currently provide a coordinated game-generation product workflow, binary asset generation, isolated code sandbox, in-dashboard Vite preview, browser console capture, Windows packaging/archive tool, durable running-task queue, or automatic repair controller. The existing game templates and separate MCP runtime are useful evidence and potential reuse, not a completed dashboard capability.

### Answer to the ten requested questions

| Question | Finding |
|---|---|
| Can current AgentHub generate a complete multi-file game? | **PARTIAL.** The Sessions agent can make multiple approved text-file changes over a tool loop. No end-to-end game workflow, quality guarantee, or binary asset generation is implemented in the dashboard. |
| Can local models create/edit an entire project? | **PARTIAL.** A compatible local model can be used by Sessions, which can make sequential approved text edits. Practical results depend on model tool-call behavior, context/output limits, timeouts, and per-file caps. |
| Can it execute development commands? | **VERIFIED in source / not exercised end-to-end here.** Sessions has `run_command`; policy, capability and session checks apply. |
| Can it install dependencies with user permission? | **PARTIAL.** Dashboard Sessions can request a shell command such as npm install and ask approval, but the arbitrary command path has no package-specific safe install transaction. The separate Python MCP runtime exposes an approved fixed npm install action using `--ignore-scripts`. |
| Automatically detect and repair build errors? | **PARTIAL.** An agent can run a check, read returned output, edit, and run a follow-up within its loop. There is no dedicated failure classifier/repair state machine or guaranteed automatic repair. |
| Preview a running Three.js game? | **MISSING in dashboard.** The standalone Python MCP can start/stop a loopback Vite server for a project; the dashboard has no project preview/browser console integration. |
| Create Windows launch scripts? | **PARTIAL.** Text-file tools can write `.cmd`/`.ps1` source with approval; no dedicated validated launcher generator is present. |
| Generate or import 3D assets? | **PARTIAL.** Text-based project import/build is possible through workspace tools; no model/texture/audio asset generator or binary workspace write exists in the dashboard. Existing Wizard Chess assets are bundled in the separate sample project as compressed base64 GLB data. |
| Package a finished project? | **MISSING in dashboard.** No ZIP/package/export tool found. The Python runtime has no packaging action either. |
| What must be added? | A project-scoped game job/checkpoint controller, template installer, multi-file/binary asset handling, safe dependency workflow, deterministic build/test and repair loop, isolated preview/console access, Windows packaging, and durable task recovery; detailed stages are in the readiness document. |

## 2. Repository overview and structure

This is a mixed workspace, not only a Next.js application. The important top-level layout is:

```text
Test/
├── .agenthub/                         # installed skills + separate website template reference library
├── agenthub-computer/                 # optional Python desktop controller
├── AgentHub-CLI/                 # independent Node CLI agent, tests, docs
├── agenthub-vm/                       # VM preparation/verification scripts; not exercised
├── db/                                # local JSON persistence and chat-thread data
├── docs/                               # architecture, operations, historical QA and audit docs
├── examples/websocket/                 # standalone websocket example
├── lmstudio-local-agent/               # independent Python MCP agent, game skills and projects
│   ├── agent_env/                      # workspace/project/skill tools and MCP server
│   ├── skills/                         # game, browser and 3D development instructions
│   └── workspace/projects/             # example projects, including Desk Racer and Wizard Chess 3D
├── prisma/schema.prisma                # optional schema/CLI artifact; not dashboard persistence
├── public/                             # static logo, Auto page, n8n workflow JSON/media
├── scripts/                            # launcher/build, structural audit and verification scripts
├── src/
│   ├── app/                            # Next App Router UI and HTTP routes
│   ├── components/agent-hub/           # dashboard views, session/chat/playground features
│   ├── components/design-studio/       # site designer and renderer
│   ├── components/ui/                  # shadcn-style primitives
│   └── lib/agent-hub/                  # domains, persistence, model, tool and service code
├── tests/                              # container/build shell checks
├── upload/, download/                  # local transfer areas (not active feature code)
└── package.json / package-lock.json / bun.lock / config files
```

### Main `src` tree

```text
src/app/
  page.tsx; layout.tsx; globals.css
  design-studio/page.tsx
  api/route.ts
  api/agent/route.ts; api/chat/route.ts; api/chat/conversations/route.ts
  api/agent-session/{conversations,exec,files,models,workspaces}/route.ts
  api/computer/route.ts; api/custom-models/route.ts; api/explain/route.ts
  api/model-preference/route.ts; api/n8n/route.ts; api/n8n-templates/[id]/route.ts
  api/playground/route.ts; api/runtime/models/route.ts; api/skills/route.ts
  api/system-metrics/route.ts; api/ui-components/route.ts; api/usage/route.ts
src/components/agent-hub/
  shell.tsx; overview.tsx; chat-view.tsx; agents-view.tsx; session-chat-view.tsx
  sessions-view.tsx (legacy/compatibility surface); tasks-view.tsx; changes-view.tsx
  auto-computer-view.tsx; playground-view.tsx; skills-view.tsx; models-view.tsx
  settings-view.tsx; agent-api-view.tsx; ui-components-view.tsx; system-console.tsx
  teaching/{teaching-panel,lesson-renderer}.tsx
  playground/{code-editor,code-editor-langs,code-editor-theme,split-divider,
    feedback-panel,playground-extract,roadmap-diorama,roadmap-tutor-panel,
    interactive-background,excel-grid,split-layout}
  marketplace/{client,component-details,component-preview,preview-document}.tsx/ts
  explain/{blocks,flow-diagram}.tsx; shared.tsx; session-state.ts; tracked-sessions.tsx
src/components/design-studio/
  designer-panel.tsx; generated-site.tsx; site-config.{ts,json}; site-renderer.tsx
src/components/ui/
  badge,button,card,hover-card,input,popover,progress,scroll-area,select,switch,
  toast,toaster,tooltip
src/lib/agent-hub/
  agent-session.ts (large legacy task/teaching/design runtime)
  llm.ts; model-routing.ts; custom-models.ts; model-preference*.ts
  session/{agents,model,navigation,paths,permissions,runner,runtime,store,tools,
    types,workspaces}.ts
  workspace-{files,exec,result}.ts; fs-atomic.ts; db-path.ts; state-file.ts; store.ts
  chat-{runs,store,settings,types,quiz}.ts; attachments.ts; document-extract.ts
  skills*.ts; marketplace/{catalog,installer,registry,types}.ts
  computer/{access,bridge,model-runtime,model-selection,preferences,protocol,runtime}.ts
  teaching-*.ts; advanced-lesson.ts; teach-prompt.ts; task-guidance.ts
  playground-*.ts; roadmap-library.ts; design-*.ts; n8n*.ts; usage/token modules
```

The report tree is deliberately a readable application/source outline rather than a listing of every runtime JSON, generated asset, lockfile, or installed dependency. `rg --files` established the application/source/config/docs inventory. Focused source reads traced the model, session, tool, persistence, route, workspace, skill, marketplace and companion execution paths; feature-specific view files were inspected for their imports/state and UI actions. The downloaded third-party template trees and all unrelated user deliverables were not read file-by-file. The standalone game project source and MCP files were inspected. No exact repository-wide file total is asserted here.

### Important files, responsibility, consumers and status

| File(s) | Responsibility and exports/consumers | Active status / concern |
|---|---|---|
| `src/app/page.tsx`, `layout.tsx`, `components/agent-hub/shell.tsx` | Dashboard entry, provider/layout, navigation/view switch. Shell links Overview, Chat, Agents, Sessions, Auto, Plan/Tasks, Changes, Playground, UI Components, Models, Settings, Agent API. | Active, source-confirmed. A single shell contains many feature views rather than separate route pages. |
| `src/lib/agent-hub/session/runner.ts` | `startTurn`, `compactTranscript`, `runConversation`; central current Sessions loop. Calls injected model/tool/approval/save dependencies. | Active in `api/agent-session/conversations`. A second large runtime remains for other agent workflows. |
| `src/lib/agent-hub/agent-session.ts` | Agent roster/state, planning, tool parser, coding sessions, design/teaching pipelines, verification, cancellation. Exports dozens of helpers; ~5.2K lines by source inspection. | Active for Tasks/teaching/design and regression coverage; broad responsibilities and overlap with Sessions are architectural debt. |
| `src/lib/agent-hub/llm.ts` | Local/custom model discovery, target selection, OpenAI-compatible completion and streaming, usage parsing, fallbacks. Used by Chat/Sessions/other server routes. | Active. Provider-specific behavior and tool support are capability dependent. |
| `src/lib/agent-hub/workspace-files.ts`, `workspace-exec.ts` | Shared server services used by Sessions tools and HTTP file/exec routes. | Active. Local machine trust boundary, not OS sandbox. |
| `src/lib/agent-hub/session/{permissions,workspaces,store,runtime}.ts` | Workspace registration, per-session grant, JSON conversation store, in-process active runs/approvals/stop. | Active. Run state is process memory; persisted transcripts are durable. |
| `src/lib/agent-hub/chat-store.ts`, `chat-runs.ts` | Chat thread persistence and client-side in-page request registry, streaming/cancel/resubscribe. | Active. In-page stream continuity does not survive reload or process restart. |
| `src/lib/agent-hub/state-file.ts`, `db-path.ts`, `fs-atomic.ts` | Dashboard JSON state, durable data-root resolution, atomic file writes and in-process serialization. | Active. JSON storage is single-process coordination, not multi-instance DB transaction semantics. |
| `src/lib/agent-hub/skills-registry.ts`, `skills-github.ts`, `skills-compat*.ts`, `skills.ts` | Skill registry, GitHub source inspection/install, validation and runtime instruction reads. | Active. Skills are instructions/data, not executable plugins. |
| `src/lib/agent-hub/marketplace/installer.ts` | UI component proposal, exact-source approval, snapshots and rollback. | Active and distinct from AI agent skills. React-source only. |
| `src/components/agent-hub/playground-view.tsx`, `playground/code-editor.tsx` | Code/teaching playground and CodeMirror integration. | Active, but not a workspace IDE or project preview server. |
| `AgentHub-CLI/src/core/run.ts` and `src/tools/*` | Independent Node CLI loop/tools/policy/authorization. | Separate npm package; dashboard does not invoke it. Its capabilities are not web UI capabilities. |
| `lmstudio-local-agent/agent_env/{server.py,core.py}` | Independent Python MCP server with bounded workspace, project action and game-planning tools. | Separate MCP process. Not imported by Next routes; local game examples and skills live alongside it. |

## 3. Technology stack and dependency audit

The declared versions below come from root `package.json`; installed versions were read with `npm ls --depth=0`. The install succeeded with an internally consistent tree (exit 0); this is not a security advisory audit.

| Technology | Declared / installed | Use and notes |
|---|---|---|
| Next.js | `^16.4.3` / 16.4.3 | App Router, route handlers, standalone output. The installed config includes the security agent upgrade experiment. Repository `AGENTS.md` warns this Next build has breaking changes and requires local bundled docs before code edits; no app code was edited. |
| React / React DOM | `^19.0.0` / 19.3.0 | UI and server/client components. |
| TypeScript | `^5` / 5.9.3 | Strict mode enabled, but `noImplicitAny: false`; current typecheck did not pass (see verification). |
| Tailwind | `^4` / 4.3.3; PostCSS v4 plugin | Global CSS and utility styling. `tailwind.config.ts` still contains a legacy content scan/config layout; actual styling primarily uses CSS variables/classes. |
| shadcn/ui | `components.json`: `new-york`, CSS variables, aliases | shadcn-compatible configuration and locally copied UI primitives under `src/components/ui`. No registry CLI dependency or 21st.dev integration was identified. |
| Radix UI | root direct packages: hover-card, popover, progress, scroll-area, select, slot, switch, toast, tooltip | Accessibility/interaction primitives backing UI. The installed versions are newer within declared ranges. |
| CodeMirror 6 | `codemirror`, `@codemirror/*` language/state/view packages | Playground editor, syntax modes for JS/TS, HTML, CSS, JSON, Python and other languages. Not a full IDE, LSP or terminal. |
| Model client | No vendor AI SDK; native `fetch` in `llm.ts` | OpenAI-compatible HTTP APIs for LM Studio, Ollama and custom endpoints. Gives direct control over SSE parsing, cancellation, tool parsing and usage. |
| Three.js | `^0.186.1` / 0.186.1 | Installed at dashboard root; standalone Desk Racer/Wizard Chess projects also declare three.js. Root dashboard has no game studio scene/preview feature. |
| Charts/visuals | Recharts 2, D3 force 3, lucide-react | Token/dashboard charts, agent network visualization, icons. |
| State | Zustand 5; React state/hooks | Dashboard state/store; durable state remains server JSON files. |
| Validation/formatting | Zod 4, clsx, class-variance-authority, tailwind-merge, react-markdown, remark-gfm, react-syntax-highlighter | Request/schema validation in selected modules, class utilities and markdown/code rendering. |
| Persistence | Node filesystem JSON; Prisma 6 schema/client present as optional deployment contract | No runtime DB client used by the active app. SQLite/Prisma is not the dashboard’s active persistence backend. |
| Terminal process | Node `child_process.spawn` in workspace service; `shell: true`; Python MCP fixed `subprocess` argv with `shell=False` | Dashboard commands are app-policy mediated shell strings; Python MCP allows a fixed action enum. Windows-specific taskkill paths exist in the dashboard. |
| Test/check tooling | ESLint 9, TypeScript, tsx, Node scripts; separate Python unittest project; CLI package Node tests | Broad, mostly script-based test suite. `npm test` orchestrator was not run in this audit. |
| Auth/security packages | No account/auth framework or session-auth dependency declared | Local app uses host/Origin checks, workspace grants and approvals; those are not user identity or multi-user authorization. |
| Build/media | `sharp` 0.35.5; `next-themes` 0.4.6 | Image processing/runtime and theme provider. |

**Unused/deprecation/version risks.** Root `prisma` and `@prisma/client` are retained but current app JSON services do not use them, according to `docs/architecture.md` and active imports. `bun.lock` is intentional for optional deployment tooling but documented stale/unvalidated; npm is the current workflow. Root `tailwind.config.ts` content paths point at conventional root folders rather than `src`; Tailwind 4 uses the PostCSS plugin and `globals.css`, so confirm any future legacy config change against actual output. No network-backed vulnerability/advisory check was run. Root `npm ls --depth=0` was clean, but lint’s full-tree scan unexpectedly included generated minified game bundles (see verification), a maintenance/configuration issue.

## 4. Frontend architecture and design system

`src/app/layout.tsx` provides theme/toast infrastructure; `/` renders the dashboard shell. `?view=` drives selected dashboard view via the shared Zustand store. `/design-studio` is a second App Router page. Styling is global CSS variables, Tailwind utilities, CSS modules for a few views, Lucide icons, and small locally owned shadcn/Radix primitives. The current visual treatment uses cards, panels, sidebars, tabs, popovers, toasts, loading/error views, editor panes and a split layout; no Next `error.tsx` route boundary or game-oriented resizable editor/preview workspace was found in the source inventory.

Square-corner preferences should be preserved in a future view by using the current `globals.css` tokens and existing dashboard panel rhythm rather than introducing a competing component theme. `components.json` is shadcn-compatible. UI Components includes local JSON/folder import and trusted public HTTPS shadcn registry-item JSON fetch (`registry:ui`, component, hook, lib and block types), plus an exact-source proposal/review/approval installation workflow. It does **not** connect private 21st.dev APIs or perform authenticated publishing. `.agenthub/website-template-library/` is a separate local reference catalog containing downloaded upstream template repositories and a shadcn UI source/reference tree; its README identifies it as a local reference library for the Sessions UI/UX Design Agent. It is not the marketplace runtime and should be treated as untrusted third-party reference code. No source in that catalog is executed merely by browsing it.

## 5. Backend architecture and API route inventory

App Router handlers validate/adapt requests and delegate to shared libraries. Server-only filesystem and process operations are in `src/lib/agent-hub/workspace-files.ts` and `workspace-exec.ts`. Model credentials and endpoints stay server-side. Origin policy is host-based and allows requests with no `Origin` header for CLI compatibility; this is not account authentication.

| Route | Methods / responsibility |
|---|---|
| `/api` | GET health/status. |
| `/api/agent` | GET/POST/DELETE dashboard aggregate state/seeded entities. |
| `/api/chat` | GET provider status; POST streamed or collected general chat; DELETE legacy history. Supports isolated/stateless calls used by some agent flows. |
| `/api/chat/conversations` | GET/POST/PATCH/DELETE named chat conversation CRUD. |
| `/api/agent-session/conversations` | GET list/get models/running/approval; POST create/settings/send/approve/stop/delete/restore/unlink actions. Current coding-session server runtime. |
| `/api/agent-session/files` | GET info/list/tree/count/read/search/filenames; POST write/edit/delete. |
| `/api/agent-session/exec` | GET scripts/tasks/logs; POST command/stop. |
| `/api/agent-session/workspaces` | POST register/select a local absolute folder. |
| `/api/agent-session/models` | GET session provider/model status and preferences. |
| `/api/runtime/models` | GET currently loaded local runtime models. |
| `/api/custom-models` | GET/POST/DELETE custom OpenAI-compatible endpoints. |
| `/api/model-preference` | GET/POST shared selected model preference. |
| `/api/usage` | GET usage ledger/statistics. |
| `/api/system-metrics` | GET host runtime metrics. |
| `/api/playground` | GET/POST playground code/tutor actions. |
| `/api/skills` | GET/POST list, inspect, install, validate/update/remove skill resources. |
| `/api/computer` | GET status; POST Auto desktop actions through Python companion. |
| `/api/explain` | POST lesson/explain generation. |
| `/api/n8n` | GET/POST/DELETE n8n connectivity/template/workflow operations. |
| `/api/n8n-templates/[id]` | GET local template detail. |
| `/api/ui-components` | GET/POST UI component marketplace browse/proposal/application actions. |

## 6. Feature inventory

Statuses below describe source evidence and this audit’s verification, not screenshots or a blanket “works” claim.

| Feature | Purpose / UI | Frontend | Backend/API and storage | Agent/model relationship | Status, evidence and limits |
|---|---|---|---|---|---|
| Overview/dashboard | Runtime/usage summary; Overview | `overview.tsx`, shell | `/api/agent`, `/api/usage`, metrics; JSON `db/` | Displays local persisted state | **IMPLEMENTED, UNTESTED**; no live browser test in this audit. |
| Chat | General assistant, attachments, streaming, teaching options | `chat-view.tsx`, renderers | `/api/chat`, `/api/chat/conversations`; JSON chat store | Shared provider resolver, local/custom endpoint; no tools in general chat contract | **IMPLEMENTED, UNTESTED**; provider behavior depends on endpoint/model. |
| Models | Provider/model selection/status | `models-view.tsx` | runtime models, custom models, preference APIs | LM Studio, Ollama, custom compatible endpoints | **PARTIAL**; local loaded-state detection differs by provider and custom endpoint. |
| Agents | Agent catalog/agent configuration and network view | `agents-view.tsx`, `agents-network.tsx` | `/api/agent`, agent state and legacy runtime | Agent definitions/config and legacy team planning | **PARTIAL**; named agents are configuration/roles, not isolated independent runtimes. |
| Sessions (current) | Workspace coding sessions, plan/read/edit/run | `session-chat-view.tsx`, `agent-sessions.tsx` | `/api/agent-session/conversations`, files/exec/workspaces; JSON conversations/grants | Local/custom model with streaming tool loop, approval, stop | **IMPLEMENTED, UNTESTED end-to-end this turn**; source has runner and checks; reload restores conversation but not active execution. |
| Sessions (legacy) | Older sessions/team interface | `sessions-view.tsx` | legacy `agent-session.ts` state/pipelines | Older simulated/planned agent team semantics | **PARTIAL/compatibility**; current architecture guide identifies current Sessions as `session-chat-view.tsx`; duplication is explicit debt. |
| Plan / Tasks / Changes | Agent task/status and proposed changes | `tasks-view.tsx`, `changes-view.tsx` | legacy runtime `agent-session.ts`; local state/actions | Task planner and legacy tool registry | **PARTIAL**; not a durable job queue or resumable build pipeline. |
| Playground | Educational code editing, prediction/debugging, language examples | `playground-view.tsx`, CodeMirror components | `/api/playground`, playground JSON store | Teaching/prompt routes; code context is in app rather than an arbitrary selected project IDE | **PARTIAL**; no Vite project preview, Three.js browser frame or console capture. |
| Teaching Agent / roadmaps | Lesson generation, step framework, quiz/practice, roadmap tutoring | teaching panel, chat teaching mode, roadmap tutor/diorama | `/api/explain`, `/api/chat`, lesson/roadmap modules and data | Model generates content; persisted learning progress/roadmaps | **PARTIAL**; multiple teaching pathways share concepts but are not one isolated agent runtime. |
| Skills Library | Browse/install/enable instruction packs | `skills-view.tsx` | `/api/skills`; registry JSON and skill directory | Session can load enabled validated instructions; no arbitrary skill executable | **IMPLEMENTED, UNTESTED end-to-end this turn**; user supplied/remote text remains untrusted. |
| Auto | Computer-use UI/control | `auto-computer-view.tsx` | `/api/computer`, `computer/*`, Python controller | Model proposes approved desktop actions | **PARTIAL**; environment-specific native control, consent, loopback, supported-app limitations. Not project browser automation/preview QA. |
| UI Components | Browse and review/install React source components | `ui-components-view.tsx`, `marketplace/*` | `/api/ui-components`, local catalog/state/snapshots | Coding session can search/propose but installation requires UI review | **PARTIAL**; no automatic dependency installation, import integration or compile/visual verification. |
| Settings | Provider, capabilities, workspace, theme, model and runtime preferences | `settings-view.tsx` | `/api/agent`, `/api/model-preference`, workspace APIs; JSON | Changes gates used by server services | **IMPLEMENTED, UNTESTED here**; `networkEgress` is stored preference only, not an enforced OS/network firewall. |
| Agent API / n8n | API examples and optional workflow integration | `agent-api-view.tsx`, `n8n-runner.tsx` | `/api/n8n`, templates route; environment config | External service calls / workflow launch | **PARTIAL**; external n8n instance/config required, no audited live connection. |
| Design Studio | Generate/render configured marketing site | `design-studio/page.tsx`, components | design APIs/modules through legacy runtime | Model-driven design intent/config generation | **PARTIAL**; this is a site designer, not a game studio. |
| CLI companion | Terminal-native agent | `AgentHub-CLI/` | Separate package, providers, filesystem/terminal/policy and persistence | independent model/tool loop | **IMPLEMENTED, UNTESTED this audit**; no automatic UI integration. |
| Local game MCP | Workspace-aware game planning and fixed Node actions | No dashboard view; separate MCP stdio server | `lmstudio-local-agent/agent_env/server.py` + core; persistent `.game-agent/task-state.json` | MCP host (e.g. configured LM Studio) invokes tools | **IMPLEMENTED, UNTESTED live MCP this audit**; not wired to dashboard, no arbitrary shell/browser/console/binary asset generator/packaging. |

## 7. Local model architecture

### Discovery, selection and request path

`src/lib/agent-hub/llm.ts` probes configured LM Studio and Ollama OpenAI-compatible endpoints, discovers model IDs and richer provider metadata where available, marks loaded/chat-compatible models, and returns `loaded`, `offline`, or `unavailable` status. The Models UI uses runtime-model APIs. Explicit model selection is resolved without silently switching when a requested model cannot be found. Auto-selection prefers a loaded chat-compatible local model, otherwise ranks candidate models by instruct/chat naming, type and vision/reasoning hints; custom models are a fallback. Custom provider metadata is persisted in the custom-model registry. Exact endpoints are defined in the source; there is no OpenAI SDK dependency.

Chat sends `/chat/completions` with OpenAI-style `messages`; streaming requests use SSE, `stream_options.include_usage`, optional JSON mode/token limit/reasoning body and abort signals. It parses content/reasoning/usage chunks, detects provider errors/incomplete streams, and can fall back to nonstreaming for unsupported streaming/JSON behavior. Missing provider token counts can be estimated and labeled. Chat constructs its own context/output budgets and stores bounded message history. The current coding-session responder sends tool schemas via OpenAI `tools`, `tool_choice: auto`, `parallel_tool_calls: false`, `stream: true`, and `max_tokens: 4096`; it incrementally parses tool call deltas, validates JSON object arguments and falls back to fenced text tool blocks when tool APIs are rejected. A tool-call argument over 1.1 MB is refused. Per-request timeout is 180 seconds for that responder.

### Capabilities and limits

- **OpenAI-compatible local API:** **VERIFIED in source** for LM Studio/Ollama-style `/models` and `/chat/completions`; exact compatibility varies by provider/version/model.
- **Tool calling:** **PARTIAL.** Native function tools are attempted and text-block fallback exists. That fallback depends on model instruction-following; the app parses and checks calls but model capability is not guaranteed.
- **Multi-step execution:** **VERIFIED in source** in Sessions. Each model response can contain a tool call; results are added to the conversation transcript and the next model request runs. Calls execute sequentially; model is explicitly told to do one action at a time. Default cap is 32 rounds.
- **Reasoning modes:** Session effort preference maps to a request body; Chat uses provider/model-specific `thinkingModeFor`/reasoning parameters. Provider support is not guaranteed. No separate chain-of-thought viewer contract is a game-generation capability.
- **Context:** Session transcript compaction retains recent complete user-turn groups up to about 60,000 serialized characters. This is a character bound, not tokenizer-aware context-window negotiation. Model output cap 4,096 tokens per session response; general chat uses distinct message/output limits. No dynamic per-model context-window metadata is applied in the session loop.
- **Model switch:** Model target is resolved when execution starts, and notice says the resolved model is held for that run. Mid-run switch is not evidenced. User preference applies to a future run.
- **Long task reliability:** 180-second single-request timeout and 32 loop turns are not an indefinite job scheduler. No persisted queued worker, retry policy with exponential backoff, incremental build checkpoint protocol, or restart recovery for active execution.
- **40B MoE / quantized local models:** The code uses the advertised API, model IDs/metadata and provider errors; it does not inspect model weights, benchmark hardware, or prove that a 40B-total MoE fits 4 GB VRAM or can reliably emit tool calls. Quantization, CPU/GPU offload, context length and LM Studio configuration determine feasibility. A model that loads can still be too slow or have weak coding/tool behavior. No performance claim is made.

**Key source:** `llm.ts` (discovery/resolution/streaming), `session/model.ts` (`createModelResponder`), `session/runner.ts` (`runConversation`), Chat handler `src/app/api/chat/route.ts`.

## 8. Agent architecture and execution lifecycle

There is no single central runtime for every UI labeled “agent.” The current coding-session loop is the cleanest central server loop. Agents are prompt/config definitions associated with a conversation/task; sessions persist conversation context, workspace ID/subpath, model, effort, mode, turns and approvals. They share the same runner/provider/tool executor. A session’s selected agent adds instructions; it does not create an independent process or memory service.

```mermaid
sequenceDiagram
  participant UI as AgentHub Sessions UI
  participant API as /api/agent-session/conversations
  participant Store as JSON session/grant stores
  participant Runner as runConversation (max 32 rounds)
  participant Model as OpenAI-compatible local/custom model
  participant Gate as grant + approval checks
  participant Tools as workspace file/exec services
  UI->>API: create/settings/send
  API->>Store: load conversation and workspace grant
  API->>Runner: prompt + model responder + tool catalog
  Runner->>Model: system + compacted history + tool schemas
  Model-->>Runner: streamed text and/or tool calls
  loop until final answer, cancellation, error or step cap
    Runner->>Gate: re-check grant; request approval for mutation/command
    Gate-->>Runner: approved/declined
    Runner->>Tools: one file or command action
    Tools-->>Runner: bounded output and change record
    Runner->>Store: persist turn/tool result
    Runner->>Model: updated transcript and tool result
  end
  Runner-->>UI: SSE deltas, turn, approval, done events
```

Execution facts: `startTurn` stores user turn; `runConversation` compacts transcript, streams responses, iterates at most 32 by default, validates available tool name/mode, calls approval before mutation/command, executes one-by-one, returns tool outcomes to the model, records changes/status and saves the final turn. `runtime.ts` keeps active `AbortController`, pending approval and publish callback in a process-local map; stop aborts the turn. Disconnect invokes stop through request cancellation. There is no separate queue, worker, durable lease or restartable continuation.

`agent-session.ts` is a second broad runtime used by Tasks/legacy features, teaching and design. It has a heuristic `createPlan`, tool parsing, a legacy plan state, token/context helpers, cancellation and task progress state, but this is not the current Sessions `runConversation` loop. Its 5K-line scope makes future changes harder to reason about.

For “create a complete 3D racing game, write every file, install dependencies, build, repair and package”: the dashboard can take a request, inspect a workspace, ask a compatible model for sequential file/command tool calls, apply approved edits and observe a command result. It is not a reliable one-shot workflow: binary files cannot be written, commands are individually gated and policy-limited, run state is process memory, output/context are bounded, no preview/browser console is attached, no archive action is provided, and build repair is dependent on the model continuing the loop. The separate MCP project can plan/checkpoint and run fixed Node/Vite actions, but lacks packaging, arbitrary binary asset creation and visual QA.

## 9. Filesystem and workspace capabilities

Dashboard Sessions can register an absolute workspace root, select a relative project subfolder, list one folder, request bounded tree, exact count, read UTF-8 text, search text, find filenames, write/replace, append (implemented as a read plus full rewrite), exact unique text edit and delete a file. Operations route through shared `workspace-files.ts`; the HTTP route is an adapter. Workspace `read` grants allow read/search/list tools, `write` grants allow mutations/commands, and Edit mode alone is insufficient without the matching grant. Every mutation/command still prompts for approval in the session runner. Delete additionally requires the exact target path to appear in the user request.

Path checks reject traversal/out-of-root resolution, resolve real paths, refuse paths that resolve through a symlink outside the workspace, and skip symlinks/junctions during recursive operations. Reads block `.env*`, key/PEM, DB and SSH private key names; writes additionally block `.git`, `node_modules`, `.next`, `db`, lockfiles, `tsconfig.tsbuildinfo`, `next-env.d.ts`. Read limit is 1 MiB; writes max 1 MiB; max list 500 entries; tree max 800 nodes/depth 5; search max 3,000 files, 256 KiB/file, 100 matches. Text-only reads/edits reject NUL-detected binary files. There are no general rename, move, mkdir, copy-template, zip or binary write tools. Writes are atomic but generic file operations have no automatic backup/rollback. Marketplace installer has its own recoverable snapshot/rollback transaction.

These limits support moderate multi-file source projects through repeated calls, not a single atomic “hundreds of files” operation. A model would need many sequential calls, repeatedly pay model latency, stay within context and output constraints, and receive approval for each mutation/command.

## 10. Terminal and command execution

Dashboard `workspace-exec.ts` accepts arbitrary command strings up to 4,000 characters in Edit mode and when the global `codeExecution` capability is enabled. It resolves working directory inside a selected root, rejects out-of-root paths/symlink escapes, applies command policy patterns, and starts via Node `spawn(command, {shell:true})`. Windows uses hidden processes and `taskkill /t /f` on timeout; synchronous default timeout is 120 seconds bounded to 1–300 seconds. Stdout/stderr are capped; background tasks keep a ring of output lines, exit code/status and can be listed/read/stopped. This task map is in memory and disappears on process restart. The API command result includes `exitCode`; the Sessions wrapper sets tool success only if exit code is zero and not timed out.

`npm install`, `npm run dev`, `npm run build`, and `npm test` are syntactically possible as user-approved commands if policy allows them and the workspace has a compatible shell/Node installation. They were not run by this audit. Dependency installation can execute package lifecycle scripts through ordinary `npm install`; dashboard does not supply a safe install broker or enforce install-specific `--ignore-scripts`. A shell command is powerful local-machine access, even with policy checks and UI approval; there is no OS/container sandbox. Concurrent process handling is a per-process in-memory task map; command execution is not durable and not a multi-worker queue.

The separate `lmstudio-local-agent` exposes fixed `install_dependencies`, `build`, `typecheck`, `test`, `start_preview`, and `stop_preview` actions for Node projects; runs npm with `--ignore-scripts`, direct local build CLIs where possible, `shell=False`, captures exit code/output, applies timeouts and binds preview to `127.0.0.1`. It requires explicit approval flags. It is the safer shape for a future project action service, but it is not integrated with the dashboard.

## 11. Playground and editor

The Playground uses CodeMirror 6 with bundled language extensions and syntax theme; it has split panes, examples/starters, tutor/feedback and learning/roadmap controls. It can present/edit supported code snippets/files in its own stored Playground state and ask model-backed prompts to explain, predict or debug those snippets. Supported highlighting modes include JS/TS, CSS, HTML, JSON, Python, SQL, Java, C++, Go, Rust, PHP and YAML (exact list is in `playground/code-editor-langs.ts` and `playground-languages.ts`).

It does not currently mount an arbitrary selected multi-file project, run Vite, iframe a local game, read browser console output, provide HMR/error overlay plumbing, or run a project build. Its editor component and split-pane controls can be reused, but a Game Studio needs a workspace-aware file tree, project runner/preview lifecycle, sandboxed iframe/proxy, console/error channel and binary asset panel. A single Three.js snippet can be edited as text, but that is not an operational game project editor.

## 12. Skills Library

Dashboard Skills has a registry and managed instruction files under `.agenthub/skills/`, remote GitHub inspect/install with supported `github.com` URLs, commit/ref resolution, bounded file/tree/size controls, path validation, metadata/frontmatter parsing, compatibility checks and validation status. Current local skill files include game design, gameplay, performance, testing, audio/UI and engine-specific instruction packs, including `create-game-assets`; these describe an asset brief/import/validation workflow and can help guide an agent. They are not a mesh/texture/audio generator and cannot make the dashboard call an external image tool. Runtime Sessions exposes only enabled, valid, reviewed skill instructions. Skill text does not grant additional tool permissions and is not run as code. Update/removal follows registry install operations; this is instruction content, not an executable plugin host.

The distinct `lmstudio-local-agent/skills/` contains game design, gameplay programming, web game, WebGL/Three.js, physics, performance, browser game, audio and testing instructions plus Desk Racer/Wizard Chess references. That local pack can inform future game-agent prompts if deliberately connected, but is not the dashboard Skills Library unless imported/registered there. Do not create a second general-purpose skill catalog; reuse the existing registry/compatibility infrastructure after deciding where project-specific game packs belong.

UI Components is a separate React-source marketplace with shadcn-compatible local import and public remote registry fetch. Its installer inspects project `package.json`, proposes exact file contents, detects collisions/dependencies, requires explicit review, snapshots and rolls back failures. It does not recursively install dependencies or prove build/visual integration.

## 13. Persistence, task recovery and process boundaries

| Data | Current persistence |
|---|---|
| Dashboard entities/preferences/token ledger | `db/agent-hub-state.json` via `state-file.ts`; atomic JSON write and one in-process serializer. |
| Chat conversations/history | `db/` JSON files via `chat-store.ts`; named and legacy history formats. |
| Coding Sessions and turns | JSON session records via `session/store.ts`; run state, pending approval and `AbortController` are volatile. |
| Workspace registry/grants | JSON files in DB directory via `session/workspaces.ts` / `permissions.ts`. |
| Skills, model endpoints, marketplace | Managed files and JSON registry/state under app storage; no relational DB runtime. |
| Playground/roadmap/learning | File-backed app data and client state in respective domain modules. |
| Command process log/task status | In-memory process map; not restart-persistent. |
| Python game task ledger | Per-project `.game-agent/task-state.json`, atomic writes. Separate MCP runtime only. |
| Terminal CLI sessions/ledger | Separate package storage implementation. |

`db-path.ts` anchors JSON data to project or configured `AGENT_HUB_DB_DIR`, including standalone Next root correction. Atomic file writes prevent partially overwritten JSON; serializers protect same-process concurrent writes. This is not a concurrent multi-process database guarantee. `prisma/schema.prisma` and Prisma packages are present for optional deployment but do not back current app runtime.

Recovery: browser refresh can reload saved conversation/transcript, but cannot reconnect/resume an active Chat SSE stream or a coding-session model/tool loop. A client disconnect cancels the coding run. App restart loses current run, approval and background task map; records retain the last saved turn and may mark interrupted steps, but there is no restart-recovery worker. Model timeout, failed build or tool failure requires user/new turn; no automatic persisted retry/checkpoint logic. The standalone Python MCP’s ledger offers explicit project task checkpoints but not a background queue or recovery of a process that had been running.

## 14. Security audit

These are local-trust findings, not claims of a hostile multi-tenant deployment boundary.

| Severity | Finding | Evidence / practical consequence |
|---|---|---|
| **High** | No user identity/authentication or per-account ownership in dashboard APIs. | No auth dependency found; `request-origin.ts` checks host equality when Origin exists and intentionally allows no-Origin calls. A network-exposed deployment can expose local workspace/state APIs to callers beyond the intended single user. Keep loopback/local; add authentication before sharing. |
| **High** | Approved dashboard shell execution is not an OS sandbox. | `workspace-exec.ts` invokes `shell: true`; project shell commands may access host resources available to the process. Policy patterns/approval reduce accidental risk but do not isolate malicious commands. `runtime-policy.ts` explicitly records networkEgress as advisory only. |
| **High** | No hard network egress firewall for agents/build commands. | Capability preference is not network enforcement; npm/network/model endpoints and child processes can contact network if host policy permits. |
| **Medium** | Origin/host validation is CSRF friction, not auth, and coverage is uneven. | Many state-changing routes call `isCrossOrigin`; the helper intentionally allows requests with no Origin, and routes such as computer/workspace registration and some read/status handlers do not all apply the same check. This does not establish user identity. Behind proxies/host rewriting, deployment config must preserve correct host semantics. |
| **Medium** | Text filesystem operations do careful path and symlink checks but have TOCTOU windows. | `resolveInRoot` plus `realPathInRoot` and lstat protections exist; later path-open/write may race with hostile local changes. It is suitable for a local desktop trust model, not hostile concurrent filesystem actors. |
| **Medium** | Shell command policy is pattern-based and platform-dependent. | `policyCheck` is not a complete command-language parser or sandbox. Shell quoting, compound commands and unrecognized tools need continued testing; user approval is essential. |
| **Medium** | Browser preview is not implemented; future preview isolation is an open risk. | There is no project preview now. Future arbitrary generated JS must be isolated from dashboard origin, cookies and parent filesystem/API trust. |
| **Medium** | GitHub/UI registry content is untrusted input. | GitHub skills are fetched from pinned revisions and bounded; skill code is not executed. Marketplace source is presented for review, but imported React source can still be malicious when later built/run. |
| **Low/Medium** | Secret-name filters are extension/name based, not a general secret scanner. | `.env*`, PEM/key/DB/private-key patterns are blocked for file tool reads; secrets embedded in ordinary source, alternate filenames, command output or model context may still appear. Keep credentials out of workspaces and logs. |
| **Medium** | Root app `npm install` command path can execute lifecycle scripts. | Dashboard allows approved shell commands; no dependency-specific allowlist or lifecycle restriction. Separate MCP fixed install uses `--ignore-scripts`, which is safer but still downloads packages and is not risk-free. |
| **Low/Medium** | API rate limiting/request-size policy is not a general authentication substitute. | Request/body and attachment caps exist on selected routes; no global user-level rate limiting framework was identified. |
| **Unknown** | Production hosting/reverse proxy security, TLS, firewall, and secret deployment behavior. | No deployment/live external configuration was tested; `.env.example` values were not read as secrets. |

Positive controls confirmed in source include session-specific `none/read/write` grants, rechecking the grant before each tool call, per-mutation approval, exact-path deletion rule, global code-execution gate, cross-origin rejection on protected routes that invoke the helper, workspace path normalization/realpath/symlink checks, sensitive path write/read blocklists, bounded file/search/output sizes, GitHub ref pinning and file limits, and Auto’s additional localhost/consent/app/approval checks. These reduce risk but do not turn the host into a secure code sandbox.

## 15. Performance and local hardware

No benchmark was run. For Ryzen 5 7235HS, 24 GB RAM, RTX 3050 Laptop 4 GB VRAM, resource limits will depend on actual model quantization/offload/context and concurrent applications. A 40B-total-parameter MoE is not equivalent to 40B dense active parameters, but total weights still require storage and runtime loading/offload; 4 GB VRAM cannot be assumed sufficient for all weights. CPU/RAM offload can make inference possible but may add substantial latency. Tool call loops multiply that latency by every model round and each 180-second request can be long.

Other bottlenecks are large file/context prompts, generating many files in separate calls, model output caps, JS build/transpile memory, Vite/Three.js GPU preview in the same 4 GB VRAM budget, multiple concurrent model/preview/build processes, and repository search over large generated folders. Practical local-first choices: keep preview/build and model concurrency low; use task-sized prompts and targeted reads; avoid sending whole repositories; use project manifests and per-step checkpoints; prefer compressed compatible local models chosen by observed coding/tool-call quality; bound SSE output/log sizes; exclude `dist`, caches and media from indexing; use procedural meshes and small assets where possible. These are recommendations, not measured throughput claims.

## 16. Testing and verification results

### Commands run for this audit

| Command | Purpose | Result | Limits |
|---|---|---|---|
| `git status --short` | Establish pre-existing changes | **PASS, inspection only**; many modifications/deletions/untracked files already existed. | No clean baseline; audit files added after inspection. |
| `rg --files` with generated/dependency exclusions | Inventory repository source/config/docs | **PASS, inspection only** | Intentionally excluded node_modules, build output, caches, runtime DB, output and binary media. No arbitrary exact total claimed. |
| `npm ls --depth=0` | Check installed direct dependency tree | **PASS**, exit 0; versions recorded above. | Not a security advisory or runtime functionality test. |
| `npm run lint` | Static lint | **FAIL**. ESLint walked generated bundled game `dist/assets/*.js` and emitted thousands of warnings; report ended with 5,034 problems (78 errors, 4,956 warnings). One clearly identified source error: `src/lib/agent-hub/marketplace/registry.ts:44` (`@next/next/no-assign-module-variable`). | Command exceeded routine output scale because generated bundles were linted. No `--fix` was run. Do not treat generated bundle warnings as source findings. |
| `npm run typecheck -- --incremental false` | No-emit TS check without incremental cache writes | **FAIL**, exit 1: `lmstudio-local-agent/workspace/projects/desk-racer/src/main.tsx:2` TS5097 (`.tsx` extension import requires `allowImportingTsExtensions`); `src/lib/agent-hub/marketplace/registry.ts:72` TS2353 (`autoSelectFamily` not in declared `RequestOptions` type). | Root tsconfig includes all `**/*.ts(x)` except a few folders, so the standalone game source is compiled as part of the app check. |
| `npm test` | Run full test suite | **NOT RUN** | Full runner executes 28 suites, writes `.verification` evidence, and includes local HTTP/service fixtures. This audit limited executed checks to package inventory, lint and no-emit typecheck; prior `docs/final-readiness.md` records an earlier run, not this checkout’s current test result. |
| build / live provider / browser / native input | End-to-end build or feature validation | **NOT RUN** | Build changes generated `.next`; model/native checks can load models or interact with host apps. Prior docs state earlier build/smoke results; they were not repeated here. |

### Existing verification artifacts

`docs/final-readiness.md`, `docs/testing.md`, `docs/restructuring.md`, historical QA files and `.verification/` record extensive earlier checks. Those documents provide useful evidence and limitations, but their run date and checkout snapshot differ from this audit, so no prior pass is presented here as a fresh verification. The root package declares numerous check scripts, including chat/session/workspace/skills/playground/Auto/model tests. Their existence is not proof of current passing status.

## 17. Code quality and architectural risks

| Priority | Finding | Evidence and impact |
|---|---|---|
| P1 | Multiple agent execution architectures | `agent-session.ts` legacy planner/task/teaching/design pipeline, current Sessions runner, separate CLI runner and Python MCP runtime differ in prompts, tool contracts, checkpointing and safety controls. Feature work could land in the wrong runtime. |
| P1 | Dashboard command execution is powerful and only policy/approval guarded | `workspace-exec.ts` spawns `shell:true`; no OS sandbox and no dedicated install/build job abstraction. |
| P1 | No durable job queue/checkpoint for web agent runs | Active run/approval/task state is process-local; app restart loses execution. Long game generation needs checkpoints and explicit recovery. |
| P2 | Oversized legacy modules and feature duplication | `agent-session.ts` ~5.2K lines; `sessions-view.tsx` ~1.8K; `chat-view.tsx` ~1.5K; `playground-view.tsx` ~1.3K; `skills-view.tsx` ~1.2K. Existing architecture doc calls old Sessions compatibility surface and notes legacy runtime technical debt. |
| P2 | Root static checks unintentionally traverse generated project bundles | `eslint .` emitted 5K diagnostics including minified example `dist` JS. Scope/ignore config should be revisited in a later code task; no config changed here. |
| P2 | Root typecheck includes external/sample project TS | `lmstudio-local-agent/workspace/projects/desk-racer/src/main.tsx` currently fails root TS check, despite being a separate MCP workspace example. Root tsconfig needs explicit scope in a future task. |
| P2 | Current lint/type errors in marketplace registry | Lint reports assigning to reserved `module` variable; typecheck reports unsupported `autoSelectFamily` RequestOptions property. No code fix was made. |
| P2 | JSON file persistence and serializer are single-process | Atomic writes and in-process queues do not provide cross-process transaction or multi-instance coordination. |
| P3 | Dependency/package-manager ambiguity | npm lock is current documented workflow; Bun lock noted stale and Bun deployment route unverified. Prisma dependency remains despite no active application DB use. |
| P3 | UI route and internal state are coupled | `?view=` shell view selector is a single dashboard shell; deep links/tests exist but independent routing/loading boundaries are limited. |
| Unknown | Circular imports/dead-code inventory at current snapshot | Prior docs say structural audit found none after earlier consolidation; current audit did not regenerate the structural CSV because that would write a third file. No new claim of current cycle-free status is made. |

## 18. Verified capabilities and missing capabilities

| Capability | Status | Evidence |
|---|---|---|
| Local model discovery/selection | PARTIAL | `llm.ts`, runtime model route; model must be reachable and API-compatible. |
| Chat streaming/cancel/usage | IMPLEMENTED, UNTESTED this turn | `llm.ts`, `/api/chat`, `chat-runs.ts`; not persistent through page reload. |
| Multi-turn tool loop | VERIFIED in source | `session/runner.ts`; 32 default rounds. |
| Sequential multi-file text edits | PARTIAL | Session tools plus 1 MiB file caps, approval per call, 16K user prompt cap. |
| Read/search/count/list workspace | IMPLEMENTED, UNTESTED this turn | `workspace-files.ts`; bounded operations and skip rules. |
| Shell execution / stdout/stderr / exit status | PARTIAL | `workspace-exec.ts`; 1–300s timeout, command policy, no sandbox. |
| User approval for Session mutations/commands | VERIFIED in source | `session/runtime.ts`, runner and route. |
| Durable conversation history | IMPLEMENTED | JSON session/chat stores. |
| Resume active work after refresh/restart | MISSING | No active run recovery; runtime is in-memory and stream is canceled on disconnect. |
| Full IDE project and live preview | MISSING in dashboard | Playground is a teaching/code editor; Python MCP offers loopback Vite fixed action separately. |
| Binary output/3D asset generation | MISSING in dashboard | File service rejects binary; no asset-generation provider/tool. Existing sample assets are static. |
| Automated build repair controller | PARTIAL | Agent can call command/read/edit repeatedly, but no controller/checkpoint/retry state machine. |
| ZIP/package export | MISSING | No archive tool/action identified. |
| User/account authentication | MISSING | No auth system in root dependency/API architecture. |

## 19. Technical recommendations

1. Decide which execution runtime is authoritative for new project-generation work. Prefer explicit shared contracts/adapters rather than merging the legacy 5K-line runtime, CLI and MCP into one object.
2. Before exposing workspaces beyond loopback, add real authentication/ownership and isolate command execution at the OS/container boundary. Treat the current settings network switch as display/preference only.
3. Add a durable job/run record with stage ledger, idempotent operations, cancel/retry semantics and restart recovery before supporting long-running generation.
4. Build project template and file operations around a manifest and transaction/snapshot, including safe binary asset staging and size/hash validation.
5. Add a narrow dependency/build/test broker with explicit package manager allowlist, lifecycle-script policy, timeout, logs, exit code and process cleanup; retain user approval and show exact action.
6. Add an isolated loopback preview broker and console/error channel with origin/cookie isolation before any generated game preview.
7. Correct root lint/typecheck scope and current registry errors in a separate approved implementation change; run the declared test suite and fresh live UI/model checks against an isolated DB.
8. Keep local-first operation: allow optional LM Studio, cap context/concurrency, use targeted file context and make remote asset generation optional. Prefer procedural assets or import with clear provenance.

## 20. Sources inspected

Primary implementation evidence is in the paths cited throughout this document. Orientation and prior verification context were read from `AGENTS.md`, `PROJECT_WALKTHROUGH.md`, `docs/architecture.md`, `docs/development.md`, `docs/testing.md`, `docs/final-readiness.md`, package manifests, scripts and the current source files. Prior documentation is treated as historical/supporting evidence, not proof of this audit’s runtime behavior. No secrets or environment values are reproduced.
