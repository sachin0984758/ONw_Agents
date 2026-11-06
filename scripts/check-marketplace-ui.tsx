import assert from 'node:assert/strict'
import React from 'react'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildPreviewDocument, DEFAULT_PREVIEW_STYLE } from '../src/components/agent-hub/marketplace/preview-document'
import type { MarketplaceComponent } from '../src/lib/agent-hub/marketplace/types'
import { resolveViewFromDeepLink } from '../src/lib/agent-hub/view-url'

const require = createRequire(import.meta.url)
require.extensions['.css'] = (module) => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, name) => String(name) }) } }
const { ComponentPreview } = require('../src/components/agent-hub/marketplace/component-preview') as typeof import('../src/components/agent-hub/marketplace/component-preview')
const { LocalComponents } = require('../src/components/agent-hub/marketplace/local-components') as typeof import('../src/components/agent-hub/marketplace/local-components')
const { listGitHubTemplates } = require('../src/lib/agent-hub/marketplace/github-templates') as typeof import('../src/lib/agent-hub/marketplace/github-templates')

let passed = 0
function check(name: string, action: () => void) { action(); passed++; process.stdout.write(`PASS ${name}\n`) }
const fixture: MarketplaceComponent = { id: 'local:test', name: 'Test', description: 'test', category: 'Cards and layouts', source: 'local', author: 'test', revision: 'v1', framework: 'React', dependencies: [], devDependencies: [], registryDependencies: [], tags: [], files: [{ path: 'test.tsx', target: 'src/test.tsx', type: 'registry:ui', content: 'window.localStorage.clear();fetch("/api/skills")' }], preview: { kind: 'builtin', key: 'task-card' }, updatedAt: '2026-10-28T00:00:00Z' }
const document = buildPreviewDocument('task-card', DEFAULT_PREVIEW_STYLE)!
check('UI Components has a stable deep link', () => assert.equal(resolveViewFromDeepLink('?view=ui-components', ''), 'ui-components'))
check('Curated task demo renders', () => assert.match(document, /Make room for the next idea/))
check('Curated status demo renders', () => assert.match(buildPreviewDocument('status-badge', DEFAULT_PREVIEW_STYLE)!, /Select a status/))
check('Curated chat demo clearly has no model call', () => assert.match(buildPreviewDocument('chat-input', DEFAULT_PREVIEW_STYLE)!, /no model call/))
check('Unknown preview keys never execute source', () => assert.equal(buildPreviewDocument('javascript:alert(1)', DEFAULT_PREVIEW_STYLE), null))
check('Preview denies all network connections', () => assert.match(document, /connect-src 'none'/))
check('Preview denies form submissions and frames', () => { assert.match(document, /form-action 'none'/); assert.match(document, /frame-src 'none'/) })
check('Demo title cannot inject HTML', () => { const value = buildPreviewDocument('task-card', DEFAULT_PREVIEW_STYLE, '<img src=x onerror=alert(1)>')!; assert.ok(value.includes('&lt;img')); assert.ok(!value.includes('<img src=x')) })
check('CSS color cannot inject markup or script', () => { const value = buildPreviewDocument('task-card', { ...DEFAULT_PREVIEW_STYLE, accent: '</style><script>fetch("/api/skills")</script>' })!; assert.ok(!value.includes('fetch("/api/skills")')); assert.ok(value.includes('#a18bfa')) })
check('Preview radii and shadow are bounded', () => { const value = buildPreviewDocument('task-card', { ...DEFAULT_PREVIEW_STYLE, radius: 999, shadow: -300 })!; assert.match(value, /border-radius:20px/); assert.match(value, /box-shadow:0 0px 0px/) })
check('Reduced motion always respected', () => assert.match(document, /prefers-reduced-motion:reduce/))
check('Light preview uses only its local palette', () => { const value = buildPreviewDocument('task-card', { ...DEFAULT_PREVIEW_STYLE, theme: 'light', background: '#ffffff', foreground: '#111111' })!; assert.match(value, /background:#ffffff/); assert.ok(!value.includes(':root')) })
check('Missing preview has truthful unavailable state', () => { const html = renderToStaticMarkup(<ComponentPreview component={{ ...fixture, preview: { kind: 'unavailable' } }} style={DEFAULT_PREVIEW_STYLE} size="desktop" />); assert.ok(html.includes('Source available. Preview isolated.')); assert.ok(!html.includes('<iframe')); assert.ok(!html.includes('window.localStorage')) })
check('Iframe has scripts but no same-origin authority', () => { const html = renderToStaticMarkup(<ComponentPreview component={fixture} style={DEFAULT_PREVIEW_STYLE} size="mobile" />); assert.ok(html.includes('sandbox="allow-scripts"')); assert.ok(!html.includes('allow-same-origin')); assert.ok(!html.includes('window.localStorage.clear()')); assert.ok(html.includes('data-size="mobile"')) })
check('Unknown builtin becomes unavailable, never evaluates source', () => { const html = renderToStaticMarkup(<ComponentPreview component={{ ...fixture, preview: { kind: 'builtin', key: 'unknown' } }} style={DEFAULT_PREVIEW_STYLE} size="desktop" />); assert.ok(!html.includes('<iframe')); assert.ok(!html.includes('window.localStorage')) })
async function checkSavedCards() {
  const templates = await listGitHubTemplates()
  const count = templates.reduce((total, template) => total + template.components.length, 0)
  assert.ok(count > 0, 'Saved GitHub components are required for this check.')
  const props = { templates, query: '', category: '', source: 'all', sort: 'name', workspaces: [], onRefresh: async () => {} }
  const html = renderToStaticMarkup(<LocalComponents {...props} />)
  check('every downloaded component has its own local source and install actions', () => {
    assert.equal((html.match(/>Install Component</g) ?? []).length, count)
    assert.equal((html.match(/>View source</g) ?? []).length, count)
  })
  check('local cards filter by search and category', () => {
    const filtered = renderToStaticMarkup(<LocalComponents {...props} query="header" category="Navigation and sidebars" />)
    assert.equal((filtered.match(/>Install Component</g) ?? []).length, templates.flatMap((template) => template.components).filter((file) => /header/i.test(file)).length)
  })
  check('remote source filter excludes saved GitHub component cards', () => {
    assert.ok(!renderToStaticMarkup(<LocalComponents {...props} source="registry" />).includes('Install Component'))
  })
  process.stdout.write(`\n${passed} UI and preview security checks passed.\n`)
}
void checkSavedCards().catch((error) => { console.error(error); process.exitCode = 1 })
