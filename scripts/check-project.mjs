import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Serial execution bounds memory and avoids fixture-port collisions. Native
// input, live-model calls and user-workspace mutations remain explicit opt-ins.
const suites = [
  'check-storage-boundaries.ts', 'check-capability-packs.ts', 'agent-session-regression.mjs',
  'check-obsidian-access.ts', 'check-obsidian-memory.ts', 'check-obsidian-math.tsx',
  'check-security-headers.ts',
  'check-obsidian-presentation.ts', 'check-obsidian-network.ts',
  'check-workspace-services.ts',
  'check-model-cancellation.ts', 'check-llm-stream.ts', 'check-advanced-lesson.ts',
  'check-session-controls.ts', 'check-session-completion.ts', 'check-session-questions.tsx', 'check-agent-session-files-e2e.mjs',
  'check-chat-normalize.mjs', 'check-chat-isolation.mjs',
  'check-chat-background.ts',
  'check-chat-attachments.mjs', 'check-chat-multimodal.mjs',
  'check-chat-quiz-rendering.tsx', 'check-teaching-rendering.tsx',
  'check-code-block-rendering.tsx', 'check-session-presentation.tsx',
  'check-sessions-layout.mjs',
  'check-runtime-models.mjs', 'check-playground.mjs', 'check-skills.mjs',
  'check-n8n-integration.mjs', 'check-token-usage.mjs', 'check-deep-links.mjs',
  'check-ui-interactions.mjs', 'check-computer-contract.ts',
  'check-computer-transport.ts', 'check-computer-preferences.ts', 'check-auto-platform.ts', 'check-auto-task-store.ts',
]
const evidence = path.join(root, '.verification', 'modernization', 'tests')
await mkdir(evidence, { recursive: true })
const results = []
for (const suite of suites) {
  const args = /\.tsx?$/.test(suite)
    ? ['--import', 'tsx', '--import', pathToFileURL(path.join(root, 'scripts/register-css-modules.cjs')).href]
    : []
  const result = spawnSync(process.execPath, [...args, path.join('scripts', suite)], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  await writeFile(path.join(evidence, `${suite}.log`), output)
  const count = /(?:^|\n)\s*(\d+) passed, 0 failed/.exec(output)
    ?? /(?:checks: |^|\n)(\d+) passed, 0 failed/m.exec(output)
    ?? /(?:^|\n)(\d+) [^\n]*checks passed/.exec(output)
  const passed = count ? Number(count[1]) : (output.match(/^PASS /gm) ?? []).length || null
  const skipped = (output.match(/^\s*SKIP\s/gm) ?? []).length
  results.push({ suite, exitCode: result.status, signal: result.signal, error: result.error?.message, passed, skipped })
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${suite}${count ? ` (${count[1]} checks)` : ''}`)
  if (result.status !== 0) console.error(output.slice(-2600))
}
await writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((result) => result.exitCode !== 0)
console.log(`\n${results.length - failed.length}/${results.length} suites passed. Evidence: .verification/modernization/tests/`)
console.log(`${results.reduce((sum, result) => sum + (result.passed ?? 0), 0)} checks passed; ${results.reduce((sum, result) => sum + result.skipped, 0)} checks skipped.`)
process.exitCode = failed.length ? 1 : 0
