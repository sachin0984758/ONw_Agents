# AgentHub Auto: implementation and verification

**Current live check, 2026-10-31:** the current Auto tool catalog supports
approved workspace file operations but does not expose `run_command`.
Earlier file/command results below are historical and do not establish command
execution in the present runtime. See `docs/audits/AGENTHUB-REMEDIATION-REPORT.md`
for the latest live results and the initial Windows focus failure/retry.
The native/DOM fixture suite now passes 39 checks, and the loaded-model Auto
control-flow suite passes 10 checks. Browser front-end inspection through Codex
was unavailable because local browser control is disabled in Work settings;
Auto's own isolated browser fixture was tested through its application API.

Auto is a new navigation entry at `/?view=auto` in the complete AgentHub application at `C:\Users\SACHIN\OneDrive\Desktop\Test`. It uses a real Windows companion, the existing local model client and the existing permission-gated workspace tools. It is a working baseline with the limitations below; the full desktop acceptance matrix has not passed yet.

## Start and use

```powershell
Set-Location 'C:\Users\SACHIN\OneDrive\Desktop\Test'
npm run computer:setup  # first installation only
npm run dev
```

Open `http://127.0.0.1:3000/?view=auto`. The startup wrapper binds the dashboard to loopback. An older server started directly with `next dev` cannot enable Auto until restarted through this wrapper. The current server was started through the wrapper and its listener was verified as `127.0.0.1:3000`; `/api/agent-session/files?op=info` returned the complete project root above.

The saved default file-tool workspace is now `C:\Users\SACHIN\AgentHub-Sandbox`. Its registered ID is stored in `db/computer-preferences.json`; future selections persist across clients/reloads. Saving a new default never changes the folder of a running task. The UI applies the pending folder after that control session ends. The sandbox passed 8 real create/read/edit/command/containment checks and 9 isolated preference/API checks. This is a working-folder boundary for file tools, not OS confinement for host apps or shell commands.

The requested strict-isolation setup is prepared separately in `agenthub-vm/README.md`, with a single-folder VM plan. It is not installed or running, and no broader host-app access was enabled. The app inventory is saved in `output/computer-use/installed-apps.md`. Desktop entries, Store packages and Start-menu launchers overlap and must not be summed as a unique total.

1. Select **Connect computer**. This starts the local Python companion; it does not enable input.
2. Select permitted applications, the file-tool workspace and exact browser hostnames.
3. Keep **Read only** checked for inspection. Clear it to allow input proposals. If control is already enabled, use Stop before changing permissions.
4. Check the session-access consent box and select **Start control**.
5. Leave the model selector on **Automatic** to follow the available local chat model. The list refreshes automatically and when the window regains focus. If none is loaded, Auto chooses an installed chat model and loads it on **Run Auto** using LM Studio's native load API (older versions use just-in-time inference loading). You can still select a specific installed model manually. No model is downloaded, unloaded, or loaded merely by opening the page. Vision grounding automatically reuses an available loaded vision model; text models continue through UI Automation and browser DOM.
6. Enter a small task and select **Run Auto**. Every input, launch, navigation, file mutation and command requires an **Allow once** decision. Declining prevents dispatch.
7. Review actual tool output and verification. Pause suspends further actions; Resume continues. Stop and Emergency Stop disable input and cancel the task. `Ctrl+Alt+Shift+Esc` is registered outside the browser. PyAutoGUI's screen-corner failsafe is also enabled.

For a first write test, ask for a **new empty Notepad tab** and a short test sentence. Existing restored Notepad documents are user data: inspect first and do not overwrite them. Read-only mode cannot open Notepad or type, even if the prompt asks it to.

The reported "no function to launch Notepad" reply was traced to an Observe-only task. The launcher exists, but input tools are withheld in that mode. Direct input requests now stop before inference with **Needs input permission**, an accurate explanation and a **Review input permissions** button. That button opens the settings without clearing Read only or granting access. The native permission checks remain in place.

