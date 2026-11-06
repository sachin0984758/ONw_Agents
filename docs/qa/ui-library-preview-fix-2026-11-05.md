# Downloaded component previews — verified 2026-11-05

The screenshots identified real missing previews. The downloaded component cards used a low-contrast code placeholder, and their dialog embedded the entire saved-template inspector without detail spacing. The previous HTTP/catalog check did not verify these views.

## Implemented

- All 18 downloaded components now have browser-rendered thumbnails from their actual saved source, local assets, and compiled Tailwind styles.
- The component dialog has separate Preview, Source, and Install tabs. View source and Install Component open their respective tabs. Template-wide controls no longer appear inside individual component details.
- Preview has desktop, tablet (768 px), and mobile (390 px) controls. Loading, compilation failures, rendering failures, and a 30-second timeout have readable states.
- The existing workspace review, conflict checks, approval, installation, and rollback backend is retained.
- Preview compilation reads source with the existing indexed-file and symlink checks. Esbuild processes source without importing it into Node; package scripts and repository build/configuration code are not executed. Browser dependencies resolve from AgentHub's installed packages, including in standalone-server mode.
- Frames use `sandbox="allow-scripts"` without same-origin, popup, top-navigation, or form privileges. CSP authorizes the exact bundled script by hash and blocks fetch connections, external assets, child frames, workers, forms, and media. Assets are embedded as data URLs. Next Image and Link have browser adapters. Headless UI modal behavior uses an explicitly identified custom preview adapter.
- Components requiring props receive labeled samples: video thumbnail, spotlight children, illustration wrapper, and dialog title/content/trigger. These samples are not edits to the saved sources.

## Evidence

- **18/18** real component bundles compiled and **18/18** displayed in the running browser. The dialog portal was verified under the iframe body rather than its empty React root.
- Downloaded Radix dialog close and reopen: passed. Video modal preview open and close: passed. Video playback remains disabled.
- Preview, Source, and Install tab navigation: passed. CTA mobile frame measured 390 px; tablet frame measured 768 px. Actual CTA, features, and hero thumbnails displayed in the grid.
- `npx tsx scripts/check-github-browser-previews.ts`: passed all 18 saved-source compilations, traversal rejection, CSP hash checks, hostile-source/config fixtures, and standalone working-directory regression. Fixture checks are separate from live browser rendering.
- `npx tsx scripts/check-marketplace-ui.tsx`: **18 passed**.
- `npx tsx scripts/check-ui-components.ts --github-saved`: **119 passed**, including all 18 actual standalone installations and rollback in compatible temporary test projects, plus 68-file and 32-file template copying. These were not installations into the user's registered workspaces.
- Whole-project typechecking: passed. Targeted strict ESLint: passed.
- Final production build: `NEXT_DIST_DIR=.next-ui-preview-webpack RAYON_NUM_THREADS=2 npm run build -- --webpack` passed without warnings. All 25 pages generated.
- Built standalone server on temporary loopback port 3017: page returned HTTP 200; CTA, workflows, and downloaded dialog preview API requests returned `ok: true` and generated documents. Temporary server stopped afterward.
- Development app remains at `http://localhost:3000/?view=ui-components`, HTTP 200.
- Screenshots: `output/ui-preview-fix/library-thumbnails.png`, `output/ui-preview-fix/component-preview.png`. Live component results: `output/ui-preview-fix/live-results.json`.

## Limits

Browser component previews do not run Next.js server routes or full repository build scripts. External navigation, YouTube embeds, and video playback are disabled. Next.js Image optimization and server behavior are not reproduced. Fonts may use local system fallbacks. Full-template isolated builds remain a separate feature; this fix does not claim either featured template has a successful full-template build.

The default Turbopack production build failed twice in the native PostCSS worker with Windows exit code `0xc0000409` while evaluating `src/app/globals.css`, including with reduced Rayon threads. The Webpack production build and standalone API checks passed. The native Turbopack production failure is unresolved; production readiness is not claimed.

## Files changed for this fix

- `src/lib/agent-hub/marketplace/github-browser-preview.ts` (new compiler and adapters)
- `src/components/agent-hub/marketplace/github-component-preview.tsx` (new preview UI)
- `src/components/agent-hub/marketplace/local-components.tsx`
- `src/components/agent-hub/marketplace/github-templates-panel.tsx`
- `src/components/agent-hub/ui-components-view.module.css`
- `src/components/agent-hub/ui-components-view.tsx`
- `src/app/api/ui-components/route.ts`
- `next.config.ts` (external esbuild runtime package)
- `package.json` and `package-lock.json` (explicit esbuild and browser dialog dependencies)
- `scripts/check-github-browser-previews.ts` (new regression checks)
- This verification report

Existing downloaded templates, chat/MCQ/teaching settings, and unrelated working-tree changes were preserved. Nothing was committed or pushed.

## Follow-up: off-screen thumbnail timeout

The subsequent user report exposed a gap in the original verification: opening every component dialog did not exercise long-lived, off-screen thumbnails. In the running library, the Cruip modal video, page illustration, spotlight, testimonials, footer, and header thumbnails showed the 30-second rendering timeout while their dialogs worked.

The browser harness previously sent its ready message after two `requestAnimationFrame` callbacks. Browsers throttle animation frames in off-screen iframes, so the parent could time out and remove an otherwise functional preview. Readiness now comes from a React commit effect without waiting for animation frames. The rendering timeout restarts when the compiled document arrives, giving compilation and mounting their own time budgets.

Failed thumbnails now expose a Retry preview button. The thumbnail opener and retry control are sibling controls, avoiding nested buttons and preserving both interactions. Live scrolling through the unfiltered library loaded all 18 thumbnails with zero preview errors. All 18 remained ready after 62.873 seconds off-screen; none of their image elements reported a broken loaded image. Compiler/security checks for all 18 and the 18 UI checks were rerun successfully, as were typechecking and targeted strict lint. The live off-screen duration and final card/image states are recorded in `output/ui-preview-fix/offscreen-regression.json`; the later rows are pictured in `output/ui-preview-fix/recovered-thumbnails.png`.
