import type { AutoTask } from './protocol'

/** Some local computer-use models end with a protocol marker. Present a
 * receipt only when the native event contains verified editor readback. */
export function autoResultText(task: AutoTask): string {
  if (task.phase !== 'completed') return task.result
  try {
    const result = JSON.parse(task.result)
    if (result?.action !== 'done') return task.result
    const typed = task.events.findLast((entry) => entry.action === 'desktop.type_text' && entry.phase === 'verifying' && entry.ok && entry.verified)
    if (typed) {
      const evidence = JSON.parse(typed.output)
      if (evidence.verified && typeof evidence.actual_text === 'string') {
        const text = evidence.actual_text.length <= 300 ? ` ${JSON.stringify(evidence.actual_text)}` : ' the requested text'
        return `Typed${text} and verified it by reading the editor text back.`
      }
    }
    return 'The model ended the task. Review the recorded actions and verification results below.'
  } catch { return task.result }
}
