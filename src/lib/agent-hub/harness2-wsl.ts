import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveProjectRoot } from './db-path'

const exec = promisify(execFile)
const scriptFile = path.join(resolveProjectRoot(), 'scripts', 'harness2-wsl.sh')
const options = { timeout: 15_000, maxBuffer: 256_000, windowsHide: true }
const decode = (text: string) => text.replaceAll('\0', '')

export function harness2Distro() {
  const value = process.env.AGENTHUB_HARNESS2_WSL_DISTRO?.trim() || 'Ubuntu-24.04'
  if (!/^Ubuntu(?:-\d{2}\.\d{2})?$/.test(value)) throw new Error('Select an installed Ubuntu WSL2 distribution.')
  return value
}

async function invoke(mode: 'check' | 'demo', source = '') {
  const script = (await fs.readFile(scriptFile, 'utf8')).replaceAll('\r\n', '\n')
  try {
    return await exec('wsl.exe', ['--distribution', harness2Distro(), '--exec', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8', '/bin/bash', '-c', script, 'agenthub-harness2', mode, source], { ...options, timeout: mode === 'demo' ? 135_000 : 15_000, encoding: 'utf8' })
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; killed?: boolean }
    const diagnostic = decode(failure.stderr || failure.stdout || '').slice(0, 1500).trim()
    throw new Error(diagnostic || (failure.killed ? 'WSL execution exceeded its deadline.' : 'WSL could not start the isolated Harness2 workload.'))
  }
}

export async function checkHarness2Wsl() {
  const distro = harness2Distro()
  try {
    const { stdout } = await exec('wsl.exe', ['--list', '--verbose'], { ...options, encoding: 'utf16le' })
    const installed = stdout.split(/\r?\n/).some((line) => {
      const parts = line.replace(/^\s*\*?\s*/, '').trim().split(/\s+/)
      return parts[0] === distro && parts.at(-1) === '2'
    })
    if (!installed) return { available: false, distro, blocker: `Install ${distro} as a WSL2 distribution. It is not currently registered as WSL2.` }
    const result = await invoke('check')
    if (!result.stdout.includes('HARNESS2_WSL_ISOLATION_OK')) throw new Error('WSL isolation check did not produce a verified result.')
    return { available: true, distro, blocker: null }
  } catch (error) {
    return { available: false, distro, blocker: error instanceof Error ? error.message : 'WSL preflight failed.' }
  }
}

export async function runHarness2WslDemo(source: string) {
  const check = await checkHarness2Wsl()
  if (!check.available) throw new Error(check.blocker!)
  const result = await invoke('demo', source)
  const report = result.stdout.split(/\r?\n/).find((line) => line.startsWith('HARNESS2_REPORT='))
  if (!report) throw new Error('The official WSL demo produced no report.')
  return JSON.parse(report.slice('HARNESS2_REPORT='.length)) as unknown
}
