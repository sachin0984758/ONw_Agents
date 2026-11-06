import { spawnSync } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stage the assets Next intentionally omits from its standalone output. */
export async function stageStandaloneAssets(root, distDir = '.next') {
  const build = path.resolve(root, distDir)
  const relative = path.relative(root, build)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('NEXT_DIST_DIR must be a build directory inside the project.')
  }
  const standalone = path.join(build, 'standalone')
  await mkdir(path.join(standalone, distDir), { recursive: true })
  await cp(path.join(build, 'static'), path.join(standalone, distDir, 'static'), { recursive: true })
  await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true })
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build', ...process.argv.slice(2)], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
  else await stageStandaloneAssets(root, process.env.NEXT_DIST_DIR || '.next')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1 })
}
