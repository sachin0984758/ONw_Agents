# Reference note: Wizard Chess

Inspected copy: `workspace/projects/wizard-chess-3d`. The React entry/shell is `src/App.tsx`; most board rules, scene setup, input, animations, and multiplayer code are concentrated in a very large `src/wizardChessEngine.js`. The project includes seven compressed `.glb.gz.b64` assets under `public/assets/glb/` and `test/applet.test.mjs` validates the simplified single-player shell and that the assets decode as glTF.

Reusable observations: keep board/rule tests independent from WebGL; treat model decompression and asset validity as testable contracts; inspect the engine around the exact requested feature before modifying it. Limitation: the current engine is monolithic and contains multiplayer/API paths, so do not assume it is an offline chess-AI opponent. The archive declares `@google/genai`, but the inspected app source does not use its SDK/API.
