> Historical evidence. This file describes an earlier implementation; use [current architecture](../architecture.md), [development](../development.md) and [testing](../testing.md) for the current project.

# AgentHub — Full Application QA Audit

Every-button test · bug fixing · final verification.

- **Date:** 2026-10-17
- **Branch:** `qa/full-app-audit` · **Baseline commit:** `d72d67a` (clean tree at start)
- **App under test:** AgentHub (Next.js local-first AI agent app) at `http://localhost:3101` (isolated instance)
- **Result:** All executed suites green; 9 defect groups found and fixed with live reproduction + regression coverage; remaining gaps listed honestly in §17.

---

## 1. Executive summary

A complete end-to-end audit of AgentHub was executed: every page, interactive control, API route, and the main agent runtime workflows were exercised against a **running, isolated copy** of the application — not just inspected in source.

Findings in one paragraph: the application is functional and its core workflows (chat, sessions/runtime, models, files/exec APIs, persistence, security guards) worked under test. The audit found and fixed **nine real defect groups**, four of them security/data-integrity classes: a provider-error body leak (raw provider HTML surfaced to clients), a file-guard blocklist bypass on Windows path separators (writes into `node_modules/`, nested `.env` reads), a persistence lost-update race, and a misleading model-call timeout that failed sessions with `Tool timed out after 10000ms` for merely-slow providers. Each fix was reproduced before, verified after, and pinned by a live regression check.

All automated suites now pass, the production build completes, and `tsc --noEmit` + ESLint are clean. What could not be verified (slow local model throughput, absent Ollama, viewport matrix, screen-reader pass) is explicitly listed as **NOT VERIFIED** in §12, §13 and §17 — nothing is claimed that was not executed.

## 2. Baseline and environment

| Item | Detail |
|---|---|
| Baseline | repo at `d72d67a`, working tree clean, no remote (local-only) |
| Branch | `qa/full-app-audit` created for the audit; nothing reset/deleted destructively |
| Live instance | `:3000` dev server + real `db/` data — treated as **read-only**, never mutated |
| Isolated instance | `:3101` with `NEXT_DIST_DIR=.next-iso` and `AGENT_HUB_DB_DIR=<temp>\audit-db` — all state-mutating tests ran here |
| Fixtures | probe custom models created then deleted; probe files removed; a nested `.env` fixture created on disk and removed after the read-block probes |
| Secrets | never printed; probe checks assert booleans only (key presence redacted) |
| Tooling | Windows 10, Node 24, PowerShell; browser battery via the desktop browser pane's DOM/behavior tools |

Previously committed hardening (before this audit, verified still present): chat-history lost-update race fix, status endpoint verifying custom endpoints, capability enforcement at runtime, Changes labeled as sample data, isolated test environment support.

## 3. Application and feature inventory

Single-page AgentHub shell with client-side views plus one separate route:

| View / route | Purpose |
|---|---|
| Overview | metric cards, token meter, provider status |
| Chat | provider chat with persisted history + stateless mode |
| Sessions | workspace, coding sessions, tracked sessions, runtime controls, agent chat |
| Agents | agent builder (7 built-in agents, enable/disable) |
| Models | LM Studio/Ollama inventory + custom API models (add/link/delete/test) |
| Workflows | n8n gallery, templates, connection state |
| Code Graph | repository visualization (stars/nodes/edges, node inspector) |
| Changes | sample-data banner, commit affordance, export |
| Settings | runtime/network/execution settings |
| Design Studio | separate route (`/design-studio`) |
| API surface | `/api`, `/api/agent`, `/api/agent-session/{files,exec,models}`, `/api/chat`, `/api/custom-models`, `/api/explain`, `/api/n8n`, `/api/n8n-templates/[id]`, `/api/system-metrics` |

## 4. Interactive control inventory

**305 interactive controls across 13 areas** were inventoried (buttons, toggles, inputs, selects, cards, links, sliders), then exercised in the running app. Every control that rendered as interactive but was inert, or reported success without a real effect, was either wired to its intended behavior or honestly disabled with `title="Not available in this build"` — none were left silently dead:

- Search + keyboard shortcuts — implemented (were inert).
- Settings fields — persist and round-trip.
- Changes: sample banner, Export, Commit — correct honest behavior (commit disabled in sample mode with explanatory toast; nothing fake).
- Models "Add/link API model" — functional; dialog reflects both stores (see D4).
- Workflows run buttons — relabeled to match what they actually do.
- n8n gallery anchors — fixed to render real interactive anchors.
- Code Graph "Impact" query — disabled with tooltip (no implementation existed; honest disable beats fake behavior).

## 5. Test methodology and evidence classes

- **Live browser testing was mandatory**: every tested control was actually clicked in the running app; result verified as (a) visible response, (b) correct state/API effect (network/state inspected), (c) persistence after reload where applicable, (d) loading/disabled/success/error states observed, (e) console errors watched, (f) double-activation attempted for idempotency.
- **HTTP probes** (curl against `:3101`) for API/security behavior, with status + body assertions; scripts kept in temp (`qa-security-probes.ps1`, `qa-security-reprobe.ps1`).
- **Automated suites** (in-process runtime/mocked-provider + live HTTP) for regression coverage (§14).
- **Honesty rule**: any check that could not be executed is marked NOT VERIFIED here rather than inferred. UI-test quirks of the harness (e.g., synthetic Enter does not activate native buttons) are noted where they limited verification.

## 6. Browser interaction results — per view

