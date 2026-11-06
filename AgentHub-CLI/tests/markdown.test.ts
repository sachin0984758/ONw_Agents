import assert from 'node:assert/strict'
import test from 'node:test'
import { createAnsi } from '../src/utils/ansi.ts'
import { MarkdownStream, renderMarkdown } from '../src/utils/markdown.ts'

test('streaming Markdown renders headings, lists, code fences and diffs without cursor control', () => {
  let output = ''
  const stream = new MarkdownStream(createAnsi(false), (chunk) => {
    output += chunk
  })
  stream.write('## Result\n\nA **bold** and `inline` value.\n\n')
  stream.write('```ts\nconst value = 1\n```\n\n')
  stream.write('- first\n+added line\n-removed line\n---\n')
  stream.flush()
  assert.match(output, /Result/)
  assert.doesNotMatch(output, /## Result/)
  assert.match(output, /• first/)
  assert.match(output, /┌─ ts/)
  assert.match(output, /│ const value = 1/)
  assert.match(output, /└─ end code/)
  assert.match(output, /\+added line/)
  assert.match(output, /-removed line/)
  assert.doesNotMatch(output, /```/)
  assert.equal(output.includes('\u001b['), false)
  assert.equal(/[\u001b]\[\d*[ABCDHJK]/.test(output), false, 'renderer must not move or erase the cursor')
})

test('ASCII mode renders fences, bullets, quotes and rules without non-ASCII decoration', () => {
  let output = ''
  renderMarkdown(
    '## Heading\n\n- item\n\n> quote\n\n```ts\nconst x = 1\n```\n\n---\n',
    createAnsi(false),
    (chunk) => {
      output += chunk
    },
    true,
  )
  assert.match(output, /\+-- ts/)
  assert.match(output, /  \| const x = 1/)
  assert.match(output, /\+-- end code --/)
  assert.match(output, /\* item/)
  assert.match(output, /  \| quote/)
  assert.equal(/[^\x00-\x7f]/.test(output), false, output)
})

test('renderMarkdown flushes a partial line and closes an unterminated code fence', () => {
  let output = ''
  renderMarkdown('text without newline', createAnsi(false), (chunk) => {
    output += chunk
  })
  assert.equal(output, 'text without newline\n')

  output = ''
  renderMarkdown('```\nunfinished', createAnsi(false), (chunk) => {
    output += chunk
  })
  assert.match(output, /┌─/)
  assert.match(output, /unfinished/)
  assert.match(output, /end code/)
})
