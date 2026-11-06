import { createElement } from 'react'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown, calculateQuizScore, splitInteractiveQuizzes } from '../src/components/agent-hub/chat-view'
import { parseChatDiagram } from '../src/components/agent-hub/chat-diagram'
import { FlowDiagram, layoutFlowDiagram } from '../src/components/agent-hub/explain/flow-diagram'
import { ExplainBlocks } from '../src/components/agent-hub/explain/blocks'
import { AI_AGENTS_GUIDE_REFERENCE } from '../src/lib/agent-hub/teach-prompt'
import { responseDepthPromptSuffix } from '../src/lib/agent-hub/chat-settings'

let passed = 0
let failed = 0
function check(name: string, condition: boolean) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} ${name}`)
  if (condition) passed += 1
  else failed += 1
}

const source = /```diagram\s*([\s\S]*?)```/.exec(AI_AGENTS_GUIDE_REFERENCE)?.[1] ?? ''
const comprehensiveFlow = /```diagram\s*([\s\S]*?)```/.exec(responseDepthPromptSuffix('comprehensive'))?.[1] ?? ''
// User-approved final prompt. Update only when the user requests a chat change.
check('final Comprehensive configuration remains unchanged', createHash('sha256').update(responseDepthPromptSuffix('comprehensive')).digest('hex') === '5c3c54b250fbfe096379c6a20c284f56651894d79014d7cdaf2198aa118389c4')
check('Comprehensive flowchart format renders decision branches through the real diagram renderer', Boolean(parseChatDiagram(comprehensiveFlow)) && renderToStaticMarkup(createElement(Markdown, { content: `\n\n\x60\x60\x60diagram\n${comprehensiveFlow}\n\x60\x60\x60` })).includes('teaching-diagram'))
const diagram = parseChatDiagram(source)
if (!diagram) throw new Error('The reference architecture could not be parsed')
const quizText = AI_AGENTS_GUIDE_REFERENCE.slice(AI_AGENTS_GUIDE_REFERENCE.indexOf('## AI Agents — MCQ Test'))
const fixture = `## Core architecture\n\n\`\`\`diagram\n${source}\n\`\`\`\n\n${quizText}`
const html = renderToStaticMarkup(createElement(Markdown, { content: fixture }))
const quizzes = splitInteractiveQuizzes(quizText).flatMap((segment) => segment.type === 'quiz' ? [segment.quiz] : [])

check('the pasted guide architecture renders as an accessible SVG in ordinary Chat Markdown', html.includes('data-testid="teaching-diagram"') && html.includes('role="img"') && html.includes('Agent Runtime / Orchestrator'))
check('all seven architecture nodes and six connections are retained', diagram.nodes?.length === 7 && diagram.edges?.length === 6)
check('the full diagram caption explains the relationships', html.includes('<figcaption') && html.includes('Tool actions run through execution controls'))
check('diagram JSON is consumed rather than shown as a source-code block', !html.includes('&quot;nodes&quot;') && !html.includes('Copy code'))
check('the guide produces its exact three MCQs with B, C, B answer keys', quizzes.length === 3 && quizzes.map((quiz) => quiz.correctLetter).join('') === 'BCB')
check('every question retains four choices and its explanation', quizzes.every((quiz) => quiz.options.length === 4 && Boolean(quiz.explanation)))
check('all-correct, all-wrong and mixed submissions score exactly', calculateQuizScore(quizzes, { 1: 'B', 2: 'C', 3: 'B' }) === 3 && calculateQuizScore(quizzes, { 1: 'A', 2: 'A', 3: 'A' }) === 0 && calculateQuizScore(quizzes, { 1: 'B', 2: 'A', 3: 'B' }) === 2)
check('answer explanations and a score are hidden until submission', !html.includes('data-testid="chat-quiz-score"') && !html.includes('RAG retrieves relevant content from a knowledge source') && !html.includes('Correct: B'))
check('the combined lesson has twelve radio choices and one submit/reset pair', (html.match(/type="radio"/g) ?? []).length === 12 && (html.match(/data-testid="chat-quiz-submit"/g) ?? []).length === 1 && (html.match(/data-testid="chat-quiz-retry"/g) ?? []).length === 1)
const singleHtml = renderToStaticMarkup(createElement(Markdown, { content: quizText.slice(0, quizText.indexOf('Question 2.')) }))
check('a single-question quiz has an explicit Submit Quiz button', singleHtml.includes('Submit Quiz') && !singleHtml.includes('data-testid="chat-quiz-score"'))
const streaming = renderToStaticMarkup(createElement(Markdown, { content: quizText, disabled: true }))
check('streaming disables answer fieldsets and submission', (streaming.match(/<fieldset[^>]*disabled/g) ?? []).length === 3 && /data-testid="chat-quiz-submit"/.test(streaming) && /<button[^>]*disabled=""[^>]*data-testid="chat-quiz-submit"/.test(streaming))

check('malformed, oversized and non-object diagram payloads are rejected', parseChatDiagram('{') === null && parseChatDiagram('[]') === null && parseChatDiagram('x'.repeat(24001)) === null)
const guarded = parseChatDiagram(JSON.stringify({ nodes: [{ id: 'one', label: '<script>alert(1)</script>', tone: 'url(evil)' }, { id: 'one', label: 'duplicate' }], edges: [{ from: 'one', to: 'missing' }] }))!
const guardedHtml = renderToStaticMarkup(createElement(FlowDiagram, { block: guarded }))
check('duplicate nodes, invalid edges and unapproved style values are removed', guarded.nodes?.length === 1 && guarded.edges?.length === 0 && !guarded.nodes[0].tone)
check('model labels are escaped and never executed as HTML', guardedHtml.includes('&lt;script&gt;') && !guardedHtml.includes('<script>'))
check('incomplete streamed diagrams preserve readable source without crashing', renderToStaticMarkup(createElement(Markdown, { content: '```diagram\n{"nodes": [\n```' })).includes('waiting for a complete diagram'))

const positioned = layoutFlowDiagram(diagram)
const overlaps = positioned.nodes.some((a, i) => positioned.nodes.some((b, j) => j > i && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y))
check('architecture nodes do not overlap or leave the SVG bounds', !overlaps && positioned.nodes.every((node) => node.x >= 0 && node.y >= 0 && node.x + node.width <= positioned.width && node.y + node.height <= positioned.height))
const cycle = layoutFlowDiagram({ ...diagram, edges: [...diagram.edges!, { from: 'verification', to: 'runtime' }] })
check('feedback cycles still produce a finite bounded layout', cycle.nodes.length === 7 && cycle.nodes.every((node) => [node.x, node.y, node.width, node.height].every(Number.isFinite)))
const pair = renderToStaticMarkup(createElement('div', null, createElement(FlowDiagram, { block: diagram }), createElement(FlowDiagram, { block: diagram })))
const markerIds = [...pair.matchAll(/<marker id="([^"]+)"/g)].map((match) => match[1])
check('multiple diagrams have independent arrow markers', markerIds.length === 2 && new Set(markerIds).size === 2)
check('diagrams stay scrollable with readable labels on narrow screens', html.includes('overflow-x-auto') && html.includes('min-width:560px') && html.includes('dark:fill-blue-950/30'))
check('legacy explanation blocks use the same improved renderer', renderToStaticMarkup(createElement(ExplainBlocks, { blocks: [diagram] })).includes('data-testid="teaching-diagram"'))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
