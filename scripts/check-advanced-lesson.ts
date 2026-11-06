import assert from 'node:assert/strict'
import { advancedStep, labelAdvancedLesson, ADVANCED_STEPS } from '../src/lib/agent-hub/advanced-lesson'

const history = [
  { role: 'user', content: 'Teach me data structures.' },
  { role: 'assistant', content: '## Step 1: The Simplified Concept\n\nA stack is like a pile of trays.' },
]
assert.equal(advancedStep([], 'Explain a stack'), 1)
assert.equal(advancedStep(history, 'Yes, I understand. Continue to Step 2 only, under 100 words.'), 2)
assert.equal(advancedStep(history, 'What does this word mean?'), 1)
assert.equal(advancedStep(history, "Yes, I'm confused; explain again."), 1)
assert.equal(advancedStep([...history, { role: 'assistant', content: '## Step 5: The Second-Order and Edge-Case Audit' }], 'Yes, continue.'), 5)
assert.equal(advancedStep(history, 'Restart with SQL'), 1)
assert.equal(labelAdvancedLesson('A variable is a label for stored data.', 1), `## Step 1: ${ADVANCED_STEPS[0]}\n\nA variable is a label for stored data.`)
assert.equal(labelAdvancedLesson('What topic do you mean? Which language are you using?', 1), 'What topic do you mean? Which language are you using?')
assert.equal(labelAdvancedLesson('## Step 2: Old heading\n\nNew explanation.', 3), `## Step 3: ${ADVANCED_STEPS[2]}\n\nNew explanation.`)
console.log('9 Advanced teaching state and heading checks passed.')
