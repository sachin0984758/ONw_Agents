# Slow spiral galaxy for large vaults

Vaults with 400 or more indexed notes now use a deterministic four-arm spiral disk. Real note IDs, paths, original references, selection and note reading remain intact. Smaller vaults retain the existing scattered layout; the workspace galaxy remains unchanged. Both centres keep the previously requested gap.

Large notes rotate in their tilted disk plane instead of flipping the whole cloud edge-on. Combined view advances at 0.035 radians/second nominally (previously 0.12), with existing pause/resume, drag and zoom controls. The live browser measurement was approximately 0.0322 radians/second over 37.087 seconds while other checks were running. Pause held the recorded phase constant.

Visual treatment inspired by the supplied image: blue/violet/pink spiral arms, soft cloud sprites, a luminous core and subtle polar light. The 2,100 dust particles and cached 64px cloud sprites are decorative pixels, never counted as notes or connections and never clickable. Actual note references are subdued by default; links touching the selected note retain stronger highlighting. No image download, external dependency, model inference or vault write required.

Verification: 26/26 network, universe and galaxy checks passed; typecheck and strict lint passed; isolated webpack build output `.next-galaxy-visual`. Browser visual inspection showed the spiral; measured slow rotation, verified pause and selected the original Natural Numbers note. Screenshot: `output/obsidian-galaxy/spiral.png`.

Source: `src/lib/agent-hub/agent-network.ts`, new `src/components/agent-hub/galaxy-nebula.ts`, `src/components/agent-hub/agents-network.tsx`, `scripts/check-obsidian-network.ts`. Existing chat, MCQ, permissions, library installation and file-reading code unchanged.
