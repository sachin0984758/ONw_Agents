import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { detectLocalProviders } from '@/lib/agent-hub/llm'
import { autoSnapshot, controlTask, decideAction, deleteAutoTask, enableComputer, manualComputerAction, startAutoTask } from '@/lib/agent-hub/computer/runtime'
import { startComputerBridge, stopComputerBridge } from '@/lib/agent-hub/computer/bridge'
import { COMPUTER_READS, validateComputerAction } from '@/lib/agent-hub/computer/protocol'
import { selectedWorkspaces } from '@/lib/agent-hub/session/workspaces'
import { saveComputerWorkspace } from '@/lib/agent-hub/computer/preferences'
import { computerModels } from '@/lib/agent-hub/computer/model-selection'

export const runtime = 'nodejs'
function localRequest(req: NextRequest, mutate = false): boolean {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(req.nextUrl.hostname)) return false
  const origin = req.headers.get('origin')
  if (mutate && !origin) return false
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false
  try { return !origin || new URL(origin).origin === req.nextUrl.origin } catch { return false }
}
const scopeSchema = z.object({ approvalMode: z.enum(['always-ask', 'when-needed', 'full']).default('always-ask'), applications: z.array(z.enum(['notepad', 'explorer', 'vscode', 'browser', 'calculator'])).max(5), domains: z.array(z.string().regex(/^[a-zA-Z0-9.-]{1,253}$/)).max(20), readonly: z.boolean(), workspaceId: z.string().uuid().optional(), workspaceAccess: z.enum(['none', 'read', 'write']).default('none'), internet: z.boolean().default(false), pointerProfile: z.enum(['fast', 'normal', 'demonstration']).default('normal'), screenshots: z.boolean().default(true) }).strict()

export async function GET(req: NextRequest) {
  if (!localRequest(req)) return NextResponse.json({ ok: false, error: 'Auto is available only through this computer’s localhost dashboard.' }, { status: 403 })
  if (process.env.AGENTHUB_LOCAL_ONLY !== '1') return NextResponse.json({ ok: true, computer: { enabled: false, connected: false, requiresLocalRestart: true, error: 'Restart AgentHub with npm run dev to activate the secure loopback-only computer-control endpoint.' }, tasks: [], activeId: null, models: [], workspaces: [] })
  const data = await autoSnapshot()
  if (req.nextUrl.searchParams.get('models') === 'true') {
    const providers = await detectLocalProviders()
    return NextResponse.json({ ok: true, ...data, workspaces: await selectedWorkspaces(), models: computerModels(providers) })
  }
  return NextResponse.json({ ok: true, ...data })
}

export async function POST(req: NextRequest) {
  if (!localRequest(req, true)) return NextResponse.json({ ok: false, error: 'Computer control requires an authenticated same-origin localhost request.' }, { status: 403 })
  const body = await req.json().catch(() => null)
  if (process.env.AGENTHUB_LOCAL_ONLY !== '1' && !['stop', 'disconnect'].includes(body?.action)) return NextResponse.json({ ok: false, error: 'Restart AgentHub with npm run dev. Computer control stays disabled until the dashboard is bound to loopback only.' }, { status: 403 })
  try {
    if (body?.action === 'workspace') {
      const workspaceId = z.string().uuid().optional().parse(body.workspaceId)
      await saveComputerWorkspace(workspaceId)
      // This changes the next-task preference, never a running task's scope.
      return NextResponse.json({ ok: true, ...await autoSnapshot() })
    }
    if (body?.action === 'connect') { await startComputerBridge(); return NextResponse.json({ ok: true, ...await autoSnapshot() }) }
    if (body?.action === 'disconnect') { await controlTask('stop'); await stopComputerBridge(); return NextResponse.json({ ok: true }) }
    if (body?.action === 'enable') {
      const scope = scopeSchema.parse(body.scope)
      return NextResponse.json({ ok: true, ...await enableComputer(scope) })
    }
    if (body?.action === 'reset') { await controlTask('stop'); await saveComputerWorkspace(undefined); return NextResponse.json({ ok: true, ...await autoSnapshot() }) }
    if (body?.action === 'delete') {
      const id = z.string().uuid().parse(body.id)
      return NextResponse.json(await deleteAutoTask(id))
    }
    if (body?.action === 'start' || body?.action === 'plan') {
      const input = z.object({ request: z.string().trim().min(1).max(8000), profile: z.enum(['fast', 'balanced', 'careful']), model: z.string().max(300), visionModel: z.string().max(300).default(''), saveSummary: z.boolean().default(false) }).strict().parse(body.input)
      return NextResponse.json({ ok: true, task: await startAutoTask({ ...input, planningOnly: body.action === 'plan' }) })
    }
    if (['pause', 'resume', 'stop'].includes(body?.action)) { await controlTask(body.action, body.id); return NextResponse.json({ ok: true }) }
    if (body?.action === 'approve') {
      const decision = z.enum(['once', 'always', 'decline']).parse(body.decision ?? (body.approved === true ? 'once' : 'decline'))
      const ok = decideAction(String(body.id), String(body.approvalId), decision)
      return NextResponse.json({ ok, error: ok ? undefined : 'The approval expired.' }, { status: ok ? 200 : 409 })
    }
    if (body?.action === 'tool') {
      if ((await autoSnapshot()).activeId) throw new Error('Manual tools are unavailable while an Auto task is running.')
      const name = String(body.name)
      const args = validateComputerAction(name, body.args)
      if (!COMPUTER_READS.has(name) && body.confirmed !== true) throw new Error('Review and confirm the exact input action first.')
      if (name === 'visual_ground') throw new Error('Visual grounding is available inside a task with an available loaded local vision model.')
      return NextResponse.json(await manualComputerAction(name, args, body.confirmed === true))
    }
    return NextResponse.json({ ok: false, error: 'Unknown Auto action.' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join('; ') : error instanceof Error ? error.message : 'Computer-control request failed.' }, { status: 400 })
  }
}
