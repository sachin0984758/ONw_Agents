import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { resolveWorkspace } from '../session/workspaces'
import { readRuntimePolicy } from '../runtime-policy'
import { createSerializer, writeJsonAtomic } from '../fs-atomic'
import { readGitHubTemplate, savedFile, UI_LIBRARY_DIRECTORY } from './github-templates'

const serialize = createSerializer()
const sourceExtension = /\.(?:tsx?|jsx?|mjs|cjs|css)$/
const hash = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')
const major = (version: string) => version.match(/^[~^]?v?(\d+)\./)?.[1]
const receiptPath = (id: string) => path.join(UI_LIBRARY_DIRECTORY, 'component-installations', `${id}.json`)

function aliasRoot(text: string): string | undefined {
  const config = ts.parseConfigFileTextToJson('tsconfig.json', text).config
  if (!config || config.extends || config.compilerOptions?.baseUrl && config.compilerOptions.baseUrl !== '.') return
  const alias = config.compilerOptions?.paths?.['@/*']
  if (Array.isArray(alias) && alias.length === 1 && (alias[0] === './*' || alias[0] === './src/*')) return alias[0] === './*' ? '' : 'src/'
}

async function fileData(ref: string, file: string) {
  return fs.readFile(await savedFile(ref, file, 8_000_000))
}

