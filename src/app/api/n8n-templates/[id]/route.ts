import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse } from 'next/server'

const PUBLIC_DIR = join(process.cwd(), 'public')
const TEMPLATES_DIR = join(PUBLIC_DIR, 'n8n-templates')

/**
 * Serve an n8n template export for import.
 *
 * Templates live in public/n8n-templates/<filename>.json and are named by the
 * numeric part of the template id (n8n-10000 -> 10000.json).
 *
 * The app is configured with output: "standalone", and Next.js does not serve
 * the public/ tree from that output in dev, so these are served explicitly here
 * instead of via a static <a download> link.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Ids are strictly "n8n-<digits>" — this also prevents path traversal
    // (e.g. "n8n-../../secret" would otherwise escape the templates dir).
    if (!id || typeof id !== 'string' || !/^n8n-\d+$/.test(id)) {
      return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 })
    }

    // Template ids are "n8n-10000"; the file on disk is "10000.json".
    const numeric = id.slice('n8n-'.length)
    const filename = `${numeric}.json`
    const candidates: string[] = [
      join(TEMPLATES_DIR, filename),
      join(process.cwd(), '.next', 'standalone', 'public', 'n8n-templates', filename),
    ]

    const filePath = candidates.find((p) => existsSync(p))
    if (!filePath) {
      return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
    }

    const data = readFileSync(filePath, 'utf8')
    return NextResponse.json(JSON.parse(data), {
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
    }
    console.error('[n8n-template] download error:', err)
    return NextResponse.json({ ok: false, error: 'server error' }, { status: 500 })
  }
}