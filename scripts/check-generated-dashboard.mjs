// Run the generated event handlers in a DOM fixture; no browser rendering claim.
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const html = fs.readFileSync(process.argv[2], 'utf8')
class Element {
  children = []; listeners = {}; textContent = ''; checked = false
  set innerHTML(value) { this.checkbox = new Element(); this.checkbox.checked = /\schecked/.test(value) }
  appendChild(child) { this.children.push(child) }
  querySelector() { return this.checkbox }
  addEventListener(name, handler) { this.listeners[name] = handler }
}
const elements = Object.fromEntries(['tasks-container', 'total-tasks', 'completed-tasks', 'pending-tasks'].map((id) => [id, new Element()]))
const context = vm.createContext({ document: { getElementById: (id) => elements[id], createElement: () => new Element(), addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') fn() } } })
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) vm.runInContext(script[1], context, { timeout: 1000 })
assert.equal(elements['total-tasks'].textContent, 6)
assert.equal(elements['completed-tasks'].textContent, 2)
assert.equal(elements['pending-tasks'].textContent, 4)
const checkbox = elements['tasks-container'].children[0].checkbox
checkbox.checked = true; checkbox.listeners.change()
assert.equal(elements['completed-tasks'].textContent, 3)
assert.equal(elements['pending-tasks'].textContent, 3)
checkbox.checked = false; checkbox.listeners.change()
assert.equal(elements['completed-tasks'].textContent, 2)
assert.equal(elements['pending-tasks'].textContent, 4)
console.log('PASS generated dashboard: initial counts, checkbox completion, pending count, and uncheck reversal. DOM fixture only; no visual browser test.')
