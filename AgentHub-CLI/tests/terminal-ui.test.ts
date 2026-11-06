import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { setImmediate, setTimeout } from 'node:timers/promises'
import test from 'node:test'
import { TerminalUi, inputViewport, liveModelStatus, statusLine, terminalText } from '../src/cli/terminal-ui.ts'
import { startupLines } from '../src/cli/startup.ts'
import { TerminalTranscript, transcriptRows, transcriptText, userMessageBlock } from '../src/cli/transcript.ts'
import { createAnsi, displayWidth, stripAnsi } from '../src/utils/ansi.ts'
import type { SkillEntry } from '../src/skills/discover.ts'
import { emptySkills, testConfig } from './helpers.ts'
import { matchingCommands, SLASH_COMMANDS } from '../src/cli/slash-commands.ts'

function terminal(ascii = false) {
  const rawModes: boolean[] = []
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: (enabled: boolean) => { rawModes.push(enabled) },
  })
  const output = Object.assign(new PassThrough(), { columns: 80, rows: 24 })
  let printed = ''
  let interrupted = 0
  let details = 0
  output.on('data', (chunk: Buffer) => { printed += chunk.toString() })
  const ui = new TerminalUi({
    input, output, ascii, ansi: createAnsi(false), history: [],
    status: () => ({ workspace: 'C:\\project', usage: '0 in / 0 out (ask)', model: '(lmstudio) local-model' }),
    onInterrupt: () => { interrupted++ },
    onDetails: () => { details++ },
  })
  ui.start()
  return { ui, input, output, rawModes, printed: () => printed, interrupted: () => interrupted, details: () => details }
}

test('long and wide input stays inside its row while the cursor remains visible', () => {
  for (const ascii of [false, true]) {
    for (let width = 1; width <= 80; width++) {
      for (const line of ['a very long input that wraps around the entire terminal '.repeat(3), '中文路径e\u0301😀'.repeat(12)]) {
        let cursor = 0
        for (const char of ['', ...line]) {
          cursor += char.length
          const view = inputViewport(line, cursor, width, ascii)
          assert.ok(displayWidth(view.text) <= width, JSON.stringify({ width, cursor, view }))
          assert.ok(view.cursor >= 0 && view.cursor < width)
        }
      }
    }
  }
})

test('narrow status rows fit and resource names cannot inject terminal controls', () => {
  for (const ascii of [false, true]) {
    for (let width = 3; width <= 160; width++) {
      const line = statusLine('12345 in / 987 out (read-only)', '(lmstudio) a-very-long-model-name', width, ascii)
      assert.ok(displayWidth(line) <= width, JSON.stringify({ width, line }))
    }
  }
  assert.equal(terminalText('\u001b[2Jevil\nname\u001b]0;title\u0007'), 'evil name')
  assert.doesNotMatch(statusLine('ask', '\u001b[2Jmodel', 60), /\u001b/)
})

test('footer reports only confirmed loaded models as live and keeps real elapsed state', () => {
  assert.equal(liveModelStatus('lmstudio', 'spark-x2.6-4b', true, true, '2.4s'), '(lmstudio) spark-x2.6-4b · LIVE · 2.4s')
  assert.equal(liveModelStatus('lmstudio', 'qwen-coder', false, true, 'idle'), '(lmstudio) qwen-coder · not loaded · idle')
  assert.equal(liveModelStatus('lmstudio', 'spark', undefined, false, '3.1s'), '(lmstudio) spark · offline · 3.1s')
  assert.equal(liveModelStatus('lmstudio', 'spark', true, true, '1s', true), '(lmstudio) spark | LIVE | 1s')
  assert.doesNotMatch(liveModelStatus('provider\u001b[2J', 'model\u001b[31m', true, true, '0s'), /\u001b/)
})

