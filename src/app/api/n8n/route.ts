import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { NextRequest, NextResponse } from 'next/server'
import {
  N8nError,
  clearStoredN8nConfigSafe,
  getExecutionHistory,
  getN8nStatus,
  importTemplate,
  inspectTemplate,
  executeTemplate,
  refreshExecutionRecord,
  saveConfig,
  setActivation,
  unlinkTemplate,
} from '@/lib/agent-hub/n8n'

// ─── n8n integration API ─────────────────────────────────────────────────────
// Bridges AgentHub to a real n8n instance. All n8n credentials stay server-side
// (env vars or db/n8n-config.json); nothing returned here ever contains a key.
//
//   GET    /api/n8n?resource=status                    → connection status
//   GET    /api/n8n?resource=workflow&templateId=…      → trigger + import info
//   GET    /api/n8n?resource=executions[&templateId=…]  → AgentHub execution history
//   GET    /api/n8n?resource=execution&id=…             → one record (refreshed)
//   POST   /api/n8n  { action: 'config'|'test'|'import'|'execute'|'activate'|'deactivate'|'refresh'|'unlink', … }
//   DELETE /api/n8n                                     → clear stored connection config
// ─────────────────────────────────────────────────────────────────────────────

// Same-origin guard used by the other state-mutating routes: local tooling
// (curl, no Origin) is allowed; a browser on another origin is not.


function errorResponse(e: unknown) {
  if (e instanceof N8nError) {
    const status =
      e.code === 'unauthorized'
        ? 401
        : e.code === 'not_imported'
          ? 409
          : e.code === 'n8n_error'
            ? 502
            : 400
    return NextResponse.json({ ok: false, error: { code: e.code, message: e.message } }, { status })
  }
  const message = e instanceof Error ? e.message : 'Unexpected error.'
  return NextResponse.json({ ok: false, error: { code: 'internal', message } }, { status: 500 })
}

export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: { code: 'forbidden', message: 'Cross-origin requests are not allowed.' } }, { status: 403 })
  }
  const resource = req.nextUrl.searchParams.get('resource') ?? 'status'
  try {
    if (resource === 'status') {
      return NextResponse.json({ ok: true, status: await getN8nStatus() })
    }
    if (resource === 'workflow') {
      const templateId = req.nextUrl.searchParams.get('templateId')
      if (!templateId) return NextResponse.json({ ok: false, error: { code: 'bad_request', message: 'templateId is required.' } }, { status: 400 })
      return NextResponse.json({ ok: true, workflow: await inspectTemplate(templateId) })
    }
    if (resource === 'executions') {
      const templateId = req.nextUrl.searchParams.get('templateId') ?? undefined
      return NextResponse.json({ ok: true, executions: await getExecutionHistory(templateId || undefined) })
    }
    if (resource === 'execution') {
      const id = req.nextUrl.searchParams.get('id')
      if (!id) return NextResponse.json({ ok: false, error: { code: 'bad_request', message: 'id is required.' } }, { status: 400 })
      const record = await refreshExecutionRecord(id)
      if (!record) return NextResponse.json({ ok: false, error: { code: 'not_found', message: 'Execution record not found.' } }, { status: 404 })
      return NextResponse.json({ ok: true, execution: record })
    }
    return NextResponse.json({ ok: false, error: { code: 'bad_resource', message: `Unknown resource "${resource}".` } }, { status: 400 })
  } catch (e) {
    return errorResponse(e)
  }
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: { code: 'forbidden', message: 'Cross-origin requests are not allowed.' } }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: { code: 'bad_json', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const action = String(body.action ?? '')
  const templateId = typeof body.templateId === 'string' ? body.templateId : undefined
  const requireTemplate = () => {
    if (!templateId) throw new N8nError('bad_request', 'templateId is required.')
    return templateId
  }

  try {
    switch (action) {
      case 'config': {
        const config = await saveConfig({
          baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
          apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
          webhookBaseUrl: typeof body.webhookBaseUrl === 'string' ? body.webhookBaseUrl : undefined,
          timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        })
        return NextResponse.json({ ok: true, config, status: await getN8nStatus() })
      }
      case 'test': {
        return NextResponse.json({ ok: true, status: await getN8nStatus() })
      }
      case 'import': {
        const result = await importTemplate(requireTemplate(), { activate: body.activate === true })
        return NextResponse.json({ ok: true, ...result })
      }
      case 'execute': {
        const result = await executeTemplate(requireTemplate(), {
          confirmCredentials: body.confirmCredentials === true,
          data: body.data,
        })
        // Spread first: `result.ok` means "the run succeeded", which must not
        // overwrite the HTTP-level `ok: true` (the request itself succeeded).
        return NextResponse.json({ ...result, ok: true, executed: result.ok })
      }
      case 'activate':
      case 'deactivate': {
        const link = await setActivation(requireTemplate(), action === 'activate')
        return NextResponse.json({ ok: true, link })
      }
      case 'refresh': {
        const id = typeof body.id === 'string' ? body.id : undefined
        if (!id) throw new N8nError('bad_request', 'id is required.')
        const record = await refreshExecutionRecord(id)
        return NextResponse.json({ ok: true, execution: record })
      }
      case 'unlink': {
        await unlinkTemplate(requireTemplate())
        return NextResponse.json({ ok: true })
      }
      default:
        return NextResponse.json({ ok: false, error: { code: 'bad_action', message: `Unknown action "${action}".` } }, { status: 400 })
    }
  } catch (e) {
    return errorResponse(e)
  }
}

export async function DELETE(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: { code: 'forbidden', message: 'Cross-origin requests are not allowed.' } }, { status: 403 })
  }
  try {
    await clearStoredN8nConfigSafe()
    return NextResponse.json({ ok: true, status: await getN8nStatus() })
  } catch (e) {
    return errorResponse(e)
  }
}
