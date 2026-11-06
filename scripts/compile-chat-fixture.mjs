import { promises as fs } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// Preserve module identities (not a bundle) so route and test share control/store
// state. Compile real local dependencies, including dynamically imported memory.
export async function compileChatFixture(root, buildDir) {
  const sourceRoot = path.join(root, 'src/lib/agent-hub')
  async function walk(relative = '') {
    for (const entry of await fs.readdir(path.join(sourceRoot, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name)
      if (entry.isDirectory()) await walk(name)
      else if (entry.isFile() && /\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
        const target = path.join(buildDir, name.replace(/\.tsx?$/, '.js'))
        const prefix = path.relative(path.dirname(target), buildDir).split(path.sep).join('/') || '.'
        const source = (await fs.readFile(path.join(sourceRoot, name), 'utf8')).replace(/@\/lib\/agent-hub\//g, prefix + '/')
        const compiled = ts.transpileModule(source, { fileName: name, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, compiled)
      }
    }
  }
  await walk()
}
