import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] === 'production' ? 'production' : 'development'
const port = Number(process.env.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.')
const args = mode === 'production' ? [path.join(root, process.env.NEXT_DIST_DIR || '.next', 'standalone/server.js')] : [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '-p', String(port)]
const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, AGENTHUB_PROJECT_ROOT: root, PORT: String(port), HOSTNAME: '127.0.0.1', AGENTHUB_LOCAL_ONLY: '1', NODE_ENV: mode } })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.once('error', (error) => { console.error(error); process.exitCode = 1 })
child.once('exit', (code) => { process.exitCode = code ?? 1 })
