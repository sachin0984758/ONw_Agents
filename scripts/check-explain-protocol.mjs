// ── Explanation protocol checks ─────────────────────────────────────────
// Run: node scripts/check-explain-protocol.mjs
// Compiles the REAL protocol module with tsc, then asserts parsing,
// validation, fallback and serialization behavior.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
import assert from 'node:assert/strict'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = join(ROOT, '.audit-explain')
let pass = 0
const ok = (name) => { pass++; console.log(`ok ${pass} - ${name}`) }

// 1. Compile the real protocol module.
const tsc = spawnSync(process.execPath, [
  join(ROOT, 'node_modules/typescript/bin/tsc'),
  'src/lib/agent-hub/explain-protocol.ts',
  '--outDir', '.audit-explain',
  '--module', 'commonjs',
  '--moduleResolution', 'node',
  '--target', 'es2020',
  '--esModuleInterop',
  '--skipLibCheck',
], { cwd: ROOT, encoding: 'utf8' })
if (tsc.status !== 0) {
  console.error(tsc.stdout, tsc.stderr)
  process.exit(1)
}
ok('compiled real protocol via tsc')

const require2 = createRequire(import.meta.url)
const {
  parseExplainResponse,
  validateBlocks,
  markdownToBlocks,
  blocksToPlainText,
} = require2(join(TMP, 'explain-protocol.js'))

// 2. Strict JSON with a full block set parses.
const full = JSON.stringify({
  blocks: [
    { type: 'text', markdown: '## Joins combine rows.' },
    { type: 'table', columns: ['id', 'name'], rows: [[1, 'a'], [2, 'b']] },
    { type: 'code', language: 'sql', code: 'SELECT * FROM a JOIN b ON a.id = b.id' },
    { type: 'diagram', format: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] },
    { type: 'chart', chart: 'line', series: [{ name: 's', points: [[0, 0], [1, 1]] }] },
    { type: 'equation', expression: 'V = I × R', steps: ['12 = 0.12 × 100'] },
    { type: 'steps', items: ['one', 'two'] },
    { type: 'checklist', items: [{ text: 'try it', hint: 'start here' }] },
    { type: 'interactive', kind: 'ohm-law' },
    { type: 'callout', variant: 'tip', markdown: 'watch the sign' },
    { type: 'metrics', items: [{ label: 'latency', value: '12 ms' }] },
  ],
})
const parsed = parseExplainResponse(full)
assert.equal(parsed.blocks.length, 11)
ok('strict JSON parses 11 block types')

// 3. Embedded fenced JSON (model wrapped it in ```json) still parses.
const fenced = 'Here is the answer:\n```json\n' + JSON.stringify({ blocks: [{ type: 'text', markdown: 'hi' }] }) + '\n```'
assert.equal(parseExplainResponse(fenced).blocks.length, 1)
ok('fenced JSON parses')

// 4. Invalid JSON falls back to Markdown blocks (prose + code).
const mdFallback = 'Intro text.\n\n```python\ndef f(x):\n    return x\n```\n\nOutro.'
const fb = parseExplainResponse(mdFallback)
assert.equal(fb.blocks.length, 3)
assert.equal(fb.blocks[0].type, 'text')
assert.equal(fb.blocks[1].type, 'code')
assert.equal(fb.blocks[1].language, 'python')
ok('markdown fallback splits prose + code')

// 5. Invalid structured output: malformed blocks are dropped, not crashed on.
const messy = JSON.stringify({ blocks: [{ type: 'text' }, { type: 'table', columns: ['a'] }, { type: 'nope' }, null, 42, { type: 'code', code: 'x' }] })
const cleaned = parseExplainResponse(messy)
assert.equal(cleaned.blocks.length, 1)
assert.equal(cleaned.blocks[0].type, 'code')
ok('invalid blocks dropped safely')

// 6. Empty / garbage input never throws and yields something renderable.
for (const bad of ['', '   ', 'not json at all', '{"blocks": "wrong"}', '{"blocks": [{}]}']) {
  const r = parseExplainResponse(bad)
  assert.ok(Array.isArray(r.blocks))
}
ok('garbage input never throws')

// 7. Legacy plain markdown message converts (history compatibility).
assert.equal(markdownToBlocks('plain text').length, 1)
ok('markdownToBlocks handles plain text')

// 8. Plain-text serialization for chat history.
const txt = blocksToPlainText(parsed.blocks)
assert.match(txt, /Joins combine rows/)
assert.match(txt, /SELECT \* FROM/)
assert.match(txt, /V = I × R/)
ok('blocksToPlainText serializes for persistence')

// 9. Interactive whitelist enforced (unknown kinds coerce to ohm-law, never crash).
const iv = validateBlocks([{ type: 'interactive', kind: 'make-a-virus' }])
assert.equal(iv.length, 1)
assert.equal(iv[0].kind, 'ohm-law')
ok('interactive kind whitelisted')

// 10. Chart drops non-numeric points.
const ch = validateBlocks([{ type: 'chart', chart: 'line', series: [{ name: 's', points: [['x', 'y'], [1, 2]] }] }])
assert.equal(ch.length, 1)
assert.equal(ch[0].type === 'chart' && ch[0].series[0].points.length, 1)
ok('chart filters non-numeric points')

rmSync(TMP, { recursive: true, force: true })
console.log(`\n# ${pass} explain-protocol checks passed`)
