---
name: web-game-development
description: Create browser games with Canvas, DOM, or an existing web engine, covering the game loop, input, responsive layout, and packaging without unnecessary 3D systems.
---

# Web Game Development

1. Prefer the project's existing framework. For a new 2D prototype, a small Canvas/DOM implementation is usually enough; add a build tool only when modules/assets require it.
2. Separate game state/update/draw functions. Use a bounded `requestAnimationFrame` loop with delta-time clamping and clean teardown.
3. Support keyboard and pointer/touch input, pause/restart, resize, and high-DPI rendering without tying rules to the DOM.
4. Add deterministic tests for scoring, collisions, transitions, and edge cases.
5. Keep assets local unless remote retrieval is explicitly needed; expose loading errors and provide controls/help.
6. Validate the production build and playable interactions, not only static markup.
