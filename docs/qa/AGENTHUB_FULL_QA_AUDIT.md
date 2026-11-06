# AgentHub Full QA Audit

**Date:** 2026-10-28  
**Repository:** `C:\Users\SACHIN\OneDrive\Desktop\Test`  
**Package version:** 0.2.1  
**Framework:** Next.js 16.4.3  
**HEAD at audit start:** `b6451dc`  
**Runtime checked:** `http://127.0.0.1:3000` (served from this repository)  
**Decision:** Partial readiness; see the final report.

## Baseline and scope

The working tree was already heavily modified at audit start, with existing additions, edits, and deletions across application code, tests, local example projects, data, and documentation. It was not reset or cleaned. The audit preserved this state and did not commit or push changes. The app was inspected in the live browser beginning at Overview. Automated checks and an isolated LM Studio inference were run.

This was a broad screen and capability audit, not a control-by-control acceptance run of every control in the application. Screen content was reviewed through browser accessibility snapshots; the Sessions action menu and several key flows were interacted with. Responsive device-size sweeps, full keyboard-only navigation, and all destructive actions were not performed.

## Screen inventory

| Screen | QA status | Observations |
| --- | --- | --- |
| Overview | PASS, visual/AX inspection | Live host telemetry and model usage rendered; it showed the local provider and real request counts. Refresh was not individually exercised. |
| Chat | PARTIAL | Composer, attachment affordance, model and thinking controls were inspected. Ctrl+Enter starts a new chat; this was pressed and cleared a draft. It created a blank chat entry during verification. A local model response was separately verified through Sessions and the stateless API. |
| Agents | PARTIAL | Network explorer, filters, graph controls, and agent list rendered. Not every filter/control was exercised. The current state includes demo-style project data. |
| Sessions | PARTIAL, key flows PASS | Plus menu, category list, search, local text-file attachment-to-draft, agent selection, Tasks navigation, Skills Library opening, access review, and permission-disabled actions were inspected. Workspace stayed at No access. |
| Auto | PARTIAL | Planning-only state, access controls, local model state, and disabled planning action were inspected. No computer action or permission grant was attempted. |
| Plan / Tasks | PASS, navigation/empty state | Empty state accurately says there is no active plan and links back to Sessions. |
| Changes | PASS, copy verified | The view clearly identifies itself as sample data and says it is not connected to Git; Commit is disabled. |
| Playground | PARTIAL | Local AI practice screen rendered and explicitly says code is not executed. Its analysis actions were not individually run. |
| UI Components | PARTIAL | Local catalog and three built-in previews rendered; empty/loading transitions and source-first review copy were inspected. Installation was not attempted. |
| Models | PARTIAL | LM Studio was connected with seven local models; Ollama was offline; there were no configured API models. No provider setting was changed. |
| Settings | PARTIAL | Theme controls, capabilities and network-egress copy were inspected. The UI explicitly says network-egress/domain preferences are recorded but not enforced. No security setting was changed. |
| Agent API | PARTIAL | GET state returned 200 and a 21.2 KB state payload. Destructive Reset and state-writing controls were not used. |
| Design Studio (`/design-studio`) | NOT TESTED | Discovered as a separate app route, outside the primary navigation screens reviewed. |
| Skills Library | PARTIAL | Opened from Sessions through the existing library panel. The initial state showed Loading; completion and install flows were not verified. |

## Major routes and backend surface discovered

The primary application is `src/app/page.tsx`; the additional page is `src/app/design-studio/page.tsx`. The API inventory includes `/api/agent`, `/api/chat`, `/api/chat/conversations`, `/api/agent-session/conversations`, `/api/agent-session/workspaces`, `/api/agent-session/files`, `/api/agent-session/exec`, `/api/agent-session/models`, `/api/runtime/models`, `/api/model-preference`, `/api/custom-models`, `/api/skills`, `/api/ui-components`, `/api/playground`, `/api/computer`, `/api/system-metrics`, `/api/usage`, `/api/explain`, and `/api/n8n` plus its template route.

