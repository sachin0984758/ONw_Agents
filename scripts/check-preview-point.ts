import assert from 'node:assert/strict'
import { previewPoint } from '../src/lib/agent-hub/computer/preview-point'
const box = { left: 10, top: 20, width: 600, height: 600 }
const image = { width: 1000, height: 500 }
const bounds = [-1000, 100, 0, 600]
assert.deepEqual(previewPoint(310, 320, box, image, bounds), { x: -500, y: 350 })
assert.equal(previewPoint(310, 100, box, image, bounds), null)
assert.equal(previewPoint(610, 320, box, image, bounds), null)
assert.equal(previewPoint(0, 320, box, image, bounds), null)
assert.equal(previewPoint(100, 200, box, { width: 0, height: 0 }, bounds), null)
assert.deepEqual(previewPoint(609.99, 469.99, box, image, bounds), { x: -1, y: 599 })
assert.equal(previewPoint(100, 200, box, image, [0, 0, 0, 0]), null)
console.log('7 preview coordinate checks passed (letterboxing, negative monitors, bounds and invalid frames).')
