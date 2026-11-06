import type { PlanStepEvent } from './events.ts'

export interface PlanStep {
  title: string
  status: PlanStepEvent['status']
  note?: string
  dependsOn?: number[]
}

export class PlanState {
  steps: PlanStep[] = []

  constructor(initial: PlanStep[] = []) {
    if (initial.some((step) => step.dependsOn?.length)) this.set(initial.map((step) => step.title), initial.map((step) => step.dependsOn ?? []))
    this.steps = initial.map((step) => ({
      title: step.title,
      status: step.status,
      ...(step.note ? { note: step.note } : {}),
      ...(step.dependsOn ? { dependsOn: [...step.dependsOn] } : {}),
    }))
  }

  set(titles: string[], dependencies?: number[][]): void {
    if (dependencies && dependencies.length !== titles.length) throw new Error('One dependency list is required for each step.')
    const deps = dependencies ?? titles.map(() => [])
    for (const [index, list] of deps.entries()) {
      if (!Array.isArray(list) || list.some((n) => !Number.isInteger(n) || n < 1 || n > titles.length || n === index + 1)) {
        throw new Error('Invalid plan dependency: use other existing step numbers (1-based).')
      }
    }
    const visiting = new Set<number>()
    const visited = new Set<number>()
    const visit = (i: number): void => {
      if (visiting.has(i)) throw new Error('Plan dependency cycle detected.')
      if (visited.has(i)) return
      visiting.add(i)
      for (const n of deps[i] ?? []) visit(n - 1)
      visiting.delete(i)
      visited.add(i)
    }
    titles.forEach((_, i) => visit(i))
    this.steps = titles.map((title, i) => ({ title, status: 'pending' as const,
      ...(deps[i]?.length ? { dependsOn: [...new Set(deps[i])] } : {}) }))
  }

  stored(): PlanStep[] {
    return this.steps.map((step) => ({
      title: step.title,
      status: step.status,
      ...(step.note ? { note: step.note } : {}),
      ...(step.dependsOn ? { dependsOn: [...step.dependsOn] } : {}),
    }))
  }

  update(index1Based: number, status: PlanStepEvent['status'], note?: string): boolean {
    const index = index1Based - 1
    const step = this.steps[index]
    if (!step) return false
    if ((status === 'active' || status === 'completed') && step.dependsOn?.some((n) => this.steps[n - 1]?.status !== 'completed')) {
      throw new Error('Cannot start or complete a step until its dependencies are completed.')
    }
    step.status = status
    if (note !== undefined) step.note = note
    // Reopening a prerequisite invalidates downstream completion evidence.
    if (status !== 'completed') {
      const invalid = new Set([index1Based])
      for (let pass = 0; pass < this.steps.length; pass++) {
        this.steps.forEach((dependent, i) => {
          if (dependent.dependsOn?.some((n) => invalid.has(n))) {
            invalid.add(i + 1)
            if (dependent.status === 'active' || dependent.status === 'completed') dependent.status = 'blocked'
          }
        })
      }
    }
    return true
  }

  snapshot(): PlanStepEvent[] {
    return this.steps.map((step, index) => ({
      index,
      title: step.title,
      status: step.status,
      ...(step.note ? { note: step.note } : {}),
      ...(step.dependsOn ? { dependsOn: [...step.dependsOn] } : {}),
    }))
  }

  active(): string | null {
    return this.steps.find((s) => s.status === 'active')?.title ?? null
  }

  progress(): { completed: number; total: number } {
    return {
      completed: this.steps.filter((s) => s.status === 'completed').length,
      total: this.steps.length,
    }
  }
}
