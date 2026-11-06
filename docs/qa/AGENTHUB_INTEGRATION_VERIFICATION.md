# AgentHub Integration Verification

## Verified connections

| Capability | Frontend → backend | Status and permissions | Persistence / evidence |
| --- | --- | --- | --- |
| Overview telemetry | Overview → system metrics/runtime/usage APIs | Live host telemetry, LM Studio status, and request counters rendered. Hardware/API provider details beyond the displayed UI were not independently verified. | Existing request usage is persisted. The QA model request reports token usage. |
| Local model discovery | Models/Sessions → `/api/agent-session/models`, runtime model APIs, LM Studio on localhost | PASS: LM Studio connected, seven models detected, `flint` loaded. Ollama offline; no API model configured. | Read-only discovery. No model/provider setting changed. |
| Local Chat inference | Sessions composer → `/api/chat` → LM Studio | PASS: isolated temporary Session prompt returned `SHORTCUT_OK`; reported `Using LM Studio · flint`, 43 seconds. | Temporary test session deleted using app's recoverable deletion flow. |
| Stateless local inference | POST `/api/chat` with `stateless: true` → LM Studio `flint` | PASS: response `AgentHub local QA passed.` | Response showed `stateless: true`, `persisted: false`. Provider usage was recorded by the application's usage meter. |
| Image/model routing | `/api/chat` → model routing + local provider metadata | PASS in automated mocked-provider test: text-only refusal is a 400 with a vision suggestion; vision model receives image content. This is not a live vision-model inference. | Test uses isolated database and mocked provider; no external provider call. |
| Session conversation state | Sessions UI → `/api/agent-session/conversations` and session persistence | Existing session loaded and new test session was created. | QA session was removed; app showed an Undo notice. Existing user session was not modified. |
| Workspace selection/permission | Folder panel → `/api/agent-session/workspaces`, file/exec endpoints | Current selected folder had No access. Review access did not grant anything. Read and terminal actions stayed disabled. | No folder, read, write, or command permission was granted. |
| Text attachment | Sessions action menu → browser file chooser → composer draft | PASS for a temporary UTF-8 `.txt` fixture (bounded to 128 KB). Contents appeared in the draft; no model send occurred. | Fixture was temporary. The draft was cleared after inspection. |
| Agent API state read | Agent API page → `GET /api/agent` | PASS: page showed `200 OK` and a state payload. The data included seeded/example project content. | Read-only; reset and state-write actions were not used. |
| Playground AI practice | Playground → local model analysis routes | Screen says AI analysis only and explicitly says code is not executed. Buttons rendered, but inference buttons were not run in this audit. | NOT TESTED end-to-end in browser. |
| UI Components catalog | UI Components → `/api/ui-components` and local source store | Three built-in component previews loaded. Installation requires source review; no install was attempted. | Local catalog showed three saved components; no project write occurred. |

## Unavailable or unverified integrations

- Sessions web search and URL browsing are labeled unavailable; no external web-search connector is configured.
- Browser automation from Sessions is labeled unavailable.
- Microsoft, Google, GitHub, and productivity connectors are not installed; no fictitious Connect action is offered.
- Ollama is offline. No remote API model is configured in Models.
- Settings says network-egress/domain preferences are recorded but not enforced. There is no OS-level command sandbox, and command execution still requires approval. This audit did not grant access or execute commands.
- Skills Library opened, but its completed loading state, marketplace fetches, and install path were not verified.
- Design Studio and remaining API mutations were not tested.
