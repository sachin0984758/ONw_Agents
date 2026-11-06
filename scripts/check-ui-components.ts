import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-components-'))
  process.env.AGENT_HUB_DB_DIR = path.join(temporary, 'db')
  process.env.AGENTHUB_PROJECT_ROOT = process.cwd()
  const catalog = await import('../src/lib/agent-hub/marketplace/catalog')
  const registry = await import('../src/lib/agent-hub/marketplace/registry')
  const installer = await import('../src/lib/agent-hub/marketplace/installer')
  const workspaces = await import('../src/lib/agent-hub/session/workspaces')
  let passed = 0
  const check = (label: string, test: unknown) => { assert.ok(test, label); console.log(`PASS ${label}`); passed++ }
  const rejects = async (label: string, task: () => Promise<unknown>, expression: RegExp) => { await assert.rejects(task(), expression); check(label, true) }
  const project = path.join(temporary, 'project')
  try {
    await fs.mkdir(project, { recursive: true })
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ dependencies: { react: '^19', next: '^16' } }))
    const workspace = await workspaces.registerWorkspace(project)
    check('original local catalog works without network', (await catalog.readMarketplace()).components.length >= 3)
    check('search uses actual metadata and categories', (await catalog.marketplaceSearch('chat', 'AI chat interfaces')).some((entry) => entry.id === 'builtin:chat-input'))
    check('category mismatch excludes results', (await catalog.marketplaceSearch('chat', 'Dashboards')).length === 0)
    const raw = { name: 'review-card', title: 'Review card', type: 'registry:component', category: 'Cards and layouts', files: [{ path: 'review.tsx', content: 'export default function Review() { return <p>Reviewed</p> }\n' }] }
    const component = await catalog.importComponent(raw)
    check('local registry source imports with stable identity', component.id === 'local:review-card')
    check('imported React is not executable in privileged preview', component.preview.kind === 'unavailable')
    const foreign = registry.normalizeRegistryItem({ ...raw, name: 'deps', files: [{ path: 'deps.tsx', target: '', content: `import { motion } from 'motion/react'\nexport default motion.div` }] })
    check('empty shadcn target resolves to a safe source target', foreign.files[0].target === 'src/components/marketplace/deps/deps.tsx')
    check('dependencies are detected from imports', foreign.dependencies.includes('motion'))
    for (const target of ['../escape.tsx', '/tmp/a.tsx', 'C:\\escape.tsx', 'src/components/../../escape.tsx', 'src/components/.env', 'src/components/x%2fy.tsx', 'src/app/route.ts', 'src/components/NUL.tsx', 'node_modules/a.tsx']) {
      assert.throws(() => registry.normalizeRegistryItem({ ...raw, files: [{ path: 'a.tsx', target, content: 'export {}' }] }), /Unsafe|protected|targets/)
    }
    check('traversal, absolute paths, protected files and Windows devices rejected', true)
    assert.throws(() => registry.normalizeRegistryItem({ ...raw, dependencies: ['https://evil.test/archive.tgz'] }), /npm/)
    assert.throws(() => registry.normalizeRegistryItem({ ...raw, dependencies: ['--ignore-scripts'] }), /npm/)
    check('dependency URL and command argument injection rejected', true)
    assert.throws(() => registry.normalizeRegistryItem({ ...raw, files: [{ path: 'a.tsx', content: '-----BEGIN PRIVATE KEY-----' }] }), /credential/)
    assert.throws(() => registry.normalizeRegistryItem({ ...raw, files: [{ path: '../a.tsx', content: 'x' }] }), /Unsafe/)
    check('private-key content and unsafe source paths rejected', true)
    assert.throws(() => registry.normalizeRegistryItem({ ...raw, files: [{ path: 'a.tsx' }] }), /UTF-8/)
    check('unresolved source manifest cannot be installed as empty code', true)
    for (const url of ['http://ui.shadcn.com/r/button.json','https://127.0.0.1/a','https://localhost/a','https://x.test/a?token=secret','https://user:secret@x.test/a','https://x.test:1234/a','https://x.test/%2e%2e/a']) assert.throws(() => registry.registryURL(url))
    check('unsafe, credential-bearing and unexpected registry URLs rejected', true)
    check('DNS addresses cannot target local, private, reserved or mapped networks', ['127.0.0.1','10.1.1.1','169.254.169.254','192.168.0.1','172.18.0.1','::1','::ffff:127.0.0.1','fe80::1'].every((address) => !registry.publicAddress(address)))
    check('public HTTPS addresses remain eligible', registry.publicAddress('8.8.8.8') && registry.publicAddress('2606:4700:4700::1111'))
    await rejects('fetch requires explicit user approval', () => catalog.importFromRegistry('https://ui.shadcn.com/r/styles/new-york/button.json', false), /approval/)
    await rejects('untrusted registries are blocked before download', () => catalog.importFromRegistry('https://ui.shadcn.com/r/styles/new-york/button.json', true), /Trust/)
    await catalog.trustRegistry('https://ui.shadcn.com/r/styles/new-york/', 'shadcn official', true)
    check('trusted registry persisted without credentials', (await catalog.readMarketplace()).registries[0].name === 'shadcn official')
    await catalog.updateCollection('favorite', component.id, true); await catalog.updateCollection('recent', component.id)
    check('favorite and recent collection persist', (await catalog.readMarketplace()).favorites.includes(component.id) && (await catalog.readMarketplace()).recent[0] === component.id)
    const preset = { id: 'graphite', name: 'Graphite', theme: 'dark' as const, background: '#101014', foreground: '#eeeeee', accent: '#8b5cf6', typography: 'sans' as const, spacing: 'compact' as const, radius: 2, shadow: 0.2, motion: false }
    await catalog.savePreset(preset)
    check('preview-only preset persists', (await catalog.readMarketplace()).presets[0].id === 'graphite')
    await rejects('CSS injection in styling presets rejected', () => catalog.savePreset({ ...preset, background: 'url(https://evil.test)' }), /unsupported/)
    await rejects('implicit app root cannot be installation target', () => installer.proposeInstall({ id: component.id, workspaceId: '' }), /Explicitly/)
    const proposal = await installer.proposeInstall({ id: component.id, workspaceId: workspace.id })
    check('proposal contains actual before/after without modifying files', proposal.files[0].before === null && await fs.stat(path.join(project, proposal.files[0].path)).catch(() => null) === null)
    await rejects('install is blocked without approval', () => installer.applyProposal(proposal.id, false), /approval/)
    const install = await installer.applyProposal(proposal.id, true)
    check('approved install writes and verifies exact source', install.verification.length === 1 && await fs.readFile(path.join(project, proposal.files[0].path), 'utf8') === proposal.files[0].after)
    check('recoverable pre-install snapshot exists', !!await fs.stat(path.join(temporary, 'db', 'marketplace-snapshots', `${proposal.id}.json`)))
    await rejects('approval token cannot be replayed', () => installer.applyProposal(proposal.id, true), /already used/)
    const uninstall = await installer.proposeInstall({ id: component.id, workspaceId: workspace.id, operation: 'uninstall', installationId: install.installation.id })
    await installer.applyProposal(uninstall.id, true)
    check('uninstall removes only unchanged installed source', await fs.stat(path.join(project, proposal.files[0].path)).catch(() => null) === null)
    const restore = await installer.proposeInstall({ id: component.id, workspaceId: workspace.id, operation: 'restore', installationId: uninstall.id })
    await installer.applyProposal(restore.id, true)
    check('restore can undo an uninstall using its snapshot', await fs.readFile(path.join(project, proposal.files[0].path), 'utf8') === proposal.files[0].after)
    const stale = await installer.proposeInstall({ id: component.id, workspaceId: workspace.id })
    await fs.writeFile(path.join(project, stale.files[0].path), 'user changed source')
    await rejects('concurrent user changes invalidate reviewed writes', () => installer.applyProposal(stale.id, true), /changed after review/)
    await rejects('uninstall cannot delete later user edits', () => installer.proposeInstall({ id: component.id, workspaceId: workspace.id, operation: 'uninstall', installationId: install.installation.id }), /user edits/)
    const conflict = await installer.proposeInstall({ id: component.id, workspaceId: workspace.id })
    check('existing file conflicts shown before destructive action', conflict.files[0].conflict && conflict.files[0].before === 'user changed source')
    await installer.applyProposal(conflict.id, true)
    const undo = await installer.proposeInstall({ id: component.id, workspaceId: workspace.id, operation: 'uninstall', installationId: conflict.id })
    await installer.applyProposal(undo.id, true)
    check('uninstall restores overwritten user original', await fs.readFile(path.join(project, undo.files[0].path), 'utf8') === 'user changed source')
    const updateReview = await installer.proposeInstall({ id: component.id, workspaceId: workspace.id })
    await catalog.importComponent({ ...raw, files: [{ path: 'review.tsx', content: 'export default function Review() { return <p>New revision</p> }' }] })
    await rejects('component updates invalidate old approval payloads', () => installer.applyProposal(updateReview.id, true), /source changed/)
    const outside = path.join(temporary, 'outside'); await fs.mkdir(outside)
    const link = path.join(project, 'src', 'components', 'linked'); await fs.mkdir(path.dirname(link), { recursive: true }); await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    const linked = await catalog.importComponent({ ...raw, name: 'linked-card', files: [{ path: 'a.tsx', target: 'src/components/linked/a.tsx', content: 'x' }] })
    await rejects('linked target directories cannot escape selected workspace', () => installer.proposeInstall({ id: linked.id, workspaceId: workspace.id }), /symbolic links/)
    const blocked = await installer.proposeInstall({ id: component.id, workspaceId: workspace.id })
    await fs.writeFile(path.join(temporary, 'db', 'agent-hub-state.json'), JSON.stringify({ settings: { codeExecution: false } }))
    await rejects('global file-write policy is enforced by installer', () => installer.applyProposal(blocked.id, true), /disabled/)
    check('failed install preserves original file', await fs.readFile(path.join(project, blocked.files[0].path), 'utf8') === 'user changed source')
    await fs.writeFile(path.join(temporary, 'db', 'agent-hub-state.json'), JSON.stringify({ settings: { codeExecution: true } }))
    const bundle = await catalog.importComponent({ ...raw, name: 'rollback-bundle', dependencies: ['react@18.3.0'], files: [{ path: 'a.tsx', content: 'first' }, { path: 'b.tsx', content: 'second' }] })
    const bundleReview = await installer.proposeInstall({ id: bundle.id, workspaceId: workspace.id })
    check('dependency version differences are reported before installation', bundleReview.warnings.some((message) => message.includes('version review')))
    const rename = fs.rename; let injectedFailure = false
    fs.rename = async (from, to) => { if (!injectedFailure && String(to) === path.join(project, bundleReview.files[1].path)) { injectedFailure = true; throw new Error('Injected second-file failure') } return rename(from, to) }
    try { await rejects('failure after the first write rolls back the actual transaction', () => installer.applyProposal(bundleReview.id, true), /rolled back/) } finally { fs.rename = rename }
    check('rollback removes only the files created by the failed transaction', await fs.stat(path.join(project, bundleReview.files[0].path)).catch(() => null) === null && await fs.stat(path.join(project, bundleReview.files[1].path)).catch(() => null) === null)
    const snapshot = JSON.parse(await fs.readFile(path.join(temporary, 'db', 'marketplace-snapshots', `${bundleReview.id}.json`), 'utf8'))
    check('failure recovery status is recorded durably', snapshot.status === 'rolled-back')
    const { GET, POST } = await import('../src/app/api/ui-components/route')
    const { NextRequest } = await import('next/server')
    const rejectedGET = await GET(new NextRequest('http://localhost/api/ui-components', { headers: { host: 'localhost', origin: 'https://evil.test' } }))
    check('cross-origin catalog reads are rejected', rejectedGET.status === 403)
    const rejectedPOST = await POST(new NextRequest('http://localhost/api/ui-components', { method: 'POST', headers: { host: 'localhost', origin: 'https://evil.test' }, body: JSON.stringify({ action: 'apply', proposalId: bundleReview.id, approved: true }) }))
    check('cross-origin write attempts are rejected', rejectedPOST.status === 403)
    const apiGET = await GET(new NextRequest('http://localhost/api/ui-components', { headers: { host: 'localhost' } }))
    const apiData = await apiGET.json()
    check('API returns local catalog, history and explicit registered workspaces', apiGET.status === 200 && apiData.catalog.length >= 3 && apiData.installations.length >= 5 && apiData.workspaces.every((entry: { id: string }) => entry.id))
    const github = await import('../src/lib/agent-hub/marketplace/github-templates')
    const fetchOnline = globalThis.fetch
    try {
      globalThis.fetch = async (input) => {
        const url = new URL(String(input))
        assert.equal(url.origin, 'https://api.github.com')
        assert.match(url.searchParams.get('q') ?? '', /topic:landing-page-template/)
        assert.equal(url.searchParams.get('page'), '42')
        return Response.json({ items: [{ full_name: 'example/unlicensed', description: 'React template', language: 'TypeScript', license: null, size: 24 }], total_count: 1400 })
      }
      const last = await github.discoverGitHub('topic', 'React', 42)
      check('GitHub topic pagination respects the search cap and flags unknown licenses', !last.next && last.results[0]?.eligible === false)
    } finally { globalThis.fetch = fetchOnline }
    if (process.argv.includes('--github-saved')) {
      const saved = path.join(process.cwd(), 'db', 'ui-library', 'templates')
      await fs.cp(saved, path.join(github.UI_LIBRARY_DIRECTORY, 'templates'), { recursive: true })
      const { createConversation } = await import('../src/lib/agent-hub/session/store')
      const { createToolExecutor } = await import('../src/lib/agent-hub/session/tools')
      const tools = createToolExecutor(createConversation({ workspace: '.', mode: 'ro' }), 'Find a landing page template')
      const signal = new AbortController().signal
      globalThis.fetch = async () => { throw new Error('Network disabled for offline verification') }
      try {
        const records = await github.listGitHubTemplates()
        assert.ok(records.length >= 2)
        const standalone = await import('../src/lib/agent-hub/marketplace/github-components')
        const runtime = await import('../src/lib/agent-hub/marketplace/github-runtime')
        let indexed = 0
        let installedComponents = 0
        for (const record of records) {
          const found = await tools('search_ui_components', { kind: 'templates', query: record.ref }, signal)
          const source = await tools('read_ui_component', { id: record.ref, file: 'README.md' }, signal)
          check(`${record.ref} is discoverable and readable by Agent Sessions offline`, found.ok && found.output.includes(record.commit) && source.ok && /GPL/i.test(source.output))
          await rejects(`${record.ref} installation requires approval`, () => github.installGitHubTemplate(record.ref, workspace.id!, record.commit, false), /explicitly approve/)
          const installed = await github.installGitHubTemplate(record.ref, workspace.id!, record.commit, true)
          for (const file of record.files) {
            const original = await fs.readFile(path.join(saved, record.ref, 'source', file))
            assert.deepEqual(await fs.readFile(path.join(installed.folder, file)), original)
          }
          check(`${record.ref} approved offline install verified ${installed.files} files byte-for-byte`, installed.files === record.files.length)
          const componentRoot = path.join(temporary, 'components-' + record.owner)
          await fs.mkdir(componentRoot)
          await fs.copyFile(path.join(installed.folder, 'package.json'), path.join(componentRoot, 'package.json'))
          await fs.copyFile(path.join(installed.folder, 'tsconfig.json'), path.join(componentRoot, 'tsconfig.json'))
          const target = await workspaces.registerWorkspace(componentRoot)
          const candidates = await tools('search_ui_components', { kind: 'standalone', query: record.ref }, signal)
          check(`${record.ref} Agent Session finds its standalone components`, candidates.ok && JSON.parse(candidates.output).length === record.components.length)
          for (const entry of record.components) {
            indexed++
            const review = await standalone.reviewGitHubComponent(record.ref, entry, target.id!)
            if (review.blockers.length) {
              console.log(`BLOCKED ${record.ref} ${entry}: ${review.blockers.join(' ')}`)
              continue
            }
            const firstNew = review.changes.find((file) => file.status === 'create')
            if (firstNew) {
              const conflict = path.join(componentRoot, firstNew.file)
              await fs.mkdir(path.dirname(conflict), { recursive: true })
              await fs.writeFile(conflict, 'concurrent user edit')
              await rejects('component review rejects changes made after approval', () => standalone.installGitHubComponent(record.ref, entry, target.id!, review.review, true), /Review again/)
              await fs.unlink(conflict)
            }
            const result = await standalone.installGitHubComponent(record.ref, entry, target.id!, review.review, true)
            check(`standalone ${record.owner} ${entry} verified ${result.verified} files`, result.verified === review.files.length)
            await standalone.rollbackGitHubComponent(result.id, true)
            check(`standalone ${record.owner} ${entry} rollback preserves pre-existing files`, await Promise.all(review.changes.filter((file) => file.status === 'create').map((file) => fs.stat(path.join(componentRoot, file.file)).catch(() => null))).then((files) => files.every((file) => file === null)))
            installedComponents++
          }
          const validation = await runtime.validateTemplateProject(record.ref)
          check(`${record.ref} project dependency validation identifies Next.js and locked dependencies`, validation.framework === 'Next.js' && Boolean(validation.lockHash))
          await rejects('isolated build requires explicit approval', () => runtime.buildTemplate(record.ref, record.commit, false), /Approve the isolated build/)
        }
        check('all saved indexed component entries were analyzed', indexed === records.reduce((count, entry) => count + entry.components.length, 0))
        check(`${installedComponents} real standalone component installations succeeded in compatible test projects`, installedComponents > 0)
        check('saved repository screenshot is served offline', (await github.readTemplatePreview('nextemplates/tailwind-landing-page-template'))?.type === 'image/jpeg')
        const queue = await import('../src/lib/agent-hub/marketplace/download-queue')
        check('already saved repositories are skipped when queued', (await queue.updateDownloadQueue('enqueue', records.map((item) => item.ref))).jobs.length === 0)
        const pending = await queue.updateDownloadQueue('enqueue', ['example/pending', 'example/pending'])
        check('queue deduplicates selected repositories', pending.jobs.length === 1)
        await queue.updateDownloadQueue('pause')
        check('queue pause persists and prevents processing', (await queue.updateDownloadQueue('step')).jobs[0].status === 'queued')
        await queue.updateDownloadQueue('resume')
        const failed = await queue.updateDownloadQueue('step')
        check('offline failure pauses the batch and records the error', failed.paused && failed.jobs[0].status === 'failed' && Boolean(failed.jobs[0].error))
        check('failed items can be requeued', (await queue.updateDownloadQueue('retry')).jobs[0].status === 'queued')
        check('cancel pending is persisted', (await queue.updateDownloadQueue('cancel')).jobs[0].status === 'cancelled')
      } finally { globalThis.fetch = fetchOnline }
    }
    if (process.argv.includes('--live')) {
      const fetched = await catalog.importFromRegistry('https://ui.shadcn.com/r/styles/new-york/button.json', true)
      check('real official shadcn registry JSON downloads and normalizes', fetched.files.some((file) => file.content.includes('Button')) && fetched.preview.kind === 'unavailable')
    }
    console.log(`\n${passed} UI Component Marketplace checks passed.`)
  } finally {
    const resolved = path.resolve(temporary)
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('agenthub-components-')) await fs.rm(resolved, { recursive: true, force: true })
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
