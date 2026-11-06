# 02 — Technology stack

## Runtime and framework

| Technology | Role in AgentHub | If removed / alternatives |
|---|---|---|
| Node.js 24 | Runs Next server, scripts and build. | A different JS runtime would need verified compatibility with Next, native dependencies and launch scripts. |
| Next.js 16 App Router | UI rendering, route handlers, production build and standalone output. | React plus another HTTP framework could substitute, but route conventions, cache behavior, font loading and deployment would need redesign. |
| React 19 + TypeScript | Component UI and typed domain/API contracts. | Vue/Svelte are alternatives but not drop-in replacements for hooks, Zustand or existing components. |
| Tailwind CSS 4 | Utility styling and design tokens in `src/app/globals.css`. | CSS Modules or another utility system are possible; existing classes and tokens must be migrated. |
| Zustand | Shared dashboard store in `src/lib/agent-hub/store.ts`. | Context/Redux can replace it, with different update and persistence boundaries. |
| Next Themes | Applies light/dark/system class theme in root layout. | A custom preference store can replace it but must prevent hydration mismatch. |

## Rendering and visualization packages

| Package family | Current use | Consequence/alternative |
|---|---|---|
| Radix UI and class-variance-authority | Accessible headless primitives and variants under `src/components/ui/`. | Native HTML can replace individual controls; keyboard, focus and ARIA behavior must be reimplemented. |
| Lucide React | Icon components. | SVGs or another icon set; audit attribution and bundle size. |
| CodeMirror packages | Language-aware editor in Playground. | Monaco or a textarea; editor features and runtime weight change. |
| react-markdown + remark-gfm | Markdown in chat and learning content. | Any replacement must retain safe HTML handling and table/task-list behavior. |
| react-syntax-highlighter | Code syntax coloration, with local declarations in `src/types/`. | CodeMirror static rendering or Shiki; performance and SSR behavior differ. |
| D3 force, Three.js, Recharts | Agent network layout, 3D/visual elements, and metrics charts. | Canvas/SVG or simpler CSS; interactive behavior must be reproduced. |
| Sharp | Image processing support in the build/runtime ecosystem. | Native image processing alternative or no transforms, with deployment changes. |
| Zod | Boundary validation for routes and configuration. | Handwritten validation is possible but easier to make inconsistent. |
| Prisma packages | Optional schema/CLI contract; the application’s active persistence is JSON. | Removing requires auditing deployment scripts and schema workflows, not replacing JSON runtime storage. |

## Languages and external runtimes

TypeScript/JavaScript implement the dashboard, route handlers, Node terminal
agent and scripts. Python implements `agenthub-computer/` and
`lmstudio-local-agent/`. Local inference is provided by separately installed
LM Studio or Ollama and is not a bundled model. Windows UI Automation uses
`pywinauto`/Windows APIs through the local Python companion. The exact optional
package requirements are recorded in their own READMEs.

## Dependency interpretation

The root package manifest contains no vendor-specific hosted-model SDK such as
an OpenAI, Anthropic or Google generation client. The shared model transport is
fetch-based and protocol-compatible. This does not mean every network feature is
local: GitHub skill operations and user-approved registries are separate,
documented integrations. See [the network audit](../../THIRD_PARTY_INDEPENDENCE_AUDIT.md).

## Communication boundaries

The browser talks same-origin HTTP to Next route handlers. Routes use Web
`Request`/`Response` APIs and Next `NextRequest`/`NextResponse` helpers. SSE is
used for streamed Chat responses. Server-side fetch connects to local model
ports. The Auto route talks to the loopback companion. Optional packages and
tools have their own process, configuration and lifetime; they are not imports
in the client bundle.
