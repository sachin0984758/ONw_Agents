import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import { createServer, type Server } from 'node:http'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import { normalizeGitHubRef, readGitHubTemplate, readTemplateSource, savedFile, UI_LIBRARY_DIRECTORY } from './github-templates'

const run = promisify(execFile)
const serialize = createSerializer()
const logs = path.join(UI_LIBRARY_DIRECTORY, 'build-logs')
const logPath = (ref: string) => path.join(logs, `${normalizeGitHubRef(ref).replace('/', '--')}.json`)
const supportedImage = () => process.env.AGENTHUB_TEMPLATE_BUILD_IMAGE?.trim()
const dockerOptions = { timeout: 10_000, maxBuffer: 256_000, windowsHide: true }
interface Preview { ref: string; container: string; root: string; server: Server; url: string; timer: ReturnType<typeof setTimeout> }
const globals = globalThis as typeof globalThis & { agentHubTemplatePreviews?: Map<string, Preview> }
const previews = globals.agentHubTemplatePreviews ??= new Map<string, Preview>()

export function templatePreviewStatus(ref: string) {
  const preview = previews.get(normalizeGitHubRef(ref))
  return preview ? { url: preview.url } : null
}

export async function stopTemplatePreview(ref: string) {
  const key = normalizeGitHubRef(ref)
  const preview = previews.get(key)
  if (!preview) return
  previews.delete(key)
  clearTimeout(preview.timer)
  preview.server.closeAllConnections()
  preview.server.close()
  await run('docker', ['rm', '-f', preview.container], dockerOptions).catch(() => undefined)
  if (path.dirname(preview.root) === os.tmpdir() && path.basename(preview.root).startsWith('agenthub-build-')) await fs.rm(preview.root, { recursive: true, force: true })
}

