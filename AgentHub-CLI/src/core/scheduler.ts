/** Only side-effect-free tools explicitly listed here may overlap. */
export const PARALLEL_READ_TOOLS = new Set(['read_file', 'list_dir', 'search_files', 'file_info', 'git_status', 'git_diff', 'git_log', 'git_show', 'git_branch'])

export async function mapBounded<T, R>(items: readonly T[], concurrency: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
  const settled = await Promise.allSettled(Array.from({ length: workers }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await work(items[i]!, i)
    }
  }))
  const failed = settled.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return out
}
