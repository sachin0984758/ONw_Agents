import { isCrossOrigin } from '@/lib/agent-hub/request-origin'
import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import type { SystemTelemetry } from '@/lib/agent-hub/types'

// ─── System telemetry ────────────────────────────────────────────────────────
// Live host hardware stats for the Overview console: GPU via nvidia-smi, CPU
// and RAM via Node's os module. Read-only, no parameters, no writes.
//
//   GET → { ok, platform, hostname, uptimeSec, gpu, cpu, memory, notes, sampledAt }
//
// Honest degradation: a machine with no NVIDIA GPU reports `gpu: null` plus a
// note, and the UI renders an "unavailable" dial rather than fake zeros.
// This is a local dashboard trust boundary (same as a terminal) — it exposes
// hardware facts about the machine the dashboard runs on and nothing else.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = 'nodejs'
import { cpuUtilization, type CpuCounters } from '@/lib/agent-hub/cpu-sample'
const samples = globalThis as typeof globalThis & { agentHubCpuSample?: CpuCounters }

const execFileAsync = promisify(execFile)



/** nvidia-smi CSV query. Resolves null when the tool or GPU is absent. */
async function readGpu(): Promise<SystemTelemetry['gpu']> {
  // NOTE: `cuda_version` is deliberately NOT queried — some drivers (e.g. the
  // 610.88 series on this machine) reject the field and exit 2, which fails the
  // whole query and reports the GPU as missing. Keep the field list to what a
  // stock nvidia-smi reliably supports.
  const fields = ['name', 'memory.total', 'memory.used', 'utilization.gpu', 'temperature.gpu', 'power.draw', 'driver_version'].join(',')
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [`--query-gpu=${fields}`, '--format=csv,noheader,nounits'], {
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    const line = stdout.trim().split(/\r?\n/)[0]
    if (!line) return null
    const [name, memTotal, memUsed, util, temp, power, driver] = line.split(',').map((s) => s.trim())
    const num = (s: string | undefined) => {
      const n = Number.parseFloat(String(s ?? '').replace(/[^0-9.]/g, ''))
      return Number.isFinite(n) ? n : 0
    }
    const vramTotalMb = num(memTotal)
    return {
      name: name || 'Unknown GPU',
      vramUsedMb: num(memUsed),
      vramTotalMb,
      utilizationPct: Math.max(0, Math.min(100, num(util))),
      temperatureC: num(temp),
      powerDrawW: num(power),
      driverVersion: driver || undefined,
    }
  } catch {
    // No nvidia-smi on PATH, no NVIDIA driver, no GPU, or an unsupported field.
    return null
  }
}

async function readCpu(): Promise<SystemTelemetry['cpu']> {
  const cpus = os.cpus()
  const first = cpus[0]
  let idle = 0
  let total = 0
  for (const c of cpus) {
    idle += c.times.idle
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle
  }
  const previous = samples.agentHubCpuSample
  const current = { idle, total }
  samples.agentHubCpuSample = current
  if (!previous || cpuUtilization(current, previous) === null) {
    await new Promise((resolve) => setTimeout(resolve, 120))
    return readCpu()
  }
  const utilizationPct = cpuUtilization(current, previous)!
  return {
    model: (first?.model ?? 'Unknown CPU').trim(),
    cores: first ? os.cpus().length : 0,
    threads: cpus.length,
    // Speed is reported in MHz by Node.
    clockGhz: Math.round((first?.speed ?? 0)) / 1000,
    utilizationPct,
  }
}

function readMemory(): SystemTelemetry['memory'] {
  const totalBytes = os.totalmem()
  const freeBytes = os.freemem()
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  const gb = 1024 ** 3
  return {
    usedGb: Math.round((usedBytes / gb) * 10) / 10,
    totalGb: Math.round((totalBytes / gb) * 10) / 10,
    utilizationPct: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
  }
}

export async function GET(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403 })
  }

  const notes: string[] = []
  const [gpu, cpu] = await Promise.all([readGpu(), readCpu()])
  if (!gpu) {
    notes.push(
      os.platform() === 'win32'
        ? 'No NVIDIA GPU detected (nvidia-smi unavailable).'
        : 'No NVIDIA GPU detected (nvidia-smi unavailable on this platform).',
    )
  }

  const payload: SystemTelemetry = {
    ok: true,
    platform: `${os.type()} ${os.release()} (${os.platform()})`,
    hostname: os.hostname(),
    uptimeSec: Math.round(os.uptime()),
    gpu,
    cpu,
    memory: readMemory(),
    notes: notes.length ? notes : undefined,
    sampledAt: new Date().toISOString(),
  }
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
