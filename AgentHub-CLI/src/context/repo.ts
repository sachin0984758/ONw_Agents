import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AgentConfig } from '../config/types.ts'
import { collectFiles, formatBytes } from '../utils/fsx.ts'

const execFileAsync = promisify(execFile)

export interface InstructionFile {
  path: string
  text: string
  truncated: boolean
}

export interface RepoContext {
  root: string
  isGit: boolean
  branch: string | null
  packageManager: string | null
  scripts: Record<string, string>
  languages: string[]
  tree: string
  treeCount: number
  instructions: InstructionFile[]
  memory: InstructionFile[]
  notes: string[]
}

const INSTRUCTION_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
]

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
}

async function gitInfo(root: string): Promise<{ isGit: boolean; branch: string | null; toplevel: string | null }> {
  try {
    const [branch, top] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeout: 3000, windowsHide: true }),
      execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: root, timeout: 3000, windowsHide: true }),
    ])
    return { isGit: true, branch: branch.stdout.trim() || null, toplevel: top.stdout.trim() || null }
  } catch {
    return { isGit: false, branch: null, toplevel: null }
  }
}

async function packageManager(root: string): Promise<{ manager: string | null; scripts: Record<string, string> }> {
  const locks: Array<[string, string]> = [
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['package.json', 'npm'],
    ['pyproject.toml', 'python'],
    ['requirements.txt', 'pip'],
    ['go.mod', 'go'],
    ['Cargo.toml', 'cargo'],
  ]
  let manager: string | null = null
  for (const [file, name] of locks) {
    try {
      await fs.access(path.join(root, file))
      manager = name
      break
    } catch {
      // continue
    }
  }
  const scripts: Record<string, string> = {}
  try {
    const raw = await fs.readFile(path.join(root, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
      if (typeof command === 'string') scripts[name] = command.slice(0, 300)
    }
  } catch {
    // no package.json
  }
  return { manager, scripts }
}

async function readInstruction(root: string, rel: string, maxBytes: number): Promise<InstructionFile | null> {
  const abs = path.join(root, rel)
  try {
    const stat = await fs.stat(abs)
    if (!stat.isFile()) return null
    const handle = await fs.open(abs, 'r')
    try {
      const length = Math.min(stat.size, maxBytes)
      const buf = Buffer.alloc(length)
      await handle.read(buf, 0, length, 0)
      if (buf.includes(0)) return null
      return { path: rel, text: buf.toString('utf8'), truncated: stat.size > maxBytes }
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

export async function buildRepoContext(config: AgentConfig): Promise<RepoContext> {
  const notes: string[] = []
  const git = await gitInfo(config.workspace)
  const pkg = await packageManager(config.workspace)

  const files = await collectFiles(config.workspace, { maxFiles: 160, maxDepth: 3 })
  const counts = new Map<string, number>()
  for (const file of files) {
    if (file.isDirectory) continue
    const ext = path.extname(file.rel).toLowerCase()
    const lang = LANG_BY_EXT[ext]
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
  }
  const languages = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang, count]) => `${lang} (${count} files)`)

  const treeLines = files
    .slice(0, 140)
    .map((file) => `${file.rel}${file.isDirectory ? '/' : ` (${formatBytes(file.size)})`}`)
  if (files.length > 140) notes.push(`Repository tree truncated: showing 140 of ${files.length} entries.`)
  const tree = treeLines.join('\n')

  const instructions: InstructionFile[] = []
  let instructionBudget = 16_000
  for (const rel of INSTRUCTION_FILES) {
    if (instructionBudget <= 0) break
    const file = await readInstruction(config.workspace, rel, Math.min(8000, instructionBudget))
    if (file) {
      instructions.push(file)
      instructionBudget -= file.text.length
    }
  }

  const memory: InstructionFile[] = []
  if (config.memory) {
    let remaining = 6000
    const wsMemory = await readInstruction(
      path.join(config.workspace, '.agenthub'),
      'memory.md',
      Math.min(3000, remaining),
    )
    if (wsMemory) {
      memory.push({ ...wsMemory, path: '.agenthub/memory.md' })
      remaining -= wsMemory.text.length
    }
    if (remaining > 0) {
      const userMemory = await readInstruction(config.home, 'memory.md', Math.min(3000, remaining))
      if (userMemory) memory.push({ ...userMemory, path: '~/.agenthub/memory.md' })
    }
  }

  if (!git.isGit) notes.push('This directory is not a Git repository; diffs and history are unavailable.')
  if (git.toplevel && path.resolve(git.toplevel) !== path.resolve(config.workspace)) {
    notes.push(`The Git root is ${git.toplevel}, which is above the selected workspace.`)
  }

  return {
    root: config.workspace,
    isGit: git.isGit,
    branch: git.branch,
    packageManager: pkg.manager,
    scripts: pkg.scripts,
    languages,
    tree,
    treeCount: files.length,
    instructions,
    memory,
    notes,
  }
}

export function renderRepoContext(repo: RepoContext, config: AgentConfig): string {
  const parts: string[] = []
  parts.push(`Workspace: ${repo.root}`)
  parts.push(`Platform: ${process.platform} · Node ${process.version} · shell: ${config.shell}`)
  parts.push(`Git: ${repo.isGit ? `yes (branch ${repo.branch ?? 'unknown'})` : 'no'}`)
  if (repo.packageManager) parts.push(`Package manager: ${repo.packageManager}`)
  if (repo.languages.length) parts.push(`Languages: ${repo.languages.join(', ')}`)
  if (Object.keys(repo.scripts).length > 0) {
    parts.push('Scripts:')
    for (const [name, command] of Object.entries(repo.scripts).slice(0, 20)) {
      parts.push(`- ${name}: ${command}`)
    }
  }
  parts.push('', 'Repository tree (depth-limited; inspect before editing):')
  parts.push(repo.tree || '(empty)')
  if (repo.notes.length) parts.push('', ...repo.notes.map((n) => `Note: ${n}`))
  return parts.join('\n')
}

export function renderInstructions(repo: RepoContext): string {
  if (repo.instructions.length === 0 && repo.memory.length === 0) return '(none)'
  const parts: string[] = []
  for (const file of repo.instructions) {
    parts.push(`### ${file.path}${file.truncated ? ' (truncated)' : ''}`, file.text.trim())
  }
  for (const file of repo.memory) {
    parts.push(`### Memory: ${file.path}${file.truncated ? ' (truncated)' : ''}`, file.text.trim())
  }
  return parts.join('\n\n')
}