| View | Exercised | Result |
|---|---|---|
| Overview | metric cards, token meter, provider list | OK after D1 fix (live provider/model numbers server-fetched) |
| Chat | composer, Send, details toggle, settings persistence (`agenthub-chat-settings`), empty state | OK; API-level behavior covered by suites |
| Sessions | full battery — see §7 | OK (after D5) |
| Agents | agent cards/switches (7 agents), enable/disable persistence, AUTO/MANUAL | OK; state persists across reload |
| Models | inventory list, loaded-model chip, custom add/link/delete, toasts, key redaction | OK after D4; keys never rendered |
| Workflows | n8n gallery, template cards/anchors, connection banner | OK after anchor fix |
| Code Graph | star render, node select, inspector, Impact control | OK after D2 (0 console errors, no negative radii) |
| Changes | banner, Export (downloads JSON), Commit (disabled in sample mode + honest toast) | OK |
| Settings | toggles/inputs persist; reflected in runtime config (`codeExecution`, network egress) | OK |
| Design Studio | route loads, templates render | OK |
| Shell | navigation (counts badges), theme toggle (hydration-safe) | OK |

## 7. Sessions deep-dive (highest-priority workflow)

Battery S1–S5 executed live:

1. **Four-card control grid**: exclusive expansion verified (opening one card removes the grid and renders only that panel; Back restores all four), live summaries derived from real state (workspace path, session counts, tracked/unassigned, mode/effort/AUTO/agent count).
2. **Workspace panel**: browse lists directories; selecting a directory persists; invalid paths and traversal are rejected.
3. **Coding sessions**: create → run → logs streamed → delete; tracked-sessions filter/reassign/open; persisted across reload.
4. **Controls**: mode read-only/edit, effort, AUTO/MANUAL, agent switches — each click verified to change the runtime config, not just the UI.
5. **Coding-agent workflow**: 17-step run exercised to completion/failure with real logs. This is where the false `Tool timed out after 10000ms` failure was reproduced (D5) and fixed.

## 8. Runtime / agent workflow results

- Approval gates, cancellation, retry bounds, and partial-failure reporting verified through the automated runtime suite (mocked provider) and live.
- Timeout semantics now correct: model calls run on `llmTimeoutMs` (90 s); real tool executions keep `toolTimeoutMs` (10 s). A slow provider no longer produces a fake tool-timeout failure (D5).
- Honest failure paths verified: no case found where a failed step was reported as success; all-failed runs report failure.
- Live model success path: **NOT fully verified** — local LM Studio model throughput 0.4–1.0 tok/s cannot complete a conversation within budget; Ollama is not installed. Failed/cancelled paths were verified live instead (§17).

## 9. API audit results

Every route was exercised against `:3101` (happy path + invalid input + guard paths):

| Route | Verified |
|---|---|
| `/api/agent` GET/POST | serialized atomic read-merge-write; 400 on invalid JSON; concurrent writers lossless (16/16) |
| `/api/agent-session/files` | read/write/edit/list; traversal 400; secrets 403; protected writes 403 (after D7); `node_modules`/lockfile **reads** allowed by design, writes blocked |
| `/api/agent-session/exec` | policy gate (no mode → 403); destructive commands blocked (`rm -rf /`, `format c:` → 403); real command execution works (`node --version` → exit 0) |
| `/api/agent-session/models` | server-side provider probing (fixes browser CORS; D1) |
| `/api/chat` | chat + stateless mode; provider errors redacted (D6); stream/non-stream paths; dead endpoint fails loudly, nothing persisted |
| `/api/custom-models` GET/POST/DELETE | CRUD; responses carry no API-key material (`hasApiKey` boolean only) |
| `/api/explain` | teaching protocol; error path redacted via shared helper; 10/10 protocol checks |
| `/api/n8n`, `/api/n8n-templates/[id]` | 28 integration checks green |
| `/api/system-metrics` | feeds token meter; values matched live UI |

Cross-origin probes (forged `Origin: evil.example.com`) → 403 on GET and POST.

## 10. Persistence and state integrity

- Stores: `agent-hub-state.json`, `custom-models.json`, `n8n-config.json`/`n8n-state.json`, `chat-history.json`.
- New `fs-atomic.ts` (`writeJsonAtomic` + `createSerializer`) now backs the state writers; `/api/agent` merges under a serializer (D3).
- **Concurrency regression: 16/16** — parallel writes no longer lose updates or return 400.
- Two-store drift in the Models flow fixed (file store ↔ UI mirror; D4).
- Chat history: lost-update race (previously fixed, commit `7379eeb`) re-verified via `/api/chat` regression 16/16.
- Browser persistence: settings/session prefs in `localStorage` keys (`agenthub-chat-settings`, `smol-agent-session-prefs`, `agent-session-coding-v1`, `agent-session-learning-v1`, `agenthub-graph-prefs`, `theme`) round-trip across reloads.

## 11. Security findings

| Probe | Result |
|---|---|
| Path traversal (5 variants) | 400 `Path escapes the workspace` |
| `.env` / `.env.local` read | 403 secrets protection |
| Protected writes (`node_modules/`, lockfiles, `.git`, `.next`, `db`, nested variants) | 403 — **fixed during audit (D7)**: pre-fix, a Windows separator bypass let `node_modules/qa-probe.txt` be created; probe artifact removed |
| Nested `.env` read (`dir/.env`) | 403 — was bypassable pre-fix on Windows separators; fixed |
| Exec policy | no-mode 403; destructive commands 403 |
| Cross-origin | 403 |
| Invalid JSON | 400 |
| API-key redaction | GET responses contain no key material |
| Provider error bodies | redacted to `The model provider returned an error (HTTP <status>).` — **fixed during audit (D6)**; pre-fix leak was 215 chars of provider HTML |

Residual posture notes: no rate limiting is implemented (documented in §16 — the app is local-first, bound to localhost, and polling endpoints make a naive limiter risky; not implemented during this audit). No authentication exists by design (single-user local app). No easings of existing guards were made as part of any fix.

