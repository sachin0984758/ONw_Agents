import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-attachment-check-'))
  process.env.AGENT_HUB_DB_DIR = directory
  const originalFetch = globalThis.fetch
  try {
    const { createModelResponder } = await import('../src/lib/agent-hub/session/model')
    const { dataUrlFor } = await import('../src/lib/agent-hub/attachments')
    const { extractDocumentText } = await import('../src/lib/agent-hub/document-extract')
    const url = dataUrlFor('', 'cGl4ZWxz', 'test.png')
    assert.equal(url, 'data:image/png;base64,cGl4ZWxz')
    console.log('PASS images with missing MIME types retain a valid image data URL')
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nstream\nBT (Invoice total is 42) Tj ET\nendstream\nendobj\n%%EOF')
    const extracted = extractDocumentText('invoice.pdf', 'application/pdf', pdf)
    assert.ok(extracted.ok && extracted.text.includes('Invoice total is 42'))
    console.log('PASS uncompressed PDF text is extracted as actual document context')
    let requests = 0
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      const user = body.messages.findLast((message: { role: string }) => message.role === 'user')
      assert.ok(Array.isArray(user.content))
      assert.equal(user.content.at(-1).image_url.url, url)
      requests++
      if (requests === 1) return Response.json({ error: 'Tools not supported' }, { status: 400 })
      return Response.json({ choices: [{ message: { content: 'The image is readable.' }, finish_reason: 'stop' }] })
    }
    const responder = createModelResponder({ endpoint: 'http://127.0.0.1:1234/v1', apiKey: '', modelId: 'minicpm-v', label: 'fixture' }, 'off', { images: [{ type: 'image_url', image_url: { url } }] })
    const result = await responder([{ role: 'system', content: 'Read attached images.' }, { role: 'user', content: 'Describe this picture.' }], [{ name: 'read_file', description: 'Read', parameters: { type: 'object', properties: {} } }], () => {}, new AbortController().signal)
    assert.equal(requests, 2)
    assert.equal(result.content, 'The image is readable.')
    console.log('PASS Session sends real image payloads, including the text-tool fallback request')
  } finally {
    globalThis.fetch = originalFetch
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('agenthub-attachment-check-')) await fs.rm(directory, { recursive: true, force: true })
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
