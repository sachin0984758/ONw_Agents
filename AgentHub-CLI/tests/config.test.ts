import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { loadConfig } from '../src/config/load.ts'
import { discoverProviders } from '../src/providers/registry.ts'
import { removeDir, tempDir } from './helpers.ts'

const ENV_KEYS = [
  'AGENTHUB_HOME',
  'AGENTHUB_WORKSPACE',
  'AGENTHUB_PROVIDER',
  'AGENTHUB_MODEL',
  'AGENTHUB_PERMISSION',
  'AGENTHUB_APP_URL',
  'AGENTHUB_THEME',
  'AGENTHUB_SHELL',
  'AGENTHUB_MAX_STEPS',
  'AGENTHUB_COMMAND_TIMEOUT_MS',
  'AGENTHUB_CONTEXT_TOKENS',
  'AGENTHUB_NO_MEMORY',
  'AGENTHUB_ALLOW_CLOUD',
  'AGENTHUB_SKILLS_DIRS',
  'AGENTHUB_BASE_URL',
  'AGENTHUB_API_KEY',
]

test('workspace config can tighten but cannot loosen security settings', async () => {
  const workspace = await tempDir('agenthub-config-ws-')
  const home = await tempDir('agenthub-config-home-')
  const saved = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  process.env.AGENTHUB_HOME = home
  try {
    await fs.mkdir(path.join(home), { recursive: true })
    await fs.mkdir(path.join(workspace, '.agenthub'), { recursive: true })
    await fs.writeFile(
      path.join(home, 'config.json'),
      JSON.stringify({
        permissionMode: 'bypass',
        allowCloud: false,
        allowOutsideWorkspaceReads: true,
        deny: ['shell.run:git push*'],
        allow: ['fs.write:*'],
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(workspace, '.agenthub', 'config.json'),
      JSON.stringify({
        permissionMode: 'read-only',
        allowCloud: true,
        allowOutsideWorkspaceReads: false,
        deny: ['fs.read:secret*'],
        allow: ['shell.run:*'],
        maxSteps: 3,
      }),
      'utf8',
    )

    const config = await loadConfig({ cwd: workspace, cli: {} })
    assert.equal(config.permissionMode, 'read-only')
    assert.equal(config.allowCloud, false)
    assert.equal(config.allowOutsideWorkspaceReads, false)
    assert.equal(config.maxSteps, 3)
    assert.deepEqual(config.denyRules.sort(), ['fs.read:secret*', 'shell.run:git push*'].sort())
    assert.deepEqual(config.allowRules, ['fs.write:*'], 'workspace allow rules must be ignored')
    assert.ok(config.configWarnings.some((w) => w.includes('allowCloud')))
    assert.ok(config.configWarnings.some((w) => w.includes('allow')))
    assert.equal(config.workspace, workspace)
    assert.equal(config.home, home)
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('MCP servers are explicit user configuration and workspace config cannot add them', async () => {
  const workspace = await tempDir('agenthub-config-ws-')
  const home = await tempDir('agenthub-config-home-')
  const saved = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  process.env.AGENTHUB_HOME = home
  try {
    await fs.mkdir(path.join(home, 'bin'), { recursive: true })
    await fs.mkdir(path.join(workspace, '.agenthub'), { recursive: true })
    await fs.writeFile(
      path.join(home, 'config.json'),
      JSON.stringify({
        mcpServers: [
          {
            id: 'local-tools',
            command: 'node',
            args: ['server.mjs'],
            env: { DEBUG: '0' },
            cwd: './bin',
            timeoutMs: 5000,
          },
        ],
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(workspace, '.agenthub', 'config.json'),
      JSON.stringify({
        mcpServers: [{ id: 'workspace-added', command: 'evil.exe' }],
      }),
      'utf8',
    )
    const config = await loadConfig({ cwd: workspace, cli: {} })
    assert.equal(config.mcpServers.length, 1)
    assert.equal(config.mcpServers[0]?.id, 'local-tools')
    assert.equal(config.mcpServers[0]?.command, 'node')
    assert.equal(config.mcpServers[0]?.cwd, path.join(home, 'bin'))
    assert.equal(config.mcpServers[0]?.env?.DEBUG, '0')
    assert.ok(config.configWarnings.some((warning) => warning.includes('mcpServers') && warning.includes('workspace')))
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('invalid MCP server definitions are configuration errors, not silently accepted', async () => {
  const workspace = await tempDir('agenthub-config-ws-')
  const home = await tempDir('agenthub-config-home-')
  const saved = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  process.env.AGENTHUB_HOME = home
  try {
    await fs.mkdir(path.join(home), { recursive: true })
    await fs.writeFile(
      path.join(home, 'config.json'),
      JSON.stringify({
        mcpServers: [
          { id: 'bad id', command: 'node' },
          { id: 'no-command' },
          { id: 'bad-timeout', command: 'node', timeoutMs: 2 },
        ],
      }),
      'utf8',
    )
    await assert.rejects(
      () => loadConfig({ cwd: workspace, cli: {} }),
      (err: Error & { problems?: string[] }) => /configuration/i.test(err.message) && (err.problems?.length ?? 0) >= 3,
    )
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await removeDir(workspace)
    await removeDir(home)
  }
})

test('CLI overrides take precedence and cloud remains off unless explicit', async () => {
  const workspace = await tempDir('agenthub-config-ws-')
  const home = await tempDir('agenthub-config-home-')
  const saved = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  process.env.AGENTHUB_HOME = home
  try {
    const config = await loadConfig({
      cwd: workspace,
      cli: { permissionMode: 'read-only', maxSteps: 7, model: 'mock-model' },
    })
    assert.equal(config.permissionMode, 'read-only')
    assert.equal(config.maxSteps, 7)
    assert.equal(config.model, 'mock-model')
    assert.equal(config.allowCloud, false)
    assert.equal(config.autoApprove, false)
    assert.deepEqual(config.providers.map((provider) => provider.id), ['lmstudio', 'ollama', 'custom'])

    let requests = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      requests++
      throw new Error('The test must not make a network request.')
    }) as typeof fetch
    try {
      config.providers = [{
        id: 'mislabelled-remote',
        label: 'Mislabelled remote',
        kind: 'openai-compatible',
        baseUrl: 'https://inference.example.com/v1',
        local: true,
      }]
      const [discovery] = await discoverProviders(config)
      assert.equal(requests, 0, 'a local label must not trigger remote model discovery')
      assert.match(discovery?.skipped ?? '', /remote endpoints are disabled/i)
    } finally {
      globalThis.fetch = originalFetch
    }
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await removeDir(workspace)
    await removeDir(home)
  }
})
