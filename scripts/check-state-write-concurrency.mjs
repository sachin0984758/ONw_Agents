// ── State-write concurrency regression ───────────────────────────────────────
// The dashboard POSTs the full state once per UI change, so bursts (e.g.
// "Pause All" fires nine patches at once) hit /api/agent simultaneously.
// Every writer used to share one `<file>.tmp` path: two concurrent writes
// could race the same temp file and one rename failed, surfacing as spurious
// 400s and silently dropped writes (the store treated any response as saved).
//
// This check asserts:
//   1. a burst of N concurrent full-state writes all return 200,
//   2. the final state is one complete, valid HubState,
//   3. two concurrent *partial* patches both land (read-merge-write is
//      serialized, so neither merge is lost),
//   4. the original state can be restored.
//
// Usage: node scripts/check-state-write-concurrency.mjs [baseUrl]
// Default baseUrl: http://localhost:3101 (isolated audit server).

const BASE = process.argv[2] || 'http://localhost:3101'

let checks = 0
const failures = []
function ok(cond, label) {
  checks++
  if (!cond) failures.push(label)
}

async function post(state) {
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  })
  return res.status
}

async function getState() {
  const res = await fetch(`${BASE}/api/agent`)
  ok(res.status === 200, `GET /api/agent → ${res.status}`)
  return (await res.json()).state
}

const original = await getState()
ok(original && typeof original === 'object', 'initial state is an object')
ok(Array.isArray(original.settings?.additionalDomains), 'initial state has settings.additionalDomains')

// 1+2: burst of N concurrent full-state writes (exactly what the store sends)
const N = 12
const burst = await Promise.all(
  Array.from({ length: N }, (_, i) => {
    const variant = structuredClone(original)
    variant.projectName = `race-${i}`
    return post(variant)
  })
)
const bad = burst.filter((s) => s !== 200)
ok(bad.length === 0, `all ${N} concurrent writes → 200 (got: ${burst.join(',')})`)

const afterBurst = await getState()
ok(/^race-\d+$/.test(afterBurst.projectName || ''), `final projectName is a complete winner (got: ${afterBurst.projectName})`)
ok(Array.isArray(afterBurst.settings?.additionalDomains), 'final state still has settings.additionalDomains')
ok(Array.isArray(afterBurst.sessions), 'final state still has sessions array')
ok(afterBurst.plan && Array.isArray(afterBurst.plan.steps), 'final state still has plan.steps')

// 3: two concurrent partial patches must both land
const [resA, resB] = await Promise.all([
  post({ settings: { allowlistMode: 'custom' } }),
  post({ settings: { networkEgress: true } }),
])
ok(resA === 200 && resB === 200, `concurrent partial patches → 200/200 (got ${resA}/${resB})`)
const merged = await getState()
ok(merged.settings.allowlistMode === 'custom', 'partial patch A landed (allowlistMode)')
ok(merged.settings.networkEgress === true, 'partial patch B landed (networkEgress)')

// 4: restore the original state
const restoreStatus = await post(original)
ok(restoreStatus === 200, `restore original state → ${restoreStatus}`)
const restored = await getState()
ok(restored.projectName === original.projectName, 'projectName restored to original')

console.log(`check-state-write-concurrency: ${checks} checks, ${failures.length} failed`)
if (failures.length) {
  for (const f of failures) console.error(`  FAIL: ${f}`)
  process.exit(1)
}
console.log('  all checks passed')
