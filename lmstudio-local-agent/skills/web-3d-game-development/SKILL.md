---
name: web-3d-game-development
description: Build or maintain browser-based 3D games with an existing Three.js, React Three Fiber, or similar renderer. Covers scene structure, cameras, lighting, assets, animation, and rendering lifecycle.
---

# Web 3D Game Workflow

Read the existing project architecture before choosing a stack. Do not replace an existing engine or scene system without evidence that it blocks the requested change.

1. Identify the scene entry point, renderer/canvas lifecycle, update loop, camera rig, input, asset loaders, and UI boundary.
2. Keep simulation state separate from the React render cycle when frequent updates would cause UI churn. Clean up listeners, RAF loops, GPU resources, and observers on teardown.
3. Make camera framing, resize behavior, loading progress, and asset failures explicit.
4. Reuse existing models/materials. Inspect texture dimensions, polygon counts, and file size before adding assets.
5. Keep interaction targets readable; add a simple fallback when WebGL or an asset fails.
6. Test build/type checks and project-provided game tests. A successful build does not prove scene interaction or visual quality.

## Loading a related example

Use `read_skill("web-3d-game-development", ["references/wizard-chess-3d.md"])` only when that reference is relevant. Treat it as a project note, not a universal recipe.