On 2026-10-26, the already-loaded LM Studio model `minicpm-v-4.7-35b-a3b` was tested through the real Auto runtime. All 10 loaded-model/control-flow checks passed. Auto's model selector and Ready/Using status show the model's name; the loaded-model inventory refreshes periodically. While a model request is pending, the interface displays elapsed waiting time instead of leaving inference at zero. No second model was loaded for this verification.

## Existing architecture and reuse

### Auto workspace update — 2026-10-28

Auto now uses a UI-TARS-inspired two-pane workspace: task conversation, expandable
action timeline and composer on the left; permitted-window screenshots on the
right. Settings and session history open on demand. Small screens have Task and
Computer tabs. Approvals, workspace restrictions, read-only mode, pause/resume,
emergency stop and the individual-tool inspector remain available.

Automatic model selection is the default and ignores the old browser-persisted
model pin. Both the interface and runtime use the same loaded-first selection
policy across available LM Studio/Ollama chat models. Explicit selections fail
clearly if the model disappears; they are never silently replaced. Loading only
happens when a task is run. Native LM Studio loading is attempted for an installed
unloaded model; a 404/405 falls back to just-in-time loading on older servers. No
download, cloud fallback, or arbitrary command was added. Text-only models can
use UIA/DOM, but screenshot grounding requires a loaded compatible vision model.

The right pane mirrors the selected permitted Windows app with local window
captures refreshed about every 1.5 seconds while the AgentHub page is visible.
Clicking the preview forwards input to that app under the existing session
permission and per-action approval rules. After you approve an action, Auto
restores and re-docks the same verified app window on the right before it
refreshes the UI target and dispatches input. Windows `PrintWindow` captures the
selected window without including overlapping apps; if a particular app cannot
be rendered in the background, the preview asks the user to bring it forward.
This is a screenshot-based mirror, not a native HWND embedded in the browser or
a low-latency remote desktop stream. The app itself continues running on Windows.

The final cold-recompile check also exposed Tailwind scanning the entire local
repository, including downloaded projects and environments. `globals.css` now
sets the source scan to `src/`, which contains the application UI. This removed
the stalled full-repository scan without changing the other screens' components.

Validation: `scripts/check-auto-models.ts` exercises automatic/manual selection,
unavailable models, embeddings, vision fallback, native loading, old-server
fallback, cancellation and loopback restrictions. Browser checks and screenshots
are saved under `.verification/auto-upgrade/`. A real read-only Auto run with
Automatic selected loaded `spark-x2.6-4b` and returned `AUTO_MODEL_OK`; no desktop
input was sent. Other models' task quality has not been inferred from this test.