## 12. Responsive checks

- Verified live at the available window (~1038 px): **2-up tablet layout** (equal column widths, single row) on the Sessions grid.
- **4-up desktop and 1-up mobile: NOT VERIFIED live** — no viewport-resize tool is available; assured only at CSS-contract level (`lg`/`sm` grid classes), which is explicitly *not* treated as verified.
- Screenshots unavailable (the capture tool requires a visible desktop window) — all responsive evidence above is DOM/computed-style measurement.

## 13. Accessibility checks

- Semantic buttons with `aria-label`s on the Sessions control cards; focus-visible styles verified for keyboard focus; shortcut handling implemented and exercised.
- **NOT VERIFIED**: full tab-order walk, screen-reader announcement pass, contrast audit — no screen-reader/axe tooling in this environment; synthetic key events cannot fully drive native button activation in the harness (clicks were used instead). Listed in §17.

## 14. Automated tooling results (all re-run at audit close)

| Suite | Checks | Result |
|---|---|---|
| `agent-session-regression.mjs` (live `:3101`) | 402 | **402 passed, 0 failed** |
| `check-state-write-concurrency.mjs` | 16 | **16/16** |
| `check-sessions-layout.mjs` | 45 | **45/45** |
| `check-token-usage.mjs` | 34 | **34/34** |
| `check-chat-isolation.mjs` | 20 | **20/20** |
| `check-chat-normalize.mjs` | 21 | **21/21** |
| `check-n8n-integration.mjs` | 28 | **28 passed** |
| `check-explain-protocol.mjs` | 10 | **10 passed** |
| `check-ownership-e2e.mjs` | 14 | **14 passed** |
| `check-session-ownership.mjs` | 6 | **6 passed** |
| `chat-api-regression.mjs` (live `:3101`) | 16 | **16 passed, 0 failed** |
| `verify-verification-suite.mjs` (live `:3101`) | 12 | **12/12 passed** |
| `tsc --noEmit` | — | **exit 0** |
| `eslint .` | — | **exit 0** |
| `next build` (`NEXT_DIST_DIR=.next-qa-build`) | — | **exit 0** (10 pre-existing dynamic-fs tracing warnings, no errors) |

Total: **624 automated assertions, 0 failures.** New checks added this audit: T37e2–e5 (blocklist bypass regression), T37g (redaction regression), T9a–e (rewritten timeout semantics), plus the concurrency script.

## 15. Defects found, root causes, fixes, regression coverage

| # | Severity | Defect | Root cause | Fix | Regression |
|---|---|---|---|---|---|
| D1 | High | Models/Token meter showed providers offline despite running | browser probes blocked by CORS | server route `/api/agent-session/models`; client fetches same-origin | live re-verify |
| D2 | High | Code Graph blank / console errors | `hash01` missing `>>> 0` → negative `<circle r>` | fix in `graph-view.tsx` | live re-verify (0 errors) |
| D3 | High | Lost state updates / 400s under concurrent writes | non-atomic read-merge-write | `fs-atomic.ts` + serializer; atomic writers | 16/16 concurrency |
| D4 | Medium | Model "added" but absent from the other store | two stores written inconsistently + misleading toast | mirror both stores; honest toast wording | live re-verify |
| D5 | High | Fake `Tool timed out after 10000ms` failures | model calls wrapped in the *tool* timeout budget | `llmTimeoutMs` (90 s) for all model-call sites; tools keep 10 s | T9a–e |
| D6 | High (security) | Provider error body (HTML) surfaced to clients/state | raw `res.text()` embedded in error messages | `providerHttpError(status)` helper; bodies drained, never surfaced | T37g + live probe |
| D7 | High (security) | File-guard blocklist bypass on Windows | `path.relative` backslashes vs `/`-only matching (`baseName`, `startsWith`) | `normalizeRel` in both predicates | T37e2–e5 + live probes |
| D8 | Medium | Dead/misleading controls (search, shortcuts, Pause All, settings, Changes, Export, Models link, Workflows labels, n8n anchors, Graph Impact) | controls shipped as no-ops or with fake success | implemented real behavior or honest disable with tooltip | browser battery per control |
| D9 | Low | Test-tooling defects | nav-helper prefix matching; staging scripts missed new `fs-atomic` dep; T9 tests calibrated to old timeout semantics | helper `startsWith` match; staging lists updated; T9 rewritten | all suites green |

Also fixed pre-existing hygiene issues: 10 TS errors in `examples/websocket/*` (excluded via tsconfig; optional deps deliberately not installed), ESLint react-hooks violations (`carousel.tsx`, `use-mobile.ts`, `theme-toggle.tsx`), and `next.config.ts` `typescript.ignoreBuildErrors` **removed** now that type-checking passes — build errors are no longer suppressed.

## 16. Remaining risks and known limitations

- **Local model throughput**: LM Studio `frognano-4b-2609` runs at 0.4–1.0 tok/s; a full live model conversation cannot complete within the 90 s model budget. This is an environment limitation, not an app defect; the honest failure path was verified.
- **No rate limiting** on `/api/chat`, `/api/explain`, `/api/agent-session/*` — documented, deliberately not implemented mid-audit (polling endpoints make a naive limiter risky; local-first threat model).
- **Responsive matrix and screen-reader pass** not fully verifiable in this environment (§12, §13).
- **Windows path semantics**: the D7 fix normalizes for both platforms, but all live file-guard probing was done on Windows; POSIX behavior is covered by normalization + suite checks.
- Framework behavior: running `next dev`/`next build` with a custom `NEXT_DIST_DIR` auto-adds its generated type includes to `tsconfig.json`; the tree is committed clean, and the framework may re-add such lines during future isolated runs.

## 17. Blocked / unperformed tests (honest list)

