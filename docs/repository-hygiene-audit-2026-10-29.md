# Repository hygiene audit — 2026-10-29

## Result

Scanned 992 current non-ignored repository files by content hash, excluding generated
dependencies/build caches, runtime databases, user output, temporary tool
results, and environment files. Exact byte matches were reviewed before
cleanup; a matching hash alone was not treated as proof that a file was safe to
delete.

- Removed the unused empty root `index.css` from the Desk Racer example. The
  active styles are under `src/` and the empty root file was not linked.
- Removed the unused empty root `index.css` from the Wizard Chess example. Its
  entry point imports `src/styles.css`; the root file was not referenced.
- Removed the empty `mini-services/.gitkeep` marker and its now-empty directory.
  No application code used that directory; the Python runtime build test
  creates its own isolated `mini-services` fixture when needed.
- No other empty files remained in the scanned non-data repository files.
- A final post-cleanup scan covered 992 current non-data files: 0 empty files and 1
  exact duplicate group (the two independent PostCSS configs described below).
- The root package manifest has no package declared in both `dependencies` and
  `devDependencies`.
- Removed the unused Google AI SDK, Gemini key boilerplate and AI Studio banners
  from the separate sample apps; see the provider audit for the exact scope.

The directory scan found empty `lmstudio-local-agent/downloads/` and `temp/`
folders, which are declared runtime staging/temp paths and are recreated by
that agent's setup. It also found empty `.venv/Include/` folders inside the
installed Python virtual environments. These runtime/environment directories
were retained; removing them would not be cleanup of unused source files.

## Exact duplicate review

The only remaining exact duplicate pair is `postcss.config.mjs` in each of the
separate Desk Racer and Wizard Chess project roots. Both are minimal standalone
project configs (`plugins: []`). They remain separate so each sample project
retains its own self-contained build root. They are not duplicate application
modules, and combining them would couple or break the independently copied
examples.

Repeated common basenames (such as `README.md`, `package.json`, and `main.tsx`)
are expected across independent packages and examples. They were not removed by
name alone. User data under `db/`, deliverables under `output/`, dependencies,
build artifacts, caches, public media, and historical audit records were
preserved.

## Current status

The provider and network findings are maintained in
[`THIRD_PARTY_INDEPENDENCE_AUDIT.md`](../THIRD_PARTY_INDEPENDENCE_AUDIT.md).
The architecture overview and current verification evidence are linked from
[`AGENTHUB_COMPLETE_ARCHITECTURE.md`](../AGENTHUB_COMPLETE_ARCHITECTURE.md).
Historical reports retain the dates and results they recorded; this audit does
not rewrite their past state. The repository's existing
[`repository-audit.csv`](repository-audit.csv) is a prior file inventory, not a
live duplicate report; this dated review avoids overwriting that existing
untracked artifact.
