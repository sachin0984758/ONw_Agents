# Architecture deep dive

This directory is a guided engineering textbook for the current AgentHub
checkout. Start at [`00-EXECUTIVE-OVERVIEW.md`](00-EXECUTIVE-OVERVIEW.md), or use
the repository-level [complete architecture guide](../../AGENTHUB_COMPLETE_ARCHITECTURE.md).

| Chapter | Subject |
|---|---|
| 00 | Purpose, audience, and capability boundaries |
| 01–03 | System, stack, and repository structure |
| 04–06 | Frontend, backend, local AI, and agent loops |
| 07–08 | Flowcharts, sequences, and information flow |
| 09–12 | Feature modules, persistence, tools, and UX |
| 13–15 | Security, engineering theory, and reconstruction |
| 16–19 | Verification, history, glossary, and assessment |

The companion [third-party independence audit](../../THIRD_PARTY_INDEPENDENCE_AUDIT.md)
documents actual model-provider defaults, opt-in network paths and retained
protocol compatibility. Existing operational guides in `docs/` remain the source
for setup commands and detailed safety prerequisites.

## How to read claims

Code paths describe intended behavior, not automatically successful live
behavior. The source-level tests often use mocks; only live checks prove contact
with the local model or Windows companion. A feature may be implemented while
remaining unverified in this environment. Security controls are application
policy unless an OS sandbox is explicitly stated.
