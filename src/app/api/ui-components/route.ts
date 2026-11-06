import { NextRequest, NextResponse } from 'next/server'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { selectedWorkspaces } from '@/lib/agent-hub/session/workspaces'
import { COMPONENT_CATEGORIES, importComponent, importFromRegistry, marketplaceRead, readMarketplace, savePreset, trustRegistry, updateCollection } from '@/lib/agent-hub/marketplace/catalog'
import { applyProposal, proposeInstall } from '@/lib/agent-hub/marketplace/installer'
import { discoverGitHub, installGitHubTemplate, listGitHubTemplates, readGitHubCatalog, readTemplatePreview, readTemplateSource, syncGitHubCatalog } from '@/lib/agent-hub/marketplace/github-templates'
import { downloadStatus, updateDownloadQueue } from '@/lib/agent-hub/marketplace/download-queue'
import { analyzeGitHubComponent, installGitHubComponent, reviewGitHubComponent, rollbackGitHubComponent } from '@/lib/agent-hub/marketplace/github-components'
import { buildTemplate, stopTemplatePreview, templatePreviewStatus, templateBuildLog, validateTemplateProject } from '@/lib/agent-hub/marketplace/github-runtime'
import { buildGitHubBrowserPreview } from '@/lib/agent-hub/marketplace/github-browser-preview'
export const runtime = 'nodejs'
const denied = () => NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
export async function GET(request: NextRequest) {
  if (isCrossOrigin(request)) return denied()
  try {
    const ref = request.nextUrl.searchParams.get('templatePreview')
    if (ref) {
      const preview = await readTemplatePreview(ref)
      return preview ? new Response(new Uint8Array(preview.data), { headers: { 'Content-Type': preview.type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } }) : new Response(null, { status: 404 })
    }
    const id = request.nextUrl.searchParams.get('id')
    if (id) return NextResponse.json({ ok: true, component: await marketplaceRead(id) }, { headers: { 'Cache-Control': 'no-store' } })
    const state = await readMarketplace()
    return NextResponse.json({ ok: true, catalog: state.components, templates: await listGitHubTemplates(), favorites: state.favorites, recent: state.recent, presets: state.presets, installations: state.installations, registries: state.registries, categories: COMPONENT_CATEGORIES, workspaces: (await selectedWorkspaces()).filter((entry) => entry.id) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Could not read the component library.' }, { status: 400 }) }
}
export async function POST(request: NextRequest) {
  if (isCrossOrigin(request)) return denied()
  try {
    if (Number(request.headers.get('content-length')) > 2_500_000) throw new Error('Request exceeds 2.5 MB.')
    const text = await request.text()
    if (Buffer.byteLength(text) > 2_500_000) throw new Error('Request exceeds 2.5 MB.')
    const body = JSON.parse(text) as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Provide a JSON action object.')
    const id = typeof body.id === 'string' ? body.id : ''
    switch (body.action) {
      case 'github-component-preview': return NextResponse.json({ ok: true, preview: await buildGitHubBrowserPreview(String(body.ref ?? ''), String(body.file ?? '')) })
      case 'github-template-validate': return NextResponse.json({ ok: true, validation: await validateTemplateProject(String(body.ref ?? '')) })
      case 'github-template-build-log': return NextResponse.json({ ok: true, build: await templateBuildLog(String(body.ref ?? '')) ?? null })
      case 'github-template-build': return NextResponse.json({ ok: true, build: await buildTemplate(String(body.ref ?? ''), String(body.commit ?? ''), body.approved === true) })
      case 'github-preview-start': return NextResponse.json({ ok: true, build: await buildTemplate(String(body.ref ?? ''), String(body.commit ?? ''), body.approved === true, true) })
      case 'github-preview-status': return NextResponse.json({ ok: true, preview: templatePreviewStatus(String(body.ref ?? '')) })
      case 'github-preview-stop': {
        await stopTemplatePreview(String(body.ref ?? ''))
        return NextResponse.json({ ok: true })
      }
      case 'github-component-details': return NextResponse.json({ ok: true, component: await analyzeGitHubComponent(String(body.ref ?? ''), String(body.file ?? '')) })
      case 'github-component-review': return NextResponse.json({ ok: true, review: await reviewGitHubComponent(String(body.ref ?? ''), String(body.file ?? ''), String(body.workspaceId ?? '')) })
      case 'github-component-install': return NextResponse.json({ ok: true, installation: await installGitHubComponent(String(body.ref ?? ''), String(body.file ?? ''), String(body.workspaceId ?? ''), String(body.review ?? ''), body.approved === true) })
      case 'github-component-rollback': return NextResponse.json({ ok: true, ...await rollbackGitHubComponent(id, body.approved === true) })
      case 'github-catalog': return NextResponse.json({ ok: true, snapshot: await readGitHubCatalog() ?? null })
      case 'github-catalog-sync': {
        const maxKb = Number(body.maxKb ?? 25000)
        if (!Number.isInteger(maxKb) || maxKb < 1 || maxKb > 25000) throw new Error('Choose a repository limit between 1 and 25,000 KB.')
        return NextResponse.json({ ok: true, snapshot: await syncGitHubCatalog(String(body.query ?? '').slice(0, 100), { maxKb, framework: String(body.framework ?? ''), license: String(body.license ?? '') }) })
      }
      case 'github-queue': return NextResponse.json({ ok: true, queue: await downloadStatus() })
      case 'github-queue-update': {
        const operation = body.operation
        if (operation !== 'enqueue' && operation !== 'pause' && operation !== 'resume' && operation !== 'retry' && operation !== 'step' && operation !== 'cancel') throw new Error('Invalid download operation.')
        const refs = body.refs
        if (operation === 'enqueue') {
          if (body.approved !== true || !Array.isArray(refs) || refs.length < 1 || refs.length > 1000 || !refs.every((ref) => typeof ref === 'string')) throw new Error('Review and approve the repository references first.')
          if (refs.length > 24 || body.snapshotId) {
            const snapshot = await readGitHubCatalog()
            const eligible = new Set(snapshot?.results.filter((row) => row.eligible).map((row) => row.ref))
            if (!snapshot || snapshot.id !== body.snapshotId || !refs.every((ref) => eligible.has(ref))) throw new Error('Review the current catalog snapshot and select eligible repositories.')
          }
        }
        return NextResponse.json({ ok: true, queue: await updateDownloadQueue(operation, operation === 'enqueue' ? refs as string[] : []) })
      }
      case 'github-search': {
        const source = String(body.source ?? '')
        const page = Number(body.page ?? 1)
        if (!['react', 'tailwind', 'topic'].includes(source) || !Number.isInteger(page) || page < 1 || page > 42) throw new Error('Invalid GitHub source or page.')
        return NextResponse.json({ ok: true, ...await discoverGitHub(source, String(body.query ?? '').slice(0, 100), page) })
      }
      case 'github-source': return NextResponse.json({ ok: true, source: await readTemplateSource(String(body.ref ?? ''), String(body.file ?? '')) })
      case 'github-install': return NextResponse.json({ ok: true, installation: await installGitHubTemplate(String(body.ref ?? ''), String(body.workspaceId ?? ''), String(body.commit ?? ''), body.approved === true) })
      case 'favorite': case 'recent': return NextResponse.json({ ok: true, values: await updateCollection(body.action, id, body.value !== false) })
      case 'preset': return NextResponse.json({ ok: true, preset: await savePreset(body.preset) })
      case 'import': return NextResponse.json({ ok: true, component: await importComponent(body.item) })
      case 'trust-registry': return NextResponse.json({ ok: true, registry: await trustRegistry(body.url, String(body.name ?? ''), body.approved === true) })
      case 'fetch': return NextResponse.json({ ok: true, component: await importFromRegistry(body.url, body.approved === true) })
      case 'propose': {
        if (body.operation !== undefined && !['install','uninstall','restore'].includes(String(body.operation))) throw new Error('Choose install, uninstall or restore.')
        return NextResponse.json({ ok: true, proposal: await proposeInstall({ id, workspaceId: String(body.workspaceId ?? ''), operation: body.operation as 'install' | 'uninstall' | 'restore' | undefined, installationId: typeof body.installationId === 'string' ? body.installationId : undefined }) })
      }
      case 'apply': return NextResponse.json({ ok: true, ...await applyProposal(String(body.proposalId ?? ''), body.approved === true) })
      default: throw new Error('Unknown component-library action.')
    }
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Component operation failed.' }, { status: 400 }) }
}
