import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import { DB_DIR, resolveProjectRoot } from './db-path'
import { createSerializer, writeJsonAtomic } from './fs-atomic'

export const HARNESS2_REVISION = '6868817518876de8fd170c6a8354daca273b6191'
const source = path.join(resolveProjectRoot(), '.agenthub', 'vendor', 'harness2')
const file = path.join(DB_DIR, 'agent-optimization.json')
const exec = promisify(execFile)
const serialize = createSerializer()
const limits = { timeout: 10_000, maxBuffer: 128_000, windowsHide: true }
interface State {
  enabled: boolean
  demo?: { passed: boolean; revision: string; checkedAt: string; report?: unknown; error?: string }
}
async function read(): Promise<State> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as State }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Optimization settings could not be read. Existing settings were preserved.') }
  return { enabled: false }
}

export async function harness2Status() {
  const state = await read()
  const installed = await exec('git', ['-C', source, 'rev-parse', 'HEAD'], limits).then(({ stdout }) => stdout.trim()).catch(() => '')
  const clean = installed === HARNESS2_REVISION && await exec('git', ['-C', source, 'status', '--porcelain', '--untracked-files=no'], limits).then(({ stdout }) => !stdout.trim()).catch(() => false)
  const docker = await exec('docker', ['info', '--format', '{{.OSType}}'], limits).then(({ stdout }) => stdout.trim() === 'linux').catch(() => false)
  const image = process.env.AGENTHUB_HARNESS2_IMAGE?.trim()
  const localImage = Boolean(image && /@sha256:[a-f0-9]{64}$/i.test(image)) && docker && await exec('docker', ['image', 'inspect', image!], limits).then(() => true).catch(() => false)
  const blockers = [
    ...(!clean ? ['The official pinned Harness² checkout is missing or modified.'] : []),
    ...(!docker ? ['Docker with a running Linux container engine is required for isolated experiments.'] : []),
    ...(!localImage ? ['Set AGENTHUB_HARNESS2_IMAGE to a locally available trusted Python 3.12 image pinned by digest.'] : []),
  ]
  return { ...state, revision: HARNESS2_REVISION, sourceInstalled: clean, blockers, adapters: [
    { name: 'Official credential-free demo', state: state.demo?.passed ? 'verified' : 'unverified' },
    { name: 'AgentHub model/tool adapter', state: 'not implemented' },
  ], improvements: [] }
}

export async function testHarness2Demo() {
  return serialize(async () => {
    const status = await harness2Status()
    if (status.blockers.length) throw new Error(status.blockers.join(' '))
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-harness2-'))
    const output = path.join(temporary, 'output')
    const stagedSource = path.join(temporary, 'official')
    const container = `agenthub-harness2-${crypto.randomUUID()}`
    const image = process.env.AGENTHUB_HARNESS2_IMAGE!.trim()
    const state = await read()
    try {
      await fs.mkdir(output)
      const { stdout } = await exec('git', ['-C', source, 'ls-files', '-z', '--', 'harness2', 'pyproject.toml', 'LICENSE'], { ...limits, maxBuffer: 1_000_000 })
      for (const relative of stdout.split('\0').filter(Boolean)) {
        if (relative.split('/').some((part) => !part || part === '..' || part.startsWith('.')) || relative.includes('\\')) throw new Error('Unexpected path in the official checkout.')
        const original = path.join(source, ...relative.split('/'))
        if (!(await fs.lstat(original)).isFile()) throw new Error('Unexpected link in the official checkout.')
        const destination = path.join(stagedSource, ...relative.split('/'))
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.copyFile(original, destination)
      }
      // Run the official engine and deterministic demo, unchanged. No executor
      // binaries, model credentials, project workspace or host environment enter.
      await exec('docker', [
        'run', '--rm', '--name', container, '--pull=never', '--network=none', '--read-only',
        '--cpus=2', '--memory=1g', '--pids-limit=128', '--cap-drop=ALL',
        '--security-opt=no-new-privileges', '--user=65534:65534',
        '--tmpfs', '/tmp:rw,nosuid,noexec,size=128m', '--env', 'HOME=/tmp',
        '--mount', `type=bind,source=${stagedSource},target=/official,readonly`,
        '--mount', `type=bind,source=${output},target=/output`,
        '--workdir=/output', '--entrypoint=python', image, '-I', '-B', '-c',
        'import sys,runpy;sys.path.insert(0,"/official");sys.argv=["harness2-demo","--output","/output/demo","--k","2","--mode","both"];runpy.run_module("harness2.cli.demo",run_name="__main__")',
      ], { ...limits, timeout: 120_000, maxBuffer: 256_000 })
      const report = JSON.parse(await fs.readFile(path.join(output, 'demo', 'demo.json'), 'utf8'))
      if (report.failed !== 0 || !(report.done > 0) || !(report.execution_count > 0) || !(report.editor_calls > 0)) throw new Error('Official demo did not report successful recursion and executions.')
      state.demo = { passed: true, revision: HARNESS2_REVISION, checkedAt: new Date().toISOString(), report }
    } catch (error) {
      state.enabled = false
      state.demo = { passed: false, revision: HARNESS2_REVISION, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message.slice(0, 1500) : 'Demo failed.' }
    } finally {
      await exec('docker', ['rm', '-f', container], limits).catch(() => undefined)
      if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('agenthub-harness2-')) await fs.rm(temporary, { recursive: true, force: true })
    }
    await writeJsonAtomic(file, state)
    return harness2Status()
  })
}

export async function disableHarness2() {
  return serialize(async () => {
    const state = await read()
    state.enabled = false
    await writeJsonAtomic(file, state)
    return harness2Status()
  })
}
