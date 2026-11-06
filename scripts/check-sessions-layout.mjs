#!/usr/bin/env node
// ── Sessions layout contract checks ──────────────────────────────────────────
//   node scripts/check-sessions-layout.mjs
//
// Structural invariants of the Sessions view (source-level, like the other
// check-* scripts). The behavioral items (exclusive card expansion, composer
// wiring, real runtime) are additionally exercised live in the browser; see
// the completion report. Static checks here:
//
//   1. Four compact control cards in a responsive grid (4-up desktop, 2-up
//      tablet, 1-up mobile) — workspace / coding-sessions / tracked-sessions /
//      controls-team — with exclusive single-panel expansion and Back.
//   2. Panel content is internally bounded (expansion cannot push the composer
//      off-screen and cannot nest page scrolling).
//   3. Cards are plain buttons (no nested interactive elements / valid HTML).
//   4. The composer submits through sendCodingMessage → startAgentSession
//      (real runtime), NOT the ordinary Chat API.
//   5. Plans, tool activity, diffs, verification and approvals remain rendered.
//   6. Other views are untouched by this change (chat-view et al. unmodified).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'fs'
import path from 'path'

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const ROOT = process.cwd()
const view = readFileSync(path.join(ROOT, 'src/components/agent-hub/sessions-view.tsx'), 'utf-8')
const shell = readFileSync(path.join(ROOT, 'src/components/agent-hub/shell.tsx'), 'utf-8')

