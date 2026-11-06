import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
function zip(entries: Record<string, string>) {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const label = Buffer.from(name), data = Buffer.from(text), local = Buffer.alloc(30), directory = Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(label.length, 26)
    directory.writeUInt32LE(0x02014b50); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(label.length, 28); directory.writeUInt32LE(offset, 42)
    locals.push(local, label, data); central.push(directory, label); offset += local.length + label.length + data.length
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(Buffer.concat(central).length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...central, end])
}
async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agenthub-vault-access-')); process.env.AGENT_HUB_DB_DIR = path.join(root, 'db')
  const folder = path.join(root, 'vault'); await mkdir(path.join(folder, '.obsidian'), { recursive: true })
  const vault = await import('../src/lib/agent-hub/obsidian/vault'), files = await import('../src/lib/agent-hub/obsidian/files'), retrieval = await import('../src/lib/agent-hub/obsidian/retrieval')
  let checks = 0
  const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++; console.log('PASS', message) }
  try {
    const long = '# Long note\n' + 'Ordinary introduction.\n'.repeat(1300) + '\n## Tail answer\nOrbital access code: GARNET-8492\n'
    await writeFile(path.join(folder, 'long.md'), long); await writeFile(path.join(folder, 'program.py'), 'print("never execute this")\n# orbital planner uses GARNET-8492\n')
    await writeFile(path.join(folder, 'values.csv'), 'name,value\nfixture,42\n')
    await writeFile(path.join(folder, 'windows.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('UTF16 decoded correctly', 'utf16le')]))
    await writeFile(path.join(folder, 'data.xlsx'), zip({ 'xl/workbook.xml': '<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.test/worksheet" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/sharedStrings.xml': '<sst><si><t>Fixture heading</t></si></sst>', 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>6*7</f><v>42</v></c></row></sheetData></worksheet>' }))
    await writeFile(path.join(folder, 'document.docx'), zip({ 'word/document.xml': '<w:document><w:p><w:t>Actual DOCX fixture text</w:t></w:p></w:document>' }))
    await writeFile(path.join(folder, 'bundle.zip'), zip({ 'code.py': 'print("archive data only")' }))
    await writeFile(path.join(folder, 'image.png'), Buffer.from([137, 80, 78, 71, 0, 0]))
    await writeFile(path.join(folder, 'unknown.exe'), 'do not run'); await writeFile(path.join(folder, '.obsidian', 'hidden.md'), 'private'); await writeFile(path.join(folder, 'secrets.txt'), 'private')
    await vault.connectVault(folder)
    const catalog = await files.listVaultFiles()
    check(catalog.allFiles === 9 && catalog.readable === 7, 'catalog includes every supported file, images and explicit unsupported types')
    check(!catalog.files.some((file) => /secret|hidden/.test(file.path)), 'secret and hidden files are excluded')
    check((await files.listVaultFiles('.py', 0, 1)).files[0].path === 'program.py', 'file search and catalog pagination')
    let page = await files.readVaultFile('long.md', 0, 1000), reconstructed = page.content
    while (page.nextOffset !== null) { page = await files.readVaultFile('long.md', page.nextOffset, 1000); reconstructed += page.content }
    check(reconstructed === long && page.nextOffset === null, 'long file can be read completely without missing pages')
    check((await files.readVaultFile('program.py')).content.includes('never execute'), 'source code is returned as data')
    check((await files.readVaultFile('windows.txt')).content === 'UTF16 decoded correctly', 'Windows UTF16 text decodes')
    const sheet = await files.readVaultFile('data.xlsx')
    check(sheet.content.includes('Sheet: Budget') && sheet.content.includes('A1: Fixture heading') && sheet.content.includes('B1: 42 [formula: 6*7]'), 'actual XLSX entries yield sheet names, shared strings, cached values and formula text')
    check(sheet.warnings.some((warning) => warning.includes('not recalculated')), 'spreadsheet limits are explicit')
    check((await files.readVaultFile('document.docx')).content.includes('Actual DOCX fixture text'), 'DOCX fixture extraction')
    check((await files.readVaultFile('bundle.zip')).content.includes('archive data only'), 'ZIP fixture extraction without unpacking')
    for (const target of ['../outside.txt', '.obsidian/hidden.md', 'secrets.txt', 'C:/outside.md', 'unknown.exe', 'image.png']) { await assert.rejects(files.readVaultFile(target)); checks++ }
    await assert.rejects(files.readVaultFile('long.md', -1)); await assert.rejects(files.readVaultFile('long.md', 0, 99999)); checks += 2
    const external = path.join(root, 'external'); await mkdir(external); await writeFile(path.join(external, 'outside.md'), 'outside'); await symlink(external, path.join(folder, 'linked'), 'junction')
    await assert.rejects(files.readVaultFile('linked/outside.md')); checks++
    const found = await retrieval.retrieveVault('Orbital access code')
    check(found.hits.some((hit) => hit.path === 'long.md' && hit.offset > 20000 && hit.content.includes('GARNET-8492')), 'ranked retrieval finds the correct section far beyond the opening context')
    check(found.failedFiles === 0 && found.indexedFiles === 7, 'all eligible fixture files indexed with explicit coverage')
    check(found.hits.every((hit) => hit.startLine > 0 && hit.sha256.length === 64), 'retrieval includes source lines and content hash')
    const source = await files.vaultFileText('program.py'); await writeFile(path.join(folder, 'program.py'), source.text + '# new cobalt keyword\n')
    await retrieval.retrievalIndex(true)
    check((await retrieval.retrieveVault('cobalt keyword')).hits.some((hit) => hit.path === 'program.py'), 'modified files are re-indexed on refresh')
    await vault.disconnectVault(); await assert.rejects(files.readVaultFile('long.md')); checks++
    check((await readFile(path.join(folder, 'long.md'), 'utf8')) === long, 'all reads preserve source files')
    console.log(`${checks}/${checks} isolated file-access checks passed; fixture documents are not live model proof.`)
  } finally { if (!root.startsWith(path.join(os.tmpdir(), 'agenthub-vault-access-'))) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }) }
}
void main().catch((e) => { console.error(e); process.exitCode = 1 })
