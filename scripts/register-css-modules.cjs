// Node-based component checks don't run Next.js CSS-module transforms. Return
// the CSS-module key for each lookup so className composition remains stable.
require.extensions['.css'] = (module, filename) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const source = require('node:fs').readFileSync(filename, 'utf8')
  const names = [...source.matchAll(/\.([a-zA-Z_][\w-]*)\s*(?=[{,:.#[])/g)].map((match) => match[1])
  module.exports = Object.fromEntries([...new Set(names)].map((name) => [name, name]))
}
