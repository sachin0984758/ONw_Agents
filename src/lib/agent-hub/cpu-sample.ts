export interface CpuCounters { idle: number; total: number }
/** CPU activity is a delta across samples, never a lifetime average. */
export function cpuUtilization(current: CpuCounters, previous: CpuCounters): number | null {
  const total = current.total - previous.total
  const idle = current.idle - previous.idle
  if (total <= 0 || idle < 0 || idle > total) return null
  return Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100)))
}
