import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const root = git('rev-parse', '--show-toplevel').trim()
const records = git('status', '--porcelain=v1', '-z').split('\0').filter(Boolean)
const snapshot = records.map((entry) => ({ status: entry.slice(0, 2), path: entry.slice(3) }))
const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
const files = new Map()
for (const entry of snapshot) {
  if (entry.path.endsWith('/')) {
    for (const file of untracked.filter((file) => file.startsWith(entry.path))) files.set(file, { ...entry, path: file, entry: entry.path })
  } else files.set(entry.path, { ...entry, entry: entry.path })
}
const binaryExtensions = /\.(png|jpe?g|webp|gif|ico|mp4|mp3|wav|glb|zip|pdf|woff2?|ttf)$/i
function category(file, status) {
  if (status.includes('D')) return 'deleted tracked material; intent requires owner review'
  if (/^(db|output|tmp|\.verification|\.next[^/]*|node_modules)\//.test(file)) return 'generated/runtime artifact; exclude from source review'
  if (/^lmstudio-local-agent\/workspace\/projects\//.test(file)) return 'user-created deliverable; preserve separately'
  if (/^(docs\/|.*\.md$)/.test(file)) return 'documentation/history; preserve and review'
  if (/^(public\/|.*\.(svg|png|jpg|webp)$)/.test(file)) return 'asset/design change; visual review required'
  if (/^(AgentHub-CLI|agenthub-computer|agenthub-vm|lmstudio-local-agent)\//.test(file)) return 'companion/package change; review independently'
  if (/^scripts\//.test(file)) return 'verification/build tooling'
  if (/^src\//.test(file)) return 'application implementation'
  return 'root configuration/build/dependency change'
}
const patterns = [
  ['private-key-marker', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['long-secret-assignment', /(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{32,}["']/i],
]
const rows = []
for (const record of files.values()) {
  const absolute = path.join(root, record.path)
  let bytes
  let review = 'content fingerprint and text pattern review'
  if (/docs\/audits\/AGENTHUB-WORKING-TREE\.(csv|json)$/.test(record.path)) review = 'generated review manifest; self fingerprint omitted'
  else if (/(^|\/)\.env(?:\.|$)|\.(pem|key|p12|pfx)$/i.test(record.path)) review = 'sensitive filename; values not read; exclude from proposed commit'
  else if (record.status.includes('D')) {
    try { bytes = execFileSync('git', ['show', `HEAD:${record.path}`], { maxBuffer: 16 * 1024 * 1024 }); review = 'deleted HEAD content fingerprinted; preserve deletion until owner confirms intent' } catch { review = 'deleted file unavailable at HEAD' }
  } else if (fs.existsSync(absolute)) {
    const stat = fs.lstatSync(absolute)
    if (stat.isSymbolicLink()) review = 'symbolic link; target not followed'
    else if (stat.size > 5 * 1024 * 1024) review = 'large file; metadata review only'
    else bytes = fs.readFileSync(absolute)
  }
  const binary = binaryExtensions.test(record.path) || bytes?.includes(0)
  const text = bytes && !binary ? bytes.toString('utf8') : ''
  const flags = patterns.filter(([,pattern]) => pattern.test(text)).map(([name]) => name)
  if (binary) review = 'binary asset fingerprinted; visual/behavioral review not performed'
  rows.push({ ...record, category: category(record.path, record.status), review, bytes: bytes?.length ?? null, sha256: bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : '', credentialPatternFlags: flags.join(';'), provenance: 'inherited dirty tree plus authorized remediation; individual authorship unverified' })
}
const output = path.join(root, 'docs/audits/AGENTHUB-WORKING-TREE.csv')
const fields = ['entry','status','path','category','review','bytes','sha256','credentialPatternFlags','provenance']
const quote = (value) => '"'+String(value ?? '').replaceAll('"', '""')+'"'
const csv = [fields.join(','), ...rows.map((row) => fields.map((field) => quote(row[field])).join(','))].join('\n')+'\n'
fs.writeFileSync(output, csv)
const summary = { capturedAt: new Date().toISOString(), statusEntries: snapshot.length, expandedFiles: rows.length, categories: {}, credentialCandidates: rows.filter((row) => row.credentialPatternFlags).map(({path,credentialPatternFlags}) => ({path, flags:credentialPatternFlags})), coverage: 'Every status entry classified; expanded nonignored files fingerprinted and text scanned. This does not establish authorship or full semantic correctness.' }
for (const row of rows) summary.categories[row.category] = (summary.categories[row.category] ?? 0)+1
fs.writeFileSync(path.join(root,'docs/audits/AGENTHUB-WORKING-TREE.json'), JSON.stringify(summary,null,2)+'\n')
console.log(JSON.stringify(summary,null,2))