| Item | Why |
|---|---|
| Full live model conversation (success path) | provider speed (see §16) |
| Ollama-specific branches | Ollama not installed |
| 4-up desktop / 1-up mobile viewports | no viewport-resize tool |
| Screenshots | capture requires a visible desktop window |
| Screen-reader / contrast / full tab-order audit | no a11y tooling available |
| Rate-limit behavior | no limiter implemented (documented, not tested) |

## 18. Final status

- Every executed suite passes: **624 automated assertions, 0 failures**; `tsc` clean; ESLint clean; production build passes with build-error suppression removed.
- Security probes pass in their final state, including the two newly fixed classes (provider-error redaction, file-guard separator bypass), each with live before/after evidence and standing regression checks.
- All changes are confined to the audit branch `qa/full-app-audit` off baseline `d72d67a`, committed together with this report. The live `:3000` instance and its data were never mutated; all state-mutating verification ran against the isolated `:3101` instance and was cleaned up afterwards.
- Unverified areas are enumerated in §12, §13 and §17 — no claim in this report exceeds what was actually executed.

## 19. Addendum (post-audit) — Agent Skills system: feature completion report

This section covers the Skills feature built on top of the audited baseline (branch `qa/full-app-audit`). It follows the Agent Skills specification (`skill-name/SKILL.md` with YAML frontmatter; directory name must match the declared `name`; `allowed-tools` is advisory). Everything below was executed; items that could not be executed are listed in §19.9.

### 19.1 Files added / modified

**Added**

| File | Role |
|---|---|
| `src/lib/agent-hub/skills-format.ts` | Dependency-free YAML-subset frontmatter parser, SKILL.md validation, hostile-content scanning (shared by server and client; zero imports) |
| `src/lib/agent-hub/skills-registry.ts` | Local library management: scanning, reconciliation, registry IO (atomic + serialized), staging/backups, path containment, size caps |
| `src/lib/agent-hub/skills-github.ts` | GitHub REST + raw file access, ref→commit pinning, tree scan, bounded downloads (no git binary, no archive extraction, no code execution) |
| `src/app/api/skills/route.ts` | Skills API: `list`, `show`, `read`, `validate`, `enable`, `disable`, `inspect`, `install`, `update`, `uninstall`, `check-update` (GET + POST) |
| `src/lib/agent-hub/skills.ts` | Client runtime: never-throwing fetch wrappers, deterministic matcher, bounded instruction block |
| `src/components/agent-hub/skills-view.tsx` | Skills Library panel UI (list/search/filters/details/install/update/uninstall) |
| `scripts/check-skills.mjs` | 25-area test suite: mock GitHub server + the real route handlers, temp workspace/DB, self-cleaning |

**Modified**

| File | Change |
|---|---|
| `src/lib/agent-hub/agent-session.ts` | Skill index at task start, deterministic auto-selection, `activate_skill` tool, `/skills` slash command + `/help` entry, bounded prompt block, all skill fetches wrapped in a 1.5 s timeout with honest fallback |
| `src/components/agent-hub/sessions-view.tsx` | Header **Skills** action, panel mount, slash-command palette entries, LiveTurn chips |
| `src/components/agent-hub/tasks-view.tsx` | Session-state fallback literals kept in sync |
| `scripts/agent-session-regression.mjs` | `skills` added to `RUNTIME_MODULES`, route-mock fixture, T62a–T62z2 block |
| `package.json` | `check:skills` script |

One real defect was found and fixed while building the suite: installing a skill whose `SKILL.md` sits at the repository **root** failed to locate the staged directory when the URL base was empty; `findSkillDirForName` now falls back to fetching/previewing the root `SKILL.md` and matching on the declared name (covered by K6k).

### 19.2 Library location and registry

- Library: **`.agenthub/skills/<skill-name>/`** inside the workspace — deliberately separate from `.agenthub/website-template-library/`.
- Registry: **`<DB dir>/skills.json`** (default `db/`, `AGENT_HUB_DB_DIR` honored). Kept out of `agent-hub-state.json` so a dashboard reset cannot corrupt installed skills. Writes are atomic and serialized; a corrupt registry is quarantined to `skills.json.corrupt-<timestamp>` and reset with a visible warning.
- Reconciliation: registry entries are reconciled with disk on every list/validate — deleted directories are reported as missing, moved/corrupt skills are re-scanned and never remain silently "valid".
- Trust levels: `local` (placed by the user), `approved` (installed after explicit review), `unreviewed` (never auto-selected).
- Scope limitation: the library is workspace/project-scoped; a shared user-level library is not implemented (§19.9).

### 19.3 Supported GitHub URL formats

- `https://github.com/<owner>/<repo>` — default branch; also accepts `github.com/...` without a scheme, a trailing `.git`, and `www.github.com`.
- `https://github.com/<owner>/<repo>/tree/<ref>/<path…>` — branch names containing `/` are resolved by trying the longest ref prefix first (up to 4 attempts).
- `https://github.com/<owner>/<repo>/blob/<ref>/<path/file>` — uses the file's containing directory.
- Plus separate optional **Branch / tag / commit** and **Skill path in repo** fields.
- Any other host or URL shape (e.g. `/issues/…`) is rejected with a specific error message.
- Repository-root skills and multi-skill repositories are both supported: candidates are every directory containing `SKILL.md` (≤ 50); inspection fetches only each candidate's `SKILL.md` (≤ 20 candidates per call) — no files are downloaded before install.

### 19.4 Validation behavior

