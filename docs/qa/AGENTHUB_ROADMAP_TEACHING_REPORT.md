# AgentHub Roadmap and Teaching Report

**Checkpoint:** 2026-10-29  
**Readiness:** Deterministic structure, rendering, and saved lesson-progress round-trip pass. A live Introduction lesson with local branch choices also passed; multi-step traversal and learner adaptation remain open.

## Existing behavior

Roadmap graph resolution is local in `roadmap-library.ts`; graph traversal supplies current topic, prerequisites, and branch choices. Teaching uses `teaching-framework.ts` for subject, level, lesson scope, section plans, and learner progress. Chat and Playground render generated lesson content and interactive questions. Advanced Teaching keeps explicit step gates in the prompt/runtime and does not advance solely because a reply is long.

## Root cause and change in this checkpoint

The Roadmap tutor conversation, current topic, selected graph, and completed-topic IDs were held only in `PlaygroundView` component state. Saving a practice persisted the editor and feedback, but not the tutor state; reloading or opening another saved practice lost the learner's Roadmap position. The practice record now has an optional, backwards-compatible `roadmapProgress` field. Saving includes the selected and active graph slugs, current topic, conversation, and explicit completion IDs; loading restores that state. Progress is marked dirty after tutor interaction and explicit topic completion. The store validates graph slugs, limits message count and size, drops non-user/assistant roles and invalid completion IDs, and leaves older records valid.

**Architecture decision:** Keep Roadmap state inside the existing per-practice session store rather than adding a second persistence backend. Completion is still recorded only when the learner uses the explicit completion control; generating a lesson does not mark mastery.

**Files changed:** `src/components/agent-hub/playground-view.tsx`, `src/lib/agent-hub/playground-types.ts`, `src/lib/agent-hub/playground-store.ts`, and `scripts/check-playground.mjs`.

## Test results

- Teaching rendering: 20 checks passed.
- Advanced lesson structure: 9 checks passed.
- Playground and Roadmap structural/provider fixture suite: 245 checks passed, including saved Roadmap lesson/topic/completion round-trip, sanitization, and bounded provider output budgets.
- Chat quiz/code rendering: 25 and 17 checks passed.
- Against LM Studio `spark-x2.6-4b`, Advanced Step 1 satisfied its gate in 92.6 seconds. An opt-in Data Analyst Introduction lesson returned the required local SQL/Excel/Tableau branch choices in 141.5 seconds and contained no external links.
- Full suite: 30/30 suites; 1,770 checks passed; 14 skipped.

## Current cross-project verification

`npm test` passed 30/30 suites (1,770 checks, 14 skipped), `npm run typecheck` passed, the isolated production build generated all 24 static pages, and lint passed with zero errors and three example-project warnings.

## Limits

The graph, branch choices, progress helpers, persistence round-trip, and lesson renderers are covered by deterministic tests. One live opt-in lesson verifies the Introduction and branch choices, but not later branch traversal, saved-session reload, factual accuracy across subjects, or learner adaptation. No curriculum-quality benchmark was run; timings above are individual observations rather than performance guarantees.

## Next steps

Run a full local-model lesson in a disposable profile, advance through one branch, answer a quiz, reload progress, and confirm recommendations are based on recorded results. Check content accuracy independently of formatting. Keep the graph locally resolved and do not infer completion from a generated answer alone.

## Checkpoint evidence

- **Original capability:** local graph traversal, topic-specific generation, explicit topic-completion UI, and disposable practice sessions.
- **Root cause:** Roadmap-specific state was excluded from the saved `PracticeSession` schema.
- **Features implemented:** bounded persistence and restoration of lesson history, current topic, graph selection, and explicit completion marks.
- **Test outcomes:** 245 Playground checks; 30/30 suites and 1,770 checks with 14 skipped; TypeScript and isolated production build passed. One live Introduction lesson and its branch choices passed.
- **Visual review:** At 1280×720, the Playground and Roadmap controls were visually inspected and the accessibility tree was read. This is a single-width review, not responsive or keyboard acceptance.
