---
name: game-physics
description: Design and debug game movement, vehicle handling, rigid-body simulation, collisions, track following, and physics stability.
---

# Game Physics Workflow

1. Determine whether the mechanic needs a physics engine. Prefer simple deterministic math for a small prototype; do not add Rapier/Bullet solely because it is a 3D game.
2. Separate input sampling, fixed or bounded simulation updates, collision response, and render transforms.
3. Clamp frame delta after pauses, handle restart/teleport by resetting all coupled state, and test at low/high frame rates.
4. For vehicles, define units, acceleration, drag, braking, steering response, traction, and speed caps. Test straight-line, cornering, collision, off-track, and reset cases.
5. Add tests for invariants and boundaries (finite state, speed limits, collision response, restart). Diagnose with telemetry before changing many constants.
6. Record what is simplified and what has not been physically validated.

Load `references/desk-racer.md` only for a related Three.js vehicle/track project.
