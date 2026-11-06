# AgentHub project orientation

The complete active application is this OneDrive checkout. The older Codex
worktree does not contain all of its features.

- [README and commands](README.md)
- [Current architecture](docs/architecture.md)
- [Development, configuration and safety boundaries](docs/development.md)
- [Testing and limits of verification](docs/testing.md)
- [Restructuring report and change manifest](docs/restructuring.md)
- [File-by-file audit](docs/repository-audit.csv)

The original 2026-10-24 walkthrough is preserved in
[the historical archive](docs/history/project-walkthrough-2026-10-24.md).
It describes an earlier runtime and includes outdated claims about Git,
type checking, session UI and API protections. Use the current guides above for
setup and architecture; retain the archive as evidence of earlier decisions.

Before editing, read `AGENTS.md`, inspect the working tree, and read applicable
bundled Next.js documentation in `node_modules/next/dist/docs/`. Verify the live
server's actual root with `/api/agent-session/files?op=info`.
