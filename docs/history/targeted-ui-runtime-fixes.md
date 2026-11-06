> Historical evidence. This file describes an earlier implementation; use [current architecture](../architecture.md), [development](../development.md) and [testing](../testing.md) for the current project.

# Targeted UI & Runtime Fixes

This report covers five defects fixed in AgentHub, how each was verified, and
what the verification does **not** prove. It is written to be read on its own:
every claim below is tied to a file, a command, or an observed browser state.

- Branch: `qa/full-app-audit` (local only)
- Base commit: `596b025`
- Push status: **not pushed** (`origin` is a local bare backup repo and was not used)
- Commit status: see [§7 Commit status](#7-commit-status)

---

## 0. What "fixed" is backed by

Throughout, evidence is labelled with one of four categories so the strength of
each claim is explicit:

| Label | Meaning |
| --- | --- |
| **Static** | Source/text inspection (a script asserts a real code shape, not a behaviour). |
| **Deterministic** | A test executes the **real** source module or route against a mocked transport, with no network and no live DB. |
| **Live browser** | Observed in a real browser against the running dev server. |
| **Real inference** | A real model/provider produced the output. |

The strongest evidence in this report is **Deterministic** + **Live browser**.
**Real inference** is called out separately and deliberately limited (see
[§6 Limitations](#6-limitations--what-was-not-tested)).

---

## 1. Playground — one current result, full-width view

### Problem
An analysis prepended a new result every run, producing a stacked list of cards,
and the feedback panel was a narrow fixed column (360–480&nbsp;px) even when the
result was the point of the screen.

### Fix
- `src/lib/agent-hub/playground-feedback.ts` (new): pure, testable helpers
  `isStaleResult`, `prependFeedback`, `activeFeedback`. History is a capped
  `feedback[]` array; exactly one entry is the **active** result.
- `src/components/agent-hub/playground/feedback-panel.tsx`: renders only the
  active entry, with a compact history menu for earlier results. No second
  result is ever presented as current.
- `src/components/agent-hub/playground-view.tsx`: three workspace modes —
  **Code**, **AI Response**, **Split** (`data-testid="workspace-mode-*"`).
  In AI Response mode the panel takes the full workspace width; Split mode keeps
  a bounded comparison column. Supersession uses a request sequence ref plus
  `AbortController`, so a late reply can never overwrite a newer one. Predictions
  are labelled "AI estimate — not executed"; nothing fabricates a run.

### Evidence
- **Deterministic**: `scripts/check-playground.mjs` → **203 passed, 0 failed, 2
  skipped**.
- **Static**: `scripts/check-ui-interactions.mjs` — the workflow asserts the
  three modes exist, that AI Response spans the full width, that Split keeps a
  bounded column, and that the old `lg:w-[360px] / xl:w-[420px]` panel is gone.
- **Live browser**: opening Playground shows all three mode buttons
  (`split` selected by default); switching to AI Response gives the feedback
  panel the full workspace width (measured panel width = workspace width,
  795&nbsp;px; the editor column is `display:none`).

---

## 2. Chat — attachments + truthful Thinking controls

### Problem
Chat had no attachment support and no reasoning control. Any "attachment" claim
would have been cosmetic.

### Fix
- `src/lib/agent-hub/attachments.ts` (new): payload types, size/count caps,
  `attachmentKind` (image / document), `validateAttachment` (explicit reasons for
  oversize, empty, or unsupported types), data-URL helpers, `modelLooksVision`,
  `thinkingModeFor`, `reasoningBody`, `thinkingPromptSuffix`.
- `src/lib/agent-hub/document-extract.ts` (new): **server-only, dependency-free**
  text extraction:
  - text/source files via UTF-8,
  - PDF best-effort via zlib-inflated content streams (`BT … ET`, `Tj`/`TJ`),
  - DOCX via a minimal ZIP reader of `word/document.xml`,
  - anything unsupported or unreadable returns an **explicit error** — never a
    silent drop.
- `src/app/api/chat/route.ts`: accepts `attachments`; validates every file;
  forwards images to the provider as OpenAI multimodal `image_url` content parts;
  folds extracted document text into the prompt. If a selected model is
  text-only and an image is attached, the request is refused with HTTP 400 and
  the list of locally available vision models — the model is never claimed to
  "see" an image it cannot. When vision capability cannot be verified, the reply
  is allowed but carries a visible `visionWarning`.
- Thinking: `src/lib/agent-hub/chat-settings.ts` persists `thinking: boolean`
  and `effort: 'low'|'medium'|'high'`. A **native** `reasoning_effort` parameter is
  sent only for models known to support it; other models receive a
  clearly-labelled prompt-guided depth instruction. The response reports the mode
  actually applied (`off | native | prompt`).
- `src/lib/agent-hub/llm.ts`: multimodal `ChatTurn` union, `chatTurnsText`,
  and an `extraBody` option so reasoning parameters reach the provider.
- `src/components/agent-hub/chat-view.tsx`: **Attach** button + hidden file input
  with the real accept list, attachment chips (thumbnail / file icon, size,
  remove), explicit per-file errors, and a **Thinking** popover (On/Off switch,
  Low/Medium/High) that states plainly that native reasoning parameters are sent
  only where supported. Attachment **contents are never persisted** — the
  transcript keeps only a `[Attached: …]` name marker.

### Evidence
- **Deterministic (unit)**: `scripts/check-chat-attachments.mjs` → **61 passed,
  0 failed**. Executes the real `attachments.ts` and `document-extract.ts`
  modules, building a real DOCX ZIP and a real FlateDecode PDF fixture.
- **Deterministic (behavioural)**: `scripts/check-chat-multimodal.mjs` → **26
  passed, 0 failed**. Runs the real `/api/chat` route against a mocked provider:
  a text-only model **refuses** an image (400 + vision suggestion); a vision
  model receives a real `image_url` data part; a document is extracted locally
  and reaches the prompt while history stores only the file name; Thinking sends
  a native param only for the reasoning model, a labelled prompt instruction
  otherwise, and reports the mode.
- **Deterministic (regression)**: `scripts/check-chat-normalize.mjs` (21/0) and
  `scripts/check-chat-isolation.mjs` (20/0) still pass; the isolation harness now
  transpiles the two new modules.
- **Live browser**: Chat composer shows **Attach** with the full accept list
  (`.png,…,image/*,text/*`); the **Thinking** popover opens with an On/Off switch
  and Low/Medium/High; effort buttons are disabled while Thinking is off;
  toggling on enables them; selecting High shows **"Thinking · High"**; the
  popover shows the honest native-vs-prompt-guided note.

---

## 3. Overview runtime widget — only genuinely loaded models

### Problem
Overview read a seeded `running` flag, so it displayed a fabricated model name
that no provider had loaded.

### Fix
- `src/lib/agent-hub/llm.ts`: LM Studio is read from `/api/v0/models`
  (`state === 'loaded'`); Ollama distinguishes `/api/ps` (running) from
  `/api/tags` (installed). Added `loadedStateKnown` and `detectRuntimeModels()`.
- `src/app/api/runtime/models/route.ts` (new): `GET /api/runtime/models`.
- `src/lib/agent-hub/use-runtime-models.ts` (new): shared hook used by Overview
  **and** the sidebar so both read one source of truth.
- `src/lib/agent-hub/seed-models.ts`: the seeded model's `running` flag is now
  `false` — seeded data is inventory only and can never appear as "running".
- `src/components/agent-hub/overview.tsx`, `shell.tsx`: render only
  provider-confirmed loaded models, otherwise an honest empty/offline/unavailable
  state. The full inventory stays in the Models view, which distinguishes
  downloaded / installed / configured / available / loaded.

### Evidence
- **Deterministic**: `scripts/check-runtime-models.mjs` → **24 passed, 0 failed**.
- **Live browser + real provider data**: the sidebar reads "1 model running" and
  the Overview card shows **`spark-x2.5-4b · LM Studio`** — the model LM Studio
  actually reported as loaded at verification time. The seeded fake name never
  appears (`hasSeededFake: false`).
- **Real provider call**: `GET /api/runtime/models` live returned
  `{"loaded":[{"id":"spark-x2.5-4b","providerId":"lmstudio",…}]}`.

---

## 4. Sessions — full-width conversation, full-code viewer, calmer logs

### Problem
The conversation was centered at `max-w-3xl`; code blocks were cramped with no
way to inspect them; activity/plan/files/verification logs cluttered the view.

### Fix
- `src/components/agent-hub/sessions-view.tsx`:
  - Conversation, approval, error, drawer and composer containers now use the
    full available width (`w-full`), removing every `mx-auto … max-w-3xl`.
  - `CodeBlock` rebuilt: language label + line count, both-axis scroll, **Copy**
    (raw source), and **Expand / Full View** opening a portal dialog (Esc to
    close, backdrop to close).
  - Activity / Plan / Files / Verification logs collapse behind a single
    **`Activity & verification`** control, closed by default.
  - A failed step's reason is no longer truncated (`max-w-[45%] break-words`).
- Honesty: a file is reported as changed only when the file API confirms it — a
  code block appearing in a message never counts as a change.

### Evidence
- **Deterministic**: `scripts/check-sessions-layout.mjs` → **54 passed, 0
  failed**.
- **Live browser**: the Sessions view contains **zero** `max-w-3xl` containers
  (measured live), and the **`Activity & verification`** control is present and
  collapsed by default.

---

## 5. Sessions agent — really read / create / update / delete permitted files

### Problem
File operations failed in practice. Two root causes:

1. `getFileScope`/`parseTargetFiles` produced an empty scope whenever a write
   request named no extension-bearing file (e.g. *"create a notebook in that
   folder and write success in it"*), so every write was refused as out of scope.
2. A direct `write_file`/`edit_file` step had no deterministic destination
   parameters.

### Fix
- `src/lib/agent-hub/agent-session.ts`:
  - New **app-owned, deterministic** intent classifier `detectFileIntent`
    (list / read / find / create / update / delete), with delete and update
    taking precedence over create so *"refactor and write"* is an update.
  - **Safe default destination**: an unnamed **create** resolves to
    `notebook.md` (or `<dir>/notebook.md` when the request names a directory).
    The scope records `defaultTarget` + `safeDefault` and explains the choice.
  - **One concise clarification instead of guessing**: an unnamed **update** or
    **delete** cannot be guessed safely, so the run returns a short clarifying
    question and modifies nothing.
  - `resolveScopedTarget` + rewritten `write_file` / `edit_file`: a missing path,
    or a bare filename proposed while the request named no file, resolves to the
    scope's safe default (and is logged). Explicit out-of-scope paths are still
    refused.
  - The guided-step prompt now states the allowed destination(s), and the Coder's
    system prompt requires file changes to be expressed as a fenced tool block.
  - Selection concepts stay separate: **registered** (roster) ≠ **eligible**
    (capability) ≠ **disabled** (explicit opt-out) ≠ **selected** (in the plan) ≠
    **executing/completed** (activity status). **AUTO** substitutes any enabled
    capable specialist when the natural owner is off; **MANUAL** uses only
    user-enabled specialists and explains the gap and how to fix it.
- `src/lib/agent-hub/runtime-policy.ts`, `seed-agents.ts`: unchanged in
  behaviour (verified intact) — the fix is in the planning/scope layer, not by
  widening permissions or timeout hacks.

### Evidence
- **Deterministic (end-to-end)**: `scripts/agent-session-regression.mjs` →
  **452 passed, 0 failed** (35 new checks, `T63*`/`T64*`). The new end-to-end
  case runs *"create a notebook in that folder and write success in it"* against
  a mocked file API and asserts a real write to `notebook.md` with the requested
  content, that the bare out-of-scope name is never written, that the change is
  tracked, and that the model was told the destination. It also asserts the
  unnamed-update path returns a clarification and writes nothing, and that
  AUTO/MANUAL selection behaves as described.

---

## 6. Limitations — what was NOT tested

> **Superseded in part by §8 (round 2):** the "no live model", "no live file
> creation" and deep-link items below were closed by the round-2 work — real
> filesystem, real local models and live browser deep-links. The remaining
> limitations are restated in §8.5.

Honest boundaries:

- **No live model completion** was run through the new Chat attachment / Thinking
  path. The multimodal and thinking behaviour was verified against a **mocked
  OpenAI-compatible provider**, not a live model. Reason: a live run would append
  to the user's real chat history, and a vision-capable model was not confirmed
  loaded. The route, payload shape, native-vs-prompt decision and response
  reporting are all exercised deterministically; what remains unproven live is a
  specific model's output quality.
- **No live file creation** in the user's real workspace. The create/update/delete
  pipeline was verified against a **mocked file API**, deliberately, so the live
  workspace and history were never mutated.
- **Real inference on the runtime widget** is limited to provider *inventory*
  (`/api/v0/models`), which is real provider data; no completion was generated.
- **PDF/DOCX extraction is best-effort** and dependency-free. Scanned PDFs and
  unusual PDF encodings will fail **explicitly** rather than silently; that is the
  intended behaviour, but it is not full-fidelity parsing.
- **Vision capability is heuristic** (`type === 'vlm'` or known id patterns).
  When it cannot be determined, the app allows the request with a visible
  `visionWarning` instead of blocking — a deliberate honest fallback, not a
  guarantee.
- **Design Studio / Teaching / Skills pipelines** were re-run under the full
  deterministic suite and pass, but were not re-verified interactively beyond
  what §1–§5 list.

---

## 7. Commit status

Per the brief, **nothing was pushed**. `origin` is a local bare backup repo and
was not contacted.

Planned local commit on `qa/full-app-audit` (feature branch) once the working
tree and all checks are clean — see the sibling entry in the session summary for
the final decision. Commands run before deciding:

```
npx tsc --noEmit      # clean
npx eslint .          # clean
npx next build        # success
```

Full check suite:

| Suite | Command | Result |
| --- | --- | --- |
| Playground | `node scripts/check-playground.mjs` | 203 / 0 (2 skipped) |
| Runtime models | `node scripts/check-runtime-models.mjs` | 24 / 0 |
| Sessions layout | `node scripts/check-sessions-layout.mjs` | 54 / 0 |
| Chat normalize | `node scripts/check-chat-normalize.mjs` | 21 / 0 |
| Chat isolation | `node scripts/check-chat-isolation.mjs` | 20 / 0 |
| Chat attachments | `node scripts/check-chat-attachments.mjs` | 61 / 0 |
| Chat multimodal | `node scripts/check-chat-multimodal.mjs` | 26 / 0 |
| UI interactions | `node scripts/check-ui-interactions.mjs` | 47 / 0 |
| Token usage | `npm run check:token-usage` | 88 / 0 |
| Skills | `node scripts/check-skills.mjs` | 123 / 0 |
| n8n | `node scripts/check-n8n-integration.mjs` | 28 / 0 |
| Agent session | `node scripts/agent-session-regression.mjs` | 452 / 0 |
| Types | `npx tsc --noEmit` | clean |
| Lint | `npx eslint .` | clean |
| Build | `npx next build` | success |

New check scripts registered in `package.json`: `check:chat-attachments`,
`check:chat-multimodal`, `check:runtime-models`, `check:sessions-layout`,
`check:agent-session`.

---

## 8. Follow-up integration verification (round 2)

The first round proved the five fixes with **deterministic** suites (mock file
API, mock provider). This round closes the integration gaps the brief called out:
real filesystem, real local models, and the deep-link first-paint concern.

### 8.1 Real file operations, end to end, in a disposable workspace

New: `scripts/check-agent-session-files-e2e.mjs` (`npm run check:files-e2e`) →
**34 passed, 0 failed**.

What is **real** here: the file operations route
(`src/app/api/agent-session/files/route.ts`), the workspace resolution and the
**filesystem** — all pointed at a fresh OS temp directory via
`AGENT_SESSION_WORKSPACE`. What is **mocked**: only the model's chat reply (a
scripted `tool` block); the file transport is bridged in-process. The live
project workspace and history are never touched.

- Part A drives the **real route** against **real disk**: write → read → list →
  edit → delete, plus the safety boundary (path escape, `.env`, `node_modules`,
  `db/`, the edit-mode gate, read-secret refusal). Every assertion is
  cross-checked with `fs` on the temp directory.
- Part B drives the **real Sessions runtime** (`startAgentSession`) through the
  real route and asserts on disk: `notebook.md` is created with `success`, read
  back, updated to `success\nupdated`, deleted, and an unnamed create lands on
  the deterministic `notebook.md` safe default while the model's invented name is
  never written.

**Defect found and fixed by this test:** the Coder agent's system prompt tells the
model to emit `delete_file`, but `delete_file` was **not** in its tool allow-list
(`src/lib/agent-hub/agent-session.ts`). `runGuidedStep` therefore refused the
call, the model's block was ignored, and the run could finish "completed" without
deleting anything — a "claims success without acting" bug. Fixed by adding
`delete_file` to the Coder's tools; the `code` capability already listed it. The
B4 delete case now passes end to end. Locked in with `T65a–c` in
`scripts/agent-session-regression.mjs` (**455 / 0**).

### 8.2 Real local-model capabilities (live inference)

New: `scripts/check-live-local-models.mjs`
(`npm run check:live-local-models`) → **9 passed, 0 failed, 0 skipped** against a
live LM Studio. Requests are `stateless`, so shared Chat history is untouched. A
real PNG is generated in-script (no fixture), so the vision check has real pixels.

| Check | Model | Result |
| --- | --- | --- |
| V1 image understanding | `qwen/qwen3.5-9b` (vlm) saw a solid-red 96×96 PNG | PASS (replied "red") |
| V2 serving model reported | same | PASS |
| V3 no false vision warning | same | PASS |
| V4 text-only model refuses an image | `qwen_qwen3-4b-instruct-2507` | PASS (400 + vision-model suggestion) |
| T1 prompt-guided thinking | `qwen_qwen3-4b-instruct-2507`, effort high | PASS (mode `prompt`, not native) |
| T2/T3 answer quality | same | PASS (sheep puzzle → 9) |
| T4 native reasoning accepted | `openai/gpt-oss-20b`, effort high | PASS (mode `native`) |
| T5 native reasoning answers | same | PASS (19×23 → 437) |

Provider-side hiccups (LM Studio returning empty-body `400`s while hot-swapping
models under memory pressure) are reported as honest **SKIPs**, never false
passes; the app surfaces them as a truthful 500, which is correct.

### 8.3 Deep-link initialization

**Finding (corrects the earlier note):** the store uses **no** zustand `persist`,
so there was no rehydration race. Deep links (`?view=…` / `#…`) *do* apply —
they simply need hydration to complete, and the earlier observation was taken
before mount. There was one latent risk: the URL-writing effect could transiently
overwrite a deep link with the default view before the URL had been applied.

**Hardening:** extracted the parsing into a pure, testable helper
`src/lib/agent-hub/view-url.ts` (`resolveViewFromDeepLink`, `isViewId`,
`VIEW_IDS`) and guarded the shell's URL write with `urlSyncedRef` so it cannot
clobber a deep link before it is applied (`src/components/agent-hub/shell.tsx`).

- New `scripts/check-deep-links.mjs` (`npm run check:deep-links`) → **15 passed,
  0 failed**, including a cross-check that the shell's `NAV` and the view-id
  contract stay in sync.
- **Live browser**: opened `?view=playground|sessions|chat|models|agents` in
  fresh tabs and confirmed each renders the requested view (active sidebar item +
  view-specific marker) after hydration, with the URL preserved.

### 8.4 Round-2 quality gate

| Check | Command | Result |
| --- | --- | --- |
| Files e2e (real FS) | `npm run check:files-e2e` | 34 / 0 |
| Live local models | `npm run check:live-local-models` | 9 / 0 |
| Deep links | `npm run check:deep-links` | 15 / 0 |
| Agent session | `npm run check:agent-session` | 455 / 0 |
| Playground | `npm run check:playground` | 203 / 0 (2 skipped) |
| Chat attachments | `npm run check:chat-attachments` | 61 / 0 |
| Chat multimodal | `npm run check:chat-multimodal` | 26 / 0 |
| Runtime models | `npm run check:runtime-models` | 24 / 0 |
| Sessions layout | `npm run check:sessions-layout` | 54 / 0 |
| UI interactions | `npm run check:ui` | 47 / 0 |
| Chat isolation / normalize | `check:chat-isolation` / `check:chat-normalize` | 20 / 0 · 21 / 0 |
| Token usage / Skills / n8n | `check:token-usage` / `check:skills` / `check:n8n` | 88 / 0 · 123 / 0 · 28 / 0 |
| Types / Lint / Build | `npx tsc --noEmit` · `npx eslint .` · `npx next build` | clean · clean · success |

New scripts registered in `package.json`: `check:files-e2e`,
`check:live-local-models`, `check:deep-links`.

### 8.5 Updated limitations

- The real-filesystem test mocks the **model reply** (the file route and disk are
  real); model behaviour against the real pipeline is covered separately by the
  live checks in §8.2.
- The live checks depend on the local provider being reachable and willing to
  serve/load a model; when it is not, they **SKIP with the real reason** rather
  than fabricate a result.
- Vision capability remains a heuristic (`type === 'vlm'` or known id patterns);
  §8.2 confirms it works for the tested models, not for every possible model.

### 8.6 Commit status (round 2)

Still **nothing pushed** (`origin` is a local bare backup repo). These changes are
committed locally on `qa/full-app-audit` on top of the `79f15b7` rollback point.

## 9. Round 3 — Playground Split workspace architecture (79f15b7 UX follow-up)

The learner-visible defect: in Split mode the editor occupied most of the
workspace and the AI Response was squeezed/clipped into a narrow right column.

### 9.1 Root cause (reproduced live at 1650×927)

1. The editor column was `flex flex-1` **without `min-w-0`**, so its automatic
   minimum size was the min-content width of the CodeMirror content
   (`white-space: pre`); a single 200-character line measured ≈1648px.
2. The workspace flex row then overflowed (`clientWidth 1393` vs
   `scrollWidth 2182`) instead of letting the editor scroll horizontally.
3. The AI Response aside was the **last, fixed-width** flex child
   (`flex-none w-[380px]/440/520px`), so the overflow pushed it out of the
   shell's clipped full-height `main` (`overflow-x: hidden`) — the "narrow
   clipped AI Response" image. Setting `min-width: 0` on the editor column in
   the live DOM restored a correct fit, proving the mechanism.

### 9.2 New architecture

- `src/components/agent-hub/playground/split-layout.ts` — pure contract:
  response-share clamp (25–62%), default 42% (~58/42 editor/response),
  `splitGridTemplate()` → `minmax(340px, Nfr) 12px minmax(360px, Mfr)`
  (pixel floors, ***no fixed-width column***), side-by-side threshold 820px of
  **measured workspace width**, and an external store (`useSyncExternalStore`)
  with localStorage persistence (`agenthub.playground.split`) that keeps the
  server render deterministic (`getServerResponseShare`).
- `src/components/agent-hub/playground/split-divider.tsx` — the 12px middle
  track: draggable (pointer capture, rAF-throttled, touch-none, selection
  suppressed), keyboard adjustable (ArrowLeft/ArrowRight ±4%, Home = default),
  double-click resets; `role="slider"` with value semantics.
- `playground-view.tsx` — the workspace is a **measured** (ResizeObserver)
  container: CSS grid with floored tracks when wide enough (~58/42), stacked
  columns below 820px (laptop split windows, tablets, mobile — decided by the
  content canvas, not the viewport, so the sidebar cannot lie about space);
  Code / AI Response / Split keep swapping hidden panes without consuming
  space; both panes carry `min-w-0` so long code scrolls **inside** CodeMirror.
- `feedback-panel.tsx` — pane safe: `min-w-0` root and content wrapper,
  `overflow-wrap: anywhere` for prose/list/table text, shrink-0 header
  controls, truncated model metadata with a `title` tooltip; code blocks and
  tables keep scrolling inside their own containers.

### 9.3 Verification

- Static: `check:playground` **231/0** (+14 new split-layout checks,
  incl. template exact strings, floors fitting under the threshold, external
  store semantics), `check:ui` **56/0** (fixed-width column contract replaced
  by the floored-grid + divider contract), `tsc` clean, `eslint` clean,
  `next build` success.
- Browser (iframe viewport harness, real app at localhost:3000, real DOM
  measurements at 1650×927 / 1366×768 / 1024×768 / 900×700 / 768×1024 /
  390×844):
  - 1650: default split `801px | 12px | 580px` (58/42); with a 200-char code
    line the row **no longer overflows** (`scrollW == clientW`), the line
    scrolls inside CodeMirror (`scrollWidth 1648 > clientWidth 799`), response
    stays fully visible; dragging the divider -120px moves the split to
    677/704 and persists `0.5069…`; ArrowLeft/Right step ±4% (0.55 → 0.51 →
    0.47) and persist; double-click restores 0.42; switching response/code/
    split preserves the editor document (all 366 chars) and the active result.
  - 1366: 639/463 columns; 900: 480/360 (the 360px response floor engages);
    1024 (cramped `lg` canvas due to the sidebar): **stacked** by measurement;
    768/390: stacked, full-width sections.
  - Real analysis action (LM Studio offline at test time): the real provider
    error renders cleanly in the pane and a completed action auto-opens AI
    Response at full width; error article right edge flush with the pane.
  - Rich-content contract in the real 580px pane (representative DOM probe):
    200+-char URL **wraps**, wide table and long code line scroll inside their
    own containers, pane never stretches, bottom controls reachable, long
    model name truncates with a hover title.

### 9.4 Limitations

- Live LM Studio was offline during the final browser pass, so a *successful*
  real-model response could not be screenshot-verified; the error path was
  verified live and the model-success rendering path is unchanged by this
  layout work (same panel, same entry shape; content CSS contract verified via
  the probe above).
- The real-*viewport* screenshots came from the desktop browser pane plus the
  same-origin iframe harness (no device-emulation tool in this environment);
  all numbers quoted are real iframe-viewport (`w×h`) measurements, not
  estimates.

### 9.5 Commit status (round 3)

Still **nothing pushed**. Committed locally on `qa/full-app-audit` on top of
`7e3d4ef`; the temporary `public/__viewport-harness.html` measurement harness
was removed before the commit.
