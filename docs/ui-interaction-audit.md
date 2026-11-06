# AgentHub — UI / interaction-aware layout audit

Branch: `qa/full-app-audit` · Scope: whole application (all views, shared layout, menus,
dropdowns, panels, forms) · Method: static inspection **plus** live browser verification.

This document records what was inspected, the real defects that were found, their root
causes, the smallest coherent shared fixes, the responsive/interaction tests that were
run, the regressions that were re-checked, and what could **not** be verified.

---

## 1. Scope and method

The requirement was an *interaction-aware layout* pass, not a redesign: keep the visual
identity, the local-model integration, the agent runtime, persistence and the safety
controls; fix cramped/competing controls, dropdowns that cover the working area, and
clipped or overflowing expanded content.

Two passes were used and are reported separately throughout:

- **Static inspection** — reading every view/component and the shared UI primitives,
  building a per-view inventory of interaction states, and tracing layout/CSS causes.
- **Runtime / browser verification** — driving the running app with the automation
  browser, opening the real menus, measuring the real geometry, and reading computed
  styles. Anything not marked *runtime* below is static-only.

The all-views inventory was produced first (an exploration pass over
`src/components/agent-hub/**` and `src/components/design-studio/**`), then the shared
causes were fixed once and re-tested across views.

---

## 2. Inventory of interactive surfaces

