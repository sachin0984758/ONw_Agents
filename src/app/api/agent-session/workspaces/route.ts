import { NextRequest, NextResponse } from 'next/server'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { registerWorkspace, resolveWorkspace } from '@/lib/agent-hub/session/workspaces'

export const runtime = 'nodejs'
const execute = promisify(execFile)
let picking = false

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  const body = await req.json().catch(() => null)
  try {
    // Pasting a folder is also an explicit selection; tools receive only its
    // registered id, never an unchecked path from the model.
    if (body?.action === 'select') return NextResponse.json({ ok: true, workspace: await registerWorkspace(body.path) })
    if (body?.action !== 'pick') return NextResponse.json({ ok: false, error: 'Choose a valid folder action.' }, { status: 400 })
    if (process.platform !== 'win32') return NextResponse.json({ ok: false, error: 'Paste the full project folder path on this system.' }, { status: 501 })
    if (picking) return NextResponse.json({ ok: false, error: 'A folder picker is already open.' }, { status: 409 })
    const start = await resolveWorkspace(typeof body.workspaceId === 'string' ? body.workspaceId : undefined)
    picking = true
    try {
      const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = 'Select the project folder for AgentHub'
$picker.ShowNewFolderButton = $false
$picker.SelectedPath = $env:AGENTHUB_PICKER_START
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Width = 1
$owner.Height = 1
try {
  $owner.Show()
  $owner.Activate()
  if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    @{ path = $picker.SelectedPath } | ConvertTo-Json -Compress
  } else { @{ cancelled = $true } | ConvertTo-Json -Compress }
} finally { $picker.Dispose(); $owner.Dispose() }`
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, signal: req.signal, timeout: 180_000, maxBuffer: 16_384, env: { ...process.env, AGENTHUB_PICKER_START: start.root } }).catch(() => { throw new Error('The Windows folder picker could not finish. Try again, or use Paste path to choose your project folder.') })
      const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''))
      if (result.cancelled) return NextResponse.json({ ok: true, cancelled: true })
      return NextResponse.json({ ok: true, workspace: await registerWorkspace(result.path) })
    } finally { picking = false }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Could not open the project folder.' }, { status: 400 })
  }
}
