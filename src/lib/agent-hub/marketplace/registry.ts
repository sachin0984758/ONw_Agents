import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import https from 'node:https'
import { isIP } from 'node:net'
import path from 'node:path'
import { COMPONENT_CATEGORIES, type MarketplaceComponent } from './types'

const TYPES = new Set(['registry:ui', 'registry:component', 'registry:hook', 'registry:lib', 'registry:block', 'registry:file'])
export const hashContent = (value: string) => createHash('sha256').update(value).digest('hex')
export function safeComponentPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500 || /[\\\u0000-\u001f:%]/.test(value) || path.posix.isAbsolute(value) || !value.split('/').every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.') && !/[. ]$/.test(part))) throw new Error('Unsafe component file path.')
  if (!/^(?:src\/)?(?:components|hooks|lib)\//.test(value) || !/\.(?:tsx?|jsx?|css|json|md)$/.test(value) || /(?:^|\/)(?:node_modules|db|dist|build|coverage|route|middleware|instrumentation)(?:\.|\/|$)/i.test(value) || /(?:^|\/)(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|\/|$)/i.test(value)) throw new Error('Component targets must be source files inside components/, hooks/ or lib/. Application routes, configuration and generated files are protected.')
  return value
}
function strings(value: unknown, field: string, maximum = 50): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== 'string' || item.length > 250)) throw new Error(`Invalid ${field}.`)
  return [...new Set(value as string[])]
}
function dependency(value: string): boolean { return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[~^]?[0-9][a-z0-9.*+<>=| ~^-]{0,60})?$/i.test(value) && !value.startsWith('-') }
export function normalizeRegistryItem(raw: unknown, source = 'Local library', registryUrl?: string): MarketplaceComponent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Provide a registry item JSON object.')
  const item = raw as Record<string, unknown>
  if (typeof item.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.name)) throw new Error('Registry name must be a lowercase component slug (max 80 characters).')
  if (!TYPES.has(String(item.type))) throw new Error('Unsupported registry type. Source components, hooks, blocks and libraries are supported; scripts, themes and application-wide configuration are not installed.')
  const dependencies = strings(item.dependencies, 'dependencies'); const devDependencies = strings(item.devDependencies, 'devDependencies')
  if ([...dependencies, ...devDependencies].some((entry) => !dependency(entry))) throw new Error('Only named npm dependencies with ordinary versions are accepted. Git, file, URL and command arguments are rejected.')
  const registryDependencies = strings(item.registryDependencies, 'registryDependencies')
  if (!Array.isArray(item.files) || item.files.length < 1 || item.files.length > 40) throw new Error('A component needs 1–40 files with embedded content. Import a built registry item, not an unresolved source manifest.')
  let bytes = 0
  const files = item.files.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid registry file.')
    const file = value as Record<string, unknown>
    if (typeof file.path !== 'string' || !file.path || /[\\\u0000-\u001f:%]/.test(file.path) || file.path.startsWith('/') || file.path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Unsafe registry source path.')
    if (typeof file.content !== 'string' || file.content.includes('\0') || Buffer.byteLength(file.content) > 512_000 || file.content.split('\n').length > 1000) throw new Error('Each file needs UTF-8 content within 512 KB / 1000 lines; remote file references are not fetched or executed.')
    bytes += Buffer.byteLength(file.content)
    if (bytes > 2_000_000) throw new Error('Component source exceeds 2 MB.')
    if (/(?:-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}))/.test(file.content)) throw new Error('Component appears to contain a credential or private key. Remove secrets before importing.')
    const target = safeComponentPath(file.target || `src/components/marketplace/${item.name}/${path.posix.basename(file.path)}`)
    return { path: file.path, target, content: file.content, type: String(file.type ?? item.type) }
  })
  if (new Set(files.map((file) => file.target.toLowerCase())).size !== files.length) throw new Error('Component has duplicate target paths.')
  for (const file of files) for (const match of file.content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1]
    if (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('~/') || specifier.startsWith('node:')) continue
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (dependency(name) && !dependencies.some((entry) => entry === name || entry.startsWith(`${name}@`)) && !devDependencies.some((entry) => entry === name || entry.startsWith(`${name}@`))) dependencies.push(name)
  }
  const category = COMPONENT_CATEGORIES.includes(item.category as typeof COMPONENT_CATEGORIES[number]) ? String(item.category) : 'Cards and layouts'
  const id = registryUrl ? `registry:${hashContent(registryUrl + ':' + item.name).slice(0, 24)}` : `local:${item.name}`
  return { id, name: typeof item.title === 'string' ? item.title.slice(0, 120) : item.name, description: typeof item.description === 'string' ? item.description.slice(0, 3000) : '', category, source, author: typeof item.author === 'string' ? item.author.slice(0, 250) : 'Not supplied', revision: hashContent(JSON.stringify({ ...item, files })).slice(0, 16), framework: 'React', dependencies, devDependencies, registryDependencies, ...(registryUrl ? { registryUrl } : {}), ...(typeof item.license === 'string' ? { license: item.license.slice(0, 100) } : {}), tags: strings(item.tags, 'tags', 20), files, preview: { kind: 'unavailable', reason: 'Imported source is never executed inside AgentHub. Review the source and use an approved project preview after installation.' }, updatedAt: new Date().toISOString() }
}

export function registryURL(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Provide an HTTPS registry item URL.')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Invalid registry URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Registry URLs must use public HTTPS hosts, no credentials, IP addresses, nonstandard ports, query strings or fragments.')
  if (/%(?:2e|2f|5c|00)/i.test(value)) throw new Error('Encoded traversal or path separators are not allowed.')
  return url
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) { const [a,b] = address.split('.').map(Number); return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0)) }
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !address.toLowerCase().startsWith('2001:db8:')
}
/** Public DNS is checked and pinned to the HTTPS socket; redirects are refused. */
export async function downloadRegistryItem(url: URL): Promise<unknown> {
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) throw new Error('Registry resolves to a private, local or reserved address.')
  const pinned = addresses[0]
  return new Promise((resolve, reject) => {
    const request = https.get(url, { family: pinned.family, headers: { Accept: 'application/json', 'User-Agent': 'AgentHub-ComponentRegistry/1' }, lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family) }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Registry returned HTTP ${response.statusCode}. Redirects and authenticated endpoints require a direct public item URL.`)); return }
      if (!String(response.headers['content-type']).includes('json')) { response.resume(); reject(new Error('Registry did not return JSON.')); return }
      const chunks: Buffer[] = []; let size = 0
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) request.destroy(new Error('Registry response exceeds 2 MB.')); else chunks.push(chunk) })
      response.on('error', reject)
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('Registry response is not valid JSON.')) } })
    })
    request.setTimeout(15_000, () => request.destroy(new Error('Registry request timed out.')))
    request.on('error', reject)
  })
}