| View / area | Interactive surfaces inspected |
| --- | --- |
| Shell (header/sidebar) | nav buttons + badges, mobile drawer, header search box with live results dropdown, theme switcher |
| Overview | metric cards, Open Workspace / Open Agent API buttons |
| Chat | settings disclosure (model select, custom-model form, system prompt), Teach toggle, Settings toggle, Clear-chat confirm, message actions (copy/retry), activity/plan/files drawer, composer |
| Agents | agent list rows, agent detail/expanded sections, add-agent form |
| Sessions | four-panel grid (Workspace, Coding sessions, Tracked sessions, Controls & Team), exclusive expansion, tracked-session reassign, Teaching panel, Design Studio panel, dedicated chat + composer, tool-activity drawer |
| Code Graph | canvas + zoom/filter controls, node detail |
| Plan / Tasks | task rows, status controls, expandable detail |
| Changes | staged/unstaged lists, stage/unstage actions |
| Playground | toolbar (title, practice name, Language/Level/Model, New, Sessions menu), problem statement, CodeMirror editor controls, action toolbar, feedback panel + collapsible details, save/reset, SQL dialect + sample schema, Excel workbook + grid + formula bar |
| Models | provider/model lists, long model names/ids, actions |
| Workflows | workflow editor nodes, selected-node panel (title/subtitle/**service select**), n8n gallery (search, **category select**, kind filters, import) |
| Settings | Radix select + switches (runtime enforcement), forms |
| Agent API | endpoint rows, token/snippet blocks |
| Design Studio (via Sessions) | template thumbnails, Theme/Typography/Navbar/Hero/Buttons/Cards selects, per-section variant selects, add-section select |

Interaction-state coverage recorded per view: closed/open dropdowns, selectors, search +
suggestions, context/overflow menus, toolbars, accordions/expandable cards, detail
panels/drawers, tabs/segmented controls, confirmations, forms + validation, long lists,
loading/error, code-editor controls, expanded team/agent details, multi-step config, and
empty/populated states.

---

## 3. Shared root causes

1. **Native `<select>` used for every selector (19 instances across 7 files).** A native
   select hands its popup to the operating system: there is no maximum height, no viewport
   collision handling, no internal scrolling and no consistent styling. A long option list
   (the Playground **model** selector) therefore covered the editor underneath it — the
   exact reported symptom. Radix primitives existed in the repo but were used only in
   Settings.
2. **Inline absolutely-positioned menus with no height cap.** The header search results
   panel was `absolute … overflow-hidden` with **no `max-height`**, so a long result list
   could run past the viewport.
3. **Fixed/cramped toolbar composition in Playground** where the identity row, the
   practice-name input and three selectors competed for one flex line, and the model select
   was width-clamped with no way to inspect a long name.
4. **No dialogs/drawers exist** anywhere under `agent-hub`/`design-studio` — confirmations
   are inline two-step banners. This is a *missing feature*, not a layout defect, and was
   deliberately not invented.

---

## 4. Defects found, root cause, fix

### D1 — Playground model selector covered the editor (high)
- **Root cause:** native `<select>` (OS popup, unbounded height).
- **Fix:** replaced with the shared portal-based `HubSelect` (Radix). The panel is rendered
  in a `body`-level **portal** (never clipped by the full-height `main { overflow:hidden }`),
  is height-capped to the space actually available, scrolls internally, and flips/shifts to
  stay inside the viewport.

### D2 — Every other selector had the same class of bug (high, app-wide)
- **Sites migrated (19):** Playground (language, level, model, dialect, workbook), Chat
  (model), Tracked sessions (reassign), Workflows (node service), n8n gallery (category),
  Teaching (subject, level), Design Studio (8 variant selects).
- **Fix:** all now use `HubSelect`, with grouping, disabled items, keyboard navigation,
  focus/selected states and accessible names preserved.

### D3 — Header search results could overflow the viewport (medium)
- **Root cause:** results panel had `overflow-hidden` but no `max-height`.
- **Fix:** `max-h-80 overflow-y-auto` + styled scrollbar (`hub-scroll`); the panel now
  scrolls instead of spilling.

### D4 — Playground toolbar was cramped and unbalanced (medium)
- **Fix:** the toolbar is now two explicit rows: row 1 = title + badge + practice name +
  primary actions (New, Sessions); row 2 = the Language / Level / Model controls with small
  visible labels. The practice selectors span the full width of row 2, so long model names
  or practice titles can never squeeze the identity row or the editor.

### D5 — Mobile model control could collapse and overflow (high, caught during runtime testing)
- **Root cause:** the model flex item had `flex-basis: 0` + `min-width: 0`, so `flex-wrap`
  considered it "fitting" at ~1px and the 13rem-wide control overflowed off-screen (frozen at
  `x≈409` in a 389px viewport), hidden by the ancestor `overflow:hidden`.
- **Fix:** the model item is full-width on its own line below `sm`, and a bounded `16rem`
  from `sm` up; because it is no longer basis-0 it *wraps* instead of overflowing. Verified
  at 390/768/900/1036/1366/1650 px: two rows on mobile, one row above, zero horizontal
  overflow, and the dropdown stays inside the frame.

### D6 — Long-text truncation in triggers (low)
- **Fix:** `HubSelect` triggers truncate the selected value (`truncate` + `min-w-0`), and the
  option labels are found even inside group elements, so a long model id shows an ellipsis in
  the trigger and the full text (with a `title`) in the list.

---

## 5. Shared component: `HubSelect`

`src/components/agent-hub/hub-select.tsx`

- Built on `@radix-ui/react-select`; content rendered via `SelectPrimitive.Portal`.
- `avoidCollisions` + `collisionPadding={8}` → flips/shifts to stay inside the viewport.
- `max-h-[min(18rem,var(--radix-select-content-available-height))]` + `overflow-y-auto` +
  `hub-scroll` → never taller than the space available, scrolls when long.
- Width: at least the trigger width, grows to fit long labels, clamped by
  `max-w-[min(30rem,calc(100vw-1.5rem))]` so it can never spill past the viewport edges.
- Radix forbids empty-string item values; several selectors use `''` to mean
  *Auto / None / Default*. `HubSelect` maps `''` to a private sentinel in both directions,
  and looks the current value up in the rendered items (including inside groups) so both
  "`''` is a real option" and "`''` means nothing selected" display correctly.
- Sizes (`xs`/`sm`/`default`) map the previous h-6/h-7/h-8 triggers; square-corner sites
  (tracked sessions) keep `rounded-none` via `className`.

Sibling primitives (`ui/dialog.tsx`, `ui/popover.tsx`, `ui/select.tsx`,
`ui/dropdown-menu.tsx`) were read and already portal + collision + height-capped; no change
was needed to them.

---

## 6. Responsive verification (runtime, measured)

Playground, measured in real frames (`innerWidth`/`innerHeight` ≈ the target):

| Viewport | Config rows | Horizontal overflow | Code/AI tabs | Editor width | Feedback width |
| --- | --- | --- | --- | --- | --- |
| 390 × 844 | 2 | 0 | shown | 355 | (tabbed, hidden) |
| 768 × 1024 | 1 | 0 | shown | 733 | (tabbed, hidden) |
| 900 × 700 | 1 | 0 | shown | 849 | (tabbed, hidden) |
| 1036 × 718 (window) | 1 | 0 | hidden | 423 | 360 |
| 1366 × 768 | 1 | 0 | hidden | 679 | 420 |
| 1650 × 927 | 1 | 0 | hidden | 898 | 480 |

The editor is the larger pane at every side-by-side size and grows with the viewport; the
feedback column is bounded (`lg:360 / xl:420 / 2xl:480`). No view had horizontal page
overflow (`documentElement.scrollWidth − clientWidth === 0`) at any tested size.

---

## 7. Interaction tests performed (runtime)

| Surface | Result |
| --- | --- |
| Playground model select | Opens in a `body > div` portal; panel rect fully inside viewport; `max-height: 288px`, `overflow-y: auto` |
| Playground language select (18 options) | Panel capped at 288px; Radix viewport `scrollHeight 647` vs `clientHeight 286` → **scrolls internally** |
| Playground model select — selection | Real click on an option updates the trigger text; Escape closes; **no listbox left mounted** after close |
| Playground model select — keyboard | `ArrowDown` opens and highlights the current item; `ArrowDown` moves the highlight; `Enter` applies the value |
| Chat model select | Portal, inside viewport, `max-h 288px`, 4 options; "+ Add Custom Model…" opens the Add-Custom form (behaviour preserved) |
| Workflows / n8n category select | 12 options, capped, `viewport scrollHeight > clientHeight` (scrolls), inside viewport; selecting filters the gallery |
| Settings select (pre-existing Radix) | Portal, inside viewport, 3 options |
| Design Studio (Sessions) | 11 comboboxes, **0 native selects**, no overflow; Theme select opens inside viewport |
| Sessions four-card grid | 4 `panel-card`s, all `rounded-none` (square corners preserved), 0 native selects, no overflow |

All opened panels were dismissed and the DOM confirmed clean afterwards. No new console
errors were produced by the changes.

---

## 8. Files modified

**Added**
- `src/components/agent-hub/hub-select.tsx` — shared portal-based select.
- `scripts/check-ui-interactions.mjs` — interaction-layer regression suite (see §9).

**Changed**
- `src/components/agent-hub/playground-view.tsx` — toolbar split into two rows; 5 native
  selects → `HubSelect`; model control made wrap-safe; feedback column bounded.
- `src/components/agent-hub/chat-view.tsx` — model select → `HubSelect` (grouped).
- `src/components/agent-hub/tracked-sessions.tsx` — reassign select → `HubSelect` (square).
- `src/components/agent-hub/workflows-view.tsx` — node service select → `HubSelect`.
- `src/components/agent-hub/n8n-gallery.tsx` — category select → `HubSelect`.
- `src/components/agent-hub/teaching/teaching-panel.tsx` — subject/level → `HubSelect`.
- `src/components/design-studio/designer-panel.tsx` — 8 selects → `HubSelect`.
- `src/components/agent-hub/shell.tsx` — header search results get `max-h-80` + internal scroll.
- `package.json` — added `check:ui` script.
- `scripts/check-playground.mjs` — updated one responsive assertion to the new (intended)
  feedback widths (`lg:360 / xl:420`).
- `scripts/check-sessions-layout.mjs` — corrected a **stale** assertion (see §10).

No changes to routes, state store, API contracts, persistence, permissions/approval gates,
AUTO/MANUAL selection, model assignments, cancellation, or verification logic.

---

## 9. New regression suite

`npm run check:ui` → `scripts/check-ui-interactions.mjs` (**44 checks, 0 failures**):

- no raw `<select>` remains anywhere in `src/components` (comments excluded);
- all 7 previously-native files import the shared `HubSelect`;
- `HubSelect` contract: Radix, portal, `avoidCollisions`, `collisionPadding`,
  available-height cap, `overflow-y-auto`, viewport width clamp, empty-value sentinel
  (both directions), grouped label lookup, trigger truncation;
- Playground: toolbar/config test-ids kept, config on its own full-width row, wrap-safe model
  width, all five selector test-ids present, editor surface + bounded feedback column;
- header search menu is height-capped and scrolls;
- **a real server-side render** of `HubSelect` (transpiled and executed) asserts it renders a
  `combobox` with the test id + accessible name, shows the placeholder when nothing matches,
  renders no *visible* native select, keeps its panel closed by default, and resolves an
  empty-string value to its real item label.

---

## 10. Regressions re-checked

| Suite | Result |
| --- | --- |
| `scripts/check-ui-interactions.mjs` | 44 / 0 |
| `scripts/check-playground.mjs` | 202 / 0 (186 / 0 + 2 skipped with the external mock provider stopped) |
| `scripts/check-sessions-layout.mjs` | 45 / 0 |
| `scripts/check-skills.mjs` | 123 / 0 |
| `scripts/agent-session-regression.mjs` | 417 / 0 |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npx next build` | succeeds (all routes compiled) |

**Stale test corrected.** `check-sessions-layout` asserted the pre-refactor shell ternary
(`view === 'chat' || view === 'sessions' ? …`). The shell has used
`FULL_HEIGHT_VIEWS = ['chat','sessions','playground']` since the earlier Playground commit,
so that assertion had been failing since then (confirmed against `HEAD`), not because of this
work. It now asserts the real contract. The Sessions four-card layout itself is unchanged.

---

## 11. Limitations / not verified

- **Viewport emulation.** The automation browser exposes no OS-level viewport resize, so the
  requested sizes were measured with same-origin **iframes** (a real browser layout at the
  real CSS width inside a frame) and, where possible, the real window (1036×718). The
  1650×927 / 1366×768 / 900×700 / 768×1024 / 390×844 sizes were covered this way rather than
  by resizing the top-level window.
- **Focus/blur events.** The automation window never has OS focus, so genuine focus/blur
  events cannot be produced. Keyboard behaviour was verified with synthetic `KeyboardEvent`
  dispatch plus real `Enter`/`Escape` via the automation input channel.
- **Non-Playground breakpoints.** Responsive frames were run for Playground only; other views
  were checked for horizontal overflow and (where present) dropdown placement at the live
  window size, not across all five sizes.
- **Provider-less states.** The model lists were exercised with a mock provider; the
  no-provider path was not re-driven end-to-end in the browser (it is covered by
  `check-playground`'s offline tests).
- **Pre-existing console noise.** One Next-internal warning ("Encountered a script tag while
  rendering React component") and a dev-only HMR WebSocket warning are present and unrelated
  to these changes; a single transient `502` on `/api/playground` occurred during a dev
  recompilation and did not reproduce (endpoint returns 200).
- No destructive tests were run against the live `db/`.

---

## 12. Summary

The audit found one app-wide root cause behind the Playground symptom: **every selector was
a raw native `<select>`**, whose OS popup has no height cap, no collision handling and no
internal scrolling, so long lists covered the working area. A single shared, portal-based
`HubSelect` now backs all 19 selectors across 7 files, giving correct placement, a
viewport-available height cap, internal scrolling, keyboard/focus behaviour and honest
selection display. The Playground toolbar was rebalanced into two coherent rows, the model
control was made wrap-safe (a mobile 1px-collapse bug found and fixed during runtime
testing), the editor keeps the majority of the space at every size, and the header search
list now scrolls instead of spilling.

All previously-native surfaces were migrated without changing behaviour, no dialogs were
invented where none exist (records as a missing feature, not a defect), and the four square
Sessions cards, the runtime, persistence, permissions and the local-model integration are
untouched. New suite `check:ui` (44 checks, including a real render of the shared select)
passes alongside every existing suite, `tsc`, `eslint` and `next build`.
