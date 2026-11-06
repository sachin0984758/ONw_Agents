import { NextRequest, NextResponse } from 'next/server'
import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { obsidianStatus } from '@/lib/agent-hub/obsidian/context'
import { connectVault, connectedVault, discoverVaults, disconnectVault, noteIndex, proposeMemory, readNote, recordMemoryActivity, reviewMemory, searchNotes, vaultGraph } from '@/lib/agent-hub/obsidian/vault'
import { updateCapabilityPack } from '@/lib/agent-hub/capabilities/registry'
import { listVaultFiles, readVaultFile } from '@/lib/agent-hub/obsidian/files'
import { retrievalIndex, retrieveVault } from '@/lib/agent-hub/obsidian/retrieval'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) return json({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403)
  try {
    const op = req.nextUrl.searchParams.get('op')
    if (op === 'discover') return json({ ok: true, vaults: await discoverVaults() })
    if (op === 'files') return json({ ok: true, ...await listVaultFiles(req.nextUrl.searchParams.get('q') || '', Number(req.nextUrl.searchParams.get('offset') || 0)) })
    if (op === 'file') { const result = await readVaultFile(req.nextUrl.searchParams.get('path'), Number(req.nextUrl.searchParams.get('offset') || 0)); await recordMemoryActivity('read', 'user-files', [result.path], result.connectionId); return json({ ok: true, file: result }) }
    if (op === 'retrieve') return json({ ok: true, ...await retrieveVault(req.nextUrl.searchParams.get('q') || '') })
    if (op === 'coverage') { const index = await retrievalIndex(req.nextUrl.searchParams.get('refresh') === 'true'); return json({ ok: true, indexedFiles: index.indexedFiles, chunks: index.chunks.length, failures: index.failures, limited: index.limited, localOnly: true, fileLimitMB: 16, formats: ['Markdown', 'text/source/data', 'PDF text (best effort)', 'DOCX', 'ZIP text/source', 'XLSX cached values'], imageSupport: 'Attach to Chat/Sessions with a vision-capable model; image bytes are not searched as text.' }) }
    if (op === 'graph') return json({ ok: true, graph: await vaultGraph(req.nextUrl.searchParams.get('refresh') === 'true') })
    if (op === 'browse') { const index = await noteIndex(); return json({ ok: true, notes: index.notes, limited: index.limited, connectionId: index.connection.id }) }
    if (op === 'search') { const result = await searchNotes(req.nextUrl.searchParams.get('q') || ''); await recordMemoryActivity('search', 'user', result.notes.map((note) => note.path), result.connection.id); return json({ ok: true, ...result }) }
    if (op === 'read') { const connection = await connectedVault(), note = await readNote(req.nextUrl.searchParams.get('path')); await recordMemoryActivity('read', 'user', [note.path], connection.id); return json({ ok: true, note }) }
    return json({ ok: true, status: await obsidianStatus() })
  } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : 'Memory operation failed.' }, 400) }
}
export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return json({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403)
  try {
    const raw = await req.text()
    if (Buffer.byteLength(raw) > 32_000) throw new Error('Memory request exceeds 32 KB.')
    const body = JSON.parse(raw)
    let result: unknown
    if (body.action === 'connect') {
      await connectVault(body.path); await updateCapabilityPack('install', { id: 'obsidian-memory' })
      for (const agentId of ['website', 'game', 'research', 'other']) await updateCapabilityPack('assign', { id: 'obsidian-memory', agentId })
      await updateCapabilityPack('enable', { id: 'obsidian-memory' })
    } else if (body.action === 'disconnect') { await disconnectVault(); await updateCapabilityPack('disable', { id: 'obsidian-memory' }) }
    else if (body.action === 'refresh') await noteIndex(true)
    else if (body.action === 'propose') result = await proposeMemory(body.title, body.content, 'user')
    else if (body.action === 'review' && typeof body.approved === 'boolean') result = await reviewMemory(body.id, body.hash, body.approved)
    else throw new Error('Choose a valid memory action.')
    return json({ ok: true, result, status: await obsidianStatus() })
  } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : 'Memory operation failed.' }, 400) }
}
