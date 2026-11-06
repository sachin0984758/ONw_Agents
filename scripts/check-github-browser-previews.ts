import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Copies of the real saved templates are compiled. Adversarial fixtures are
// separate and never added to the user's library. No browser rendering claim
// is made by this compiler/security test.
async function main() {
  const originalDb = process.env.AGENT_HUB_DB_DIR
  const saved = path.resolve(originalDb || 'db', 'ui-library/templates')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-browser-preview-'))
  process.env.AGENT_HUB_DB_DIR = temporary
  const templatesRoot = path.join(temporary, 'ui-library/templates')
  try {
    await fs.cp(saved, templatesRoot, { recursive: true })
    const { buildGitHubBrowserPreview } = await import('../src/lib/agent-hub/marketplace/github-browser-preview')
    const { listGitHubTemplates } = await import('../src/lib/agent-hub/marketplace/github-templates')
    const templates = await listGitHubTemplates()
    let count = 0
    for (const template of templates) for (const file of template.components) {
      const result = await buildGitHubBrowserPreview(template.ref, file)
      const script = result.document.match(/<script>([\s\S]*)<\/script>/)?.[1]
      assert.ok(script, `${file} must include its compiled browser bundle`)
      assert.ok(result.document.includes(`sha256-${createHash('sha256').update(script).digest('base64')}`), 'Only the exact bundled script is authorized')
      for (const blocked of ["connect-src &#39;none&#39;", "worker-src &#39;none&#39;", "form-action &#39;none&#39;", "frame-src &#39;none&#39;"]) assert.ok(result.document.includes(blocked), blocked)
      assert.ok(!result.document.includes('script-src &#39;unsafe-inline&#39;'))
      const source = await fs.readFile(path.join(saved, template.ref, 'source', file))
      assert.deepEqual(await fs.readFile(path.join(templatesRoot, template.ref, 'source', file)), source)
      console.log(`PASS real saved source compiled: ${template.ref}/${file}`)
      count++
    }
    assert.equal(count, 18, 'All eighteen currently indexed downloaded components must compile')
    await assert.rejects(buildGitHubBrowserPreview('cruip/open-react-template', '../package.json'), /indexed/)
    await assert.rejects(buildGitHubBrowserPreview('../escape/repository', 'index.tsx'), /valid GitHub/)
    console.log('PASS traversal and non-indexed source rejected')

    const fixture = path.join(templatesRoot, 'fixture/unsafe')
    await fs.mkdir(path.join(fixture, 'source'), { recursive: true })
    const files = {
      'index.tsx': 'throw new Error("REPOSITORY_TOP_LEVEL_EXECUTED"); export default function Component(){return <p>Sandbox only</p>}',
      'host.tsx': 'import fs from "node:fs"; export default function Component(){return <p>{String(fs)}</p>}',
      'app/layout.tsx': 'export default function Layout(){return <html/>}',
      'globals.css': '@config "./untrusted-config.js";',
      'untrusted-config.js': 'throw new Error("REPOSITORY_CONFIG_EXECUTED")',
    }
    for (const [name, contents] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(fixture, 'source', name)), { recursive: true }); await fs.writeFile(path.join(fixture, 'source', name), contents) }
    const manifest = { ...templates[0], ref: 'fixture/unsafe', commit: 'a'.repeat(40), files: Object.keys(files).filter((name) => name !== 'globals.css'), components: ['index.tsx', 'host.tsx'] }
    await fs.writeFile(path.join(fixture, 'manifest.json'), JSON.stringify(manifest))
    const browserOnly = await buildGitHubBrowserPreview('fixture/unsafe', 'index.tsx')
    assert.ok(browserOnly.document.includes('REPOSITORY_TOP_LEVEL_EXECUTED'), 'Untrusted top-level statements must only enter the browser bundle, never execute on the host')
    await assert.rejects(buildGitHubBrowserPreview('fixture/unsafe', 'host.tsx'), /does not support node:fs/)
    await fs.writeFile(path.join(fixture, 'manifest.json'), JSON.stringify({ ...manifest, commit: 'b'.repeat(40), files: Object.keys(files) }))
    await assert.rejects(buildGitHubBrowserPreview('fixture/unsafe', 'index.tsx'), /CSS plugins and configuration are disabled/)
    console.log('PASS hostile top-level source stays unevaluated; host imports and repository CSS config are blocked (fixtures)')
    await fs.writeFile(path.join(fixture, 'manifest.json'), JSON.stringify({ ...manifest, commit: 'c'.repeat(40) }))
    const originalCwd = process.cwd()
    const standaloneTest = await fs.mkdtemp(path.join(originalCwd, '.next-preview-test-'))
    try {
      await fs.mkdir(path.join(standaloneTest, 'standalone'))
      process.chdir(path.join(standaloneTest, 'standalone'))
      const standalone = await buildGitHubBrowserPreview('fixture/unsafe', 'index.tsx')
      assert.ok(standalone.document.includes('Sandbox only'))
      console.log('PASS preview resolves browser dependencies after the standalone server changes its working directory')
    } finally {
      process.chdir(originalCwd)
      if (path.dirname(standaloneTest) === originalCwd && path.basename(standaloneTest).startsWith('.next-preview-test-')) await fs.rm(standaloneTest, { recursive: true, force: true })
    }
    console.log(`${count}/18 real component bundles verified; browser rendering requires the separate live UI checks.`)
  } finally {
    if (originalDb === undefined) delete process.env.AGENT_HUB_DB_DIR
    else process.env.AGENT_HUB_DB_DIR = originalDb
    if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('agenthub-browser-preview-')) await fs.rm(temporary, { recursive: true, force: true })
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
