#!/usr/bin/env node
// Checkouts use source so npm link reflects edits. npm archives ship compiled
// JavaScript: Node does not strip TypeScript inside node_modules.
import { existsSync } from 'node:fs'

const source = new URL('../src/cli/main.ts', import.meta.url)
const entry = existsSync(source) ? source : new URL('../dist/cli/main.js', import.meta.url)
try {
  const { main } = await import(entry.href)
  await main()
} catch (err) {
  console.error(`agenthub: failed to start: ${err.message}`)
  process.exitCode = 1
}