test('the composer follows short output; readline editing and history still work', async () => {
  const t = terminal()
  try {
    t.ui.write('AgentHub\n[Skills]\n')
    const answer = t.ui.question()
    t.input.write('hello\u001b[D!\r')
    assert.equal(await answer, 'hell!o')
    assert.equal(t.ui.readline.history[0], 'hell!o')
    assert.match(t.printed(), /\u001b\[4;1H/)
    assert.match(t.printed(), /\u001b\[8;1H.*\(lmstudio\) local-model/)
    const next = t.ui.question()
    t.input.write('\u001b[A\r')
    assert.equal(await next, 'hell!o')
  } finally {
    t.ui.close()
  }
  assert.deepEqual(t.rawModes, [true, false])
  assert.match(t.printed(), /\u001b\[r/)
  assert.ok(t.printed().endsWith('\u001b[?25h\r\n'))
})

test('resize keeps pending input and redraws streamed output above the footer', async () => {
  const t = terminal()
  try {
    const answer = t.ui.question()
    t.input.write('中文 input')
    t.ui.write('background progress\n'.repeat(20))
    t.output.columns = 38
    t.output.rows = 15
    t.ui.resize()
    await setImmediate()
    assert.equal(t.ui.readline.line, '中文 input')
    assert.match(t.printed(), /\u001b\[1;10r/)
    assert.match(t.printed(), /\u001b\[11;1H/)
    assert.match(t.printed(), /background progress/)
    t.input.write('\r')
    assert.equal(await answer, '中文 input')
  } finally {
    t.ui.close()
  }
})

test('Escape clears ordinary input; Ctrl+O and Ctrl+C reach their handlers', async () => {
  const t = terminal()
  try {
    const answer = t.ui.question()
    t.input.write('discard this')
    t.input.emit('keypress', '\u001b', { name: 'escape' })
    assert.equal(t.ui.readline.line, '')
    t.input.write('\u000f\u0003')
    assert.equal(t.details(), 1)
    assert.equal(t.interrupted(), 1)
    t.input.write('keep\r')
    assert.equal(await answer, 'keep')
    t.input.emit('keypress', '\u001b', { name: 'escape' })
    assert.equal(t.interrupted(), 2)
  } finally {
    t.ui.close()
  }
})

test('approval cancellation releases the prompt and accepts a fresh task', async () => {
  const t = terminal()
  try {
    const controller = new AbortController()
    const approval = t.ui.question('Approve? y / n', controller.signal)
    t.input.write('y')
    controller.abort()
    assert.equal(await approval, null)
    const task = t.ui.question()
    t.input.write('next task\r')
    assert.equal(await task, 'next task')
    assert.equal(await t.ui.question('already cancelled', controller.signal), null)
  } finally {
    t.ui.close()
  }
})

test('EOF resolves a pending question and close restores the terminal', async () => {
  const t = terminal()
  const answer = t.ui.question()
  t.input.write('\u0004')
  assert.equal(await answer, null)
  assert.equal(await t.ui.question(), null)
  t.ui.close()
  assert.deepEqual(t.rawModes, [true, false])
  assert.equal(t.input.listenerCount('keypress'), 0)
})

test('startup displays discovered skills and configured MCP servers accurately', () => {
  const skills = emptySkills()
  const entry = (name: string, valid = true, shadowedBy?: string): SkillEntry => ({
    name, valid, shadowedBy, dir: '', skillFile: '', body: '', meta: null, source: 'user',
    description: '', errors: [], warnings: [], security: [], scripts: [], files: [], sizeBytes: 0,
  })
  skills.entries = [entry('my-skill'), entry('invalid-skill', false), entry('shadowed-skill', true, '/override')]
  const config = testConfig('workspace', 'home', { mcpServers: [{ id: 'configured-server', command: 'node', args: [] }] })
  const banner = startupLines(config, skills, createAnsi(true)).map(stripAnsi).join('\n')
  assert.match(banner, /AgentHub v/)
  assert.match(banner, /\[Skills\]\n  my-skill/)
  assert.doesNotMatch(banner, /invalid-skill|shadowed-skill|Update Available/)
  assert.match(banner, /\[MCP servers configured\]\n  configured-server/)
  config.ascii = true
  config.mcpServers = []
  const plain = startupLines(config, emptySkills(), createAnsi(false)).join('\n')
  assert.match(plain, /None found/)
  assert.doesNotMatch(plain, /MCP servers|[^\x00-\x7f]/)
  skills.entries = Array.from({ length: 119 }, (_, index) => entry(`skill-${index}`))
  const compact = startupLines(config, skills, createAnsi(false), 19)
  assert.ok(compact.length <= 17, 'the startup banner must fit above a 24-row composer')
  const shown = compact.filter((line) => /^  skill-/.test(line)).length
  const hidden = Number(compact.join('\n').match(/\+ (\d+) more/)?.[1])
  assert.equal(shown + hidden, 119)
})

test('user message panels wrap wide text, preserve line breaks, and resize from original text', () => {
  const ansi = createAnsi(true)
  const history = new TerminalTranscript()
  history.append('first line\n')
  history.append('hello 中文 world\nsecond user line', 'user')
  history.append('assistant ')
  history.append('answer\n')
  for (const width of [12, 27, 80]) {
    const block = userMessageBlock('hello 中文 world\nsecond user line', width, ansi)
    assert.match(block, /\u001b\[48;2;28;41;72m/)
    for (const line of block.split('\n').filter(Boolean)) assert.equal(displayWidth(line), width)
    const output = stripAnsi(history.render(width, ansi))
    assert.match(output, /^first line\n/)
    assert.match(output, /assistant answer\n$/)
    assert.ok(output.includes('中文'))
    assert.ok(output.includes('second') || output.includes('secon'))
  }
  assert.doesNotMatch(userMessageBlock('no colour', 40, createAnsi(false)), /\u001b/)
})

test('chat turns are separated by a full-width blue rule and ASCII mode uses ASCII', () => {
  const history = new TerminalTranscript()
  history.append('startup\n')
  history.append('first question', 'user')
  history.append('first answer\n')
  history.append('second question', 'user')

  const width = 24
  const rendered = history.render(width, createAnsi(true))
  const plain = stripAnsi(rendered)
  const rule = '─'.repeat(width)
  assert.equal(plain.split(rule).length - 1, 2)
  assert.ok(plain.includes(`first answer\n${rule}\n`))
  assert.match(rendered, /\u001b\[34m─{24}\u001b\[0m/)

  const ascii = stripAnsi(history.render(width, createAnsi(false), true))
  assert.equal(ascii.split('-'.repeat(width)).length - 1, 2)
  assert.doesNotMatch(ascii, /─/)
})

test('transcript wrapping preserves styles and removes cursor or title controls', () => {
  const red = '\u001b[31m'
  const rows = transcriptRows(`${red}中文abc\u001b[0m\nnext`, 4)
  assert.equal(stripAnsi(rows[0] ?? ''), '中文')
  assert.equal(stripAnsi(rows[1] ?? ''), 'abc')
  assert.match(rows[1] ?? '', /^\u001b\[31m/)
  assert.equal(stripAnsi(rows[2] ?? ''), 'next')
  assert.equal(transcriptText('a\u001b[2Jb\u001b]0;bad\u0007\n\u001b[32mOK\u001b[0m'), 'ab\n\u001b[32mOK\u001b[0m')
  assert.equal(transcriptText('\u001b'), '')
  const history = new TerminalTranscript()
  history.append('old'.repeat(100_000) + '\nLATEST\n')
  const output = history.render(80, createAnsi(false))
  assert.ok(output.length <= 256_000)
  assert.match(output, /LATEST/)
})

test('scrollback shows a real jump hint, keeps its place during output, and Ctrl+End returns to live chat', async () => {
  const t = terminal()
  try {
    t.ui.write(Array.from({ length: 70 }, (_, index) => `message ${index + 1}\n`).join(''))
    const answer = t.ui.question()
    t.input.write('draft')
    let before = t.printed().length
    t.input.emit('keypress', '', { name: 'pageup', shift: true })
    await setImmediate()
    const scrolled = t.printed().slice(before)
    assert.match(scrolled, /Jump to latest message/)
    assert.doesNotMatch(scrolled, /message 70\r?\n/)
    before = t.printed().length
    t.ui.write('NEWEST message\n')
    assert.doesNotMatch(t.printed().slice(before), /NEWEST message/)
    assert.match(t.printed().slice(before), /Jump to latest message/)
    t.output.columns = 50
    t.ui.resize()
    before = t.printed().length
    t.input.emit('keypress', '', { name: 'end', ctrl: true })
    await setImmediate()
    const latest = t.printed().slice(before)
    assert.match(latest, /NEWEST message/)
    assert.doesNotMatch(latest, /Jump to latest message/)
    assert.equal(t.ui.readline.line, 'draft')
    t.input.write('\r')
    assert.equal(await answer, 'draft')
  } finally {
    t.ui.close()
  }
})

test('Ctrl+C and Ctrl+D clear a draft before interrupting or exiting', async () => {
  const t = terminal()
  try {
    const answer = t.ui.question()
    t.input.write('unfinished draft\u0003')
    assert.equal(t.ui.readline.line, '')
    assert.equal(t.interrupted(), 0)
    t.input.write('another draft\u0004')
    assert.equal(t.ui.readline.line, '')
    t.input.write('\u0004')
    assert.equal(await answer, null)
    assert.deepEqual(t.rawModes, [true, false])
  } finally {
    t.ui.close()
  }
})

test('activity animates only the input border, keeps elapsed time, and stops at completion', (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  const t = terminal()
  try {
    t.ui.write('Existing answer\n')
    t.ui.setActivity({ phase: 'thinking', detail: 'Waiting for model' })
    const before = t.printed().length
    context.mock.timers.tick(1000)
    t.ui.setActivity({ phase: 'thinking', detail: 'Waiting for model' })
    context.mock.timers.tick(1000)
    const ticks = t.printed().slice(before)
    assert.match(ticks, /Thinking \(2s\)/, 'identical events must not restart the phase timer')
    assert.match(ticks, /\u001b\[3;1H/)
    assert.doesNotMatch(ticks, /Existing answer|\u001b\[4;1H|\u001b7/, 'ticks must not repaint chat/input or replace its saved cursor')
    t.ui.setActivity({ phase: 'responding' })
    assert.match(t.printed(), /Responding \(0s\)/)
    t.ui.setActivity({ phase: 'completed' })
    assert.match(t.printed(), /✓ Completed/)
    const completed = t.printed()
    context.mock.timers.tick(5000)
    assert.equal(t.printed(), completed, 'completed activity must stop painting')
    t.ui.setActivity({ phase: 'acting', detail: 'Reading file' })
    t.ui.close()
    const closed = t.printed()
    context.mock.timers.tick(5000)
    assert.equal(t.printed(), closed, 'closing must stop the spinner')
  } finally {
    t.ui.close()
  }
})

test('approval activity preserves draft editing and cursor placement through ticks and resize', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  const t = terminal()
  try {
    t.ui.setActivity({ phase: 'approval', detail: 'Writing file' })
    const controller = new AbortController()
    const answer = t.ui.question('Approve? [y]es / [n]o', controller.signal)
    t.input.write('ye')
    await setImmediate()
    context.mock.timers.tick(1000)
    assert.match(t.printed(), /Waiting for approval \(1s\).*Approve\?/)
    assert.ok(t.printed().endsWith('\u001b[4;3H\u001b[?25h'))
    t.output.columns = 45
    t.output.rows = 15
    t.ui.resize()
    context.mock.timers.tick(100)
    assert.equal(t.ui.readline.line, 'ye')
    assert.ok(t.printed().endsWith('\u001b[4;3H\u001b[?25h'))
    t.input.write('s\r')
    assert.equal(await answer, 'yes')
  } finally {
    t.ui.close()
  }
})

test('ASCII activity fits narrow terminals and sanitizes untrusted details', (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 0 })
  const t = terminal(true)
  try {
    t.ui.setActivity({ phase: 'acting', detail: '\u001b[2JReading\nfile' })
    for (const columns of [4, 20, 80]) {
      t.output.columns = columns
      t.ui.resize()
      const before = t.printed().length
      context.mock.timers.tick(100)
      const tick = t.printed().slice(before)
      const border = tick.split('\u001b[2K').at(-1) ?? ''
      assert.equal(displayWidth(border), columns - 1)
      assert.doesNotMatch(border, /[^\x20-\x7e]/)
    }
    assert.match(t.printed(), /Reading file/)
    t.ui.setActivity(null)
    const cleared = t.printed()
    context.mock.timers.tick(500)
    assert.equal(t.printed(), cleared)
  } finally {
    t.ui.close()
  }
})

test('slash suggestions filter commands, preserve exact names, and ignore arguments', () => {
  assert.equal(matchingCommands('/').length, SLASH_COMMANDS.length)
  assert.deepEqual(matchingCommands('/mo').map((command) => command.name), ['/model'])
  assert.equal(matchingCommands('/SKILL')[0]?.name, '/skill')
  for (const input of ['hello /model', '/model local-model', '/unknown', '']) {
    assert.deepEqual(matchingCommands(input), [])
  }
})

test('slash picker opens immediately, navigates without history, completes with Tab, and runs with Enter', async () => {
  const t = terminal()
  try {
    t.ui.readline.history.push('previous task')
    const answer = t.ui.question()
    t.input.write('/')
    await setImmediate()
    assert.match(t.printed(), /> \/help\s+Show commands/)
    assert.match(t.printed(), /Tab complete.*Enter run/)
    t.input.write('\u001b[B\t')
    await setImmediate()
    assert.equal(t.ui.readline.line, '/model ')
    t.input.write('local-test\r')
    assert.equal(await answer, '/model local-test')
    const next = t.ui.question()
    t.input.write('/stat\r')
    assert.equal(await next, '/status')
    const exact = t.ui.question()
    t.input.write('/skill\r')
    assert.equal(await exact, '/skill', 'an exact command must not execute the longer /skills command')
  } finally {
    t.ui.close()
  }
})

test('picker wraps, reveals commands beyond the first page, and Escape dismisses before clearing', async () => {
  const t = terminal()
  try {
    const answer = t.ui.question()
    t.input.write('/\u001b[A')
    await setImmediate()
    assert.equal(t.ui.readline.line, '/')
    assert.match(t.printed(), /> \/quit\s+Exit AgentHub/)
    assert.match(t.printed(), /18\/18/)
    t.input.write('\u001b')
    await setTimeout(600)
    assert.equal(t.ui.readline.line, '/')
    const before = t.printed().length
    t.ui.draw()
    assert.doesNotMatch(t.printed().slice(before), /Tab complete|Exit AgentHub/)
    t.input.emit('keypress', '\u001b', { name: 'escape' })
    assert.equal(t.ui.readline.line, '')
    t.input.write('normal task\r')
    assert.equal(await answer, 'normal task')
  } finally {
    t.ui.close()
  }
})

test('slash picker stays out of approval and multiline prompts and survives resize', async () => {
  const t = terminal(true)
  try {
    t.ui.write('context\n'.repeat(30))
    const answer = t.ui.question()
    t.input.write('/p')
    await setImmediate()
    t.output.columns = 26
    t.output.rows = 12
    const before = t.printed().length
    t.ui.resize()
    const frame = t.printed().slice(before)
    assert.match(frame, /\/provider/)
    assert.equal(t.ui.readline.line, '/p')
    for (const row of frame.split(/\u001b\[\d+;\d+H\u001b\[2K/).slice(1)) {
      assert.ok(displayWidth(row.split('\u001b')[0] ?? '') <= 25)
    }
    t.input.write('\u001b[B\r')
    assert.equal(await answer, '/plan')
    const controller = new AbortController()
    const approval = t.ui.question('Approve? y/n', controller.signal)
    const approvalStart = t.printed().length
    t.input.write('/help')
    await setImmediate()
    assert.doesNotMatch(t.printed().slice(approvalStart), /Tab complete|Show commands/)
    controller.abort()
    assert.equal(await approval, null)
    const continuation = t.ui.question('...')
    t.input.write('/help\r')
    assert.equal(await continuation, '/help')
  } finally {
    t.ui.close()
  }
})

test('compact messages and composer remove empty gaps and expand to the bottom for long output', async () => {
  const t = terminal()
  try {
    t.ui.writeUserMessage('hi')
    t.ui.write('Hello!\n')
    const answer = t.ui.question()
    t.input.write('draft')
    await setImmediate()
    assert.equal(stripAnsi(userMessageBlock('hi', 79, createAnsi(true))).split('\n').length, 3)
    // User row, one separating blank, reply, one blank, then border/input.
    assert.ok(t.printed().endsWith('\u001b[6;6H\u001b[?25h'))
    t.ui.write('more output\n'.repeat(40))
    assert.ok(t.printed().endsWith('\u001b[21;6H\u001b[?25h'))
    assert.equal(t.ui.readline.line, 'draft')
    t.input.write('\r')
    assert.equal(await answer, 'draft')
  } finally {
    t.ui.close()
  }
})
