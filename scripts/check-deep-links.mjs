#!/usr/bin/env node
// ─── Deep-link view resolution ───────────────────────────────────────────────
// Regression test for src/lib/agent-hub/view-url.ts — the pure helper the shell
// uses to turn `?view=…` / `#…` into a view. No DOM, no network.
//
//   node scripts/check-deep-links.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const ROOT = process.cwd()

let passed = 0
let failed = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'deep-links-'))
try {
  const src = readFileSync(path.join(ROOT, 'src', 'lib', 'agent-hub', 'view-url.ts'), 'utf-8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  writeFileSync(path.join(dir, 'view-url.js'), out)
  const { resolveViewFromDeepLink, isViewId, VIEW_IDS } = require(path.join(dir, 'view-url.js'))

  console.log('\nDeep-link view resolution\n')

  // ── query string ──────────────────────────────────────────────────────────
  ok('D1 ?view=chat resolves to chat', resolveViewFromDeepLink('?view=chat', '') === 'chat')
  ok('D2 a bare ?view=playground resolves', resolveViewFromDeepLink('?view=playground', '') === 'playground')
  ok('D3 other params do not interfere', resolveViewFromDeepLink('?foo=1&view=models', '') === 'models')

  // ── hash fallback ─────────────────────────────────────────────────────────
  ok('D4 #sessions resolves to sessions', resolveViewFromDeepLink('', '#sessions') === 'sessions')
  ok('D5 query wins over hash', resolveViewFromDeepLink('?view=chat', '#sessions') === 'chat')

  // ── invalid / empty ───────────────────────────────────────────────────────
  ok('D6 an unknown view resolves to null', resolveViewFromDeepLink('?view=bogus', '') === null)
  ok('D7 an empty link resolves to null', resolveViewFromDeepLink('', '') === null)
  ok('D8 an empty query value falls back to the hash', resolveViewFromDeepLink('?view=', '#tasks') === 'tasks')
  ok('D9 an unknown hash resolves to null', resolveViewFromDeepLink('', '#nope') === null)

  // ── every declared view is reachable via a deep link ──────────────────────
  const unreachable = VIEW_IDS.filter((id) => resolveViewFromDeepLink(`?view=${id}`, '') !== id)
  ok('D10 every declared view id round-trips through a deep link', unreachable.length === 0, unreachable.join(','))
  ok('D11 isViewId accepts a real id', isViewId('overview') === true)
  ok('D12 isViewId rejects a non-id', isViewId('not-a-view') === false)
  ok('D13 isViewId rejects undefined', isViewId(undefined) === false)

  // ── the shell's NAV table matches the view-id contract ────────────────────
  // (Every navigable view must be deep-linkable and vice-versa.)
  const shellSrc = readFileSync(path.join(ROOT, 'src', 'components', 'agent-hub', 'shell.tsx'), 'utf-8')
  const navIds = [...shellSrc.matchAll(/\{\s*id:\s*'([a-z-]+)'\s*,\s*label:/g)].map((m) => m[1])
  const missingFromHelper = navIds.filter((id) => !VIEW_IDS.includes(id))
  const missingFromNav = VIEW_IDS.filter((id) => !navIds.includes(id))
  ok('D14 every NAV entry is a declared view id', missingFromHelper.length === 0, missingFromHelper.join(','))
  ok('D15 every declared view id appears in NAV', missingFromNav.length === 0, missingFromNav.join(','))
  ok('D16 retired Code Graph query opens Overview', resolveViewFromDeepLink('?view=graph&session=retained', '') === 'overview')
  ok('D17 retired Workflows hash opens Overview', resolveViewFromDeepLink('', '#workflows') === 'overview')
  ok('D18 removed screens are not navigable view ids', !isViewId('graph') && !isViewId('workflows'))
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  console.error('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
