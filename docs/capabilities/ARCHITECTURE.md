# Capability platform architecture

Audit date: 2026-10-29. This is an additive slice of the current Next.js application.

## Reused foundations

| Need | Existing owner | Status |
|---|---|---|
| Local model discovery and inference | `src/lib/agent-hub/llm.ts`; Sessions resolves only discovered local models | Reusable; provider failures still depend on the configured provider |
| Session agents and slash commands | `src/lib/agent-hub/session/agents.ts` | Reusable: `/website`, `/game`, `/research`, `/other` |
| Session tool execution | `session/tools.ts`, `session/runner.ts`, `session/permissions.ts` | Reusable; writes/commands retain approval and workspace checks |
| Skills Library | `skills-registry.ts`, `/api/skills` | Reuse; do not create a second skill store |
| UI component source registry | `marketplace/catalog.ts`, `/api/ui-components` | Reuse; source review/install is separate from capability metadata |
| Website templates | existing design/template catalog | Reference from capability packs; no second template store |
| Windows automation | `computer/*`, Python companion and `/api/computer` | Reuse; visible desktop control is not an OS sandbox |
| Agent-team capability selection | `agent-session.ts` capability enum and tool-based selection | Reuse; separate from Session slash-agent IDs |
| Persistent application state | `db-path.ts`, `fs-atomic.ts` and local JSON | Reuse; no database replacement |
| Game workflow | game agent and installed Skills Library routing | Partial; no game-engine packs installed by this change |
| External research/browsing | no browser research tool in Session tool list | Missing; project-file research exists |

## New shared layer

`src/lib/agent-hub/capabilities/` defines a versioned metadata manifest, validates
references against the existing Session agent and tool registries, and stores
install/enable/assignment state in `db/capability-packs.json`. The API is
`/api/capabilities`; the shell exposes the Capabilities view. For an explicitly
selected slash agent, enabled, assigned packs whose keywords match the task add
resource-routing context to the existing system prompt. The model still receives
the established Session tool catalog; pack declarations do not create, hide, or
authorize tools.

Built-in packs: Website Builder, Coding Workflows, Game Development, Research
Workflows, General Tasks, and Teaching. They are discoverable but initially not
installed. Imported packs contain declarative metadata only. They cannot contain
or run scripts, install packages, or start connections.

## Lifecycle now covered

`discover → validate/import → install → assign → enable → relevance match → use
existing resources → disable/uninstall`.

Dependency existence and compatibility checks apply to install; uninstall is
blocked while an installed pack requires the target. Optional dependencies do
not block uninstall. No remote package update or executable plugin lifecycle is
implemented. Current capabilities are single-user local JSON and one server
process, consistent with the existing application store.

## Not implemented in this slice

Direct 21st.dev search/preview, dynamically installing third-party tools,
automatic model-capability negotiation, remote pack update discovery, and a
browser/research connector. Packs do not make a benchmark claim for website,
game, or external research tasks. See `FINAL_IMPLEMENTATION_REPORT.md` for the
phase acceptance matrix.

