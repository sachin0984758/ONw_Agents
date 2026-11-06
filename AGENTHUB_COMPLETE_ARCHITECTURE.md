# AgentHub: complete architecture guide

This is the entry point for a repository-grounded explanation of AgentHub. It
describes the checkout at `C:\Users\SACHIN\OneDrive\Desktop\Test`, not a
generic agent product. Implementation claims are tied to source paths; a feature
marked partial or unverified must not be read as a promise that every workflow
works end to end.

## Read in this order

1. [Executive overview](docs/architecture-deep-dive/00-EXECUTIVE-OVERVIEW.md)
2. [System architecture](docs/architecture-deep-dive/01-COMPLETE-SYSTEM-ARCHITECTURE.md)
3. [Technology stack](docs/architecture-deep-dive/02-TECHNOLOGY-STACK.md)
4. [Repository map](docs/architecture-deep-dive/03-REPOSITORY-STRUCTURE.md)
5. [Frontend](docs/architecture-deep-dive/04-FRONTEND-ARCHITECTURE.md) and [backend](docs/architecture-deep-dive/05-BACKEND-ARCHITECTURE.md)
6. [Local AI and agent loops](docs/architecture-deep-dive/06-LOCAL-AI-AND-AGENTS.md)
7. [Flows](docs/architecture-deep-dive/07-COMPLETE-FLOWCHARTS.md) and [sequences/data flows](docs/architecture-deep-dive/08-SEQUENCE-AND-DATA-FLOW-DIAGRAMS.md)
8. [Feature chapters](docs/architecture-deep-dive/09-MODULE-BY-MODULE-EXPLANATION.md)
9. [Storage](docs/architecture-deep-dive/10-DATA-STORAGE-AND-MEMORY.md), [tools and automation](docs/architecture-deep-dive/11-TOOLS-SKILLS-AND-WINDOWS-AUTOMATION.md), and [UI](docs/architecture-deep-dive/12-UI-UX-ARCHITECTURE.md)
10. [Security and performance](docs/architecture-deep-dive/13-SECURITY-AND-PERFORMANCE.md), [engineering theory](docs/architecture-deep-dive/14-SOFTWARE-ENGINEERING-THEORY.md), and [rebuild guide](docs/architecture-deep-dive/15-REBUILD-FROM-SCRATCH-GUIDE.md)
11. [Testing](docs/architecture-deep-dive/16-TESTING-AND-VERIFICATION.md), [history](docs/architecture-deep-dive/17-DEVELOPMENT-HISTORY.md), [glossary](docs/architecture-deep-dive/18-ARCHITECTURE-GLOSSARY.md), and [assessment](docs/architecture-deep-dive/19-FINAL-ENGINEERING-ASSESSMENT.md)

The independent [third-party independence audit](THIRD_PARTY_INDEPENDENCE_AUDIT.md)
tracks provider integrations and network destinations. The project’s
[architecture](docs/architecture.md), [development](docs/development.md),
[testing](docs/testing.md), and [readiness](docs/final-readiness.md) guides
remain operational references. The [file inventory](docs/repository-audit.csv)
is a prior review snapshot; use the dated [repository hygiene audit](docs/repository-hygiene-audit-2026-10-29.md)
for the latest duplicate and empty-file check.

## One-minute mental model

The browser renders one Next.js dashboard. The shell chooses a feature view and
feature components call same-origin API routes. Routes validate requests and
delegate work to server-side domain services. Chat and agent workflows select a
configured compatible runtime; LM Studio and Ollama run on loopback by default.
Agent runtimes may call permission-checked tools, and state is persisted to
local JSON files under `db/`. Auto can use an optional Windows companion for
observable, user-approved desktop actions. A separate terminal agent and an
optional MCP package are distinct processes; they are not launched by the web
shell.

## Evidence conventions

- **Verified in source**: implementation path exists and was inspected.
- **Regression tested**: covered by the named automated suite, usually with a
  fixture rather than a real model or desktop application.
- **Live verified**: a real local service or app was exercised in this audit.
- **Partial / unverified**: the code has limits or runtime behavior was not
  exercised. HTTP 200 alone is only route availability.

The checkout was already heavily modified before this audit. The documentation
is additive; it does not attribute historical worktree changes or old test
results to this audit. See the final chapter and audit report for current-session
verification, limitations and working-tree boundaries.
