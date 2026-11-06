# 17 — Development history

## Evidence available

The directory is a Git worktree and has commit history. The observed recent log
includes:

| Commit | Subject | Safe inference |
|---|---|---|
| `b6451dc` | measured split workspace — floored 58/42 grid, draggable divider, pane-safe response | A recent UI layout refinement was committed. |
| `7e3d4ef` | real-FS file ops, live local-model checks, deep-link hardening | Filesystem checks and local-model verification scripts were added/updated. |
| `79f15b7` | one-current-result Playground, chat attachments+thinking, truthful runtime, full-width sessions, working file ops | Several feature and status changes were grouped in that commit. |
| `596b025` | stop tracking local Prisma dev database | A local database artifact was removed from version control. |
| `039bd28` | token usage: record server-side so direct API calls are counted | Usage tracking moved into server-side request handling. |

Documentation archives under `docs/history/` include a 2026-10-24 walkthrough
and UI, teaching, token and full-application audits. Those reports are
historical snapshots, not proof of current behavior. Current operational
architecture in `docs/architecture.md` intentionally supersedes outdated
statements in the old walkthrough.

## What cannot be reconstructed reliably

The working tree contained many modified, deleted and untracked files before
this session. Those changes are not attributable from `git log` alone. The
commit subjects summarize intent, not every code-level decision. No claim is
made about the project's full origin story, individual authorship, or every
feature's first implementation. A complete history chapter would require
reviewing all relevant commits and PRs, not extrapolating from five subjects.

## Evolution visible in the source

The current design reflects coexistence of an older large task runtime and newer
modular chat/session/computer services, plus separate terminal/MCP packages. The
local JSON storage and local model workflow are central. This evolutionary shape
explains duplicated model/context/tool code and the need to document which
runtime owns each feature. It is an architectural observation, not an assertion
that all duplication should be removed.