- Required fields: `name`, `description`. The directory name must equal the declared name (spec rule) — mismatches are hard errors.
- Additional errors: over-length name/description/compatibility, invalid YAML-subset lines (reported with line numbers, e.g. tab indentation), malformed `metadata` maps, missing frontmatter.
- Warnings (do not block): unknown frontmatter fields (kept as extras), unusually long license, non-string metadata values, empty instruction body.
- Skills with errors show as **invalid** ("need attention") in the UI and are excluded from runtime selection; the exact error text is displayed (live-verified).
- Hostile-content scanning flags prompt-injection / secret-exfiltration heuristics as a review list; the UI states plainly: *"Automated scanning is a warning list, not a safety guarantee — review the source before relying on a skill."*
- `allowed-tools` is parsed and displayed but **advisory only** — it never grants permissions; runtime allow-lists, file scopes, read-only mode, approvals and timeouts are unchanged.

### 19.5 Install / update / remove behavior

- **Install** = inspect (no downloads, pinned commit shown) → review source → select skills → install; files are staged to `.staging-<id>-<ts>` and atomically renamed into place (a failed install leaves nothing behind). The resolved commit is recorded and the repo is remembered as an approved source ("source approved before"). Duplicate installs are refused with *"A skill named X is already installed. Use update instead."*
- **Update** = check-update compares the recorded per-file blob SHAs against the upstream tree; applying copies the previous version to `.backups/<id>-<ts>` (the two newest backups are kept) before replacing.
- **Uninstall** = explicit **Confirm uninstall** step; removes the files and the registry entry (live-verified, including on-disk removal).
- Nothing at any point runs `npm install`, repository scripts or any repository code; downloads are bounded by 300 files / 2 MiB per file / 24 MiB total / 20 000 tree entries, and every path is containment-checked (no traversal, no symlink escape, duplicate-path refusal).

### 19.6 Runtime selection and activation

- At task start the runtime fetches a compact skill index. Every skill fetch is wrapped in a 1.5 s timeout; on failure the session logs `Skills unavailable: … — continuing with general capabilities.` and proceeds.
- Deterministic scoring (no model needed): name token +3, tag +2, shared category up to +4, description token +1, with saturation penalties; threshold 4; ties broken by id. Only enabled + valid + reviewed skills are scored; excluded ones are logged as `Skill skipped: <reason> — <id>`.
- The top match is auto-activated; a second skill only when it is in a disjoint category and scores ≥ 60 % of the top.
- Logs are explicit: `Skill selected: <id> (<reason>)` and `Skill instructions loaded: <id> (<n> chars)`. The full `SKILL.md` is loaded only on activation, truncated at 6 000 chars; the whole skills block is capped at 12 000 chars / 4 candidates.
- An `activate_skill` tool lets the model request a skill explicitly; references/scripts are read on demand through the existing read API.
- Skill text is treated as untrusted input (same trust class as repository content) with no path to bypass read-only mode, file scopes, allow-lists, approvals or verification.

### 19.7 UI

- Sessions header **Skills** action opens the Skills Library panel (the four control cards are unchanged).
- Panel: installed/enabled/disabled/attention counts, **All/Enabled/Disabled/Attention** filters, search, per-skill badges (valid/invalid, scripts, category, source trust), detail view (metadata, integrity hash, file inventory with reference/script/asset kinds), **Validate**, **Check updates**, **Disable/Enable**, **Uninstall**, **Install from GitHub** (inspect → select → install), and an on-demand viewer for `SKILL.md`, references and scripts (scripts shown with the standing note that they are never executed).
- Real `/skills list | search | show | validate | enable | disable | install | update | remove` slash command plus a `/help` entry; task logs use the exact lines above.

### 19.8 Tests executed (all this session)

| Suite | Result |
|---|---|
| `node scripts/check-skills.mjs` (25 areas + unit checks; self-contained mock GitHub + temp workspace/DB) | **123 passed, 0 failed** |
| `node scripts/agent-session-regression.mjs` (incl. T62a–T62z2 skills block) | **417 passed, 0 failed** |
| `node scripts/check-sessions-layout.mjs` | **45 passed, 0 failed** |
| `node scripts/chat-api-regression.mjs` (isolated :3101 + mock provider) | **16 passed, 0 failed** |
| `node scripts/check-state-write-concurrency.mjs` (:3101) | **16 checks, 0 failed** |
| `node scripts/verify-verification-suite.mjs` (:3101) | 7/12 — the 5 failures are content-dependent checks that need a real chat model (see §19.9) |
| `check-chat-isolation` / `check-chat-normalize` / `check-n8n-integration` / `check-explain-protocol` / `check-token-usage` / `check-session-ownership` / `check-ownership-e2e` | 20/0 · 21/0 · 28 checks · 10 checks · 34/0 · 6 checks · 14 checks |
| `npx tsc --noEmit` · `npx eslint .` · `npx next build` | clean · clean · passes (`/api/skills` dynamic route registered) |

**Live browser pass** (isolated :3101, temp DB, two hand-placed demo skills in the workspace library, removed afterwards): list/counts/filters/search/badges; details incl. SKILL.md, reference and script viewers; Validate on the broken skill → the exact directory/name mismatch error + honesty note; Check updates on a local skill → *"added locally — there is no remote source to update from"*; disable → counts change to 1 disabled → enable → back; a **real GitHub inspection** of `https://github.com/anthropics/skills` resolved commit `dbd4588f9e10`, listed 20 candidates with per-candidate validity (18 pre-selected; name-mismatch `template-skill` left unselected); installing `brand-guidelines` produced `trust=approved` + pinned commit; a repeat install was refused honestly; uninstall required **Confirm uninstall** and removed files and registry. `/skills list` in the chat produced real output (`Installed skills: 2 (1 enabled)` with per-skill lines) with no model call. **Zero console errors** across the whole pass.

### 19.9 Limitations / not verified

