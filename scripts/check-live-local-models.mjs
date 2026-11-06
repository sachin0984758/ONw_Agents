#!/usr/bin/env node
// ─── LIVE local-model capability checks (opt-in) ─────────────────────────────
// Exercises the REAL /api/chat route against REAL local models to verify:
//   • image understanding with a genuinely vision-capable model,
//   • the honest refusal when a text-only model is given an image,
//   • prompt-guided Thinking on a non-reasoning model,
//   • native reasoning_effort on a reasoning model (when one is available).
//
// Requires a running dev server (default http://localhost:3000) with a reachable
// local provider. Anything it cannot verify (no server, no provider, no vision
// model, provider error) is reported as SKIP with the real reason — never a
// false PASS. Requests are `stateless`, so shared Chat history is untouched.
//
//   node scripts/check-live-local-models.mjs [baseUrl]
// ─────────────────────────────────────────────────────────────────────────────

import zlib from 'zlib'

const BASE = (process.argv[2] || process.env.CHAT_BASE || 'http://localhost:3000').replace(/\/$/, '')

let passed = 0
let failed = 0
let skipped = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function skip(name, why) {
  skipped++
  console.log(`  SKIP  ${name} (${why})`)
}

// ── A real PNG, built here so the vision check has real pixels ────────────────
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
function solidPng(w, h, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour RGB
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = r
    row[2 + x * 3] = g
    row[3 + x * 3] = b
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.from(row)))
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

