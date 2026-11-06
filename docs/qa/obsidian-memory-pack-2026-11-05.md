# Obsidian memory capability pack — 2026-11-05

Implemented in the existing application. No dependencies installed, no commits, no existing vault notes changed.

## Behavior

- Capability Packs contains Add system Obsidian, discovery from the local Obsidian vault registry, manual folder connection, connection status/count, search, note source viewer, wiki links/backlinks, Open in Obsidian, refresh and disconnect.
- Built-in Obsidian Memory pack supports enable/disable and the four existing specialist assignments. General assignment also controls Chat, teaching/explanations, custom agents using Chat, and Auto. Connecting explicitly installs/enables the pack and assigns all four; these choices remain editable.
- Relevant bounded excerpts are read from real Markdown files for loopback model endpoints. Chat, explanation, Agent Session and Auto call the shared retrieval adapter. Session tools also search/read notes and propose memories.
- Persistent memory writes create new UUID-named Markdown notes under `AgentHub Memory` only after exact proposal hash review. Decline writes no note. Existing notes cannot be overwritten through the memory API. Global file-write policy remains enforced.
- Local JSON connection, proposal and activity persistence is in `db/obsidian-memory.json`. Pack preferences stay in the existing pack registry. Disconnect revokes this memory adapter, not independently authorized workspace sessions. Already generated transcripts are retained.

## Evidence

- 18/18 temporary-vault checks: real files, content search, wiki links/backlinks, hidden configuration exclusion, traversal/junction refusal, proposals without writes, hash mismatch, approved actual file, replay refusal, decline, retrieval, cloud endpoint exclusion, assignment, disable and disconnect.
- Capability registry: 14/14.
- Chat quiz rendering: 25/25 and teaching rendering: 22/22, using `node --require ./scripts/register-css-modules.cjs --import tsx` (plain tsx fails on the repository's preexisting CSS-module imports).
- Typecheck passes. ESLint on all modified source/test files passes with zero warnings.
- Isolated webpack production build succeeds (`NEXT_DIST_DIR=.next-obsidian-verify`, `RAYON_NUM_THREADS=2`).
- Real local vault: My Second Brain, 1,476 non-hidden Markdown notes at verification. Actual natural-number note search/read and Aptitude index read passed. Cross-origin API request rejected with HTTP 403.
- Browser: detected system vault, displayed connected pack, searched natural numbers, opened actual note, displayed wiki connections and Open in Obsidian URI. Prepared and declined disposable proposal `f3869859-8d22-4b41-b5e7-87d6fd35e5ab`; pending count zero and no corresponding vault file exists.
- Screenshot: `output/obsidian-memory-pack/capability-memory.png`.

## Limits and unverified items

- LM Studio 127.0.0.1:1234 refused connections during this turn. No fresh actual-model recall or autonomous memory-proposal response is claimed. Shared retrieval was exercised with real temporary note text; that is not a live model test. The prior session's model test is historical evidence only.
- This is lexical retrieval, not vector embeddings, model training, or an embedded Obsidian application. Notes are shown as source text; Obsidian handles its own full editing interface. No plugin/API key required.
- Hidden folders/configuration and symlinked notes are excluded. Discovery does not read note contents. Index capped at 5,000 notes/20,000 entries/depth 32; content scans at 32 MB, note reads at 256 KB; relationship displays at 30. Refresh or a new request updates the five-second index cache. Ambiguous basename links can show several matches.
- No cloud-model vault retrieval. Existing generated replies may contain quoted note text; disabling/disconnecting stops future retrieval, not previously stored transcripts. Independently authorized generic workspace tools retain their existing scope.
- Actual vault writes were deliberately not tested with a saved test note; approved writes were verified in an isolated temporary vault. Desktop Auto input was not repeated for this read-context integration.

## Source changes

New: `src/lib/agent-hub/obsidian/{types,vault,context}.ts`, `src/app/api/obsidian/route.ts`, `src/components/agent-hub/obsidian-memory-panel.tsx`, `scripts/check-obsidian-memory.ts`.

Updated: capability registry/view, session tools/permissions, session conversation route, Chat route, explanation route, Auto runtime, capability-registry test count. Existing MCQ renderers, teaching contracts and UI library were preserved.

Obsidian's documented local Markdown storage and URI format informed the adapter: https://help.obsidian.md/Files+and+folders/How+Obsidian+stores+data and https://help.obsidian.md/Extending+Obsidian/Obsidian+URI .
