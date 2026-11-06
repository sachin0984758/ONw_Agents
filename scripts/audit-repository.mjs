import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const decisions = JSON.parse(fs.readFileSync(path.join(root, 'docs/review-decisions.json'), 'utf8')).entries
const decisionByPath = new Map(decisions.map((entry) => [entry.path, entry]))
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.ps1', '.md', '.json', '.yml', '.yaml', '.css', '.prisma', '.bat', '.sh', '.txt'])
const omitted = /^(?:output|db|public|download|upload|tool-results|\.verification|\.agenthub|\.next[^/]*|node_modules)\//
const files = []
for (const name of listed) {
  if (omitted.test(name) || name.startsWith('.env') || name === 'package-lock.json' || name === 'docs/repository-audit.csv') continue
  if (!sourceExtensions.has(path.extname(name)) && !['.gitignore', 'Caddyfile'].includes(name)) continue
  const absolute = path.join(root, name)
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue
  const content = fs.readFileSync(absolute, 'utf8')
  const imports = []
  if (/\.[cm]?[jt]sx?$/.test(name)) {
    const ast = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true)
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
        const bindings = node.importClause?.namedBindings
        const onlyTypes = node.importClause?.isTypeOnly || (bindings && ts.isNamedImports(bindings) && !node.importClause.name && bindings.elements.length && bindings.elements.every((element) => element.isTypeOnly))
        if (!onlyTypes) imports.push(node.moduleSpecifier.text)
      }
      if (ts.isCallExpression(node) && ['require', 'import'].includes(node.expression.getText(ast)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  files.push({ path: name, lines: content.split('\n').length, sha256: createHash('sha256').update(content).digest('hex'), imports, client: /^['"]use client['"]/m.test(content) })
}
const index = new Map(files.map((file) => [file.path, file]))
const unresolved = []
for (const file of files) {
  file.dependencies = []
  for (const specifier of file.imports) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue
    const base = specifier.startsWith('@/') ? `src/${specifier.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(file.path), specifier))
    const resolved = [base, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '/index.ts', '/index.tsx'].map((suffix) => base + suffix)].find((candidate) => index.has(candidate))
    if (resolved) file.dependencies.push(resolved)
    else if (!/\.(css|png|jpe?g|svg|webp)$/.test(specifier) && !fs.existsSync(path.join(root, base))) unresolved.push({ file: file.path, specifier })
  }
}
const cycles = new Set()
const done = new Set()
function visitGraph(name, stack = []) {
  const at = stack.indexOf(name)
  if (at >= 0) { cycles.add([...stack.slice(at), name].join(' -> ')); return }
  if (done.has(name)) return
  for (const dependency of index.get(name)?.dependencies ?? []) visitGraph(dependency, [...stack, name])
  done.add(name)
}
for (const file of files) visitGraph(file.path)
const clientServerLeaks = []
for (const client of files.filter((file) => file.client && file.path.startsWith('src/'))) {
  const seen = new Set()
  const trace = (name) => {
    if (seen.has(name)) return
    seen.add(name)
    const entry = index.get(name)
    const native = entry?.imports.filter((item) => /^(?:node:)?(?:fs|child_process|async_hooks|net|tls)(?:\/|$)/.test(item)) ?? []
    if (native.length) clientServerLeaks.push({ client: client.path, server: name, imports: native })
    for (const dependency of entry?.dependencies ?? []) trace(dependency)
  }
  trace(client.path)
}
const merged = new Set([
  'src/lib/agent-hub/workspace-files.ts', 'src/lib/agent-hub/workspace-exec.ts',
  'src/lib/agent-hub/roadmap-library.ts', 'scripts/sync-roadmaps.mjs',
  'src/app/api/chat/route.ts', 'src/app/api/chat/conversations/route.ts',
  'src/components/agent-hub/tasks-view.tsx', 'src/components/agent-hub/sessions-view.tsx',
  'src/lib/agent-hub/session/tools.ts', 'src/lib/agent-hub/session/store.ts', 'src/lib/agent-hub/session/workspaces.ts',
])
function classify(file) {
  const resolved = decisionByPath.get(file.path)
  if (resolved) return [resolved.decision, resolved.reason]
  if (file.path.startsWith('agenthub-vm/')) return ['REVIEW', 'Prepared VM tooling; installation cancelled; no real guest isolation verified.']
  if (file.path.startsWith('src/components/ui/') && !files.some((entry) => entry.dependencies.includes(file.path))) return ['REVIEW', 'Reusable shadcn primitive with no current importer; library retained rather than guessing it is obsolete.']
  if (merged.has(file.path) || (file.path.startsWith('src/app/api/') && (file.dependencies.includes('src/lib/agent-hub/request-origin.ts') || file.dependencies.some((name) => /workspace-(files|exec)\.ts$/.test(name))))) return ['MERGE', 'Consumes authoritative storage, origin, path, workspace service, atomic-write or session-snapshot implementation; route/feature retained.']
  if (['src/lib/agent-hub/db-path.ts', 'src/lib/agent-hub/fs-atomic.ts', 'src/lib/agent-hub/llm.ts', 'src/lib/agent-hub/computer/bridge.ts', 'scripts/start-local.mjs', 'package.json', 'next.config.ts', 'eslint.config.mjs'].includes(file.path)) return ['REFACTOR', 'Consolidated lifecycle/configuration or cancellable model transport with compatibility checks.']
  if (file.path.startsWith('docs/history/')) return ['MOVE', 'Historical evidence relocated without deleting unique content; use current guides for setup.']
  if (file.path.startsWith('AgentHub-CLI/')) return ['KEEP', 'Independent Node CLI and its tests; distinct execution environment, policy and persistence.']
  if (file.path.startsWith('tmp/')) return ['KEEP', 'User document-generation helpers outside the AgentHub runtime; preserved, not treated as unused application code.']
  return ['KEEP', file.path.startsWith('src/app/') ? 'Framework-discovered entry point or app-owned asset/style.' : file.path.startsWith('src/') ? 'Feature, shared primitive, model contract or data module retained with its dependency relationships.' : 'Supporting configuration, verification, operational documentation or user notes retained.']
}
const rows = files.map((file) => { const [classification, reason] = classify(file); return { ...file, classification, reason } })
const duplicates = [...Map.groupBy(files, (file) => file.sha256).values()].filter((group) => group.length > 1).map((group) => group.map((file) => file.path))
const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`
const csv = [['path', 'classification', 'reason', 'lines', 'sha256'], ...rows.map((file) => [file.path, file.classification, file.reason, file.lines, file.sha256])].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
fs.writeFileSync(path.join(root, 'docs/repository-audit.csv'), csv)
const summary = {
  root, sourceFilesAudited: files.length, classifications: Object.fromEntries([...Map.groupBy(rows, (file) => file.classification)].map(([key, group]) => [key, group.length])),
  exactDuplicateFiles: duplicates, cycles: [...cycles], unresolvedLocalImports: unresolved, clientServerLeaks,
  serverRouteImports: files.flatMap((file) => file.path.startsWith('src/lib/') ? file.dependencies.filter((name) => name.startsWith('src/app/api/')).map((route) => ({ file: file.path, route })) : []),
  originalReviewItems: decisions.filter((entry) => entry.baseline === 'REVIEW').length,
  resolvedReviewItems: decisions.filter((entry) => entry.baseline === 'REVIEW' && entry.decision !== 'REVIEW').length,
  unexpectedlyRestoredFiles: decisions.filter((entry) => entry.decision === 'DELETE' && fs.existsSync(path.join(root, entry.path))).map((entry) => entry.path),
  deletedFiles: decisions.filter((entry) => entry.decision === 'DELETE').map((entry) => entry.path),
  exclusions: 'Dependencies, generated builds, caches, runtime DB and user output/assets excluded from source analysis; .env values never read. Public assets and output deliverables preserved. Lockfiles preserved.',
}
fs.mkdirSync(path.join(root, '.verification/finalization'), { recursive: true })
fs.writeFileSync(path.join(root, '.verification/finalization/audit-after.json'), JSON.stringify({ ...summary, files: rows }, null, 2))
console.log(JSON.stringify(summary, null, 2))
if (unresolved.length || clientServerLeaks.length || cycles.size || summary.serverRouteImports.length || summary.unexpectedlyRestoredFiles.length) process.exitCode = 1