// 1. Four-card grid + exclusive single-panel expansion
ok('no longer imports the stacked accordion', !view.includes('@/components/ui/accordion'))
ok('exactly four panels registered in the card registry', (view.match(/\{ id: PANEL_/g) ?? []).length === 4)
for (const id of ['workspace', 'coding-sessions', 'tracked-sessions', 'controls-team']) {
  ok(`card present: ${id}`, view.includes(`PANEL_${id.replace(/-/g, '_').toUpperCase()} = '${id}'`))
}
ok('cards render in a responsive grid (4-up desktop, 2-up tablet, 1-up mobile)', view.includes('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'))
ok('exactly one panel can be open (grid ⇄ expanded switch on activePanel)', /const activeCard = PANEL_CARDS\.find\(\(c\) => c\.id === activePanel\) \?\? null/.test(view))
ok('all four panels start collapsed (empty activePanel)', view.includes("useState<SessionsPanel>('')"))
ok('selecting a card opens its panel', view.includes('onClick={() => setActivePanel(c.id)}'))
ok('Back collapses to the four-card grid', view.includes('aria-label="Back to the four panels"') && view.includes("onClick={() => setActivePanel('')}"))
ok('other three cards are not rendered while one is open (exclusive branches)', view.includes('data-slot="panel-grid"') && view.includes('data-slot="panel-expanded"'))
ok('card headers carry an accessible label', view.includes('aria-label={`Open ${c.title} controls — ${headerSummaries[c.id]}`}'))
ok('expanded header keeps title + live summary + Back', view.includes('{activeCard.title}') && view.includes('{headerSummaries[activeCard.id]}'))
ok('card summaries come from live state (no hardcoded numbers)', /truncate text-\[11px\] text-muted-foreground">\{headerSummaries\[c\.id\]\}/.test(view))
ok('long paths/names cannot overflow cards (min-w-0 + truncate)', view.includes('group flex min-w-0 flex-col gap-1.5 rounded-none border bg-card/60 p-3 text-left'))

// 2. Bounded panel content + chat column
ok('expanded panel is capped + internally scrolled (composer can never be pushed off-screen by expansion)', /flex min-h-0 max-h-\[65%\] flex-col overflow-hidden rounded-none border bg-card/.test(view))
ok('expanded content scrolls internally (min-h-0 flex-1 overflow-y-auto)', view.includes('"hub-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3"'))
ok('chat occupies remaining height (flex-1 min-h-0)', /"flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card"/.test(view))
ok('message area scrolls internally (min-h-0 flex-1 overflow-y-auto)', /"hub-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4"/.test(view))
ok('composer is pinned in the card (border-t persistent section)', /border-t bg-card p-3/.test(view))
ok('details drawer bounded so it cannot push the composer', /max-h-\[min\(38vh,22rem\)\] overflow-y-auto/.test(view))
ok('details toggle always available when closed', view.includes('Activity &amp; verification'))

// 2b. Straight rectangular card geometry (radius 0), panel scope only
const tracked = readFileSync(path.join(ROOT, 'src/components/agent-hub/tracked-sessions.tsx'), 'utf-8')
// Panel-scoped slice: expanded panel subtree + four-card grid (TeamPanel included).
// Chat-area classes (drawer, checklist, StepRow…) are out of the panel scope.
const panelRegion = view.slice(view.indexOf('data-slot="panel-expanded"'), view.indexOf('{/* ── Dedicated chat'))
  + view.slice(view.indexOf('function TeamPanel'))
ok('grid cards are square (rounded-none, radius 0)', /rounded-none border bg-card\/60 p-3 text-left/.test(view))
ok('expanded panel container is square', /rounded-none border bg-card" data-slot="panel-expanded"/.test(view))
const chatCardCount = (view.match(/flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card/g) ?? []).length
ok('only the chat card keeps rounded styling (scope guard)', chatCardCount === 1)
ok('selector bars are rectangular', !/rounded-md border bg-secondary\/30 p-1/.test(panelRegion))
ok('session/team/tracked rows are rectangular',
  !/rounded-(md) border px-2 py-1\.5/.test(panelRegion) && !/rounded-md border px-2 py-1\.5 text-xs/.test(tracked))
ok('inputs inside the panels are square-ended', !/rounded-md border border-input bg-secondary\/50/.test(panelRegion))
ok('panel badges/chips are no longer pill-shaped',
  !/rounded-full border px-2|rounded-full bg-primary\/20|rounded-full bg-secondary|rounded-full border border-amber/.test(tracked)
  && !/shrink-0 rounded px-1\.5 py-0\.5/.test(panelRegion))
ok('tracked panel card is rectangular', tracked.includes('rounded-none border bg-card p-3') && !tracked.includes('rounded-lg'))
ok('workspace input is rectangular', view.includes('rounded-none border border-input bg-secondary/50 px-2.5 font-mono'))
ok('switches and dots keep their standard shapes (intentional)', /size-1\.5 shrink-0 rounded-full/.test(view) && /relative inline-flex h-4 w-7 shrink-0 items-center rounded-full/.test(view))

// 3. Cards are plain buttons — no nested interactive elements (valid HTML)
const gridBlock = view.slice(view.indexOf('data-slot="panel-grid"'), view.indexOf('{/* ── Dedicated chat'))
ok('each card is one plain button (no nested buttons/inputs inside)', (gridBlock.match(/<button/g) ?? []).length === 1 && !gridBlock.includes('<Button') && !gridBlock.includes('<input'))

// 4. Real Sessions runtime wiring
ok('composer handler calls sendCodingMessage', /sendCodingMessage\(msg\)|await sendCodingMessage/.test(view))
ok('composer does NOT post to the ordinary Chat API', !view.includes("'/api/chat'") && !view.includes('fetch(`${BASE}/api/chat`'))
ok('runtime cancel wired (cancelAgentSession on Stop)', view.includes('cancelAgentSession()'))

// 5. Plans / approvals / evidence remain rendered
ok('approval gate kept (resolveApproval true/false)', view.includes('resolveApproval(true)') && view.includes('resolveApproval(false)'))
ok('run plan + steps rendered (Run team, StepRow)', view.includes('Run team ·') && view.includes('<StepRow'))
ok('tool logs surfaced inside the live turn', view.includes('<WorkDisclosure') && view.includes('Worked for ${formatWorkedTime') && view.includes('recent.map('))
ok('verification + changed-file diffs kept', view.includes('task.verification') && view.includes('diffLines('))
ok('syntax-highlighted code + Copy kept', view.includes('highlightCode(') && /{copied \? /.test(view))

// 5b. Full-width conversation + complete code viewer (targeted UI fixes)
ok('conversation no longer pinned to a narrow centered column', !/mx-auto w-full max-w-3xl/.test(view) && !/max-w-3xl/.test(view.slice(view.indexOf('Dedicated chat'), view.indexOf('function DetailsBody'))))
ok('conversation keeps readable turns with plain assistant text', view.includes('mx-auto w-full max-w-4xl space-y-4') && view.includes('<ConversationTurn') && view.includes('turn.result'))
ok('each sessions code block offers an Expand / Full view action', view.includes('data-testid="code-expand"') && view.includes('data-testid="code-fullview"'))
ok('the full code view is a dismissible portal dialog', view.includes('createPortal(') && view.includes('role="dialog"') && view.includes('aria-modal="true"') && view.includes('data-testid="code-fullview-close"'))
ok('Escape closes the full code view', /e\.key === 'Escape'/.test(view))
ok('full code view scrolls both ways (no clipping)', /flex-1 overflow-auto p-3 font-mono text-xs/.test(view))
ok('code block body itself scrolls without clipping long files', /max-h-\[22rem\] overflow-auto p-2\.5 font-mono/.test(view))
ok('copied source is raw code only (clipboard gets `code`)', view.includes('navigator.clipboard?.writeText(code)'))
ok('a failed step shows its full reason (not truncated to a badge)', !/max-w-32 truncate text-\[10px\] text-red-600/.test(view) && view.includes('max-w-[45%] break-words text-[10px] text-red-600'))
ok('auto-scroll does not yank the user (stick-to-bottom guard)', view.includes('stickToBottom.current'))

// 6. Scope: other views untouched
const fullHeight = shell.match(/const FULL_HEIGHT_VIEWS: ViewId\[\] = \[([^\]]+)\]/)?.[1].match(/'[^']+'/g)?.sort().join(',')
ok('shell bounds the full-height views including Auto',
  fullHeight === "'agents','auto','chat','playground','sessions'"
  && shell.includes("FULL_HEIGHT_VIEWS.includes(view) ? 'h-screen overflow-hidden'"))
ok('shell leaves other views in page-scroll mode', !shell.includes("view === 'overview' ||"))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
