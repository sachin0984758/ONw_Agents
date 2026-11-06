// ── Session ownership checks (PART B §13) ──────────────────────────────
// Run: node scripts/check-session-ownership.mjs
// Validates store ownership logic + normalize migration in isolation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const normSrc = readFileSync(join(ROOT, 'src/lib/agent-hub/normalize.ts'), 'utf8')
const storeSrc = readFileSync(join(ROOT, 'src/lib/agent-hub/store.ts'), 'utf8')
const typesSrc = readFileSync(join(ROOT, 'src/lib/agent-hub/types.ts'), 'utf8')
const seedSrc = readFileSync(join(ROOT, 'src/lib/agent-hub/seed-sessions.ts'), 'utf8')

let pass = 0
const ok = (name) => { pass++; console.log(`ok ${pass} - ${name}`) }

// 1. Session type carries a stable agentId field.
assert.match(typesSrc, /interface Session[\s\S]*?agentId:\s*string/, 'Session.agentId missing')
ok('Session type has required agentId')

// 2. Seed sessions ship with a stable owner (backend), never bare.
assert.match(seedSrc, /agentId:\s*'backend'/, 'seed sessions lack agentId')
ok('seed sessions carry agentId')

// 3. normalize keeps persisted agentIds, coerces legacy (missing) to ''.
assert.match(
  normSrc,
  /agentId:\s*typeof s\.agentId === 'string' && s\.agentId \? s\.agentId : ''/,
  'normalize agentId migration missing'
)
ok('normalize preserves/migrates agentId')

// 4. No silent owner switch: selection actions never write agentId.
const selectAgentUses = (storeSrc.match(/selectAgent/g) || []).length
assert.ok(selectAgentUses >= 1, 'selectAgent missing')
assert.ok(!/selectAgent[\s\S]{0,400}agentId\s*:/.test(storeSrc), 'selectAgent must not write agentId')
assert.ok(!/selectSession[\s\S]{0,400}agentId\s*:/.test(storeSrc), 'selectSession must not write agentId')
ok('selection never rewrites owner')

// 5. New sessions are created through the owner-aware action.
assert.match(storeSrc, /createSessionForAgent:\s*\(agentId/, 'createSessionForAgent missing')
assert.match(storeSrc, /reassignSessionOwner/, 'reassignSessionOwner missing')
ok('store exposes createSessionForAgent + reassignSessionOwner')

// 6. Runtime isolation: agent-session runtime never mutates store agentId.
const runtimeSrc = readFileSync(join(ROOT, 'src/lib/agent-hub/agent-session.ts'), 'utf8')
// A comparison (`===`/`==`) is not an assignment; only a real `=` write fails.
assert.ok(!/\.agentId\s*=(?!=)/.test(runtimeSrc), 'runtime must not assign store agentId')
ok('agent-session runtime does not touch registry ownership')

console.log(`\n# ${pass} ownership checks passed`)
