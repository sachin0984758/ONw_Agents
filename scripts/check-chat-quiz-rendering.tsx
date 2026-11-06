import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown, calculateQuizScore, splitInteractiveQuizzes } from '../src/components/agent-hub/chat-view'

let passed = 0
let failed = 0
function check(name: string, condition: boolean) {
  if (condition) { passed += 1; console.log(`  PASS ${name}`) }
  else { failed += 1; console.error(`  FAIL ${name}`) }
}

const answerBlock = ['```answer', 'Correct: B. Explanation: The second choice is correct.', '```'].join('\n')
const questions = Array.from({ length: 5 }, (_, index) => [
  index % 2 === 0 ? `**Question\u202f${index + 1}.**\nWhich choice is correct?` : `**${index + 1}. Which choice is correct?**`,
  '- A) First choice', '- B) Second choice', '- C) Third choice', '- D) Fourth choice', answerBlock,
].join('\n'))
const output = ['# Data Science & AI Agents – MCQ Test', '5 questions · Beginner level · 1 mark each', '', ...questions].join('\n\n')
const segments = splitInteractiveQuizzes(output)
const quizzes = segments.flatMap((segment) => segment.type === 'quiz' ? [segment.quiz] : [])
const boldTitleSegments = splitInteractiveQuizzes(output.replace('# Data Science & AI Agents – MCQ Test', '**Data Science & AI Agents – MCQ Test**'))
const boldTitle = boldTitleSegments.find((segment) => segment.type === 'quiz')

check('inline-bold and separate-line bold question labels with narrow spaces are recognized', quizzes.length === 5 && quizzes[0]?.prompt === 'Which choice is correct?')
check('quiz heading and details are preserved on the first card', quizzes[0]?.title === 'Data Science & AI Agents – MCQ Test' && quizzes[0]?.details === '5 questions · Beginner level · 1 mark each')
check('bold quiz titles without a Markdown heading are also kept', boldTitle?.type === 'quiz' && boldTitle.quiz.title === 'Data Science & AI Agents – MCQ Test')
check('every question has four choices and a hidden answer with explanation', quizzes.length === 5 && quizzes.every((quiz) => quiz?.options.length === 4 && quiz.correctLetter === 'B' && quiz.explanation?.includes('second choice')))
check('the parser removes answer blocks from ordinary Markdown', !segments.some((segment) => segment.type === 'markdown' && segment.content.includes('Correct: B.')))

const plainModelReply = [
  '## Arrays – MCQs (Multiple Choice Questions)',
  '### Q1. What is the index of the first array element?', 'A) 1', 'B) 0', 'C) -1', 'D) Depends on the language', '**Answer: B) 0**', '---',
  '### Q2. Which array operation has O(1) time complexity?', 'A) Insert at the beginning', 'B) Delete from the middle', 'C) Access by index', 'D) Search', '**Answer: C) Access by index**', '---',
  '### Q3. What is a common limitation of fixed-size arrays?', 'A) They are slow', 'B) Their size cannot grow automatically', 'C) They only store strings', 'D) They cannot be indexed', '**Answer: B) Their size cannot grow automatically**', '---',
  '### Q4. If an array has 10 elements and uses zero-based indexing, what is its last index?', 'A) 10', 'B) 9', 'C) 11', 'D) 0', '**Answer: B) 9**', '---',
  '### Q5. Where are array elements typically stored?', 'A) In consecutive memory locations', 'B) Only in a database', 'C) Randomly on disk', 'D) Only in a stack', '**Answer: A) In consecutive memory locations**',
].join('\n\n')
const plainSegments = splitInteractiveQuizzes(plainModelReply)
const plainQuizzes = plainSegments.flatMap((segment) => segment.type === 'quiz' ? [segment.quiz] : [])
check('Q1-style question labels and Answer: lines become five selectable quiz questions', plainQuizzes.length === 5 && plainQuizzes.every((quiz) => Boolean(quiz && quiz.options.length === 4 && quiz.correctLetter)))
check('legacy quiz title and answer keys are preserved while inline answer text is hidden', Boolean(plainQuizzes[0]?.title?.includes('Arrays')) && plainQuizzes.map((quiz) => quiz?.correctLetter).join('') === 'BCBBA' && !plainSegments.some((segment) => segment.type === 'markdown' && /Answer:\s*[A-D]/i.test(segment.content)))
check('legacy questions stay contiguous so the UI renders one scored quiz card', plainSegments.length === 5 && plainSegments.every((segment) => segment.type === 'quiz'))
check('the submitted-answer scorer returns 3/5 for a three-correct attempt', calculateQuizScore(plainQuizzes, { 1: 'B', 2: 'A', 3: 'B', 4: 'A', 5: 'A' }) === 3)

