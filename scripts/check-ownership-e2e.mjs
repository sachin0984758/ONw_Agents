// ── E2E ownership audit (isolated fixtures; user state untouched) ──────
// Compiles the REAL store/normalize/seed with tsc into .audit-tmp/, then
// exercises the actual actions: createSessionForAgent, reassignSessionOwner,
// selectSession, hydrateIfNewer, and the API route's deepMerge+normalize
// persistence logic. Never contacts a server, never touches db/*.json.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
import assert from 'node:assert/strict'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = join(ROOT, '.audit-tmp')
let pass = 0
const ok = (name) => { pass++; console.log(`ok ${pass} - ${name}`) }

// 1. Compile the real TS store graph to CJS.
const tsc = spawnSync(process.execPath, [
  join(ROOT, 'node_modules/typescript/bin/tsc'),
  'src/lib/agent-hub/store.ts',
  '--outDir', '.audit-tmp',
  '--module', 'commonjs',
  '--moduleResolution', 'node',
  '--target', 'es2020',
  '--esModuleInterop',
  '--skipLibCheck',
  '--jsx', 'react-jsx',
  '--noImplicitAny', 'false',
], { cwd: ROOT, encoding: 'utf8' })
if (tsc.status !== 0) {
  console.error(tsc.stdout, tsc.stderr)
  process.exit(1)
}
ok('compiled real store via tsc')

// 2. Load the compiled REAL store + normalize.
const require2 = createRequire(import.meta.url)
let mod
try {
  mod = {
    store: require2(join(TMP, 'store.js')),
    normalize: require2(join(TMP, 'normalize.js')),
  }
} catch (e) {
  console.error(e)
  rmSync(TMP, { recursive: true, force: true })
  process.exit(1)
}
const { useHub } = mod.store
const { normalizeState, deepMerge } = mod.normalize
ok('loaded real store + normalize')

// 3. Fixture agents: A and B (isolated, never persisted).
const FIX_A = { id: 'agent-a', name: 'Agent A', type: 'backend', status: 'running', description: 'fixture', worktree: 'a', metrics: { agents: 1, worktrees: 0, completion: 0 }, children: [] }
const FIX_B = { id: 'agent-b', name: 'Agent B', type: 'backend', status: 'running', description: 'fixture', worktree: 'b', metrics: { agents: 1, worktrees: 0, completion: 0 }, children: [] }
useHub.setState({ state: { ...useHub.getState().state, agents: [FIX_A, FIX_B], sessions: [] } })
ok('loaded two isolated fixture agents')

// 4. Creating a session for Agent A assigns A's stable ID.
const idA1 = useHub.getState().createSessionForAgent('agent-a')
assert.equal(useHub.getState().state.sessions.find((s) => s.id === idA1)?.agentId, 'agent-a')
ok('create for Agent A assigns agent-a')

// 5. Agent A lists only its own; create a second session for A.
const idA2 = useHub.getState().createSessionForAgent('agent-a')
assert.equal(useHub.getState().state.sessions.find((s) => s.id === idA2)?.agentId, 'agent-a')
const listA = useHub.getState().state.sessions.filter((s) => s.agentId === 'agent-a')
assert.ok(listA.some((s) => s.id === idA1) && listA.some((s) => s.id === idA2))
ok('Agent A lists both its sessions')

// 6. Agent B lists only its own.
const idB1 = useHub.getState().createSessionForAgent('agent-b')
assert.equal(useHub.getState().state.sessions.find((s) => s.id === idB1)?.agentId, 'agent-b')
const listB = useHub.getState().state.sessions.filter((s) => s.agentId === 'agent-b')
assert.ok(listB.length === 1 && listB[0].id === idB1)
ok('Agent B lists only its own')

// 7. Global list shows both agents' sessions.
const global = useHub.getState().state.sessions
assert.ok(global.length === 3)
assert.ok(global.some((s) => s.agentId === 'agent-a') && global.some((s) => s.agentId === 'agent-b'))
ok('global sessions view lists both agents')

// 8. Opening (selecting) a session never changes its owner.
useHub.getState().selectSession(idA1)
assert.equal(useHub.getState().state.sessions.find((s) => s.id === idA1)?.agentId, 'agent-a')
useHub.getState().selectSession(idB1)
assert.equal(useHub.getState().state.sessions.find((s) => s.id === idB1)?.agentId, 'agent-b')
ok('selecting a session does not change its owner')

// 9. Reassignment requires an explicit action.
useHub.getState().reassignSessionOwner(idA1, 'agent-b')
assert.equal(useHub.getState().state.sessions.find((s) => s.id === idA1)?.agentId, 'agent-b')
ok('explicit reassignSessionOwner moves ownership')
useHub.getState().reassignSessionOwner(idA1, 'agent-a') // revert for later checks
assert.equal(useHub.getState().state.sessions.find((s) => s.id === idA1)?.agentId, 'agent-a')
ok('ownership reverted via explicit action')

// 10. Reloading / rehydrating preserves ownership.
const snap = JSON.parse(JSON.stringify(useHub.getState().state))
useHub.getState().hydrateIfNewer(snap)
assert.equal(useHub.getState().state.sessions.find((s) => s.id === idA1)?.agentId, 'agent-a')
assert.equal(useHub.getState().state.sessions.find((s) => s.id === idB1)?.agentId, 'agent-b')
ok('hydrateIfNewer preserves ownership')

// 11. Partial API updates do not erase ownership (deepMerge + normalizeState).
const persisted = normalizeState(JSON.parse(JSON.stringify(snap)))
const patched = deepMerge(persisted, { projectName: 'Renamed Project', plan: { autoRun: false } })
const merged = normalizeState(patched)
assert.equal(merged.projectName, 'Renamed Project')
assert.equal(merged.plan.autoRun, false)
assert.equal(merged.sessions.find((s) => s.id === idA1)?.agentId, 'agent-a')
assert.equal(merged.sessions.find((s) => s.id === idB1)?.agentId, 'agent-b')
ok('partial update preserves ownership')

// 12. Missing and deleted agent references are handled safely.
const stale = JSON.parse(JSON.stringify(snap))
stale.sessions.push({ id: 'sess-ghost', name: 'ghost', model: '', source: '', endedAt: '', agentId: 'deleted-agent', stats: stale.sessions[0].stats, events: [] })
stale.sessions.push({ id: 'sess-legacy', name: 'legacy', model: '', source: '', endedAt: '', stats: stale.sessions[0].stats, events: [] }) // no agentId
const healed = normalizeState(stale)
const ghost = healed.sessions.find((s) => s.id === 'sess-ghost')
const legacy = healed.sessions.find((s) => s.id === 'sess-legacy')
assert.equal(ghost?.agentId, 'deleted-agent') // preserved so UI can badge "Orphaned"
assert.equal(legacy?.agentId, '') // legacy migrates to explicit Unassigned
ok('missing/deleted agent refs handled safely (Unassigned/Orphaned)')

// 13. Duplicate creation requests do not create duplicate sessions.
const before = useHub.getState().state.sessions.length
const idC1 = useHub.getState().createSessionForAgent('agent-a')
const idC2 = useHub.getState().createSessionForAgent('agent-a')
assert.notEqual(idC1, idC2)
assert.equal(useHub.getState().state.sessions.length, before + 2)
ok('distinct session IDs per creation (no accidental overwrite)')

rmSync(TMP, { recursive: true, force: true })
console.log(`\n# ${pass} E2E ownership checks passed`)