async function servePreview(ref: string, container: string, root: string) {
  let active = 0
  const script = 'const http=require("node:http");let n=0,chunks=[];const r=http.get({hostname:"127.0.0.1",port:4173,path:process.argv[1],headers:{host:"127.0.0.1:4173"}},s=>{s.on("data",c=>{n+=c.length;if(n>8000000){r.destroy();process.exit(2)}chunks.push(c)});s.on("end",()=>console.log(JSON.stringify({status:s.statusCode,type:s.headers["content-type"],body:Buffer.concat(chunks).toString("base64")})))});r.setTimeout(8000,()=>r.destroy());r.on("error",()=>process.exit(1));'
  const server = createServer(async (req, res) => {
    const address = server.address()
    const host = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : ''
    if (req.headers.host !== host || req.method !== 'GET' || !req.url?.startsWith('/') || active >= 4) { res.writeHead(403); res.end(); return }
    active++
    try {
      const { stdout } = await run('docker', ['exec', container, 'node', '-e', script, req.url], { ...dockerOptions, maxBuffer: 12_000_000 })
      const value = JSON.parse(stdout)
      res.writeHead(Number(value.status) || 502, {
        'Content-Type': typeof value.type === 'string' ? value.type : 'application/octet-stream',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'",
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()',
      })
      res.end(Buffer.from(value.body, 'base64'))
    } catch { res.writeHead(502); res.end('The isolated preview did not respond. Check build logs or restart the preview.') }
    finally { active-- }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not bind the preview listener.')
  const url = `http://127.0.0.1:${address.port}`
  const timer = setTimeout(() => { void stopTemplatePreview(ref) }, 15 * 60_000)
  timer.unref()
  previews.set(ref, { ref, container, root, server, timer, url })
  return url
}
export async function templateBuildLog(ref: string) {
  try { return JSON.parse(await fs.readFile(logPath(ref), 'utf8')) as { status: 'passed' | 'failed'; commit: string; output: string; finishedAt: string } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}

export async function validateTemplateProject(ref: string) {
  const template = await readGitHubTemplate(ref)
  if (!template) throw new Error('Download the template first.')
  const manifest = JSON.parse(await readTemplateSource(ref, 'package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> }
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies }
  const framework = dependencies.next ? 'Next.js' : dependencies.vite ? 'Vite' : 'Unsupported'
  const blockers: string[] = []
  const lock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].find((file) => template.files.includes(file))
  const lockHash = lock ? createHash('sha256').update(await fs.readFile(await savedFile(ref, lock, 4_000_000))).digest('hex') : undefined
  if (framework === 'Unsupported') blockers.push('Only Next.js and Vite CLI builds are supported.')
  if (!lockHash) blockers.push('A saved npm, pnpm, or Yarn lockfile is required to match pre-provisioned dependencies.')
  const docker = await run('docker', ['info', '--format', '{{.OSType}}'], dockerOptions).then(({ stdout }) => stdout.trim() === 'linux').catch(() => false)
  if (!docker) blockers.push('A running Docker engine in Linux container mode is required. Host execution is disabled.')
  const image = supportedImage()
  if (!image || !/@sha256:[a-f\d]{64}$/i.test(image)) blockers.push('Configure a trusted AGENTHUB_TEMPLATE_BUILD_IMAGE pinned by digest with dependencies prepared for the lockfile.')
  else if (docker && !await run('docker', ['image', 'inspect', image], dockerOptions).then(() => true).catch(() => false)) blockers.push('The trusted build image must already be available locally.')
  const layoutFiles = template.files.filter((file) => /(?:^|\/)layout\.[jt]sx?$/.test(file))
  const layouts = await Promise.all(layoutFiles.map((file) => readTemplateSource(ref, file)))
  const externalFont = layouts.some((text) => text.includes('next/font/google'))
  return { framework, dependencies, scripts: manifest.scripts ?? {}, blockers, lockHash, externalFont, commit: template.commit }
}

export async function buildTemplate(ref: string, commit: string, approved: boolean, preview = false) {
  if (!approved) throw new Error('Approve the isolated build before running it.')
  return serialize(async () => {
    ref = normalizeGitHubRef(ref)
    const validation = await validateTemplateProject(ref)
    if (validation.commit !== commit || validation.blockers.length) throw new Error(validation.blockers.join(' ') || 'Saved revision changed. Validate it again.')
    const template = (await readGitHubTemplate(ref))!
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agenthub-build-'))
    const container = `agenthub-preview-${crypto.randomUUID()}`
    const image = supportedImage()!
    let previewUrl: string | undefined
    let status: 'passed' | 'failed' = 'failed'
    let output = ''
    try {
      for (const file of template.files) {
        const source = await savedFile(ref, file, 40_000_000)
        const target = path.join(root, ...file.split('/'))
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.copyFile(source, target)
      }
      const bin = validation.framework === 'Next.js' ? 'next/dist/bin/next' : 'vite/bin/vite.js'
      const command = 'test -d "$1" && ln -s "$1" node_modules && exec node "node_modules/$2" build'
      const { stdout, stderr } = await run('docker', [
        'run', '--rm', '--name', container, '--pull=never', '--network=none', '--read-only',
        '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--cpus=2', '--memory=2g',
        '--user=65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
        '--mount', `type=bind,source=${root},target=/work`, '--workdir=/work', '--env', 'HOME=/tmp',
        '--env', 'NEXT_TELEMETRY_DISABLED=1', '--entrypoint', '/bin/sh', image,
        '-c', command, 'agenthub-build', `/opt/agenthub-deps/${validation.lockHash}/node_modules`, bin,
      ], { ...dockerOptions, timeout: 180_000, maxBuffer: 1_000_000 })
      output = `${stdout}\n${stderr}`
      status = 'passed'
      if (preview) {
        await stopTemplatePreview(ref)
        await run('docker', [
          'run', '-d', '--rm', '--name', container, '--pull=never', '--network=none', '--read-only',
          '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128', '--cpus=2', '--memory=2g',
          '--user=65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
          '--mount', `type=bind,source=${root},target=/work`, '--workdir=/work', '--env', 'HOME=/tmp',
          '--env', 'NEXT_TELEMETRY_DISABLED=1', '--entrypoint', 'node', image,
          `node_modules/${bin}`, ...(validation.framework === 'Next.js' ? ['start', '--hostname', '127.0.0.1', '--port', '4173'] : ['preview', '--host', '127.0.0.1', '--port', '4173']),
        ], dockerOptions)
        let ready = false
        for (let attempt = 0; attempt < 15; attempt++) {
          ready = await run('docker', ['exec', container, 'node', '-e', 'fetch("http://127.0.0.1:4173").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'], dockerOptions).then(() => true).catch(() => false)
          if (ready) break
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        if (!ready) throw new Error('Built template did not start a successful preview. Check its configuration.')
        previewUrl = await servePreview(ref, container, root)
      }
    } catch (error) {
      status = 'failed'
      const failure = error as { message?: string; stdout?: string; stderr?: string }
      output = [failure.message, failure.stdout, failure.stderr].filter(Boolean).join('\n')
    } finally {
      if (!previewUrl) {
        await run('docker', ['rm', '-f', container], dockerOptions).catch(() => undefined)
        if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('agenthub-build-')) await fs.rm(root, { recursive: true, force: true })
      }
    }
    const result = { status, commit, output: output.slice(-32_000), finishedAt: new Date().toISOString() }
    await writeJsonAtomic(logPath(ref), result)
    return { ...result, previewUrl }
  })
}
