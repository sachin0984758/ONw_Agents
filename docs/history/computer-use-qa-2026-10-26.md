> Historical evidence. This file describes an earlier implementation; use [current architecture](../architecture.md), [development](../development.md) and [testing](../testing.md) for the current project.

# Computer-use verification on this PC — 2026-10-26

Auto works on the actual Windows computer with the existing LM Studio MiniCPM model for the workflows tested below. This is a scoped acceptance result, not a claim that every installed application or arbitrary task is supported.

| Work category | Actual outcome | Evidence |
| --- | --- | --- |
| Notepad desktop work | Open/focus, fresh tab, real Unicode/multiline typing, Ctrl+A, replacement, large text value, read-back and screenshot passed. | `output/computer-use/acceptance.json`, `output/computer-use/notepad-verified.png` |
| Mouse interaction | Actual pointer drag selected fixture text; selection was read independently through UI Automation. UIA button invocation passed. | Full 39-check native/DOM suite |
| Browser tasks | Open isolated Chromium, fill/read form, click, dropdown, scroll observation, navigate, missing locator and host restrictions passed. | Full 39-check native/DOM suite |
| Local model control | MiniCPM answered from the real desktop observation, generated a launch-tool proposal, respected decline, paused/resumed and stopped. | `output/computer-use/model-acceptance-minicpm-v-4_7-35b-a3b.json`: 10 checks |
| Coding/file/terminal work | The actual model wrote the exact requested JavaScript file in a registered test directory and ran `node auto-smoke.cjs`. Independent reads confirmed its contents. Actual stdout was `AUTO_WORKSPACE_OK`, exit code 0. | `output/computer-use/workflow-acceptance.json`: 9 checks |
| Working-folder isolation | File reading/writing, actual command cwd, junction/traversal rejection, concurrent project isolation, session deletion and undo passed. | `npm run check:session-controls`: 39 checks |
| Permission and stop behavior | Input remains opt-in; unavailable/cross-origin/unknown actions are refused. Transport cancellation sends native Stop. | `npm run check:computer`: 55 checks; `npm run check:computer-transport`: passed |

## Problems found and fixed

| Before | After |
| --- | --- |
| Very rapid keyboard dispatch produced missing or repeated characters in actual Notepad. | Keyboard fallback uses the library's normal interval, rechecks focus and reads the actual result. Larger empty/replacement values use native UIA Value input when available. |
| The drag test guessed a title-bar point and hit a window control. | It uses observed text geometry and verifies actual selected text; it no longer claims to have moved a window. |
| The model proposed an absolute path for a tool that accepts workspace-relative paths. | The Auto system instructions state the path rule, and invalid file paths are rejected before approval. The rerun created and executed the correct file. |
| Cancelling HTTP could leave the native operation alive until another Stop. | A transport failure/abort explicitly sends the independent native Stop request. |
| Windows refused focus during an interrupted rerun. | The test reported the failure and required manual activation; no focus-lock or secure-desktop bypass was introduced. The final complete suite passed after activation. |

## What remains limited

- The configured native application list is Notepad, File Explorer and VS Code, plus the separate controlled browser. It is not an unrestricted allowlist for all installed programs.
- Word/Excel desktop workflows, arbitrary games, arbitrary drag-and-drop, right/double-click outcomes, different DPI settings and multi-monitor behavior were not fully verified.
- The selected MiniCPM model supports vision according to LM Studio's inventory, but the visual-grounding inference path has not been benchmarked or accepted end to end. Structured UIA/DOM paths are verified.
- Native keyboard fallback is limited to 400 characters per action. Longer insertion needs a compatible Value pattern, an empty editor/explicit replacement, or workspace file tools.
- Windows may require the user to focus the target application. User input during physical typing can invalidate the test; the controller stops when the target loses focus.
- Purchases, credentials, security prompts, installers, browser submissions and protected desktops require manual handling. File changes and commands keep their approval gates.

The create-and-run fixture used 3 MiniCPM model calls and about 120.15 seconds of model time. This was local inference with no cloud fallback. Native input was off when verification ended. Existing user documents were not overwritten; only disposable fixtures and fresh test tabs were changed.

See [the implementation walkthrough](auto-computer-use.md) for setup, commands, architecture and the full capability matrix.