- **Live local-model activation success path NOT VERIFIED**: the only local model available answers at ~0.4–1.0 tok/s, so a full task with automatic skill activation was not run end-to-end; selection/activation logic is covered by the deterministic matcher tests and the regression suite.
- **`verify-verification-suite` content checks not re-verifiable in this environment**: tests B/C/D (reply formatting, model identification), E-leak and F2 (embedding-model rejection needs LM Studio's model inventory) depend on a real chat model; with the scripted mock provider they cannot pass by construction. The same suite passed 12/12 at audit time with LM Studio running, and the affected checks are about `/api/chat`, which this feature does not modify.
- Screenshots remain unavailable (capture needs a visible desktop window — same limitation as §17).
- The skill library is workspace-scoped only; no user-level/global library.
- `allowed-tools` remains advisory by spec; hostile-content scanning is heuristic, as stated in the UI.
- GitHub anonymous rate limit (60 req/h) applies unless `GITHUB_TOKEN` is set (honored, never echoed).

### 19.10 Compatibility scanner (pre-install, installed, bulk audit, controlled test)

A static **evidence** pass that answers "can this skill actually run here?" against the registered runtime — never against what the skill claims. Nothing is downloaded before install, no skill script is executed, no package is installed, and no report is inferred from a successful download.

| File | Role |
|---|---|
| `src/lib/agent-hub/skills-compat.ts` | Pure engine: capability catalog, capability/dependency/script/reference extraction, model-suitability heuristics, per-dimension + overall status, deterministic fingerprints. Imports only `skills-format.ts`. |
| `src/lib/agent-hub/skills-compat-server.ts` | Server orchestration: GitHub candidate analysis (bounded text reads), installed-skill analysis, bulk audit, atomic report cache, optional allow-listed binary probe, controlled functional test. |
| `src/lib/agent-hub/skills-github.ts` | `fetchRepoTextFile()` — bounded, binary-rejecting text reads for inspection. |
| `src/app/api/skills/route.ts` | New ops `compat` (repo candidate or installed id), `compat-all`, `compat-cache`, `compat-env`; POST actions `test-skill` (requires `confirm: true`), `compat-clear`. |
| `src/lib/agent-hub/skills.ts` | Client wrappers (`checkRepoCompatibility`, `checkSkillCompatibility`, `checkAllInstalledSkills`, `testSkillWithModel`, `fetchCompatEnv`, `clearCompatCache`). |
| `src/components/agent-hub/skills-view.tsx` | **Check compatibility** per install candidate and in the detail view; **Test skill**; **Check all** bulk audit; full report card. |
| `scripts/check-skills.mjs` | New K26–K44 block (50 checks) including the registry drift guard. |

**Dimensions.** `format` (frontmatter/name/description/name↔directory), `metadata` (supported vs unsupported fields, missing relative references, advisory `allowed-tools`), `tools` (each detected requirement → `Available` / `Available when permitted` / `Check required` / `Unavailable`), `dependencies` (interpreters, declared packages, env vars, commands, services, OS-specific steps), `security` (instruction + script findings; never "safe"), `model` (size/steps/context/vision/provider-specific instructions), `functional` (the controlled test). Each dimension is one of Fully compatible / Partially compatible / Needs review / Incompatible / Not verified.

**Overall precedence.** `incompatible` if the format is invalid, any required capability is *unavailable*, a security hard-blocker is present, or a functional test **failed** → `needs-review` for unsupported metadata or security warnings → `not-verified` when no model is loaded or the test is **blocked** → `partially-compatible` if any dimension is partial or the functional test has not been run → `fully-compatible` only when every dimension is clean **and** the test passed on the recorded model. A statically clean skill without a test is therefore reported as *Partially compatible*, with "run Test skill" as the explicit adaptation path.

**Capability truth.** `RUNTIME_TOOL_NAMES` / `RUNTIME_APPROVAL_TOOLS` mirror `agent-session.ts`; K26a/K26b parse the real `tools` array and fail on any drift. If a capability names a tool outside the supplied runtime snapshot, its row is downgraded to *Unavailable* with the missing tool names. A skill declaring `allowed-tools: bash write_file` gains nothing (K30b).

**Functional test.** Reuses `readSkillInstructions` → `buildSkillsPrompt` (the real skill-loading path), writes a disposable fixture under `<db>/compat-fixtures/`, resolves the loaded local model via `detectRuntimeModels`/`resolveTarget`, makes one `callLLM` completion (90 s cap), reports model id/provider/duration/usage/steps/limitations, and deletes the fixture. Tool execution, skill scripts and network access from skill content are out of scope by design; a missing provider yields `blocked` (not `failed`).

**Caching / invalidation.** Reports persist atomically in `<db>/skills-compat.json` (never in the library) keyed by `origin + source + revisionKey`, and are only reused when `envFingerprint` matches. The fingerprint covers platform, mode, code-execution/network policy, the loaded model, the tool set and probe results; functional results are stored separately and only merge under the same fingerprint. Bulk audit iterates the real registry and makes **zero** model calls.

**Safety.** Static scan: the engine contains no I/O, execution or network calls (K26c). The only process spawn is the fixed `execFile(name, ['--version'])` allow-list probe, opt-in per request (K26d). Scripts are read as text, inventoried, and never run (K36b); a `package.json` in a repo becomes a declared dependency, not an install (K36c). Paths are validated (`../etc` rejected, K41c).

**Results.** `check-skills` **172 passed / 0 failed** (was 123); `agent-session-regression` **455 / 0**; `check-ui-interactions` **56 / 0**; `check-playground` **215 / 0 / 2 skipped** (port 1234 held by LM Studio); `tsc --noEmit` and `eslint .` clean; `next build` exit 0 (`/api/skills` dynamic). **Live**: the controlled test passed on `gpt-oss-20b` via LM Studio (13.6 s, 482 tokens) and, with that result recorded, the report reached **Fully compatible** with all seven dimensions green; the model note records `~13056 token context · estimated prompt ~257 tokens · low complexity`. No model was generalised from.

**Limitations.** Capability extraction is heuristic (keyword/pattern based) and can under- or over-report; it is labelled as detected evidence, not proof. Package availability is never verified (AgentHub installs nothing) and stays *Check required*. Static scanning is a warning list, not a safety guarantee. The functional test is one non-streaming completion on a small fixture — it proves instruction loading and a model reply, not multi-step tool use. Bulk audit is static only.

## 20. Addendum (post-audit) - Code Playground: feature completion report

**Honest starting point:** no Playground feature existed anywhere before this work. This was verified across `src/`, `docs/` (including this audit), the worklog and both branches - there was no prior editor view, action toolbar or practice-session store to upgrade. Everything below is newly created for this task; nothing existing was renamed or repurposed.

### 20.1 Files added / modified

Added:

| Area | Files |
|---|---|
| Registry / content | `src/lib/agent-hub/playground-types.ts`, `playground-languages.ts`, `playground-starters.ts` |
| Local model + persistence | `src/lib/agent-hub/playground-prompts.ts`, `playground-store.ts`, `src/app/api/playground/route.ts` |
| View + components | `src/components/agent-hub/playground-view.tsx`, `playground/code-editor.tsx`, `playground/code-editor-langs.ts`, `playground/code-editor-theme.ts`, `playground/excel-grid.tsx`, `playground/feedback-panel.tsx`, `playground/playground-extract.ts` |
| Tests | `scripts/check-playground.mjs` (202 checks) |

Modified: `src/components/agent-hub/shell.tsx` (NAV entry in the Build group, `FULL_HEIGHT_VIEWS`, render `<PlaygroundView />`), `src/lib/agent-hub/types.ts` (`ViewId` + `'playground'`), `scripts/mock-provider.mjs` (deterministic playground replies for live tests), `package.json` / `package-lock.json` (CodeMirror 6 dependencies + `check:playground` script). Nothing else was touched.

### 20.2 Layout and view shell

Spacious Go-Playground-inspired regions, no borrowed branding: (A) compact top toolbar - title, workspace/session name, language/practice-mode selector, local-model selector, level selector, New practice, Save; (B) the editor occupies most of the viewport with monospace text, line numbers, syntax highlighting, horizontal scroll and minimal chrome; (C) compact action toolbar, mode-adaptive (below); (D) AI feedback area - loading state, rendered Markdown with highlighted code, provider-error entries, useful empty state. On `lg` and up the editor and feedback sit side by side; below `lg` a **Code / AI feedback** tab switcher appears and both panes stay mounted (`hidden lg:flex`) so editor content and scroll survive tab switches and resizes. The required standing labels are rendered verbatim per mode:

- code modes: `AI analysis only — code is not executed.`
- SQL: `Queries are analyzed but not executed. Results shown by AI are estimates.`
- Excel: `Formula analysis only — recalculation is not performed unless a verified calculation engine is explicitly integrated.`

### 20.3 Editor technology

**CodeMirror 6** was chosen over Monaco (bundle size and React 19 compatibility). Real editing: `basicSetup` + per-language extensions, dynamic `import()` per language, a shared `makeEditorTheme()` with light/dark variants driven by compartments, and a `CodeEditorHandle.getValue()/setValue(next, { history })`. `react-syntax-highlighter` remains output-only in the feedback panel and is not used as the editor (asserted in tests). Highlighting makes no compile/type-check claims.

### 20.4 Languages, modes and practice content

- Registry: 18 entries - Python, C, C++, Java, C#, Go, Rust, PHP, JavaScript, TypeScript (incl. JSX/TSX), HTML, CSS, SQL, JSON, YAML, Bash, PowerShell, Excel formulas. Legacy stream modes cover C#/Bash/PowerShell; C uses the C++ grammar with C semantics (C-only Lezer grammar does not exist in `@codemirror/lang-cpp`, verified).
- 23 deterministic starters (the deliberate off-by-one `average()` bug for Python, pointer-UB exercises for C, etc.). Every practice works without the model; starters are always available.
- SQL mode: dialect selector (PostgreSQL / MySQL / SQLite / SQL Server), collapsible sample-schema panel (4 tables - customers, products, orders, order_items - shipped as text only; "no database is created"), problem statement, JOIN / GROUP BY / HAVING / subquery / window practice. Predicted results are labeled AI estimates.
- Excel mode: grid with column letters, row numbers, selected-cell indicator, raw-text formula bar, editable cells and formulas, sample-workbook selector (Sales Q1 with a deliberate `=XLOOKUP(...)` size-mismatch error at B9, Budget planner), problem statement. Cells show raw text only - no calculated values are ever invented.
- Action toolbar by mode: code - Explain, Review, Find bugs, Hint, Improve, Predict output; SQL - Explain, Review, Find bugs, Hint, Predict result; Excel - Explain formula, Find formula errors, Suggest a correction, Explain dataset, Hint, Practice questions. There is **no Run/Compile button anywhere**, and no Format action (no local formatter is integrated - the UI says so explicitly instead of faking one).

### 20.5 Local-model request flow

`POST /api/playground` with `action: 'analyze'` -> payload validation -> `buildAnalysisMessages` (system prompt + one user message; size-clamped) -> the existing provider plumbing only: `resolveTarget(modelId, readCustomModels())` then a single non-streaming `callLLM(target, messages, { maxTokens: 1500 })`. No new model client, no tools/functions are ever sent (asserted on the wire in tests), no filesystem/shell access for the playground model, no agent runtime, and no silent cloud fallback - an explicit model that is unreachable fails loudly with the real provider error and HTTP 502. Provider errors keep the user's work; only a real error entry is appended to the feedback list. Cross-origin POSTs are rejected with 403.

### 20.6 Persistence

New `db/playground.json` using the existing storage conventions (`resolveDbDir()` + `writeJsonAtomic` + the shared serializer). Sessions carry name, language/mode, level, problem statement, model preference, editor or sheet state **including both the saved starter state and the current state**, feedback history and timestamps. Bounds: 20 feedback entries, 200 000 chars of code, 100 sessions; corrupt files are quarantined to `playground.json.corrupt-<ts>` with an honest warning. Entirely separate from chat and coding-session history (never overwritten - asserted in tests).

### 20.7 How non-execution is enforced

- Static sweep over every playground source: no `child_process`, `execSync`, `execFile`, `spawn(`, `eval(`, `new Function`, `vm.runInThisContext`, and no use of the agent-session exec endpoint.
- No Run/Execute/Compile button or handler exists; actions only build chat-style analysis requests.
- Excel grid displays raw text; formula bar is labeled "raw cell text, not calculated" and the footer repeats the exact label above; there is no recalculation code path at all.
- HTML/CSS mode reviews markup, styles, accessibility and responsive concerns; no rendering/preview happens because no verified isolated renderer exists in the app - the UI claims nothing more.
- Predicted-output actions are marked with the exact chip `AI estimate — not executed` (UI + feedback entries carry the same flag).

### 20.8 Apply suggestion / undo

Model improvements are shown as a separate suggestion block with an explicit **Apply suggestion** button; the original content is untouched until acceptance. Applying replaces the editor content through a normal CodeMirror transaction (`history: true`), so **Ctrl+Z restores the original** (verified live with a real undo keydown). Programmatic loads instead use the `Transaction.addToHistory.of(false)` annotation so history is not polluted. In the Excel grid, applying a correction commits a normal cell change and the sheet keeps its own value-level undo stack (Undo button + Ctrl+Z, verified live). Destructive actions (language switch, workbook switch, reset, new practice, delete) use an inline two-step confirm banner when content is unsaved.

### 20.9 Live browser pass (all this session)

Real dev server on :3000, deterministic mock provider on :1234 (started and later stopped by this session), real workspace DB:

- Python starter opens in CodeMirror with line numbers; Explain returns rendered Markdown with the answering model shown; Improve produced a suggestion block, **Apply suggestion** replaced the content, Ctrl+Z restored the original; Predict output shows the `AI estimate — not executed` chip.
- Sessions: Save (real `db/playground.json`), rename (row + active name update), full page reload -> still listed -> Load restored code, name and the saved 3-entry feedback; Delete required confirmation and removed it.
- SQL: dialect selector present (sqlite default), schema panel opened with 4 tables and the "text only" note, Predict result flagged as an AI estimate.
- Excel: grid rendered raw formulas (`=C2*D2` etc. - never computed), clicking B9 showed the raw buggy `=XLOOKUP(MAX(E2:E6),E2:E6,B2:B2)` in the formula bar; Suggest correction -> Apply -> formula replaced and undoable; manual cell edit -> Enter commit -> Ctrl+Z reverted with "Reverted B9."
- Switching mode from a dirty grid to TypeScript showed the confirm banner first ("Switch to TypeScript? Current editor content will be replaced by its starter."), then loaded the TS starter with branded highlighting and 21 line-number gutters.
- Offline behavior: mock provider stopped, model forced to the dead one -> "Explain formula" returned the real error `Model "mock-model" was not found on any reachable local provider...` as a red feedback entry, with the full sheet verified byte-identical before/after (no data loss, no fabricated text, no fallback to the unrelated custom model).
- Mobile: the app loaded inside the same-origin iframe at 390 px - Code/AI feedback tabs visible, no horizontal page overflow, editor pane hidden-but-mounted when viewing feedback (content preserved), editor visible again and content intact on switch back.
- Deep link `/?view=playground` opens the view directly.
- **Environment finding worth recording:** the automation window never has OS focus, so Chromium fires no focus/blur events; the grid originally tracked "value at edit start" from focus events, which made commit-on-blur unverifiable (and brittle in that situation generally). It now captures the pre-edit value from the first change event instead - commit and undo no longer depend on focus events at all, and the whole chain was re-verified live via the Enter-commit + Ctrl+Z path.

### 20.10 Tests executed (all this session)

| Suite | Result |
|---|---|
| `node scripts/check-playground.mjs` (registry/labels, starters/schema/workbooks, prompt contract, suggestion extraction, store CRUD/caps/sanitize/quarantine/isolation, route + in-process mock provider, static non-execution sweep, editor dependency contract) | **202 passed, 0 failed, 0 skipped** |
| `node scripts/check-skills.mjs` | **123 passed, 0 failed** |
| `node scripts/agent-session-regression.mjs` (chat/sessions/skills regressions, T62a-T62z2) | **417 passed, 0 failed** |
| `npx tsc --noEmit` / `npx eslint` (all new + modified files) | clean / clean |
| `npx next build` | passes; `/api/playground` registered as a dynamic route |

### 20.11 Limitations / not verified

- The blur-commit path of the grid is the same `commitCurrent()` as the Enter/Tab/arrow path, but the blur event itself cannot be produced in this environment (no OS focus) - it is verified by code path and by the keyboard path, not by an end-to-end blur.
- Live model responses were exercised through the deterministic mock provider on :1234; a full pass against a real LM Studio model was not possible in this session (no loaded chat model available on this machine at acceptable speed).
- No HTML/CSS preview exists by design (no verified isolated renderer was found), so preview behavior is claimed nowhere and not tested; likewise there is no Format action and no formatter claim.
- Screenshots remain unavailable (capture needs a visible desktop window - same limitation as sections 17 and 19.9).
