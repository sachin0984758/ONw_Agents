#!/usr/bin/env node
// ── UI interaction checks ─────────────────────────────────────────────────────
//   node scripts/check-ui-interactions.mjs
//
// Guards the interaction-layer fixes that came out of the UI/UX audit:
//
//   · every AgentHub view uses the shared portal-based HubSelect instead of a
//     raw native <select> (native popups have no max height, no collision
//     handling and cover the working area — the Playground model selector bug)
//   · HubSelect renders in a portal, caps its height to the available viewport
//     space, scrolls internally, clamps its width and respects Radix's
//     "item value must not be empty" rule via an internal sentinel
//   · the Playground toolbar is split into an identity row and a config row so
//     long model names / practice titles cannot squeeze the editor
//   · the header search list scrolls instead of overflowing the viewport
//   · the shared select actually renders (real server-side render of the
//     component — not a source-string guess)
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(path.join(ROOT, 'package.json'))
const BUILD_DIR = path.join(ROOT, '.tmp-ui-check')

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(name) {
  console.log(`\n── ${name} ──`)
}

const read = (rel) => fs.readFile(path.join(ROOT, rel), 'utf-8')

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await walk(rel)))
    else out.push(rel)
  }
  return out
}

try {
  await fs.rm(BUILD_DIR, { recursive: true, force: true })
  await fs.mkdir(BUILD_DIR, { recursive: true })
  const walkTsx = (await walk('src/components')).filter((p) => p.endsWith('.tsx'))

  section('0. Idle mascot remains visible')
  const globalStyles = await read('src/app/globals.css')
  ok('idle mascot remains fully opaque and near full size outside hover and keyboard focus', /\.agent-mascot-anchor\[data-active="false"\]:not\(:hover\):not\(:focus-within\) \.agent-mascot\s*\{[^}]*opacity:\s*1[^}]*transform:\s*scale\(\.9\)/s.test(globalStyles))
  ok('mascot becomes fully visible on hover and keyboard focus', /\.agent-mascot-anchor\[data-active="false"\]:hover \.agent-mascot[\s\S]*?\.agent-mascot-anchor\[data-active="false"\]:focus-within \.agent-mascot\s*\{[^}]*opacity:\s*1;\s*transform:\s*scale\(1\)/s.test(globalStyles))

  section('0b. Chat response depth is independent and persisted')
  const chatSettings = await read('src/lib/agent-hub/chat-settings.ts')
  const chatView = await read('src/components/agent-hub/chat-view.tsx')
  const chatRoute = await read('src/app/api/chat/route.ts')
  ok('four response depth levels have a backwards-compatible standard default', /RESPONSE_DEPTHS: ResponseDepth\[\] = \['concise', 'standard', 'detailed', 'comprehensive'\]/.test(chatSettings) && /responseDepth: 'standard'/.test(chatSettings))
  ok('response depth is validated when settings load from storage', /RESPONSE_DEPTHS\.includes\(parsed\.responseDepth as ResponseDepth\)/.test(chatSettings))
  ok('Chat exposes an accessible independent response-depth picker', chatView.includes('data-testid="chat-response-depth-button"') && chatView.includes('aria-label="Response depth"') && chatView.includes('Choose how much explanation to show. This does not change thinking effort.'))
  ok('selected response depth reaches the route and changes only the answer instruction', chatView.includes('responseDepth: selectedSettings.responseDepth') && chatRoute.includes('responseDepthPromptSuffix(responseDepth)'))

  section('1. Native selects are gone from every view')
  const offenders = []
  for (const rel of walkTsx) {
    if (rel.endsWith('hub-select.tsx')) continue
    const src = await read(rel)
    // Ignore matches inside comments so a doc comment can mention <select>.
    const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    if (/<select[\s>]/.test(withoutComments)) offenders.push(rel)
  }
  ok('no raw <select> remains in src/components', offenders.length === 0, offenders.join(', '))

  section('2. Shared HubSelect is adopted across the app')
  const HUB_USERS = {
    'src/components/agent-hub/playground-view.tsx': './hub-select',
    'src/components/agent-hub/chat-view.tsx': './hub-select',
    'src/components/agent-hub/tracked-sessions.tsx': './hub-select',
    'src/components/agent-hub/teaching/teaching-panel.tsx': '../hub-select',
    'src/components/design-studio/designer-panel.tsx': '../agent-hub/hub-select',
  }
  for (const [rel, spec] of Object.entries(HUB_USERS)) {
    const src = await read(rel)
    ok(`${rel} imports HubSelect`, src.includes(`from '${spec}'`))
  }

  section('3. HubSelect contract (portal, collision, height, width, sentinel)')
  const hub = await read('src/components/agent-hub/hub-select.tsx')
  ok('built on @radix-ui/react-select', hub.includes("@radix-ui/react-select"))
  ok('content renders in a portal (never clipped by ancestors)', hub.includes('SelectPrimitive.Portal'))
  ok('avoidCollisions is enabled', hub.includes('avoidCollisions'))
  ok('collisionPadding keeps a viewport gutter', hub.includes('collisionPadding'))
  ok('height is capped to available space', hub.includes('--radix-select-content-available-height'))
  ok('long lists scroll internally', hub.includes('overflow-y-auto'))
  ok('width is clamped to the viewport', hub.includes('100vw'))
  ok('empty-string values are mapped to a sentinel', hub.includes('__hub_select_empty__') && hub.includes('toRadix'))
  ok('sentinel values are mapped back on selection', hub.includes('fromRadix'))
  ok('items are found even inside groups', hub.includes('collectLabels'))
  ok('trigger text truncates long values', hub.includes('truncate'))

  section('4. Playground toolbar + editor space')
  const pg = await read('src/components/agent-hub/playground-view.tsx')
  ok('toolbar keeps its test id', pg.includes('data-testid="playground-toolbar"'))
  ok('practice selectors live on their own config row', pg.includes('data-testid="playground-config"'))
  ok('config row spans a full line', /flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2/.test(pg))
  ok('model trigger has a bounded, wrap-safe width', pg.includes('w-full min-w-0 sm:w-[16rem]'))
  for (const id of ['language-select', 'level-select', 'model-select', 'dialect-select', 'workbook-select']) {
    ok(`playground ${id} still present`, pg.includes(`data-testid="${id}"`))
  }
  ok('playground selects are HubSelect', pg.includes('onValueChange={requestLanguage}') && pg.includes('onValueChange={setModelId}') && pg.includes('onValueChange={requestWorkbook}'))
  ok(
    'editor keeps a flexible, clipped surface with the optional interactive background',
    pg.includes('min-h-0 flex-1 overflow-hidden rounded-md border') &&
      pg.includes("interactiveBackground ? 'bg-card/50' : 'bg-card'"),
  )
  ok(
    'workspace remains split without retired layout mode controls',
    pg.includes('data-workspace-mode="split"') &&
      !['workspace-mode-code', 'workspace-mode-response', 'workspace-mode-split'].some((id) => pg.includes(`data-testid="${id}"`)),
  )
  ok(
    'editor and response guidance occupy the same split workspace',
    pg.includes('data-testid="playground-workspace"') &&
      pg.includes('<CodeEditor') &&
      pg.includes('<FeedbackPanel') &&
      pg.includes('<RoadmapTutorPanel'),
  )
  // ── Split workspace: measured grid + adjustable divider ──
  const splitLayout = await read('src/components/agent-hub/playground/split-layout.ts')
  const divider = await read('src/components/agent-hub/playground/split-divider.tsx')
  const fbp = await read('src/components/agent-hub/playground/feedback-panel.tsx')
  ok(
    'split layout follows the measured workspace, not the viewport',
    pg.includes('isSideBySideWidth(workspaceWidth)') &&
      pg.includes('ResizeObserver') &&
      splitLayout.includes('MEASURED workspace'),
  )
  ok(
    'split panes are floored grid tracks (long code cannot push the response out)',
    pg.includes('gridTemplateColumns: splitGridTemplate(splitShare)') &&
      pg.includes("gridTemplateRows: 'minmax(0, 1fr)'") &&
      splitLayout.includes('minmax(${MIN_EDITOR_PANE_PX}px, ${editorFr}fr)') &&
      splitLayout.includes('minmax(${MIN_RESPONSE_PANE_PX}px, ${responseFr}fr)'),
  )
  ok(
    'both split panes can shrink below their content (min-w-0)',
    pg.includes('min-h-0 min-w-0 flex-col gap-2') && fbp.includes('flex min-h-0 min-w-0 flex-col gap-2'),
  )
  ok(
    'the fixed-width comparison column is gone entirely',
    !pg.includes('lg:w-[380px]') &&
      !pg.includes('xl:w-[440px]') &&
      !pg.includes('2xl:w-[520px]') &&
      !pg.includes('lg:flex-none') &&
      !/(^|[^-\w])flex-none/.test(pg.replace(/sm:flex-none/g, '')),
  )
  ok(
    'the divider is a keyboard-reachable slider between the panes',
    divider.includes('role="slider"') &&
      divider.includes('aria-orientation="vertical"') &&
      divider.includes('tabIndex={0}') &&
      divider.includes('data-testid="split-divider"') &&
      pg.includes('{sideBySide ? (') &&
      pg.includes('<SplitDivider'),
  )
  ok(
    'the divider drags with pointer capture (rAF-throttled)',
    divider.includes('setPointerCapture') && divider.includes('requestAnimationFrame'),
  )
  ok(
    'divider keyboard + double-click restore the default split',
    divider.includes('ArrowLeft') &&
      divider.includes('ArrowRight') &&
      divider.includes("'Home'") &&
      divider.includes('DEFAULT_RESPONSE_SHARE'),
  )
  ok(
    'split share flows through an external store and persists in localStorage',
    splitLayout.includes("SPLIT_STORAGE_KEY = 'agenthub.playground.split'") &&
      pg.includes('useSyncExternalStore(') &&
      pg.includes('setResponseShare(next, false)') &&
      pg.includes('onCommit={(share) => saveResponseShare(share)}') &&
      splitLayout.includes('getServerResponseShare'),
  )
  ok(
    'narrow workspaces stack instead of squeezing two columns',
    pg.includes("sideBySide ? 'grid' : 'flex flex-col'") &&
      pg.includes("data-split-layout={sideBySide ? 'columns' : 'stacked'}"),
  )
  ok(
    'response content wraps instead of overflowing its pane',
    fbp.includes('[&_td]:[overflow-wrap:anywhere]') && fbp.includes('min-w-0 max-w-4xl'),
  )
  ok('model metadata keeps a hover title when truncated', fbp.includes('title={active.model}'))
  ok('no native select attributes remain', !pg.includes('<select') && !pg.includes('optgroup'))

  section('5. Header search list cannot overflow the viewport')
  const shell = await read('src/components/agent-hub/shell.tsx')
  ok('search menu has a max height', shell.includes('max-h-80'))
  ok('search menu scrolls internally', /hub-scroll absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto/.test(shell))

  section('6. Playground sessions menu stays bounded + scrollable')
  ok('sessions menu caps height', pg.includes('max-h-80'))
  ok('sessions menu scrolls internally', pg.includes('hub-scroll max-h-80 overflow-y-auto'))

  section('7. Existing Radix select in Settings is untouched')
  const settings = await read('src/components/agent-hub/settings-view.tsx')
  ok('settings still uses the shadcn Radix select', settings.includes("@/components/ui/select"))

  section('8. Real server-side render of the shared select')
  try {
    const utilsSrc = await read('src/lib/utils.ts')
    await fs.writeFile(
      path.join(BUILD_DIR, 'utils.js'),
      ts.transpileModule(utilsSrc, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText,
      'utf-8',
    )
    const schemeSrc = await read('src/components/agent-hub/conversation-color-scheme.tsx')
    await fs.writeFile(path.join(BUILD_DIR, 'conversation-color-scheme.js'), ts.transpileModule(schemeSrc, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText, 'utf-8')
    // CSS is bundled by Next in production; this check renders structure only.
    await fs.writeFile(path.join(BUILD_DIR, 'conversation-profile.module.css.js'), 'module.exports = { theme: "conversation-theme" };', 'utf-8')
    const hubOut = ts.transpileModule(hub.replace(/@\/lib\/utils/g, './utils').replace('./conversation-profile.module.css', './conversation-profile.module.css.js'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText
    await fs.writeFile(path.join(BUILD_DIR, 'hub-select.js'), hubOut, 'utf-8')

    const React = req('react')
    const { renderToStaticMarkup } = req('react-dom/server')
    const { HubSelect, HubSelectItem } = req(path.join(BUILD_DIR, 'hub-select.js'))

    const html = renderToStaticMarkup(
      React.createElement(
        HubSelect,
        { value: '', placeholder: 'Pick a model', ariaLabel: 'Local model', 'data-testid': 'model-select', id: 'demo' },
        React.createElement(HubSelectItem, { value: 'alpha' }, 'Alpha model'),
        React.createElement(HubSelectItem, { value: 'beta' }, 'Beta model'),
      ),
    )
    ok('renders a combobox trigger', html.includes('role="combobox"'))
    ok('carries the test id', html.includes('data-testid="model-select"'))
    ok('carries the accessible name', html.includes('aria-label="Local model"'))
    ok('shows the placeholder when nothing matches', html.includes('Pick a model'))
    ok('closed by default (no floating panel in markup)', !html.includes('radix-select-content'))
    // Radix renders a hidden native <select> for form submission / mobile a11y;
    // what matters is that no *visible* native select is rendered.
    const visibleNativeSelect = /<select(?![^>]*aria-hidden)/.test(html)
    ok('no visible native <select> is rendered', !visibleNativeSelect)

    const html2 = renderToStaticMarkup(
      React.createElement(
        HubSelect,
        { value: '', ariaLabel: 'Auto', id: 'demo2' },
        React.createElement(HubSelectItem, { value: '' }, 'Auto (first available local model)'),
      ),
    )
    ok('empty-string value resolves to its real item label', html2.includes('Auto (first available local model)'))
  } catch (err) {
    ok('server-side render of HubSelect', false, err && err.message ? err.message : String(err))
  }

  console.log(`\n──────────────────────────────────────────`)
  console.log(`  ${pass} passed, ${fail} failed`)
  if (failures.length) {
    console.log('\nFailures:')
    for (const f of failures) console.log(`  · ${f}`)
  }
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  await fs.rm(BUILD_DIR, { recursive: true, force: true })
}
