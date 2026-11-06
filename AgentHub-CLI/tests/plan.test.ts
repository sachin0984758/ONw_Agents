import assert from 'node:assert/strict'
import test from 'node:test'
import { PlanState } from '../src/core/plan.ts'

test('plan dependencies reject cycles and premature completion without replacing the plan', () => {
  const plan = new PlanState()
  plan.set(['build', 'test'], [[], [1]])
  assert.throws(() => plan.update(2, 'completed'), /depend/i)
  assert.throws(() => plan.set(['a', 'b'], [[2], [1]]), /cycle/i)
  assert.equal(plan.steps[0]?.title, 'build')
  plan.update(1, 'completed')
  plan.update(2, 'completed')
  plan.update(1, 'failed', 'regression')
  assert.equal(plan.steps[1]?.status, 'blocked')
  plan.update(1, 'cancelled')
  assert.equal(new PlanState(plan.stored()).steps[0]?.status, 'cancelled')
  assert.deepEqual(plan.snapshot()[1]?.dependsOn, [1])
})

test('legacy plans remain compatible; explicit replanning is atomic', () => {
  const plan = new PlanState([{ title: 'old', status: 'active' }])
  assert.deepEqual(plan.stored(), [{ title: 'old', status: 'active' }])
  assert.throws(() => plan.set(['invalid'], [[2]]), /dependency/i)
  assert.equal(plan.active(), 'old')
  plan.set(['revised'])
  assert.equal(plan.update(2, 'active'), false)
})
