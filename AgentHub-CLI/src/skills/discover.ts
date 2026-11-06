import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { AgentConfig } from '../config/types.ts'
import { displayPath, resolveInside } from '../utils/fsx.ts'
import { parseSkillMarkdown, type SkillMeta } from './parse.ts'

export type SkillSource = 'user' | 'workspace' | 'extra'

export interface SkillFileInfo {
  rel: string
  size: number
  kind: 'text' | 'binary' | 'script' | 'symlink'
}

export interface SkillEntry {
  name: string
  description: string
  dir: string
  skillFile: string
  body: string
  meta: SkillMeta | null
  source: SkillSource
  valid: boolean
  errors: string[]
  warnings: string[]
  security: string[]
  scripts: string[]
  files: SkillFileInfo[]
  sizeBytes: number
  shadowedBy?: string
}

export interface SkillDirInfo {
  path: string
  source: SkillSource
  exists: boolean
  error?: string
}

export interface SkillIndex {
  entries: SkillEntry[]
  invalid: SkillEntry[]
  dirs: SkillDirInfo[]
  warnings: string[]
  scannedAt: string
}

const SCRIPT_EXT = new Set([
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.psm1',
  '.bat',
  '.cmd',
  '.exe',
  '.dll',
  '.com',
  '.msi',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.py',
  '.rb',
  '.pl',
  '.php',
  '.jar',
])

const RISKY_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /\bcurl\b[^\n|]*\|\s*(?:ba|z|k)?sh\b/i, message: 'Pipes a download into a shell.' },
  { re: /\bwget\b[^\n|]*\|\s*(?:ba|z|k)?sh\b/i, message: 'Pipes a download into a shell.' },
  { re: /\brm\s+-rf\b/i, message: 'Contains a recursive delete command.' },
  { re: /\b(?:curl|wget|invoke-webrequest|iwr)\b/i, message: 'Downloads from the network.' },
  { re: /\b(?:base64\s+-d|--decode)\b|\bpowershell\s+-(?:enc|encodedcommand)\b/i, message: 'Contains obfuscated command execution.' },
  { re: /\bignore\s+(?:all\s+)?(?:previous|prior)\s+instructions\b/i, message: 'Contains an instruction-injection phrase.' },
  { re: /\b(?:disable|bypass|ignore|override)\b[^\n]{0,50}\b(?:permission|policy|approval|safety|guardrail)s?\b/i, message: 'Asks to bypass permissions or policy.' },
  { re: /(?:^|\s)(?:\.\.\/|\.\.\\)/, message: 'References a parent directory.' },
  { re: /\b(?:api[_-]?key|secret|password|access[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9_\-]{12,}/i, message: 'Looks like a hard-coded credential.' },
  { re: /\b(?:chmod\s+777|set-executionpolicy\s+bypass)\b/i, message: 'Weakens local security settings.' },
]

function sourceFor(dir: string, config: AgentConfig): SkillSource {
  const normalized = path.resolve(dir)
  if (normalized === path.resolve(config.workspace, '.agenthub', 'skills')) return 'workspace'
  if (normalized === path.resolve(config.home, 'skills')) return 'user'
  return 'extra'
}

async function scanFiles(dir: string, limitFiles = 200): Promise<{ files: SkillFileInfo[]; scripts: string[]; sizeBytes: number; warnings: string[]; security: string[] }> {
  const files: SkillFileInfo[] = []
  const scripts: string[] = []
  const warnings: string[] = []
  const security: string[] = []
  let sizeBytes = 0
  let count = 0
  const stack: string[] = [dir]
  while (stack.length > 0 && count < limitFiles) {
    const current = stack.pop()
    if (!current) break
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (count >= limitFiles) break
      const abs = path.join(current, entry.name)
      const rel = path.relative(dir, abs).split(path.sep).join('/')
      if (entry.isSymbolicLink()) {
        files.push({ rel, size: 0, kind: 'symlink' })
        warnings.push(`Symlink "${rel}" is never followed or executed.`)
        count++
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        stack.push(abs)
        continue
      }
      if (!entry.isFile()) continue
      let size = 0
      try {
        size = (await fs.stat(abs)).size
      } catch {
        continue
      }
      sizeBytes += size
      const ext = path.extname(entry.name).toLowerCase()
      const isScript = SCRIPT_EXT.has(ext)
      if (isScript) scripts.push(rel)
      files.push({ rel, size, kind: isScript ? 'script' : 'text' })
      count++

      // Bounded content scan: enough to catch obvious risky instructions.
      try {
        const handle = await fs.open(abs, 'r')
        try {
          const length = Math.min(size, 64 * 1024)
          const buf = Buffer.alloc(length)
          await handle.read(buf, 0, length, 0)
          if (!buf.includes(0)) {
            const text = buf.toString('utf8')
            for (const rule of RISKY_PATTERNS) {
              if (rule.re.test(text)) security.push(`${rule.message} (${rel})`)
            }
          }
        } finally {
          await handle.close()
        }
      } catch {
        // Ignore unreadable files; the skill is still listed.
      }
    }
  }
  if (count >= limitFiles) warnings.push(`Only the first ${limitFiles} files were inspected.`)
  if (sizeBytes > 50 * 1024 * 1024) warnings.push('Skill files exceed 50 MB.')
  return { files, scripts, sizeBytes, warnings, security }
}

