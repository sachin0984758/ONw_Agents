---
name: game-testing
description: Verify game builds, deterministic mechanics, asset loading, runtime behavior, acceptance criteria, and regressions with honest evidence.
---

# Game Testing

1. Read `ACCEPTANCE_TESTS.md` and map each item to a specific automated or observable check.
2. Inspect existing tests and scripts. Never execute package lifecycle hooks or unfamiliar scripts by default; use the fixed approved runner and explain its exact action.
3. Test core rules separately from rendering. Cover normal, boundary, failure, restart, input-focus, and asset-load paths.
4. Run type/build/test actions and capture bounded output. Reproduce a failure, make one targeted repair, then rerun the relevant checks.
5. Launch a local preview only after approval. Check HTTP availability separately from browser interaction.
6. Only claim visual or interactive verification when a browser automation/inspection tool actually observed it. Report unavailable capabilities explicitly.

Use `get_game_task` to resume and `update_game_task` to record status/evidence. Do not mark a task complete based only on model confidence.
