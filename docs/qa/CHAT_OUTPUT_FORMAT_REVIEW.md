# Chat output format review

Date: 2026-10-28

## Changes

- Quiz questions, choices, and explanations render inline code, emphasis, and strikethrough instead of literal Markdown markers. Choice labels cannot contain nested interactive links.
- Ordinary fenced code is preserved even when its text looks like numbered MCQs or answer summaries. Incomplete streamed fences are protected too.
- Registered the missing CSS syntax highlighter.
- Code colors follow the conversation profile palette, including Day, Night, Warm Sand, Ocean Panels, and Bold Outline.
- Code copy shows a failure message when both clipboard methods fail, rather than claiming success.
- Profile and UI Components use the shared bounded dropdown. Dropdown portals inherit the conversation palette.
- Chat profile images use the Next image component, resolving the attachment regression guard.

## Verification

These are actual React server-rendering and parser checks, not screenshots or a browser interaction audit.

| Area | Result |
| --- | --- |
| MCQs: supported formats, grading, hidden keys, inline formatting, code fences | 25 checks passed |
| Teach: diagrams, quiz controls, hidden explanations, streamed/invalid content | 20 checks passed |
| Code: indentation, line numbers, long lines, HTML escaping, CSS, palette | 17 checks passed |
| Advanced lesson state and heading rules | 9 checks passed |
| Saved model replies: confirmation gates, confused learner, steps 3–5, current-step practice | 6 checks passed; historical replies replayed, not fresh inference |
| Chat attachment and thinking controls | 65 checks passed |
| Sessions presentation / layout | 14 / 54 checks passed |
| Playground / Skills | 239 / 172 checks passed |
| Shared controls | 54 checks passed |
| Full regression at this review | 28/28 suites passed; 1,674 checks passed; 14 skipped. Current aggregate after later Chat/Sessions/Roadmap and Auto additions: 30/30 suites, 1,770 checks passed, 14 skipped. |
| Final incremental code-fence and CSS changes | Relevant rendering suites rerun and passed |
| TypeScript and focused ESLint | Passed after changes |

Full regression evidence: `.verification/chat-output/regression.log` and `.verification/modernization/tests/`. Fresh model requests and generated render artifacts are recorded under `.verification/chat-output/`.

## Fresh local model checks

The live check uses synthetic prompts and stateless Chat requests; it does not add messages to the user's saved conversations. It exercises the same streaming response path as Chat.

LM Studio reported `flint` loaded. The first nonstreaming MCQ request exceeded 180 seconds. The subsequent normal MCQ and mixed-format streaming requests failed when LM Studio unloaded the model; the provider log records that event at 19:05:31 local time. A direct short streaming probe subsequently returned `OK`, confirming recovery for a small prompt. The Teach request exceeded 300 seconds without a completed answer.

The Advanced request also ended with a provider streaming error. LM Studio recorded another model unload at 19:14:17. None of the four fresh longer-form cases completed successfully, so fresh output generation has not passed this audit. See `results.json` for the final per-mode outcomes. Model loading settings were not changed by this audit.

## Limits

Local browser automation was disabled in Work settings. No fresh screenshots, visual contrast measurements, browser quiz submissions, clipboard clicks, or full keyboard interaction sweep were performed. The renderer fixes and automated results do not establish that every live model will follow the requested format. External integrations and Auto desktop execution were not exercised.
