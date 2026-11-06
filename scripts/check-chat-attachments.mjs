#!/usr/bin/env node
// ── Chat attachments + Thinking checks ───────────────────────────────────────
//   node scripts/check-chat-attachments.mjs
//
// Proves the Chat composer's new behaviour is real and honest:
//   * file classification / validation (images, text/source, PDF, DOCX),
//   * local document extraction (text, DOCX zip, best-effort PDF) with explicit
//     failures instead of silent drops,
//   * vision capability detection that refuses to fake image understanding,
//   * the Thinking control sending a NATIVE reasoning param only for models that
//     support it, and a clearly-labelled prompt-guided depth instruction
//     otherwise.
//
// The real src/lib/agent-hub/{attachments,document-extract}.ts modules are
// transpiled and executed, so nothing is asserted by name alone. No network
// call is made and no provider is required.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(title) {
  console.log(`\n── ${title} ──`)
}

// ── Build the real modules ───────────────────────────────────────────────────
const BUILD_DIR = path.join(ROOT, '.tmp-chat-attach-check')
await fs.rm(BUILD_DIR, { recursive: true, force: true })
await fs.mkdir(BUILD_DIR, { recursive: true })
for (const name of ['attachments', 'document-extract']) {
  const src = await fs.readFile(path.join(ROOT, 'src', 'lib', 'agent-hub', `${name}.ts`), 'utf-8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  await fs.writeFile(path.join(BUILD_DIR, `${name}.js`), out, 'utf-8')
}
const require = createRequire(pathToFileURL(path.join(ROOT, 'package.json')).href)
const att = require(path.join(BUILD_DIR, 'attachments.js'))
const docx = require(path.join(BUILD_DIR, 'document-extract.js'))
const readSource = (rel) => fs.readFile(path.join(ROOT, rel), 'utf-8')

// ── Minimal fixtures ─────────────────────────────────────────────────────────
// A single-entry stored ZIP, also used to build a minimal DOCX fixture.
function makeZipEntry(entryName, content) {
  const name = Buffer.from(entryName, 'utf-8')
  const data = Buffer.from(content, 'utf-8')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(0, 8) // stored
  local.writeUInt32LE(0, 14) // crc (ignored by the reader)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  const localBlock = Buffer.concat([local, name, data])

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(0, 10) // stored
  central.writeUInt32LE(0, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt32LE(0, 36)
  central.writeUInt32LE(0, 38)
  central.writeUInt32LE(0, 42) // local header offset
  const centralBlock = Buffer.concat([central, name])

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralBlock.length, 12)
  eocd.writeUInt32LE(localBlock.length, 16)
  return Buffer.concat([localBlock, centralBlock, eocd])
}
const makeDocx = (xml) => makeZipEntry('word/document.xml', xml)

// A tiny PDF with one FlateDecode content stream holding a text object.
function makePdf(text) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const flate = zlib.deflateSync(Buffer.from(content, 'latin1'))
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Length ' + flate.length + '>>stream\n', 'latin1')
  const tail = Buffer.from('\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  return Buffer.concat([head, flate, tail])
}

try {
  // ── 1. Classification ─────────────────────────────────────────────────────
  section('Attachment classification')
  ok('PNG is an image', att.attachmentKind('shot.png', 'image/png') === 'image')
  ok('JPEG with empty mime is detected by extension', att.attachmentKind('photo.JPG', '') === 'image')
  ok('WebP is an image', att.attachmentKind('a.webp', 'image/webp') === 'image')
  ok('Markdown is a document', att.attachmentKind('notes.md', 'text/markdown') === 'document')
  ok('JSON is a document', att.attachmentKind('data.json', 'application/json') === 'document')
  ok('source code is a document', att.attachmentKind('main.ts', '') === 'document')
  ok('CSV is a document', att.attachmentKind('rows.csv', 'text/csv') === 'document')
  ok('PDF is a document', att.attachmentKind('paper.pdf', 'application/pdf') === 'document')
  ok(
    'DOCX is a document',
    att.attachmentKind('brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ===
      'document',
  )
  ok('ZIP is a document', att.attachmentKind('project.zip', 'application/zip') === 'document')
  ok('an executable is NOT attachable', att.attachmentKind('evil.exe', 'application/x-msdownload') === null)
  ok('a video is NOT attachable', att.attachmentKind('clip.mp4', 'video/mp4') === null)

  // ── 2. Validation (no silent drops) ───────────────────────────────────────
  section('Validation')
  ok('a good file validates clean', att.validateAttachment('notes.md', 'text/markdown', 1024) === null)
  ok('an oversize file is rejected with a reason', /limit/.test(att.validateAttachment('big.png', 'image/png', 9 * 1024 * 1024) || ''))
  ok('an empty file is rejected', /empty/.test(att.validateAttachment('empty.txt', 'text/plain', 0) || ''))
  ok('an unsupported type is rejected', /not a supported/.test(att.validateAttachment('x.exe', '', 100) || ''))

  // ── 3. Vision capability (never fake it) ──────────────────────────────────
  section('Vision capability detection')
  ok('provider-reported vlm type counts as vision', att.modelLooksVision('anything', 'vlm') === true)
  ok('a llava model counts as vision', att.modelLooksVision('llava-v1.6-7b', 'llm') === true)
  ok('a qwen-vl model counts as vision', att.modelLooksVision('qwen2.5-vl-7b-instruct', 'llm') === true)
  ok('a plain instruct model does NOT count as vision', att.modelLooksVision('qwen2.5-coder-3b-instruct', 'llm') === false)
  ok('an embeddings model does NOT count as vision', att.modelLooksVision('nomic-embed', 'embeddings') === false)

  // ── 4. Thinking: native only where supported ──────────────────────────────
  section('Thinking mode')
  ok('a plain local model is prompt-guided (not native)', att.thinkingModeFor('qwen2.5-coder-3b-instruct') === 'prompt')
  ok('an o3 model is native', att.thinkingModeFor('o3-mini') === 'native')
  ok('a deepseek-r model is native', att.thinkingModeFor('deepseek-r1:8b') === 'native')
  ok('native mode sends a reasoning_effort param', att.reasoningBody('o3-mini', 'high').reasoning_effort === 'high')
  ok('prompt-guided mode sends NO native param', Object.keys(att.reasoningBody('qwen2.5-coder-3b-instruct', 'high')).length === 0)
  const suffix = att.thinkingPromptSuffix('medium')
  ok('the prompt-guided suffix is applied to the prompt', /Thinking/.test(suffix) && /medium/.test(suffix))
  ok('the prompt-guided suffix forbids leaking chain-of-thought', /chain-of-thought/i.test(suffix))

  // ── 5. Data-URL helpers ───────────────────────────────────────────────────
  section('Data URLs (image parts)')
  const round = att.parseDataUrl(att.dataUrlFor('image/png', 'AAAB'))
  ok('image data URL round-trips', round && round.mime === 'image/png' && round.base64 === 'AAAB')
  ok('a malformed data URL parses to null', att.parseDataUrl('not-a-data-url') === null)

  // ── 6. Local document extraction ──────────────────────────────────────────
  section('Document extraction (local, no cloud)')
  const txt = docx.extractDocumentText('notes.md', 'text/markdown', Buffer.from('# Title\n\nHello', 'utf-8'))
  ok('text files extract to their contents', txt.ok === true && txt.text.includes('Hello') && txt.method === 'text')

  const d = docx.extractDocumentText(
    'brief.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    makeDocx('<w:document><w:body><w:p><w:r><w:t>Quarterly &amp; plan</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>'),
  )
  ok('DOCX extracts text from word/document.xml', d.ok === true && d.method === 'docx')
  ok('DOCX paragraphs become line breaks', d.ok === true && /Quarterly & plan/.test(d.text) && /Second line/.test(d.text))

  const zip = docx.extractDocumentText('project.zip', 'application/zip', makeZipEntry('src/readme.md', '# Project\nHello ZIP'))
  ok('ZIP extracts bounded text/source content', zip.ok === true && zip.method === 'zip' && zip.text.includes('Hello ZIP'))
  const binaryZip = docx.extractDocumentText('images.zip', 'application/zip', makeZipEntry('photo.png', 'binary data'))
  ok('ZIP with no readable text fails explicitly', binaryZip.ok === false && /no readable text/.test(binaryZip.error))

  const p = docx.extractDocumentText('paper.pdf', 'application/pdf', makePdf('Hello AgentHub PDF'))
  ok('PDF extracts text from its content stream', p.ok === true && p.method === 'pdf' && p.text.includes('Hello AgentHub PDF'))

  const bad = docx.extractDocumentText('broken.pdf', 'application/pdf', Buffer.from('not really a pdf'))
  ok('an unreadable PDF fails EXPLICITLY (no silent drop)', bad.ok === false && /could not be read/.test(bad.error))

  const unsupported = docx.extractDocumentText('archive.bin', 'application/octet-stream', Buffer.from('PK'))
  ok('an unsupported document fails explicitly', unsupported.ok === false && /not a supported/.test(unsupported.error))

  // ── 7. Route wiring (server) ──────────────────────────────────────────────
  section('Chat API route wiring')
  const route = await readSource('src/app/api/chat/route.ts')
  ok('the route extracts documents locally', route.includes('extractDocumentText('))
  ok('the route validates attachments (no silent drop)', route.includes('validateAttachment(') && route.includes('status: 400'))
  ok('the route builds real multimodal image parts', route.includes("type: 'image_url'") && route.includes('dataUrlFor('))
  ok('a text-only model refuses to fake seeing an image', route.includes('modelLooksVision(') && /is text-only and cannot see images/.test(route))
  ok('the refusal suggests an available vision model', /Choose a locally available vision model/.test(route))
  ok('unverified vision support is surfaced as a warning, not a claim', route.includes('visionWarning'))
  ok('native reasoning params are sent only via reasoningBody', route.includes('reasoningBody(') && route.includes('extraBody'))
  ok('prompt-guided thinking is applied to the system prompt', route.includes('thinkingPromptSuffix('))
  ok('the response reports the thinking mode actually applied', route.includes('thinking: thinkingInfo'))
  ok('provider reasoning text is not forwarded to the browser', /send\(\{\s*type: 'thinking'\s*\}\)/.test(route) && !/send\(\{\s*type: 'thinking',\s*text: chunk\.text/.test(route))
  ok('reasoning settings, cancellation and quiz token budgets reach the stream call', /streamLLM\(target, messages, \{ extraBody, signal, maxTokens: outputBudget \}\)/.test(route) && /Math\.min\(3600, Math\.max\(800, mcqCount \* 600\)\)/.test(route))
  ok('attachments are not stored in the transcript (names only)', route.includes('persistedUserContent') && !/content: finalUserContent/.test(route.match(/ChatMessage = \{[^}]*content: [\s\S]{0,40}/)?.[0] ?? ''))

  // ── 8. Client wiring ──────────────────────────────────────────────────────
  section('Chat view wiring')
  const view = await readSource('src/components/agent-hub/chat-view.tsx')
  ok('the composer has a real attach control', view.includes('data-testid="chat-attach-button"') && view.includes('data-testid="chat-attach-input"'))
  ok('the file input accepts images and documents', view.includes('ATTACH_ACCEPT') && /\.pdf/.test(view) && /\.docx/.test(view))
  ok('selected files are listed with a remove control', view.includes('data-testid="chat-attachment-list"') && view.includes('data-testid="chat-attachment-remove"'))
  ok('unsupported files are shown WITH their reason (not dropped)', view.includes('data-testid="chat-attach-error"') && view.includes('validateAttachment('))
  ok('image files get a thumbnail preview', view.includes('URL.createObjectURL('))
  ok('file bytes are read as base64 before sending', view.includes('readFileBase64(') && view.includes('FileReader'))
  ok('the background request captures attachments + selected thinking settings', /attachments: payloads/.test(view) && /thinking: selectedSettings\.thinking/.test(view) && /effort: selectedSettings\.effort/.test(view))
  ok('a Thinking control with On/Off + Low/Medium/High exists', view.includes('data-testid="chat-thinking-button"') && view.includes('data-testid="chat-thinking-toggle"') && view.includes('data-effort={e}'))
  ok('thinking is persisted through shared chat settings', view.includes('THINKING_EFFORTS') && view.includes('settings.effort'))
  ok('the UI labels prompt-guided thinking honestly', /has no native reasoning control/.test(view))
  ok('sent messages show their attachment names', view.includes('data-testid="message-attachments"'))
  ok('no raw <img> element is used for previews (lint-safe)', !/<img\s/.test(view))

  // ── 9. Settings persistence ───────────────────────────────────────────────
  section('Settings persistence')
  const settings = await readSource('src/lib/agent-hub/chat-settings.ts')
  ok('ChatSettings carries thinking + effort', /thinking: boolean/.test(settings) && /effort: ThinkingEffort/.test(settings))
  ok('defaults are off / medium', /thinking: false/.test(settings) && /effort: 'medium'/.test(settings))
  ok('invalid effort falls back to medium', /DEFAULT_CHAT_SETTINGS\.effort/.test(settings))
} finally {
  await fs.rm(BUILD_DIR, { recursive: true, force: true })
}

console.log('\n' + '─'.repeat(60))
console.log(`Chat attachment + thinking checks: ${pass} passed, ${fail} failed`)
if (failures.length > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
}
process.exit(fail === 0 ? 0 : 1)
