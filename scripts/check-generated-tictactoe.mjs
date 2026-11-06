// Executes the generated game's actual JavaScript with a small DOM fixture.
// This verifies game rules and click handlers, not browser layout or rendering.
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const html = fs.readFileSync(process.argv[2], 'utf8')
class Element {
  children = []; dataset = {}; textContent = ''; listeners = {}; classList = { add() {} }
  set innerHTML(value) { if (value === '') this.children = [] }
  appendChild(child) { this.children.push(child) }
  addEventListener(name, handler) { this.listeners[name] = handler }
  click() { this.listeners.click?.({ target: this }) }
}
const elements = Object.fromEntries(['board', 'status', 'restart'].map((id) => [id, new Element()]))
const context = vm.createContext({ document: { getElementById: (id) => elements[id], createElement: () => new Element() } })
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) vm.runInContext(script[1], context, { timeout: 1000 })
const click = (index) => elements.board.children[index].click()
assert.equal(elements.board.children.length, 9)
click(0); assert.equal(elements.board.children[0].textContent, 'X')
click(0); assert.equal(elements.board.children[0].textContent, 'X')
click(3); assert.equal(elements.board.children[3].textContent, 'O')
for (const index of [1, 4, 2]) click(index)
assert.match(elements.status.textContent, /X wins/)
click(8); assert.equal(elements.board.children[8].textContent, '')
elements.restart.click()
assert.equal(elements.board.children.length, 9)
assert.ok(elements.board.children.every((cell) => cell.textContent === ''))
assert.match(elements.status.textContent, /X.*turn/)
for (const index of [0, 1, 2, 4, 3, 5, 7, 6, 8]) click(index)
assert.match(elements.status.textContent, /draw/i)
console.log('PASS generated game: nine cells, alternating players, occupied-cell protection, win, post-win lock, restart and draw. DOM fixture only; visual browser test not included.')