const detailsWrappedReply = [
  '## Arrays – New MCQ Test', '**5 questions · Beginner level · 1 mark each**', '---',
  '**Question 1.** What happens on an out-of-bounds array access?', '- A) Returns 0', '- B) Throws an error', '- C) Returns the last element', '- D) Creates an element',
  '<details>', '<summary>Click to reveal answer</summary>', '', '```answer', 'Correct: B. Explanation: The index is outside the array bounds.', '```', '</details>', '---',
  '**Question 2.** Which Java declaration creates five integers?', '- A) `int arr = new int[5];`', '- B) `int[] arr = new int[5];`', '- C) `array int arr[5];`', '- D) `int arr(5);`',
  '<details>', '<summary>Click to reveal answer</summary>', '', '```answer', 'Correct: B. Explanation: Java declares an integer array with `int[]`.', '```', '</details>', '---',
  '**Question 3.** What is the time complexity to read an array length?', '- A) O(n)', '- B) O(log n)', '- C) O(1)', '- D) O(n²)',
  '<details>', '<summary>Click to reveal answer</summary>', '', '```answer', 'Correct: C. Explanation: The length is stored as a property.', '```', '</details>', '---',
  '**Question 4.** Can a typed Java array store integers and strings together?', '- A) Yes, always', '- B) No, elements share one type', '- C) Only with libraries', '- D) It depends on size',
  '<details>', '<summary>Click to reveal answer</summary>', '', '```answer', 'Correct: B. Explanation: A Java array has one component type.', '```', '</details>', '---',
  '**Question 5.** What is linear search time complexity in the worst case?', '- A) O(1)', '- B) O(log n)', '- C) O(n)', '- D) O(n²)',
  '<details>', '<summary>Click to reveal answer</summary>', '', '```answer', 'Correct: C. Explanation: It may inspect every element.', '```', '</details>',
].join('\n\n')
const detailsSegments = splitInteractiveQuizzes(detailsWrappedReply)
const detailsQuizzes = detailsSegments.flatMap((segment) => segment.type === 'quiz' ? [segment.quiz] : [])
check('Codex-style details wrappers are removed and answer blocks are parsed', detailsQuizzes.length === 5 && detailsQuizzes.every((quiz) => quiz?.correctLetter && quiz.explanation))
check('the generated quiz title, score keys, and single-card grouping survive model formatting', detailsQuizzes[0]?.title === 'Arrays – New MCQ Test' && detailsQuizzes.map((quiz) => quiz?.correctLetter).join('') === 'BBCBC' && detailsSegments.length === 5)
check('hidden HTML and answers do not leak into ordinary Markdown', !detailsSegments.some((segment) => segment.type === 'markdown' && /<details>|Correct: [A-D]/i.test(segment.content)))

