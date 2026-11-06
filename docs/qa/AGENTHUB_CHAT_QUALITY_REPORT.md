# AgentHub Chat Quality Report

**Checkpoint:** 2026-10-29  
**Readiness:** Automated behavior passes; local-model output formats for Chat, Advanced Step 1, and Playground prediction were exercised. MCQ repair and response-depth adherence remain mock/UI verified only.

## Existing behavior

Chat uses the shared local inference client and model router. Each conversation has independent persisted history; stateless calls do not read or write that history. Browser-side request state in `chat-runs.ts` owns optimistic messages, SSE progress, cancellation, and per-chat activity beyond a mounted view. Chat output includes code rendering, interactive MCQs, image/document attachment handling, and thinking-mode metadata.

## Work in this checkpoint

Chat now has a separate response-length control with Concise, Standard, Detailed, and Comprehensive options. The value is persisted in local Chat settings and sent on every turn. The server applies a bounded, task-aware prompt instruction only for non-standard choices; it does not alter native reasoning parameters. Missing or invalid values fall back to Standard for backwards compatibility.

The baseline lint errors in Chat were corrected. The previous real-model run returned an incomplete five-question quiz, and the route surfaced an error after the model spent about 17.7 seconds generating. Chat now validates quiz structure, makes one repair request with the draft and the same response contract, validates again, and sends a `replace` event after a valid streamed repair. The stream store replaces the partial draft instead of joining it to the repaired answer. Invalid output is not saved as a completed quiz.

## Test results

- Full suite: 30/30 suites; 1,770 checks passed; 14 skipped.
- Chat isolation and route harness: 52 checks passed, including malformed-quiz repair, SSE replacement, response-depth prompts, standard fallback, and prompt-guided thinking compatibility.
- UI interaction suite: 60 checks passed, including response-depth control wiring and separation from thinking effort.
- Background stream store: 38 checks passed, including corrected-answer replacement.
- Rendering: MCQs 25, teaching 20, and code blocks 17 checks passed.
- Multimodal route fixture: 26 checks passed.
- Live finalization against LM Studio `spark-x2.6-4b`: document streaming/history, five MCQs with complete answer keys, and Advanced Step 1 passed. Playground prediction also passed. A compact Playground bug-finding call first exceeded its 1,800-token cap; a retry after raising the bounded cap to 3,000 returned a valid finding in 651 output tokens.

## Live evidence and limits

In the isolated workflow, the streamed document answer completed in 4.4 seconds with 420 reported tokens; five MCQs took 57.8 seconds; Advanced Step 1 took 92.6 seconds; and the Playground prediction took 21.9 seconds. A valid bug-finding retry took 31 seconds. These are individual observations, not performance guarantees.

The live quiz case validates generation and renderable answer keys, while the separate malformed-draft repair path remains covered by mocks. Real-model adherence to response-depth choices remains unverified. A 1280×720 browser screenshot and accessibility tree were inspected for Chat. The response-depth picker was exercised live and Detailed persisted across reload before restoring Standard. The mascot is compact and subdued while idle and expands on hover or keyboard focus. Narrow-width and keyboard-only checks remain open.

## Next steps

With a local model loaded, exercise the malformed-quiz repair path against an actual model-generated incomplete draft and confirm a second invalid response is not persisted. Then check a genuine user conversation for stream continuation, stop/retry, and per-chat history isolation.

## Current cross-project verification

`npm test` passed 30/30 suites (1,770 checks, 14 skipped), `npm run typecheck` passed, the isolated production build passed with all 24 static pages generated, and `npm run lint` had 0 errors with 3 warnings limited to example projects.

## Checkpoint change record

- **Original capability:** isolated per-chat history, shared local model routing, streaming controls, attachments, structured MCQs, and syntax-highlighted code.
- **Root cause addressed:** malformed MCQ drafts could fail format validation without bounded recovery; stream clients needed a replacement event to avoid concatenating repaired and invalid output.
- **Architecture decision:** retain the shared Chat inference route and add one validated repair attempt there; only send a `replace` event after a structurally valid repair.
- **Files changed:** `src/app/api/chat/route.ts`, `src/lib/agent-hub/chat-runs.ts`, `src/lib/agent-hub/chat-settings.ts`, `src/components/agent-hub/chat-view.tsx`, `scripts/check-chat-isolation.mjs`, `scripts/check-chat-background.ts`, and `scripts/check-ui-interactions.mjs`.
- **Actual outcomes:** fixture and full-suite checks pass; five live MCQs and Advanced Step 1 completed with the loaded local model. Malformed-quiz repair and response-depth adherence remain unverified with a real model. The first Playground bug-finding attempt hit its cap; a 3,000-token retry passed. Timings are observations, not benchmarks.
