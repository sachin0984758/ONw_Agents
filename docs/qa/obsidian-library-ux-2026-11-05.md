# Obsidian library and design guidance

The connected vault now opens as a library inside Capability Packs. The setup form is under Connection settings & agent session. The library shows folder counts, a paginated note list, an automatically opened real note, Read/Source controls, styled Markdown headings/lists/tables, and connected-note buttons. Memory proposals and history retain their original review controls below the library. No vault files were edited.

The metadata-only `GET /api/obsidian?op=browse` uses the existing bounded, vault-restricted index; it returned 1,476 real notes and no hidden paths. Forty notes are rendered per list page and all indexed notes can be paged through. Content search remains lexical with the existing bounded result limit. Source preserves original Markdown. Reading strips frontmatter and shows wiki-link labels; the connected-ideas footer provides navigation. Images and ordinary external links are inert in the reader to prevent unrequested external requests. LaTeX remains readable source notation rather than a mathematical typesetter; Obsidian remains available for its complete rendering and editing support.

Website Builder v1.1.0 now includes explicit design workflow guidance: inspect the task and existing UI, establish hierarchy, use progressive disclosure, reuse reviewed components, implement keyboard/focus/loading/error/empty states, check responsive sizes and overflow, and use actual screenshots when available. Enabled for the existing Website Builder assignment at user request. This does not install a vision model or add screenshot tools to AgentHub agents.

Verified:

- Typecheck and strict lint on modified source and tests passed.
- 7 presentation checks passed (folder grouping/counts, readable labels, frontmatter, wiki labels, unchanged original text).
- 15 capability checks passed, including actual design guidance reaching assigned agent context and truthful vision limitations.
- 18 isolated temporary-vault checks passed, including reviewed writes and scope restrictions. These are file/integration checks, not actual-model responses.
- Isolated webpack production build succeeded with `.next-obsidian-ux` output. Generated TypeScript include entries were removed afterward.
- Browser: real vault auto-open, folder selection, whole-number note selection, Source via keyboard Enter, Read mode, connected Natural Numbers navigation, and page two of the Aptitude collection (Simple Average) worked.
- Responsive inspection at 1440px desktop, 768px tablet and 390px mobile. Tablet/mobile had no document horizontal overflow; mobile stacks the note list above the reader. Temporary viewport override reset after inspection.
- LM Studio on 127.0.0.1:1234 was unavailable. Fresh model response and visual reasoning by AgentHub's own agent were not verified.

Files: new `obsidian-library.tsx`, `obsidian-library.module.css`, `obsidian/presentation.ts`, `check-obsidian-presentation.ts`; updated `obsidian-memory-panel.tsx`, `capabilities-view.tsx`, `capabilities/registry.ts`, `api/obsidian/route.ts`, and `check-capability-packs.ts`. Existing Chat, MCQ, explanation and UI installer code was not changed in this redesign.
