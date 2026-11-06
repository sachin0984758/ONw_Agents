import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.resolve(root, 'dist')
assert.equal(path.dirname(output), path.resolve(root))
assert.equal(path.basename(output), 'dist')
// dist is generated and ignored. Clear it so deleted source modules cannot
// survive into a later archive as stale executable code.
await fs.rm(output, { recursive: true, force: true, maxRetries: 3 })
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
await promisify(execFile)(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: root, windowsHide: true })