const bulkReply = ['## Advanced Scenario MCQ Test', ...Array.from({ length: 3 }, (_, i) => [`**Question ${i + 1}.** Choose an action.`, '- A) First action', '- B) Second action', '- C) Third action', '- D) Fourth action'].join('\n')), '```answer', 'Correct: A. Explanation: First rationale.', '', 'Correct: B. Explanation: Second rationale.', '', 'Correct: B. Explanation: Third rationale.', '```'].join('\n\n')
const bulkSegments = splitInteractiveQuizzes(bulkReply)
const bulkQuizzes = bulkSegments.flatMap((segment) => segment.type === 'quiz' ? [segment.quiz] : [])
check('ordered keys in a shared final answer fence map to their own questions', bulkQuizzes.length === 3 && bulkQuizzes.map((quiz) => quiz.correctLetter).join('') === 'ABB' && bulkQuizzes.map((quiz) => quiz.explanation).join('|') === 'First rationale.|Second rationale.|Third rationale.')
check('a shared answer fence still scores correctly without leaking into normal Markdown', calculateQuizScore(bulkQuizzes, { 1: 'A', 2: 'B', 3: 'B' }) === 3 && !bulkSegments.some((segment) => segment.type === 'markdown' && segment.content.includes('Correct:')))
const mismatchedKeys = splitInteractiveQuizzes(bulkReply.replace('Correct: B. Explanation: Second rationale.', '')) .flatMap((segment) => segment.type === 'quiz' ? [segment.quiz] : [])
check('an incomplete shared key never fabricates a fully graded quiz', !mismatchedKeys.every((quiz) => Boolean(quiz.correctLetter)))

const withQuickExplanation = `${plainModelReply}\n\n## Quick Explanations:\n\n- **Q1:** Secret explanation for the first answer.\n- **Q2:** Secret explanation for the second answer.\n\n## Next lesson\nKeep learning.`
const quickSegments = splitInteractiveQuizzes(withQuickExplanation)
check('quick explanations are attached to the quiz instead of visible Markdown', quickSegments.some((segment) => segment.type === 'quiz' && segment.quiz.quickExplanation?.includes('Secret explanation')) && !quickSegments.some((segment) => segment.type === 'markdown' && segment.content.includes('Secret explanation')))
const quickHtml = renderToStaticMarkup(createElement(Markdown, { content: withQuickExplanation }))
check('unsubmitted quizzes hide the quick explanation heading and contents', !quickHtml.includes('Quick Explanations') && !quickHtml.includes('Secret explanation'))
check('the following lesson stays visible independently of submission', quickHtml.includes('Next lesson') && quickHtml.includes('Keep learning.'))
check('an explanation without a preceding quiz remains normal content', renderToStaticMarkup(createElement(Markdown, { content: '## Quick Explanations:\nAn ordinary lesson.' })).includes('An ordinary lesson.'))

const formattedQuiz = ['1. What does `len(items)` return?', 'A) *The length*', 'B) `items[0]`', 'C) ~~Nothing~~', 'D) A name', '```answer', 'Correct: A. Explanation: It counts items.', '```'].join('\n')
const formattedHtml = renderToStaticMarkup(createElement(Markdown, { content: formattedQuiz }))
check('question and option Markdown render inline without literal formatting markers', formattedHtml.includes('<code>len(items)</code>') && formattedHtml.includes('<em>The length</em>') && formattedHtml.includes('<code>items[0]</code>') && formattedHtml.includes('<del>Nothing</del>'))
check('quiz choices contain no nested paragraphs or clickable links', [...formattedHtml.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/g)].every((match) => !/<(?:p|a)\b/.test(match[1])))

for (const marker of ['```', '~~~~']) {
  const sample = `${marker}text\n1. A sample question\nA) First\nB) Second\nAnswers: 1-B\n${marker}`
  const parsed = splitInteractiveQuizzes(sample)
  check(`${marker} code fences keep quiz-like source unchanged`, parsed.length === 1 && parsed[0].type === 'markdown' && parsed[0].content === sample)
  const incomplete = sample.slice(0, -marker.length)
  check(`${marker} unfinished streaming fences never become quiz controls`, splitInteractiveQuizzes(incomplete).every((segment) => segment.type === 'markdown'))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
