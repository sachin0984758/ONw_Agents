# Formula rendering in Obsidian notes

The actual Natural Numbers note already contains the five correct sum formulas. Its original table has the correct three columns. Raw `$...$`/LaTeX was appearing because the note readers used plain Markdown without a math extension. No vault files were changed.

Added the shared `ObsidianNoteMarkdown` renderer to the library reading pane and the network note inspector. Inline and block equations now typeset with locally bundled KaTeX fonts and CSS, accessible MathML, proper fractions and superscripts, and scrollable display equations. Paired inline equations on consecutive lines remain separate. Source mode and literal code retain the original text.

Dependencies: remark-math 6.0.0, rehype-katex 7.0.1 and KaTeX 0.19.1. The KaTeX override aligns both transitive plugins with the direct renderer/CSS version, avoiding the older 0.16 dependency and its reported low-severity advisory. No blanket npm audit fix or unrelated dependency migration was performed. The repository still reports 11 other vulnerabilities (8 moderate, 3 high); this task does not claim a clean application security audit.

KaTeX runs with `trust:false`, `maxSize:10` and `maxExpand:200`; external-image/link/HTML-extension commands remain disabled. Ordinary note images and links retain their inert rendering. Malformed or unsupported TeX stays visibly inspectable without crashing the reader. [KaTeX configuration reference](https://katex.org/docs/options).

Verification:

- 21/21 targeted checks passed, covering the five table formulas, fractions/powers/MathML, block maths, paired lines, code preservation, untrusted commands, fallback and direct sum calculations at six values of n.
- The actual vault note was read via AgentHub's API, contained all five expected expressions, and rendered without math errors. Live browser library: 48 rendered formulas, 19 within the table including example expressions, zero KaTeX errors, and KaTeX_Main font applied.
- Numerical examples at n=4: natural 10, odd 16, even 20, squares 30, cubes 100.
- Chat quiz renderer: 25/25; teaching renderer: 22/22, using the repository CSS-module test loader.
- Typecheck and strict lint passed. Isolated webpack production build uses `.next-note-math`.
- Screenshot: `output/obsidian-math/formula-table.png`.
- The live network note inspector independently rendered 48 formulas with zero errors and the KaTeX_Main font, matching the library reader.

Source changes: new `obsidian-note-markdown.tsx`, `obsidian-note-markdown.module.css`, `check-obsidian-math.tsx`; reader integration in `obsidian-library.tsx` and `agents-network.tsx`; package manifest and lockfile. Existing chat prompts, MCQs, teaching contracts, permissions, galaxy layout and vault source files were preserved.
