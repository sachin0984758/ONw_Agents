---
name: gameplay-programming
description: Implement game input, rules, state machines, scoring, turns, interactions, and restart/progression behavior with testable logic.
---

# Gameplay Programming

1. Inspect the existing state model and public entry points. Preserve working behavior and make a narrow change.
2. Model the core state explicitly; define legal transitions and reject invalid input at the rule boundary.
3. Keep deterministic game rules independent of rendering, audio, and network transport where possible.
4. Make input mappings discoverable and avoid capturing keys while the player is typing in a form.
5. Cover start, normal play, edge cases, win/fail, pause, and reset with tests.
6. Update the task ledger only after the specific task's evidence is available.
