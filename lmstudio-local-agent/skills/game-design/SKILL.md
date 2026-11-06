---
name: game-design
description: Turn a game idea into a compact game loop, mechanics, assumptions, and measurable acceptance checks before implementation.
---

# Game Design Workflow

1. Extract genre, platform, player fantasy, camera, controls, art direction, target hardware, and constraints from the request.
2. If a missing detail is low-risk, choose a reversible default and record it. Ask only about choices that change the game substantially.
3. Define the core loop in 3–5 actions, then list the win/fail states and restart path.
4. Create `GAME_DESIGN.md`, `TECHNICAL_DESIGN.md`, `TASK_PLAN.md`, and `ACCEPTANCE_TESTS.md` with `create_game_plan`. Review defaults; correct them before coding.
5. Plan the smallest playable vertical slice first. Defer decorative content and progression until it passes.
6. Keep task dependencies visible in the persistent ledger; do not mark work complete without evidence.

## Design checks

- A player can tell the immediate goal and how to act.
- The core loop has visible success/failure feedback and a restart route.
- Mechanics are testable separately from rendering when practical.
- Controls and readability work at the target viewport and a smaller viewport.
- Distinguish assumptions from requirements and implemented features from verified ones.
