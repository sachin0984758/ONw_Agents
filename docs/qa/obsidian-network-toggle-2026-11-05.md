# Obsidian switch in Agent Network

Preserved the existing Agent Network canvas, sidebar, inspector, palette and graph controls. Added a native accessible Obsidian switch and Connect device before the existing search field. The connection panel detects installed vaults with Search Obsidian and offers explicit Connect vault. Existing connected vaults can be viewed immediately with the switch.

The switch changes the view only: off restores the workspace/agent graph; on shows the connected vault's note graph and note explorer. Search filters note labels and paths, selecting a note reads the actual Markdown into the inspector, and Open in Obsidian links to the original note. No edits or model inference are needed. Turning the view off does not revoke or expand memory permissions. The connection panel explains its separate authorization action.

`GET /api/obsidian?op=graph` resolves actual wiki and local Markdown note references against the bounded vault index. It deduplicates reciprocal references, skips unknown/outside targets, and does not invent semantic relationships. Graph scans cap text at 32 MB, notes at the existing 5,000 index limit, and edges at 15,000. All indexed notes are represented even if the edge scan is bounded; the UI labels a bounded scan. Graph cache is 30 seconds; while on, the client checks availability every 15 seconds and refreshes links approximately every minute or when the note count/connection changes. Disconnects clear the note graph on the next availability check. Already-open note contents follow normal read snapshots.

Verified real vault: My Second Brain, 1,476 notes, 1,476 scanned, 3,558 deduplicated references, no scan limit hit. Counts are saved in `output/obsidian-network/real-graph.json`.

Validation:

- 19 temporary-vault filesystem/security checks passed, including actual wiki graph links and reciprocal deduplication.
- 8 network/projection checks passed, including note identity, missing endpoints, finite positions and empty graph.
- Typecheck and strict lint on changed source/tests passed.
- Isolated webpack production build passed using `.next-obsidian-network`.
- Browser: Connect device → Search Obsidian detected the actual vault path; graph on displayed all notes; network search found the natural-number note; inspector read the actual note; off restored the original workspace graph; on restored the note graph. Both native pointer and keyboard switch behavior verified. The floating mascot initially overlapped the control; its existing Home shortcut moved it aside.
- No existing vault notes changed, no new software installed, no commit/push. Existing Chat, MCQ, Auto, library installer and memory-review behaviors were not modified.
- Mobile control check at 390px had no document horizontal overflow; viewport override restored. Note reader bold text stays inline and its content has no horizontal overflow. Screenshot: `output/obsidian-network/graph-and-note.png`.

Changed files: `agents-network.tsx`, `agents-network.module.css`, new `use-obsidian-network.ts`, `agent-network.ts`, `obsidian/types.ts`, `obsidian/vault.ts`, `api/obsidian/route.ts`, `check-obsidian-memory.ts`, new `check-obsidian-network.ts`.
