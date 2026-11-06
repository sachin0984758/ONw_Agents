// Mock OpenAI-compatible provider for end-to-end testing of /api/explain.
// Runs on LM Studio's default port (1234) so the app's auto-detect finds it.
// Streams a realistic JSON-blocks reply over SSE. Test-only; not part of the app.
import http from 'node:http'

const BLOCKS = {
  blocks: [
    { type: 'text', markdown: '## Ohm\'s law\nVoltage equals current times resistance.' },
    { type: 'equation', expression: 'V = I × R', steps: ['12 = 0.12 × 100'], description: 'worked example' },
    { type: 'interactive', kind: 'ohm-law', title: 'Try it' },
  ],
}
const FULL = JSON.stringify(BLOCKS)

// Playground analysis replies. The playground sends a prompt that starts with
// "Practice mode:"; answers here are marker-based so live UI tests can verify
// rendering, estimated labels and "Apply suggestion" for code and formulas.
function playgroundReply(userMsg) {
  if (userMsg.includes('Requested action: Suggest correction.')) {
    return 'The B9 formula fails because the lookup and return arrays have different sizes.\n\n```\n=XLOOKUP(MAX(E2:E6),E2:E6,B2:B6)\n```\n\nThe return array now spans B2:B6 so every row gets a matching rep. (Analysis only — the sheet is not recalculated.)'
  }
  if (userMsg.includes('Requested action: Improve.')) {
    const fence = userMsg.includes('Language: Python') ? 'python' : userMsg.includes('Language: SQL') ? 'sql' : ''
    return (
      '## Improved version\n\nHere is a corrected version of the starter.\n\n```' +
      fence +
      '\ndef average(numbers):\n    total = 0\n    for value in numbers:\n        total += value\n    return total / len(numbers) if numbers else 0\n```\n\nChanges:\n- The loop now visits every element (the starter skipped the first one).\n- The accumulator is initialised and an empty list is handled.\n\nThis is a static reading of the text — nothing was executed.'
    )
  }
  if (userMsg.includes('Requested action: Predict output.')) {
    return '## Likely output (AI estimate — not executed)\n\n1. The starter skips `numbers[0]` because the loop starts at index 1.\n2. With the sample list the estimate is `75.6`.\n\nThis is reasoning over the text, not real output.'
  }
  return '## Analysis\n\nThis practice material looks structured and readable.\n\n- **What it does:** it processes the values step by step.\n- **Worth checking:** boundary conditions such as empty input.\n- **Note:** this is a static reading of the text — nothing was executed.'
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
    return
  }
  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let wantsStream = false
      let userMsg = ''
      try {
        const parsed = JSON.parse(body)
        wantsStream = parsed.stream === true
        const msgs = Array.isArray(parsed.messages) ? parsed.messages : []
        const last = msgs.filter((m) => m.role === 'user').pop()
        userMsg = last ? String(last.content) : ''
      } catch {}
      // Garbage mode: reply with plain prose that is NOT valid JSON, to
      // exercise the markdown-fallback path end to end.
      const payload = userMsg.includes('Practice mode:')
        ? playgroundReply(userMsg)
        : userMsg.includes('GARBAGE')
          ? 'Ohms law is simply V = I x R. ```py\nprint(1)\n```'
          : FULL
      if (!wantsStream) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: payload } }] }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      // emit as ~10 char deltas so streaming is observable
      const chunk = 10
      for (let i = 0; i < payload.length; i += chunk) {
        const delta = payload.slice(i, i + chunk)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`)
      }
      res.write('data: [DONE]\n\n')
      res.end()
    })
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(1234, () => console.log('mock provider listening on 1234'))
