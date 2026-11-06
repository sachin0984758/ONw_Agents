import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import assert from 'node:assert/strict'
import { ObsidianNoteMarkdown } from '../src/components/agent-hub/obsidian-note-markdown'
import { readableNote } from '../src/lib/agent-hub/obsidian/presentation'
const render = (source: string) => renderToStaticMarkup(<ObsidianNoteMarkdown>{source}</ObsidianNoteMarkdown>)
let checks = 0
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; console.log('PASS', label) }
const formulas = [String.raw`\dfrac{n(n+1)}{2}`, 'n^2', 'n(n+1)', String.raw`\dfrac{n(n+1)(2n+1)}{6}`, String.raw`\left[\dfrac{n(n+1)}{2}\right]^2`]
const table = '| Sum | Formula |\n|---|---|\n' + formulas.map((formula, index) => `| ${index + 1} | $${formula}$ |`).join('\n')
const html = render(table)
check((html.match(/class="katex"/g) ?? []).length === 5, 'five table formulas typeset')
check(html.includes('<mfrac>') && html.includes('<msup>'), 'fractions and powers have accessible MathML')
check(!html.includes('katex-error'), 'all requested formulas are valid TeX')
check(render('$$\n'+formulas[0]+'\n$$').includes('katex-display'), 'block equations typeset')
check(render('$1+2+3$\n$3+2+1$').includes('<br/>'), 'paired equation lines stay visually separate')
check(!render('`$n^2$`').includes('class="katex"'), 'inline source code stays literal')
check(!render('```text\n$n^2$\n```').includes('class="katex"'), 'plain fenced source stays literal')
const untrusted = render(String.raw`$\href{https://example.com/private}{secret}$ $\includegraphics{https://example.com/pixel}$ $\htmlStyle{position:fixed}{x}$`)
check(!/<(?:a|img|script)[\s>]/.test(untrusted), 'untrusted TeX cannot create links, images or scripts')
check(!render('![x](https://example.com/pixel)').includes('<img'), 'ordinary note images remain inert')
check(!render('[x](https://example.com)').includes('<a '), 'ordinary note links remain inert')
check(render('$\\unknownCommand{x}$').length > 0, 'invalid TeX retains visible fallback without crashing')
const formulasAt = (n: number) => [n * (n + 1) / 2, n * n, n * (n + 1), n * (n + 1) * (2 * n + 1) / 6, (n * (n + 1) / 2) ** 2]
for (const n of [1, 2, 4, 10, 50, 100]) {
  const expected = [0, 0, 0, 0, 0]
  for (let k = 1; k <= n; k++) { expected[0] += k; expected[1] += 2 * k - 1; expected[2] += 2 * k; expected[3] += k * k; expected[4] += k * k * k }
  assert.deepEqual(formulasAt(n), expected); checks++
}
check(JSON.stringify(formulasAt(4)) === JSON.stringify([10, 16, 20, 30, 100]), 'all five pasted n=4 examples are correct')
async function main() {
  if (process.argv.includes('--live')) {
    const base = process.env.AGENTHUB_BASE_URL || 'http://localhost:3000'
    const path = 'LEARN/Aptitude/01_Number_System_and_Arithmetic/001_natural_numbers.md'
    const response = await fetch(`${base}/api/obsidian?op=read&path=${encodeURIComponent(path)}`, { headers: { Origin: base } })
    const data = await response.json()
    check(response.ok && data.ok && data.note.path === path, 'actual vault note read through live API')
    const content = data.note.content as string
    check(formulas.every((formula) => content.includes(formula)), 'actual note contains all five correct formulas')
    const actual = render(readableNote(content))
    check(!actual.includes('katex-error') && (actual.match(/class="katex"/g) ?? []).length > 20, 'actual complete note renders without math errors')
  }
  console.log(`${checks}/${checks} note-math checks passed; no model inference or vault edits.`)
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