References: [UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop) and
[LM Studio's native load API](https://lmstudio.ai/docs/developer/rest/load).

The project is a browser-hosted Next.js application, not an Electron desktop application. React uses a Node route handler which controls a local Python process. The companion uses Windows UI Automation through pywinauto, native pointer/keyboard APIs through PyAutoGUI/Windows input, and an isolated headed Playwright Chromium context. Browser DOM and UIA observations are preferred over screenshots.

```text
Auto React view -> same-origin Next API -> authenticated loopback IPC
                                        -> Windows UIA / real input / Playwright
                 -> existing local LM Studio/Ollama model client
                 -> existing selected-workspace file/command tools and approvals
```

No cloud inference fallback was added. Both text inference and optional image grounding reject non-loopback model endpoints. The native service uses an ephemeral loopback port and a random per-process bearer secret which is never returned to the browser. Cross-origin and unauthenticated native requests are refused. The dashboard also refuses computer control when it was not launched through its loopback-only wrapper.

The native service exposes validated actions, not a shell endpoint. Existing file and command execution remains confined to the selected registered workspace and its existing approval rules. UI content is data rather than instructions. Secret fields are omitted from inspection and masked in capture. Locked/UAC desktops, stale targets, terminal/credential controls and unapproved applications are refused. Browser POST submissions and downloads require manual work; they are not automated through this bridge.

## What changed

| Area | Files added or updated for this work |
| --- | --- |
| Native controller | `agenthub-computer/controller.py`, `agenthub-computer/requirements.txt` |
| Typed native/browser protocol | `src/lib/agent-hub/computer/protocol.ts` |
| Accurate Observe-only guidance and early permission check | `src/lib/agent-hub/computer/access.ts` |
| Companion launch, authentication and lifecycle | `src/lib/agent-hub/computer/bridge.ts` |
| Model/action loop, approvals, recovery and summaries | `src/lib/agent-hub/computer/runtime.ts` |
| Local API | `src/app/api/computer/route.ts` |
| Auto interface | `src/components/agent-hub/auto-computer-view.tsx` |
| Navigation integration | `src/components/agent-hub/shell.tsx`, `src/lib/agent-hub/types.ts`, `src/lib/agent-hub/view-url.ts` |
| Real session hover list | `src/components/agent-hub/sidebar-hover-menu.tsx` |
| Correct hover selection despite stale URL IDs | `src/lib/agent-hub/session/navigation.ts`, `src/components/agent-hub/session-chat-view.tsx` |
| Verified working-folder facts | `src/lib/agent-hub/session/tools.ts`, `src/lib/agent-hub/session/runner.ts`, `src/app/api/agent-session/conversations/route.ts` |
| Reused model/workspace support | `src/lib/agent-hub/session/model.ts`, `src/lib/agent-hub/session/workspaces.ts` |
| Setup and local startup | `scripts/setup-computer.mjs`, `scripts/start-local.mjs`, `package.json`, `.gitignore` |
| Repeatable tests and safe fixture | `scripts/check-computer-contract.ts`, `scripts/check-computer-live.mjs`, `scripts/check-computer-model.mjs`, `scripts/check-session-controls.ts`, `public/auto-test.html` |
| Reported Notepad regression and actual launch test | `scripts/check-computer-permissions.mjs` |
| Complete LM Studio file/command workflow | `scripts/check-computer-workflow.mjs` |
| Transport cancellation safety | `scripts/check-computer-transport.ts` |
| Report | `docs/auto-computer-use.md` |

Other existing uncommitted chat, teaching, roadmap, Playground, mascot and styling changes were preserved. This list describes this work, not every modified file in the checkout. No commit or push was made.

## Capability and verification matrix

| Capability | Current status | Evidence or limit |
| --- | --- | --- |
| Real window/process/monitor discovery | Verified | Native acceptance queried actual Windows handles and one 1920x1080 monitor. Unapproved window titles were redacted. |
| UIA controls, names, IDs, bounds, enabled/focus/pattern metadata | Verified in Notepad | Controls, editor value, text geometry and selected text were observed. |
| Launch/focus Notepad | Verified | Actual application/window and foreground observed. Windows can refuse background focus; manual activation was needed during one rerun. |
| Unicode and multiline keyboard input | Verified | Real keyboard input read back from a fresh empty tab. Normal key timing fixed corrupt/repeated characters from overly fast dispatch. |
| Selection and replacement | Verified | Ctrl+A, replacement and a large Unicode value were verified against the actual editor. Large text uses the native Value pattern; keyboard fallback is capped at 400 characters per action. |
| Mouse move, left/right/double click, scroll and drag | Partially verified | Actual UIA click and pointer drag selection passed. Right/double click and arbitrary drag-and-drop workflows remain unverified. |
| Stale elements and moved windows | Partially verified | Stale-reference rejection and inspection recovery passed. Arbitrary window movement and alternate DPI need more runtime coverage. |
| Isolated browser navigation, DOM, role/name locators | Verified | Actual local fixture opened in Chromium, filled, read, clicked, selected and navigated. |
| Browser tabs | Implemented; switching not tested | Open/list/switch tools use only the owned browser context. User profiles are not attached. |
| Browser scroll | Dispatch and new observation verified | Not presented as a verified semantic outcome merely because dispatch succeeded. |
| Screenshots | Verified native capture | Actual Notepad PNG and scaling metadata checked; artifact `output/computer-use/notepad-verified.png`. Background `PrintWindow` mirroring is implemented; supported rendering varies by application. |
| Local text model decision loop | Verified with LM Studio GPT-OSS-20B | Real observation answer, tool proposal, approval decline, Pause/Resume and cancellation. |
| Existing loaded local model selection | Implemented | Runtime resolves the real provider and rejects unloaded/nonlocal targets. Models are not silently loaded. |
| Vision grounding | Implemented; inference unverified | Explicit loaded-VLM check and bounded JSON coordinate proposals. No vision inference benchmark or accuracy claim. Text-only models never receive screenshots. |
| File edits and commands | Verified in isolated project fixtures | Real model created a script, ran it and reported verified output/exit code. Independent filesystem reads and project-isolation tests passed. The full composite Notepad-save/VS Code task remains unverified. |
| Pause/Resume/Stop | Verified through the real native controller/model runtime | Approval decline caused no dispatch; Stop cancelled active model work and disabled input. |
| External emergency hotkey | Registered at startup; physical shortcut unverified | Startup fails if registration is unavailable. A real outside-app keypress was not tested. |
| Read-only and application/domain restrictions | Verified | Actual denied actions, missing/cross-origin requests and unapproved browser host tested. |
| Context compaction and bounded logs | Implemented | 40-step task limit, bounded events/history and compact model context; no endless screenshot transcript. |
| Saved summaries | Implemented, opt-in | Compact summaries saved to `db/computer-task-summaries.json` only when requested. A persisted-history viewer is not implemented. Live task details are memory-only. |
| Multiple displays and alternate DPI | Incomplete verification | Only the available single display/current scaling was observed. These conditions were not simulated or changed. |
| Protected desktops/password managers/installers/payments | Unsupported/manual | No elevation, credential automation, purchase flow or security-boundary bypass. |

## Executed checks

| Suite | Result |
| --- | --- |
| `npm run check:computer` | 55 protocol/security/permission checks passed, including refusing the older broadly bound startup. |
| `npm run check:computer-permissions -- --launch-notepad` | 9 real checks passed on 2026-10-26: the exact request reports permission required with zero model calls; an approved control-mode launch opened Notepad and a separate query confirmed its window. No text was typed or saved. Control ended off. Evidence: `output/computer-use/permissions-acceptance.json`. |
| `npm run check:session-controls` | 39 passed: actual folder binding, traversal/junction containment, concurrent project isolation, deletions/undo and stale-session URL replacement. |
| `npm run check:computer-live -- --enable-test-scope` | 39 real native/DOM checks passed on 2026-10-26, including short/large Unicode input, selection/replacement, pointer drag selection, screenshot capture, browser operations and native Stop. Evidence: `output/computer-use/acceptance.json`. |
| `npm run check:computer-workflow` | 9 passed with the loaded MiniCPM model: create exact script in a registered disposable workspace, approve only its exact contents/command, execute it, independently verify file/output and finish with native input off. Evidence: `output/computer-use/workflow-acceptance.json`. |
| `npm run check:computer-transport` | Passed: an aborted native request sends the independent Stop signal instead of just abandoning HTTP. |
| `npm run check:computer-model` | 9 real local-model/control-flow checks passed; saved in `output/computer-use/model-acceptance.json`. |
| Loaded MiniCPM model verification, 2026-10-26 | 10 passed with `minicpm-v-4.7-35b-a3b`; evidence in `output/computer-use/model-acceptance-minicpm-v-4_7-35b-a3b.json`. Actual desktop answer, native launch proposal, approval decline with no dispatch, Pause/Resume and Stop verified. |
| TypeScript | `npx tsc --noEmit` passed. |
| Targeted ESLint, Python compile and whitespace validation | Passed. Git emitted existing LF-to-CRLF warnings; no whitespace errors. |
| Current live startup | Verified loopback listener, complete project root, visible Auto page and permissions controls. |
| Current Sessions hover navigation | Visually verified: selected New folder conversation ID and displayed folder agree. |

The native typing test deliberately refuses nonempty editors. Another application taking focus aborts typing rather than sending input to the wrong app. Do not report this interrupted suite as passing. Do not run acceptance scripts while a user Auto task is active; the live script temporarily sets test permissions and Stop states.

The final full native suite passed after the user focused Notepad and left input idle. Earlier interrupted/failing attempts were used to fix typing timing and test targeting, not counted as passes. The script preserves existing user tabs and leaves disposable test tabs open.

## Measured performance

These are individual recorded fixture observations, not general throughput guarantees. Timings include the HTTP round trip unless marked otherwise. Expected rejection cases are not counted as successful task completions.

| Observation | Actual measured time |
| --- | ---: |
| Window/monitor discovery | 40.13 ms total; 6.59 ms native |
| Cold isolated Chromium open | 2,617.08 ms total |
| DOM fill and value verification | 139.94 ms total |
| DOM button click and state verification | 176.74 ms total |
| DOM navigation and URL verification | 110.85 ms total |
| Stop request | 26.64 ms for the final recorded Stop |
| Local GPT-OSS read-only answer | 10,646.92 ms model time; one actual HTTP model call |
| Cancellation of the active model fixture | 100.35 ms observed cancellation interval |
| Loaded MiniCPM desktop answer (2026-10-26) | 44,308.50 ms model time; one actual model call |
| Loaded MiniCPM launch-tool proposal (2026-10-26) | 62,247.25 ms model time; one actual model call; proposal deliberately declined |
| Complete MiniCPM create-and-run workflow (2026-10-26) | 120,145.86 ms model time across 3 actual model calls; script output `AUTO_WORKSPACE_OK`, exit code 0 |
| Final native keyboard typing sample (2026-10-26) | 3,080.38 ms total |
| Large Unicode Value-pattern sample (2026-10-26) | 421.32 ms total |
| Final native screenshot capture (2026-10-26) | 243.70 ms total |

No vision latency, native typing throughput, screenshot latency, multi-monitor rate or broad task-success percentage is asserted. A structured-versus-visual benchmark comparison is incomplete until a compatible local vision model and the remaining desktop cases are exercised. Local inference, rather than DOM dispatch, was the largest measured delay on the simple model fixture.

## Session folder and hover fixes

The selected screenshots folder was checked independently on disk. Both the recorded tool result and an independent recursive file walk counted **32,792 files** at that time. This establishes that result for that folder at that time, not a permanent count after files change.

Sessions hover previously displayed seeded dashboard records. It now loads actual coding conversations from their API, using the same rounded hover-card interaction as Chat. Selection updates both the actual session ID and browser URL. The folder in the opened New folder session was visually checked against the selected conversation.

## Repeat tests

```powershell
npm run check:computer
npm run check:computer-permissions -- --launch-notepad
npm run check:session-controls
npx tsc --noEmit

# Only when no user Auto task is running:
$env:AGENTHUB_TEST_URL = 'http://127.0.0.1:3000'
npm run check:computer-live -- --enable-test-scope --dom-only

# Requires an idle keyboard/mouse and fresh disposable Notepad tab:
npm run check:computer-live -- --enable-test-scope

# Uses a chat model already loaded in LM Studio:
npm run check:computer-model
npm run check:computer-workflow
npm run check:computer-transport
```

The model test now discovers the already-loaded LM Studio chat model. Set `AGENTHUB_TEST_MODEL` to a particular loaded model ID when needed; it does not load models or silently switch to a downloaded model. The full end-to-end example involving Notepad saving, VS Code and a project test command remains a follow-up acceptance task, not a claimed verified result.

Implementation references: [pywinauto UIA controls](https://github.com/pywinauto/pywinauto/blob/master/pywinauto/controls/uiawrapper.py), [Playwright locators](https://playwright.dev/python/docs/api/class-locator), [isolated browser contexts](https://playwright.dev/python/docs/api/class-browsercontext).
