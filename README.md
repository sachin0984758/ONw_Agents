# AgentHub

A local-first dashboard for chat, coding sessions, learning roadmaps, code practice,
installed skills and supervised computer use. It uses your configured model
providers; LM Studio and Ollama are supported locally. Custom providers are optional.

The web app uses **Next.js 16.4, React 19, TypeScript, Tailwind CSS 4, Zustand,
CodeMirror and shadcn/Radix UI**. Application data lives in JSON files under `db/`.
The separate `AgentHub-CLI/` package is a Node CLI. The optional Windows
computer companion uses Python, UI Automation and an app-owned browser.

## Start locally

Use Node.js 24 and npm. Run commands from this directory, not the older Codex worktree.

```powershell
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. Start LM Studio or Ollama separately and load your
chosen model. The launcher binds to loopback and keeps Auto's native-control
endpoint local. `PORT` selects another port. See [development](docs/development.md)
for optional computer setup and production startup.

## Checks and build

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

`npm test` runs the serial application regression suites with disposable storage
and mock providers where applicable. It does not type into desktop apps or start
model inference. Live tests are explicit opt-ins; see [testing](docs/testing.md).
Build and startup scripts work on Windows without Unix `cp`.

## Project map

| Location | Responsibility |
|---|---|
| `src/app/` | App Router pages, layouts and HTTP routes |
| `src/components/agent-hub/` | Dashboard and feature interfaces |
| `src/components/ui/` | Reusable UI primitives |
| `src/lib/agent-hub/` | Domain logic, provider adapters, storage and policies |
| `src/lib/agent-hub/session/` | Coding conversations, tools, approvals and workspaces |
| `src/lib/agent-hub/computer/` | Supervised Auto runtime and companion bridge |
| `agenthub-computer/` | Optional local Python companion |
| `AgentHub-CLI/` | Independent terminal agent and tests |
| `scripts/` | Build, setup, audit and regression runners |
| `docs/` | Current operating guides; `history/` preserves earlier evidence |
| `public/` | Served assets, including the mascot |
| `db/`, `output/` | Local persisted data and user/test deliverables |

Read [architecture](docs/architecture.md), [development and configuration](docs/development.md),
[testing](docs/testing.md), [Auto](docs/auto-computer-use.md),
[teaching and quiz rendering](docs/chat-teaching-format.md), and [n8n setup](docs/n8n-setup.md).
The [final readiness report](docs/final-readiness.md), [first-phase report](docs/restructuring.md) and [file audit](docs/repository-audit.csv)
record the cleanup, evidence and unresolved items.

This is a local development application, not an authenticated public hosting service.
Workspace file restrictions do not confine arbitrary desktop programs or shell
commands at the OS level. VM tooling is prepared only; the cancelled VirtualBox
installation was not resumed. Keep `db/`, credentials, personal documents and
existing deliverables outside source control.
