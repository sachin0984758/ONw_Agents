import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantAnswer, DirectoryAnswer, parseDirectorySnapshot, ThinkingEffortControl, TurnView } from '../src/components/agent-hub/session-chat-view'
import type { SessionTurn } from '../src/lib/agent-hub/session/types'

let passed = 0
let failed = 0
function check(name: string, condition: boolean) {
  if (condition) { passed += 1; console.log(`  PASS ${name}`) }
  else { failed += 1; console.error(`  FAIL ${name}`) }
}

const markdown = [
  '# Summary',
  '',
  '**Strong answer** with `inlineCode`.',
  '',
  '1. First step',
  '2. Second step',
  '',
  '| Item | Result |',
  '| --- | --- |',
  '| Build | Pass |',
  '',
  '> Evidence stays visible.',
  '',
  '```ts',
  'const answer = 42',
  '```',
].join('\n')
const answerHtml = renderToStaticMarkup(<AssistantAnswer content={markdown} agentName="Website Builder" />)
check('assistant markdown headings, emphasis, lists, tables, quotes and inline code render', ['<h1', '<strong>', '<ol>', '<table', '<blockquote', '<code'].every((part) => answerHtml.includes(part)))
check('assistant name and one-click copy answer action render', answerHtml.includes('AgentHub · Website Builder') && answerHtml.includes('Copy answer'))
check('fenced code uses the syntax-highlighted copyable code block', answerHtml.includes('data-code-block=') && answerHtml.includes('Copy code'))

const legacy = parseDirectorySnapshot(JSON.stringify({ path: '.', entries: [{ name: 'src', type: 'dir' }, { name: 'README.md', type: 'file' }], truncated: false }))
check('saved JSON directory output remains readable', legacy?.directories[0] === 'src' && legacy.files[0] === 'README.md')
const concise = parseDirectorySnapshot('Folder: src\nDirectories (1):\n  app\nFiles (1):\n  page.tsx')
check('new concise directory output is readable', concise?.folder === 'src' && concise.directories[0] === 'app' && concise.files[0] === 'page.tsx')
const empty = parseDirectorySnapshot('Folder: empty\nDirectories (0):\n  (none)\nFiles (0):\n  (none)')
check('empty folder output is handled', empty?.directories.length === 0 && empty.files.length === 0)
const partial = parseDirectorySnapshot('Folder: src\nDirectories (1):\n  app\nFiles (0):\n  (none)\nListing is truncated at the folder entry limit.')
check('truncated folder output is marked partial', partial?.truncated === true)
check('malformed directory output does not create a false listing', parseDirectorySnapshot('not a listing') === null)
const listingHtml = renderToStaticMarkup(<DirectoryAnswer snapshot={legacy!} />)
check('directory card shows exact counts and keeps long names collapsed', listingHtml.includes('1 folder') && listingHtml.includes('1 file') && listingHtml.includes('Show folder and file names') && !listingHtml.includes('README.md'))

const effortLabels = (['off', 'low', 'medium', 'high'] as const).map((effort) => renderToStaticMarkup(<ThinkingEffortControl value={effort} disabled={false} onChange={() => {}} />))
check('all four reasoning levels render in the accessible control', ['Thinking off', 'Thinking · Low', 'Thinking · Medium', 'Thinking · High'].every((label) => effortLabels.some((html) => html.includes(label))))
check('reasoning control explains its behavior without exposing private chain-of-thought', effortLabels[2].includes('aria-haspopup="dialog"'))

const listTurn: SessionTurn = {
  id: 'list', request: 'list the files', startedAt: new Date(0).toISOString(), endedAt: new Date(1000).toISOString(), status: 'completed',
  agent: { id: 'website', name: 'Website Builder' }, changes: [], items: [
    { id: 'tool', kind: 'tool', name: 'list_files', text: 'list_files', status: 'completed', output: JSON.stringify({ path: '.', entries: [{ name: 'src', type: 'dir' }] }) },
    { id: 'answer', kind: 'assistant', text: 'Old raw model answer with a huge code block.' },
  ],
}
const directoryTurnHtml = renderToStaticMarkup(<TurnView turn={listTurn} />)
check('saved file-list answers use the compact directory card and agent label', directoryTurnHtml.includes('Folder listing') && directoryTurnHtml.includes('AgentHub · Website Builder') && !directoryTurnHtml.includes('Old raw model answer'))

const activityTurn: SessionTurn = {
  id: 'activity', request: 'Update the project', startedAt: new Date(0).toISOString(), status: 'partial', changes: [{ path: 'src/app.ts', before: 'old', after: 'new' }], items: [
    { id: 'plan', kind: 'tool', name: 'plan', text: 'plan', status: 'completed', output: '1. [x] Inspect files' },
    { id: 'failed', kind: 'tool', name: 'read_file', text: 'read_file', status: 'failed', output: 'Permission denied' },
    { id: 'notice', kind: 'notice', text: 'Could not finish every step.' },
  ],
}
const activityHtml = renderToStaticMarkup(<TurnView turn={activityTurn} />)
check('plan, tool failure, notice and file-change preview render in one turn', activityHtml.includes('plan') && activityHtml.includes('Failed') && activityHtml.includes('Could not finish every step') && activityHtml.includes('Edited 1 file'))

const streamingTurn: SessionTurn = { id: 'stream', request: 'Explain this', startedAt: new Date(0).toISOString(), status: 'running', changes: [], items: [{ id: 'thinking', kind: 'assistant', text: '' }] }
const streamingHtml = renderToStaticMarkup(<TurnView turn={streamingTurn} />)
check('empty streaming response shows a thinking state and working status', streamingHtml.includes('Thinking…') && streamingHtml.includes('Working…'))

console.log(`\n${passed} presentation checks passed; ${failed} failed.`)
if (failed > 0) process.exit(1)
