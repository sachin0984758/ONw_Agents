# Auto slow-model failure — 2026-11-05

## Observed failure

The latest real task (`73cfc4e7-f40c-4751-8587-be260fad69fd`) asked to open Notepad and type a 100-line story. LM Studio and the Windows companion were reachable. The task made seven model requests and spent about 408 seconds in inference, then stopped after repeated native errors. Two keyboard actions failed with `The approved observation expired. Inspect the app and request approval again.` A recovery attempt also proposed a window handle that was no longer available.

The controller expired observations after 90 seconds, including at the approval handoff. This was shorter than actual model latency. Independently, Auto limited output to 1,024 tokens, and native UIA readback fell back to a 5,000-character text limit although typing permits up to 8,000 characters.

## Changes

- The 90-second limit for direct native input is retained. Only the internal handoff can renew up to 15-minute-old evidence, by obtaining a fresh observation before input.
- Renewal checks the exact process identity, window title and bounds, UIA runtime identities, controls, layout, and bounded full editor-content fingerprints. Changed, missing, oversized, or unverifiable editor content rejects renewal. Old coordinate actions cannot be renewed. Stop, pause, readonly, protected controls, and allowlists remain enforced.
- Full editor content is fingerprinted privately, rather than comparing only the 2,500-character model-facing excerpt. Readback supports the 8,000-character typing limit and stays bounded at 100,001 characters.
- Long drafting requests (including 100 lines) get a 4,096-token response budget; ordinary tasks retain 1,024. Auto guidance now asks for a new empty document/tab before drafting, explicitly avoiding select-all/replacement of an existing user document unless requested.
- Historical tasks now preserve their approval-mode label. Loading history still restores no grant, pending approval, or input capability.
- The companion was reconnected while there was no running task or active input grant, loading the new native code.

## Verified

- `scripts/check-auto-handoff.py`: 15 fixture checks, including 120-second latency, changed document/tab/process/control/layout, content changes beyond the excerpt, revocation, old coordinate rejection, unchanged focus changes, and long readback. These use the real controller methods with fake UIA objects and send no live input.
- `scripts/check-auto-native-policy.py`: 16 checks.
- `scripts/check-auto-context.ts`: 20 checks, including the larger long-output budget and provider error handling.
- `npm run check:computer-preferences`: 15 checks.
- `npm run check:computer`: 69 checks.
- `scripts/check-auto-task-store.ts`: 13 checks.
- `scripts/check-computer-transport.ts`: cancellation/independent Stop check.
- Whole-project typecheck, targeted strict ESLint, and Python syntax compilation passed.
- Real Auto model test `f7b7fea4-9fa8-4d5b-b161-34f8756d7d79` used the already loaded `minicpm-v-4.7-35b-a3b`, returned an actual proposed plan, and finished in about 102.5 seconds of inference. No computer access or native actions were granted by that test. The response was visibly displayed in Auto.

## Live Notepad verification after user authorization

The user explicitly approved the safe Notepad test. `node scripts/check-auto-notepad-model.mjs --approved-notepad-test` then passed **10 live checks** using the already loaded model and the actual Windows companion.

- Test task: `c5821d5b-3151-4e01-8319-bb904402b6b1`, final phase `completed`, two real model calls.
- The test prepared a new empty Notepad tab through the real native bridge, verified its empty editor and increased tab count, and left existing documents untouched. The model was given those real observed target identifiers.
- Only the exact two-line fixture typing proposal was allowed. Other input proposals would have been declined. Scope was Notepad only, ask every time, no files, no internet, no screenshots.
- The exact proposal was approved with the original observation **120 seconds old**, beyond the former 90-second rejection threshold. Native handoff obtained a fresh observation, validated the unchanged app/control/content, and executed the action.
- Native UIA readback exactly matched `AgentHub safe verification ✓` followed by `New empty tab only.` Independent computer-use inspection also saw those two lines in the actual Notepad document.
- No other model input action executed. The task completed and temporary input access was revoked. The new test tab is left unsaved for user inspection; no existing document was saved, closed, cleared, or replaced.
- Evidence: `output/auto-slow-model-fix/live-notepad.json` and `output/auto-slow-model-fix/notepad-verified.png`.

## Remaining limits

The live model/controller check typed a short exact fixture. The 100-line/over-5,000-character readback and larger response budget are covered by automated tests; a complete model-generated 100-line story was not run in this turn. Slow inference remains a property observed with the selected loaded model; no speed improvement is claimed.

Existing failed tasks and user documents were preserved. No old task was resumed automatically.
