# Workspace and Obsidian universe view

Agent Network now combines two independently sourced galaxies when its existing Obsidian switch is on: the current workspace (Large Project here) and Obsidian (My Second Brain here). It no longer replaces the project with the vault. Both roots have visible labels and explorer entries. Existing agent groups, worktrees, sessions, code and notes remain filterable and selectable together. Selecting an actual note keeps the existing local note inspector.

The layout scales and translates the two existing graphs without changing IDs, ownership, note paths or edges. There are no invented edges between the workspace and vault. The centres remain separated during automatic rotation; local node positions rotate within each galaxy. Stars and radial glows are decorative canvas pixels and are not included in data counts. Obsidian off returns the unmodified original workspace layout. No permission, model, vault file, chat, teaching, MCQ or installer changes.

Validation:

- 20/20 network and universe checks passed, including both root positions, edge/node counts, retained agent and note identities, no input mutation, and separated projected centres across three rotations.
- Typechecking and strict lint passed for the changed source/tests.
- Isolated webpack production build uses `.next-obsidian-universe`; generated build-specific TypeScript include entries are removed afterward.
- Live browser: both named universe entries and all original node-type filters present. Real combined snapshot has 1,786 nodes and 3,912 edges (309 workspace nodes plus 1,477 vault nodes, and 354 workspace edges plus 3,558 note references). Counts include each centre. The counts reflect the current saved project tree and vault.
- Toggle off restored workspace-only mode and removed universe entries. Toggle on restored both graphs. Obsidian centre selection and source-backed note reading were checked in the combined view. No model inference required or claimed.

Files: `src/lib/agent-hub/agent-network.ts`, `src/components/agent-hub/agents-network.tsx`, `src/components/agent-hub/agents-network.module.css`, `scripts/check-obsidian-network.ts`. Screenshot: `output/obsidian-universe/two-galaxies.png`.
