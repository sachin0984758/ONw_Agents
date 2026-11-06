---
name: game-performance
description: Identify game CPU/GPU, draw-call, memory, asset-size, and frame-pacing bottlenecks, especially on modest local hardware.
---

# Game Performance

1. Establish target resolution, frame-rate goal, GPU/VRAM budget, scene complexity, and measured baseline.
2. Profile before optimizing. Separate CPU simulation time, GPU/render time, asset loading, and garbage-collection spikes.
3. Check draw calls, shadow casters, postprocessing, geometry, texture dimensions, transparency overdraw, and bundle/asset size.
4. Prefer targeted fixes: instancing/reuse, lower-cost shadows, bounded physics steps, level-of-detail, texture compression, and lazy loading where appropriate.
5. Re-measure the same scene and report actual measurements; do not infer FPS from a successful build.
6. Preserve visual readability and gameplay feel while reducing cost.
