import { spawnSync } from 'node:child_process'
import path from 'node:path'
if (process.platform !== 'win32') throw new Error('The Windows companion requires Windows.')
const root = process.cwd()
for (const [exe, args] of [
  ['python', ['-m', 'venv', '--system-site-packages', 'agenthub-computer/.venv']],
  [path.join(root, 'agenthub-computer/.venv/Scripts/python.exe'), ['-m', 'pip', 'install', '-r', 'agenthub-computer/requirements.txt']],
  [path.join(root, 'agenthub-computer/.venv/Scripts/python.exe'), ['-m', 'playwright', 'install', 'chromium']],
]) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.status !== 0 || result.error) throw new Error(`Computer setup failed: ${result.error?.message ?? result.status}`)
}
console.log('Ready. Open Auto in AgentHub and connect the local companion. Control remains off until explicitly enabled.')
