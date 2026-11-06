import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeBlock } from '../src/components/agent-hub/code-block'
import { Markdown } from '../src/components/agent-hub/chat-view'
import { ConversationColorScheme } from '../src/components/agent-hub/conversation-color-scheme'

let passed = 0
let failed = 0
function check(name: string, condition: boolean) {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} ${name}`)
  if (condition) passed += 1
  else failed += 1
}
function render(code: string, language = 'python', showLineNumbers?: boolean) {
  return renderToStaticMarkup(createElement(CodeBlock, { code, language, showLineNumbers }))
}
function numbers(html: string) {
  return [...html.matchAll(/class="[^"]*react-syntax-highlighter-line-number[^"]*"[^>]*>(\d+)<\/span>/g)].map((match) => Number(match[1]))
}
function source(html: string) {
  const code = /<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1] ?? ''
  return code.replace(/<span\b[^>]*class="[^"]*react-syntax-highlighter-line-number[^"]*"[^>]*>\d+<\/span>/g, '').replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

const python = ['import asyncio', '', 'def main():', '    for number in range(3):', '        if number:', '            print(number)', '', 'if __name__ == "__main__":', '    main()'].join('\n')
const html = render(python)
check('short code blocks number every line, including blank lines and the final line', numbers(html).join(',') === '1,2,3,4,5,6,7,8,9')
check('each source row contains its own number instead of a detached gutter', (html.match(/data-code-line="\d+"/g) ?? []).length === 9 && !/<code\b[^>]*>[\s\S]*?<code\b/.test(html))
check('rendered Python preserves indentation, whitespace and line ordering exactly', source(html) === python)
const longSource = Array.from({ length: 125 }, (_, index) => index % 9 === 0 ? '' : `    value_${index + 1} = ${index}`).join('\n')
const longHtml = render(longSource)
check('long code has a continuous one-to-one sequence through line 125', numbers(longHtml).length === 125 && numbers(longHtml).every((number, index) => number === index + 1))
check('crossing 9, 99 and 100 does not change the gutter width', (longHtml.match(/width:3ch/g) ?? []).length === 250)
check('pre and code share font size and line height, without prose padding on block code', html.includes('line-height:1.65') && html.includes('line-height:inherit') && html.includes('font-size:inherit') && html.includes('margin:0;padding:0'))
check('line numbers remain upright and readable instead of inheriting comment styling', [...html.matchAll(/<span\b[^>]*class="[^"]*react-syntax-highlighter-line-number[^"]*"[^>]*>/g)].every(([span]) => span.includes('font-style:normal') && span.includes('color:var(--muted-foreground)')))
check('a very long line remains one numbered line and retains all text', numbers(render('    ' + 'value'.repeat(180))).length === 1 && source(render('    ' + 'value'.repeat(180))) === '    ' + 'value'.repeat(180))
check('CRLF and CR render consistently without stray carriage returns', source(render('one\r\n    two\rthree', 'text')) === 'one\n    two\nthree' && numbers(render('one\r\n    two\rthree', 'text')).length === 3)
check('tabs and intentional blank lines remain intact', source(render('\tif value:\n\n\t\tprint(value)\n')) === '\tif value:\n\n\t\tprint(value)\n')
check('a trailing empty line receives its own number', numbers(render('first\nsecond\n')).join(',') === '1,2,3')
check('unsupported languages use the same numbered layout', numbers(render('alpha\n  beta', 'unknown-language')).join(',') === '1,2' && source(render('alpha\n  beta', 'unknown-language')) === 'alpha\n  beta')
check('explicitly disabling numbering remains supported', numbers(render(python, 'python', false)).length === 0 && source(render(python, 'python', false)) === python)
check('normal Chat Markdown uses the corrected renderer and leaves inline code inline', (() => { const rendered = renderToStaticMarkup(createElement(Markdown, { content: `Use \`main()\`.\n\n\`\`\`python\n${python}\n\`\`\`` })); return numbers(rendered).length === 9 && rendered.includes('Use <code') })())
check('source resembling HTML is rendered as text', !render('print("<script>alert(1)</script>")').includes('<script>'))
const cssSource = 'body { color: red; padding: 1rem; }'
const cssHtml = render(cssSource, 'css')
check('CSS fences produce syntax tokens and preserve the original source', source(cssHtml) === cssSource && (cssHtml.match(/<span\b/g) ?? []).length > (render(cssSource, 'text').match(/<span\b/g) ?? []).length)

const light = renderToStaticMarkup(createElement(ConversationColorScheme.Provider, { value: 'light' }, createElement(CodeBlock, { language: 'python', code: 'print(42)' })))
const dark = renderToStaticMarkup(createElement(ConversationColorScheme.Provider, { value: 'dark' }, createElement(CodeBlock, { language: 'python', code: 'print(42)' })))
check('conversation Day and Night palettes produce different syntax colors with identical source', light !== dark && source(light) === source(dark) && source(light) === 'print(42)')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