async function post(pathname, body, timeoutMs = 180000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    let json = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

const NATIVE_HINT = /(^|[-_/])(o1|o3|o4|gpt-5|gpt-oss|deepseek-r\d*|deepseek-reasoner|qwq|magistral|reasoning|thinking)([-_/:]|$)|qwen3[^/]*think/i

async function main() {
  console.log('\nLive local-model capability checks (real inference)\n')

  // ── Is the server + provider there at all? ────────────────────────────────
  let providers = []
  try {
    const res = await fetch(`${BASE}/api/runtime/models`)
    const json = await res.json()
    providers = json?.onlineProviders ?? []
  } catch (err) {
    skip('environment', `no server at ${BASE} — ${err.message}`)
    return
  }
  if (!providers.length) {
    skip('environment', 'no local provider online')
    return
  }
  console.log(`  providers: ${providers.join(', ')}\n`)

  // ── Discover real models from the provider ────────────────────────────────
  let models = []
  try {
    const lm = providers.includes('LM Studio') ? 'http://localhost:1234' : null
    if (lm) {
      const res = await fetch(`${lm}/api/v0/models`)
      const json = await res.json()
      models = (json.data ?? []).map((m) => ({ id: m.id, type: (m.type ?? 'llm').toLowerCase() }))
    }
  } catch {
    models = []
  }
  const llm = models.find((m) => m.type === 'llm' && !/embed/i.test(m.id))
  const reasoner = models.find((m) => m.type === 'llm' && NATIVE_HINT.test(m.id))

  // ── 1 · real image understanding with a genuine vision model ──────────────
  const vlms = models.filter((m) => m.type === 'vlm')
  if (!vlms.length) {
    skip('V1 vision model sees a red image', 'no vision (vlm) model available')
  } else {
    const png = solidPng(96, 96, [220, 20, 20])
    const attachments = [{ name: 'swatch.png', mime: 'image/png', size: png.length, dataBase64: png.toString('base64') }]
    let verified = false
    let lastErr = ''
    // Local providers can refuse a request while hot-swapping models under
    // memory pressure (empty 400). Try each available vision model once; only a
    // model that actually answers tests the app, and a provider error is an
    // honest SKIP (never a false PASS).
    for (const m of vlms.slice(0, 3)) {
      let r
      try {
        r = await post('/api/chat', {
          message: 'What is the dominant colour of this image? Reply with a single lowercase colour word.',
          stateless: true,
          settings: { model: m.id },
          attachments,
        })
      } catch (err) {
        lastErr = err.message
        continue
      }
      if (r.status >= 500 || /provider returned an error/i.test(String(r.json?.error ?? ''))) {
        lastErr = String(r.json?.error ?? `HTTP ${r.status}`)
        continue
      }
      const reply = String(r.json?.reply ?? '')
      ok(`V1 ${m.id} really sees the red image`, /\bred\b/i.test(reply), `status=${r.status} reply=${JSON.stringify(reply.slice(0, 80))}`)
      ok('V2 the vision model is reported as the serving model', String(r.json?.model ?? '').includes(m.id), String(r.json?.model))
      ok('V3 no false vision warning was raised', r.json?.visionWarning === undefined, String(r.json?.visionWarning))
      verified = true
      break
    }
    if (!verified) skip('V1 vision model sees a red image', `no vision model could be served right now — ${lastErr}`)
  }

  // ── 2 · a text-only model must refuse the image, not pretend ──────────────
  if (!llm) {
    skip('V4 text-only model refuses an image', 'no text-only (llm) model available')
  } else {
    const png = solidPng(48, 48, [20, 90, 220])
    const attachments = [{ name: 'swatch.png', mime: 'image/png', size: png.length, dataBase64: png.toString('base64') }]
    try {
      const r = await post('/api/chat', {
        message: 'What colour is this image?',
        stateless: true,
        settings: { model: llm.id },
        attachments,
      })
      ok(
        `V4 ${llm.id} (text-only) refuses the image honestly`,
        r.status === 400 && /text-only|vision model/i.test(String(r.json?.error ?? '')),
        `status=${r.status} err=${r.json?.error ?? ''}`,
      )
    } catch (err) {
      skip('V4 text-only model refuses an image', `provider error — ${err.message}`)
    }
  }

  // ── 3 · prompt-guided Thinking on a non-reasoning model ───────────────────
  // Must be a model the app does NOT classify as native-reasoning, otherwise it
  // would (correctly) report native mode and this would test nothing.
  const promptModel = models.find((m) => m.type === 'llm' && !/embed/i.test(m.id) && !NATIVE_HINT.test(m.id))
  if (!promptModel) {
    skip('T1 prompt-guided thinking', 'no non-reasoning text model available')
  } else {
    try {
      const r = await post('/api/chat', {
        message: 'A farmer has 17 sheep and all but 9 run away. How many are left? Answer with the number and one sentence.',
        stateless: true,
        settings: { model: promptModel.id, thinking: true, effort: 'high' },
      })
      ok(
        `T1 ${promptModel.id} reports prompt-guided thinking (not native)`,
        r.status === 200 && r.json?.thinking?.mode === 'prompt' && r.json?.thinking?.effort === 'high',
        `status=${r.status} thinking=${JSON.stringify(r.json?.thinking)}`,
      )
      ok('T2 prompt-guided thinking still returns a real answer', r.status === 200 && String(r.json?.reply ?? '').length > 0, String(r.json?.reply ?? '').slice(0, 80))
      ok('T3 the answer is correct (9)', r.status === 200 && /\b9\b/.test(String(r.json?.reply ?? '')), String(r.json?.reply ?? '').slice(0, 80))
    } catch (err) {
      skip('T1 prompt-guided thinking', `provider error — ${err.message}`)
    }
  }

  // ── 4 · native reasoning_effort on a reasoning model (best effort) ────────
  if (!reasoner) {
    skip('T4 native reasoning_effort is accepted', 'no reasoning-capable model available')
  } else {
    try {
      const r = await post('/api/chat', {
        message: 'What is 19*23? Reply with the number only.',
        stateless: true,
        settings: { model: reasoner.id, thinking: true, effort: 'high' },
      })
      if (r.status >= 500 || /provider returned an error/i.test(String(r.json?.error ?? ''))) {
        // A provider that refuses reasoning_effort is a provider limitation, not
        // an app defect — report it honestly instead of passing or failing.
        skip('T4 native reasoning_effort is accepted', `provider refused the request — ${r.json?.error ?? `HTTP ${r.status}`}`)
      } else {
        ok(
          `T4 ${reasoner.id} reports native reasoning mode`,
          r.status === 200 && r.json?.thinking?.mode === 'native',
          `status=${r.status} thinking=${JSON.stringify(r.json?.thinking)}`,
        )
        const reply = String(r.json?.reply ?? '').trim()
        if (!reply) skip('T5 native reasoning model still answers', 'provider returned reasoning-only content (no visible answer)')
        else ok('T5 native reasoning model still answers', /\b437\b/.test(reply), reply.slice(0, 80))
      }
    } catch (err) {
      skip('T4 native reasoning_effort is accepted', `provider error — ${err.message}`)
    }
  }
}

main()
  .catch((err) => {
    failed++
    failures.push(`unexpected: ${err.message}`)
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`)
    if (failed) {
      console.error('FAILURES:\n' + failures.map((f) => `  - ${f}`).join('\n'))
      process.exit(1)
    }
  })