export async function analyzeGitHubComponent(ref: string, entry: string) {
  const template = await readGitHubTemplate(ref)
  if (!template?.components.includes(entry)) throw new Error('Choose an indexed component from a saved template.')
  const declaredPackages = template.dependencies
  const available = new Set(template.files)
  const alias = available.has('tsconfig.json') ? aliasRoot((await fileData(ref, 'tsconfig.json')).toString('utf8')) : undefined
  const files = new Set<string>()
  const packages = new Set(['react'])
  const blockers = new Set<string>()
  let usesAlias = false

  function resolveLocal(value: string) {
    if (value.startsWith('../') || value.startsWith('/') || value === '..') return
    return [value, ...['.ts', '.tsx', '.js', '.jsx', '.json', '.css'].map((ext) => value + ext), ...['ts', 'tsx', 'js', 'jsx'].map((ext) => `${value}/index.${ext}`)].find((file) => available.has(file))
  }
  async function visit(file: string) {
    if (files.has(file)) return
    if (files.size >= 80) throw new Error('Component dependency graph is too large. Use the complete template.')
    files.add(file)
    if (!sourceExtension.test(file)) return
    const text = (await fileData(ref, file)).toString('utf8')
    const imports = new Set<string>()
    const assets = new Set<string>()
    if (file.endsWith('.css')) {
      for (const match of text.matchAll(/(?:url\(\s*|@import\s+)['"]?([^'")\s;]+)/g)) {
        const value = match[1]
        if (value.startsWith('/') && !value.startsWith('//')) assets.add(value)
        else if (!/^(?:[a-z]+:|#|\/\/)/i.test(value)) imports.add(declaredPackages[value] ? value : value.startsWith('.') ? value : `./${value}`)
      }
    } else {
      for (const item of ts.preProcessFile(text, true, true).importedFiles) imports.add(item.fileName)
      const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      function inspect(node: ts.Node) {
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0]))) blockers.add(`Computed import in ${file} needs manual review.`)
        if (ts.isStringLiteralLike(node) && /^\/(?!\/)[^?#]+\.(?:png|jpe?g|svg|webp|gif|woff2?|mp4|webm|ico)(?:[?#]|$)/i.test(node.text)) assets.add(node.text.split(/[?#]/)[0])
        ts.forEachChild(node, inspect)
      }
      inspect(parsed)
    }
    for (const value of assets) {
      const asset = resolveLocal(path.posix.normalize(`public${value}`))
      if (asset) await visit(asset)
      else blockers.add(`Missing public asset ${value}.`)
    }
    for (const specifier of imports) {
      if (specifier.startsWith('.') || specifier.startsWith('@/')) {
        if (specifier.startsWith('@/')) usesAlias = true
        const candidate = specifier.startsWith('@/') ? alias === undefined ? undefined : alias + specifier.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
        const local = candidate && resolveLocal(candidate)
        if (local) await visit(local)
        else blockers.add(`Unresolved import ${specifier} in ${file}.`)
      } else {
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
        if (!declaredPackages[name]) blockers.add(`Unsupported or undeclared import ${specifier} in ${file}.`)
        else packages.add(name)
      }
    }
  }
  await visit(entry)
  const styles = template.files.filter((file) => /(?:^|\/)(?:tailwind\.config\.[^/]+|globals\.css|style\.css)$/.test(file))
  if (template.dependencies.tailwindcss && styles.length) {
    packages.add('tailwindcss')
    for (const file of styles) await visit(file)
    for (const name of ['postcss', '@tailwindcss/postcss']) if (template.dependencies[name]) packages.add(name)
  }
  return { ref, entry, commit: template.commit, license: template.license, attribution: template.owner, url: template.url, warning: template.warning, files: [...files], styles, alias, usesAlias, blockers: [...blockers], dependencies: Object.fromEntries([...packages].map((name) => [name, template.dependencies[name] ?? 'required'])) }
}

async function safeTarget(root: string, file: string) {
  let current = root
  const parts = file.split('/')
  for (const [index, part] of parts.entries()) {
    if (!part || part.startsWith('.') || /[\\:]/.test(part)) throw new Error('Unsafe component destination.')
    current = path.join(current, part)
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    if (stat && (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()))) throw new Error(`Unexpected file or link at ${file}.`)
  }
  return current
}

async function optionalRead(file: string) {
  return fs.readFile(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
}

async function prepare(ref: string, entry: string, workspaceId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(workspaceId)) throw new Error('Select a registered project.')
  const analysis = await analyzeGitHubComponent(ref, entry)
  const root = await fs.realpath((await resolveWorkspace(workspaceId)).root)
  const packageFile = await optionalRead(await safeTarget(root, 'package.json'))
  const manifest = packageFile ? JSON.parse(packageFile.toString('utf8')) : {}
  const declared = { ...manifest.devDependencies, ...manifest.dependencies }
  const blockers = [...analysis.blockers]
  for (const [name, version] of Object.entries(analysis.dependencies)) {
    if (typeof declared[name] !== 'string') blockers.push(`Project must declare ${name} (${version}).`)
    else if (version !== 'required' && declared[name] !== version && (!major(version) || major(declared[name]) !== major(version))) blockers.push(`Review the ${name} version. Source uses ${version}; project declares ${declared[name]}.`)
  }
  const config = await optionalRead(await safeTarget(root, 'tsconfig.json'))
  if (analysis.usesAlias && (!config || aliasRoot(config.toString('utf8')) !== analysis.alias)) blockers.push('Project must use the same @/* alias as the template. Use the complete template or configure the alias.')
  const files = await Promise.all(analysis.files.map(async (file) => {
    const data = await fileData(ref, file)
    const existing = await optionalRead(await safeTarget(root, file))
    const status = !existing ? 'create' : existing.equals(data) ? 'identical' : 'conflict'
    return { file, data, status }
  }))
  const changes = files.map(({ file, data, status }) => ({ file, bytes: data.length, sha256: hash(data), status }))
  const review = hash(JSON.stringify({ analysis, root, workspaceId, changes, blockers }))
  return { files, result: { ...analysis, root, changes, blockers, review } }
}

export async function reviewGitHubComponent(ref: string, entry: string, workspaceId: string) {
  return (await prepare(ref, entry, workspaceId)).result
}

export async function installGitHubComponent(ref: string, entry: string, workspaceId: string, review: string, approved: boolean) {
  if (!approved) throw new Error('Review the planned files and approve component installation.')
  if (!(await readRuntimePolicy()).codeExecution) throw new Error('Project writes are disabled in AgentHub settings.')
  return serialize(async () => {
    const { files, result } = await prepare(ref, entry, workspaceId)
    if (result.review !== review) throw new Error('The component or destination changed. Review again.')
    if (result.blockers.length || files.some((file) => file.status === 'conflict')) throw new Error('Resolve compatibility issues and file conflicts before installation.')
    const created: { file: string; data: Buffer }[] = []
    try {
      for (const { file, data, status } of files) {
        const target = await safeTarget(result.root, file)
        if (status === 'create') {
          await fs.mkdir(path.dirname(target), { recursive: true })
          await safeTarget(result.root, file)
          const temporary = `${target}.${crypto.randomUUID()}.tmp`
          try {
            await fs.writeFile(temporary, data, { flag: 'wx' })
            await fs.link(temporary, target)
            created.push({ file, data })
          } finally { await fs.unlink(temporary).catch(() => undefined) }
        }
        if (!(await fs.readFile(target)).equals(data)) throw new Error(`Byte verification failed for ${file}.`)
      }
      const id = crypto.randomUUID()
      await writeJsonAtomic(receiptPath(id), { id, workspaceId, root: result.root, ref, entry, commit: result.commit, license: result.license, attribution: result.attribution, url: result.url, files: created.map(({ file, data }) => ({ file, hash: hash(data) })) })
      return { ...result, id, created: created.length, verified: files.length }
    } catch (error) {
      for (const item of created.reverse()) {
        const target = await safeTarget(result.root, item.file).catch(() => undefined)
        if (target && (await optionalRead(target))?.equals(item.data)) await fs.unlink(target).catch(() => undefined)
      }
      throw error
    }
  })
}

export async function rollbackGitHubComponent(id: string, approved: boolean) {
  if (!approved || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Approve rollback of the selected installation.')
  if (!(await readRuntimePolicy()).codeExecution) throw new Error('Project writes are disabled in AgentHub settings.')
  return serialize(async () => {
    const receipt = JSON.parse(await fs.readFile(receiptPath(id), 'utf8')) as { workspaceId: string; root: string; files: { file: string; hash: string }[]; rolledBack?: string }
    if (receipt.rolledBack) throw new Error('This installation was already rolled back.')
    if (await fs.realpath((await resolveWorkspace(receipt.workspaceId)).root) !== receipt.root) throw new Error('The installation workspace changed.')
    const files = await Promise.all(receipt.files.map(async ({ file, hash: expected }) => {
      const target = await safeTarget(receipt.root, file)
      const data = await optionalRead(target)
      if (data && hash(data) !== expected) throw new Error(`File changed after installation: ${file}. Rollback was stopped.`)
      return { target, expected }
    }))
    let removed = 0
    for (const { target, expected } of files) {
      const data = await optionalRead(target)
      if (!data) continue
      if (hash(data) !== expected) throw new Error('A file changed during rollback. Any changed file was preserved.')
      await fs.unlink(target)
      removed++
    }
    await writeJsonAtomic(receiptPath(id), { ...receipt, rolledBack: new Date().toISOString() })
    return { removed }
  })
}
