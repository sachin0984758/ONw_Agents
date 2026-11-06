import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { NextRequest, NextResponse } from 'next/server'
import {
  createCustomModelId,
  readCustomModels,
  toPublicCustomModel,
  validateCustomModel,
  writeCustomModels,
  type CustomModelInput,
} from '@/lib/agent-hub/custom-models'

// ── Custom Models API ────────────────────────────────────────────────────────
// CRUD for user-defined OpenAI-compatible API models.
//   GET    /api/custom-models  → list all custom models (API keys redacted)
//   POST   /api/custom-models  → create a new custom model
//   DELETE /api/custom-models?id=… → delete a custom model
// ─────────────────────────────────────────────────────────────────────────────

// Same-origin guard used by the other state-mutating routes: local tooling
// (curl, no Origin header) is allowed; a browser on another origin is not.
// The API key is a secret, so this route is guarded on every method.


export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  const models = await readCustomModels()
  return NextResponse.json({ ok: true, models: models.map(toPublicCustomModel) })
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  let body: CustomModelInput
  try {
    body = (await req.json()) as CustomModelInput
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const validation = validateCustomModel(body)
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400 })
  }

  const models = await readCustomModels()
  const newModel = {
    id: createCustomModelId(),
    name: body.name.trim(),
    endpoint: body.endpoint.trim(),
    apiKey: body.apiKey.trim(),
    modelId: body.modelId.trim(),
    createdAt: new Date().toISOString(),
  }
  models.push(newModel)
  await writeCustomModels(models)

  return NextResponse.json({ ok: true, model: toPublicCustomModel(newModel) })
}

export async function DELETE(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ ok: false, error: 'Missing id parameter.' }, { status: 400 })
  }

  const models = await readCustomModels()
  const filtered = models.filter((m) => m.id !== id)
  if (filtered.length === models.length) {
    return NextResponse.json({ ok: false, error: 'Model not found.' }, { status: 404 })
  }
  await writeCustomModels(filtered)

  return NextResponse.json({ ok: true, deleted: id })
}
