# Reference note: Desk Racer

Inspected copy: `workspace/projects/desk-racer`. Vehicle motion and spline/track sampling are in `src/physics/KartPhysicsController.js`; scene responsibilities are split among `src/scene/` builders; audio is isolated in `src/audio/WebAudioSynth.js`. Track spline and desk manifest data are in `public/assets/data/`.

The controller implements custom track-following/handling rather than relying on a general rigid-body engine. Preserve its state invariants and reset/teleport paths when editing. The four detailed GLB models are fetched from `www.gstatic.com` by the Vite proxy in development and by a plugin during production builds. Review network behavior before calling the game fully offline; the successful production build bundled local copies.
