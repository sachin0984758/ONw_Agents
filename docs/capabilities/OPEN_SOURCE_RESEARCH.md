# Open-source capability foundations

Reviewed against the listed upstream repositories on 2026-10-29. No repository
was cloned or installed in this task. License and compatibility must be checked
again for each exact version/source before redistributing code.

| Repository | Actual role / license | Fit and decision |
|---|---|---|
| [21st.dev marketplace source](https://github.com/serafimcloud/21st) | React/Tailwind/shadcn components, blocks and hooks; MIT | Useful as a source catalogue. Current marketplace can import React registry JSON, but does not query 21st.dev directly. Add source discovery only through a reviewed, optional connector. |
| [21st.dev Agent Skill](https://github.com/21st-dev/skill) | Search/install/publish React components, themes and templates; Apache-2.0 | Existing AgentHub Skills Library can represent its instructions. Do not install its CLI or invoke `npx` automatically; this repo has a small public history (7 commits on the viewed page), so recheck maintenance before adoption. |
| [21st registry CLI](https://github.com/21st-dev/registry) | Publish/install/search private component registries; MIT | Closest to private registries, but it is a CLI and may require account access. Do not replace AgentHub’s reviewed source installer or run the CLI. |
| [21st Agent Elements](https://github.com/21st-dev/agent-elements) | React UI elements for agent interactions; MIT | Selective source reuse may fit Chat components; keep AgentHub’s current UI registry and component review flow. |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | Copyable, composable React UI components and registries; MIT | Strongest registry format fit. Current marketplace already accepts registry-item JSON and owns source review/install; do not add a second marketplace. |
| [Aider](https://github.com/Aider-AI/aider) | Terminal pair programmer; supports codebase mapping, local/cloud models and lint/test loops; Apache-2.0 | Use as a workflow-pattern reference. AgentHub already has local model, workspace and approved command flows; do not add a second orchestrator. |
| [Continue](https://github.com/continuedev/continue) | CLI/editor coding agent; Apache-2.0 | Upstream states the repository is read-only and no longer actively maintained. Do not select it as a current runtime foundation. |
| [MCP servers](https://github.com/modelcontextprotocol/servers) | Reference server implementations and test/examples; package licensing can vary | Not a client runtime or universal execution policy. AgentHub has separate optional MCP-capable packages; do not add a parallel MCP client without an integration requirement. Review each server/package before install. |
| [React Three Fiber](https://github.com/pmndrs/react-three-fiber) | React renderer for Three.js; MIT; React/Three peer requirements | Good optional game-pack engine layer. `three` is already declared; Fiber itself is not. Add only per-project after compatibility review. |
| [Drei](https://github.com/pmndrs/drei) | Ready-made helpers for React Three Fiber; MIT | Optional companion to Fiber, not an engine or standalone game template. Not installed. |
| [React Three Rapier](https://github.com/pmndrs/react-three-rapier) | Rapier WASM physics wrappers for Fiber; current README describes v2 with React 19/Fiber 9; license is per upstream repository | Optional physics pack with WASM/platform implications. Not installed; verify the exact package license and peer ranges before approval. |
| [Three.js](https://github.com/mrdoob/three.js) | JavaScript 3D rendering library; MIT | Already present as an application dependency. Reuse as an existing foundation; no second renderer. |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | MCP browser automation via Playwright and accessibility snapshots; Apache-2.0 | Could support research/browser workflows but adds browser processes and access scope. Not integrated; do not confuse browser automation with user-visible desktop authorization. |
| [Playwright](https://github.com/microsoft/playwright) | Cross-browser automation/testing; Apache-2.0 | Suitable for controlled test workflows. Not currently an app dependency and not a substitute for screenshots or interactive QA unless configured. |
| [Microsoft WinApp CLI](https://github.com/microsoft/winappCli) | Windows SDK/app packaging and build tooling; MIT | Not a desktop automation API; reject for solving Auto UI control. Existing Python companion remains authoritative. |
| [pywinauto](https://github.com/pywinauto/pywinauto) | Python Windows UI Automation/Win32 library; BSD-3-Clause | Relevant alternative, but replacing the existing controller would duplicate automation and regress tested behavior. No replacement proposed. |
| [Agent Skills spec](https://github.com/agentskills/agentskills) | Portable `SKILL.md` format/specification; Apache-2.0 | AgentHub already has a Skills Library with validation and permission boundaries. Maintain interoperability rather than creating a second skill store. |

## Constraints and follow-up

The page status, displayed release information and package peer ranges can change;
this review is a dated shortlist, not a security audit or software bill of
materials. Most useful candidates are source/format references, not runtime
dependencies. The 21st.dev API/registry account behavior, exact per-component
licenses, all maintenance signals, and engine benchmarks remain unverified.

