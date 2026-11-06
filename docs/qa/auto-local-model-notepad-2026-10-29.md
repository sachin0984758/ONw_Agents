# Auto local-model Notepad repair and acceptance

Date: 2026-10-29. Live application: `http://127.0.0.1:3000`.

## Reported failure and fixes

The user's `open notepad and type online` task was stopped by Observe only
permissions before inference (zero model calls). The loaded model was available:
LM Studio `somarkai-docision-1.0`, with an 8,192-token loaded context.

- Auto now checks recognizable input requests before starting a read-only task,
  preserves the draft, and opens the permissions panel.
- Blocked history entries show **Needs input permission** and offer **Review
  access and retry**. An idle active grant can be revoked from the panel so its
  previously disabled controls can be edited. Access still requires an explicit
  grant, and input still requires per-action approval.
- Read only is now at the top of session permissions; its explanation reflects
  the chosen mode. Instructions use the actual **Grant session access** label.
- Real execution exposed a separate context bug: an 8,755-token request exceeded
  the loaded 8,192-token context. The provider's HTTP 200 stream carried an error
  that was previously ignored and reported as an empty answer.
- The responder now recognizes streamed provider errors, safely classifies
  context errors, and avoids the unsupported-tools retry for a context error.
  Arbitrary provider error bodies are not displayed.
- Auto retains the original instructions and the latest complete tool-call/result
  round, plus a bounded record of earlier outcomes. Native audit events keep the
  full evidence. Redundant geometry, unnamed layout containers, schema headers
  and tool descriptions are removed from inference context.
- Native control IDs are short IDs within the required unique snapshot, reducing
  repeated prompt tokens. Snapshot freshness and window/target checks remain.
- Auto reserves a 1,024-token reply budget. A local model's `action: done` marker
  is presented as a readable typing receipt only when verified editor readback
  exists; ordinary answers and errors are preserved.

## Real local-model execution

Successful task: `b992101c-e1e9-4fda-91a6-383e8741792c`.

The existing Auto runtime selected the already-loaded model explicitly. It
proposed opening Notepad, focusing its observed window, and typing `online`.
Each mutation was reviewed and approved individually within the user's request.
The editor was observed empty and focused before typing. An earlier attempt had
created this new empty tab; existing documents were not overwritten.

The final native result reported:

```json
{"verified":true,"verification_method":"UIA editor text readback","actual_text":"online"}
```

The task completed after **4 model calls**, with **19.11 seconds of inference**.
Provider-reported prompt token counts were **5531, 5637, 6666, 6690**; completion
token counts were **22, 26, 62, 13**. No other model was downloaded or loaded.
No file, browser, internet, or command permission was granted for this test.
Control was revoked after completion. Notepad is left open with the unsaved text.

An intermediate attempt reached a new tab but exhausted the remaining context
(8,119 prompt tokens and 73 output tokens). Its incomplete action was not
executed. Both failed attempts are retained separately as evidence.

## Verification

- 17 context, error-handling, and completion-receipt checks passed.
- 69 computer protocol/security checks passed.
- 16 native permission checks passed.
- 21 usage-accounting regression checks passed against an isolated fixture.
- Focused lint, TypeScript, and native Python compilation passed.
- Captured and visually inspected the actual Notepad window showing `online`.
- Browser automation was disabled in Work settings during this turn, so the new
  permission controls were not retested through live browser interactions.

This confirms the specific loaded-model Notepad workflow, not all desktop tasks,
all models, or completion of the broader Windows-control project.

## Evidence

- [Successful model/task/action evidence](../../output/computer-control/notepad-local-model-success.json)
- [Notepad screenshot](../../output/computer-control/notepad-online-local-model.png)
- [Initial context failure](../../output/computer-control/notepad-local-model-initial-failure.json)
- [Intermediate truncated action](../../output/computer-control/notepad-local-model-second-attempt.json)