## Controls and workflows exercised

- Opened each primary navigation screen and inspected its rendered state.
- Sessions `+` menu: inspected category tabs, search, action availability, access footer, and disabled access-gated operations.
- Sessions actions: drafted an agent prefix, navigated to the real Tasks view, opened the existing Skills Library, reviewed workspace access, and attached a temporary UTF-8 text fixture to the draft. The attachment was not sent.
- Verified selecting/reviewing a folder does not silently grant access; the permission remained No access and file/command actions remained disabled.
- Chat Ctrl+Enter: started a new blank conversation and cleared a draft without sending it. The test produced a blank chat entry; no user text was transmitted.
- Sessions Ctrl+Enter: sent a temporary prompt through the local LM Studio model and verified the exact response; the test session was deleted through the app's recoverable delete flow.
- Local stateless `/api/chat` request to LM Studio model `flint` returned `AgentHub local QA passed.` with `persisted: false`.
- Exercised the local text-only image refusal and multimodal route through the automated test suite.

## Automated results

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, 0 errors and 3 warnings in bundled local example-project files |
| `npm test` | FAIL, 27/28 suites; 1,617 assertions passed and 14 checks skipped. The remaining failing suite is `check-ui-interactions.mjs`, which flags native selects in the UI Components view, profile, and component marketplace. |
| `npm run audit:repository` | PASS; 500 source files classified, no cycles, unresolved local imports, client/server leaks, or server-route imports detected; 39/42 pre-existing review items resolved. Two exact duplicate CSS/config pairs are in generated local example projects. |
| `NEXT_DIST_DIR=.next-qa npm run build` | PASS; production build completed and generated all listed application/API routes. |
| Focused ESLint on Sessions/profile/select files | PASS |

The test harness writes detailed logs and counts to `.verification/modernization/tests/`. These automated checks do not establish that every interactive control works in the browser.

## Known errors, limitations, and untested areas

- An older saved Sessions turn still displays “The operation was aborted due to timeout.” It is historical content; this audit did not reproduce a new timeout or retry it.
- The browser console retained an earlier React warning about a `contentTheme` prop. After a full page reload and fresh navigation, no new instance was observed; the retained entry was timestamped before that reload.
- Web search, URL browsing, browser automation from Sessions, and third-party app connectors are unavailable in this configuration. The action menu labels them unavailable instead of offering a fake connection flow.
- Local models are real and reachable through LM Studio; Ollama is offline. Remote API models were not configured.
- Workspace permissions were No access; read, write, and terminal flows were therefore correctly gated and were not enabled for testing.
- Settings states that network-egress preferences are recorded but not enforced. Commands are not OS-sandboxed; this is an explicit product limitation.
- Changes and Agent API show seeded/example project state. Changes explicitly says it is illustrative and disconnected from Git.
- Responsive viewport sizes 1920×1080 through 390×844, screen-reader behavior, WCAG contrast, reduced motion, and every button/dropdown/dialog were not exhaustively tested.
- Live browser screenshots were captured and visually reviewed inline during this audit. The available browser capture interface did not provide a filesystem export path, so no screenshot binaries could be saved here without fabricating or introducing another capture mechanism. See `docs/qa/screenshots/README.md`.
- Chat shortcut verification leaves one blank “New chat” entry in the Chat conversation list. The Ctrl+Enter test did not send the draft. The temporary Sessions shortcut test was deleted and showed the app's Undo notice.

## Severity assessment

- **P0:** No P0 issue discovered in this bounded audit. This is not a full security certification.
- **P1:** None reproduced in the tested core local-chat and workspace-gating flows.
- **P2:** One automated suite fails due to native-select consistency checks; several large pages and controls remain only partially tested; settings disclose a recorded-but-unenforced network preference.
- **P3:** Three lint warnings in bundled local examples; screenshots are not persisted; an old timeout remains visible in session history.