async function inspectEntry(
  dir: string,
  source: SkillSource,
  skillFile: string,
  _config: AgentConfig,
): Promise<SkillEntry> {
  const errors: string[] = []
  const warnings: string[] = []
  const dirName = path.basename(dir)
  let text = ''
  try {
    const stat = await fs.stat(skillFile)
    if (stat.size > 512 * 1024) errors.push('SKILL.md is larger than 512 KB.')
    text = await fs.readFile(skillFile, 'utf8')
  } catch (err) {
    errors.push(`Cannot read SKILL.md: ${(err as Error).message}`)
  }
  const parsed = text ? parseSkillMarkdown(text, dirName) : null
  if (parsed) {
    errors.push(...parsed.errors)
    warnings.push(...parsed.warnings)
  }
  const scanned = await scanFiles(dir)
  warnings.push(...scanned.warnings)
  const security = [...scanned.security]
  if (parsed?.body) {
    for (const rule of RISKY_PATTERNS) {
      if (rule.re.test(parsed.body)) security.push(`${rule.message} (SKILL.md)`)
    }
  }
  const dedupedSecurity = [...new Set(security)]
  const name = parsed?.meta?.name || dirName
  const description = parsed?.meta?.description || ''
  return {
    name,
    description,
    dir,
    skillFile,
    body: parsed?.body ?? '',
    meta: parsed?.meta ?? null,
    source,
    valid: errors.length === 0,
    errors,
    warnings,
    security: dedupedSecurity,
    scripts: scanned.scripts,
    files: scanned.files,
    sizeBytes: scanned.sizeBytes,
  }
}

export async function discoverSkills(config: AgentConfig): Promise<SkillIndex> {
  const entries: SkillEntry[] = []
  const dirs: SkillDirInfo[] = []
  const warnings: string[] = []

  for (const rawDir of config.skillsDirs) {
    const dir = path.resolve(rawDir)
    const source = sourceFor(dir, config)
    try {
      const stat = await fs.stat(dir)
      if (!stat.isDirectory()) {
        dirs.push({ path: dir, source, exists: false, error: 'Not a directory.' })
        continue
      }
    } catch {
      dirs.push({ path: dir, source, exists: false })
      continue
    }
    dirs.push({ path: dir, source, exists: true })
    let children: Dirent[]
    try {
      children = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      warnings.push(`Cannot list ${dir}: ${(err as Error).message}`)
      continue
    }
    children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      const abs = path.join(dir, child.name)
      if (!child.isDirectory() && !child.isSymbolicLink()) continue
      if (child.name.startsWith('.')) continue
      // A skill is a directory containing SKILL.md. Symlinked skill dirs are
      // accepted only if they resolve inside this skills root.
      if (child.isSymbolicLink()) {
        try {
          await resolveInside(dir, child.name)
        } catch (err) {
          warnings.push(`Skill symlink "${child.name}" was skipped: ${(err as Error).message}`)
          continue
        }
      }
      const skillFile = path.join(abs, 'SKILL.md')
      try {
        const stat = await fs.stat(skillFile)
        if (!stat.isFile()) continue
      } catch {
        continue
      }
      try {
        await resolveInside(dir, abs)
      } catch (err) {
        warnings.push(`Skill directory "${child.name}" was skipped: ${(err as Error).message}`)
        continue
      }
      entries.push(await inspectEntry(resolvePath(dir, child.name), source, skillFile, config))
    }
    // A skills directory that is itself a skill.
    const rootSkill = path.join(dir, 'SKILL.md')
    try {
      const stat = await fs.stat(rootSkill)
      if (stat.isFile()) {
        entries.push(await inspectEntry(dir, source, rootSkill, config))
      }
    } catch {
      // not a skill root
    }
  }

  // Later directories take precedence (user first, then workspace, then extra).
  const byName = new Map<string, SkillEntry>()
  for (const entry of entries) {
    const key = entry.name.toLowerCase()
    const previous = byName.get(key)
    if (previous) {
      previous.shadowedBy = entry.dir
    }
    byName.set(key, entry)
  }
  const all = [...entries].sort((a, b) => {
    if (a.shadowedBy && !b.shadowedBy) return -1
    if (!a.shadowedBy && b.shadowedBy) return 1
    return a.name.localeCompare(b.name)
  })

  return {
    entries: all,
    invalid: all.filter((e) => !e.valid),
    dirs,
    warnings: [...new Set(warnings)],
    scannedAt: new Date().toISOString(),
  }
}

function resolvePath(dir: string, child: string): string {
  return path.join(dir, child)
}

export function findSkill(index: SkillIndex, name: string): SkillEntry | undefined {
  const key = name.toLowerCase()
  return index.entries.find((e) => e.name.toLowerCase() === key && !e.shadowedBy)
}

export function skillDisplayPath(config: AgentConfig, entry: SkillEntry): string {
  return displayPath(config.workspace, entry.dir) === entry.dir ? entry.dir : displayPath(config.workspace, entry.dir)
}
