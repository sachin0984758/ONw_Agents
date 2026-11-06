import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { compile } from 'tailwindcss'
import ts from 'typescript'
import { readGitHubTemplate, readTemplateSource, savedFile } from './github-templates'
import { resolveProjectRoot } from '../db-path'

const cache = new Map<string, Promise<{ document: string; notes: string[] }>>()
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

// Only compiler input is read on the host. Repository modules, configs, plugins,
// lifecycle scripts and dependencies are NEVER imported or executed by Node.
// The output runs solely in an opaque-origin iframe with no network authority.
export async function buildGitHubBrowserPreview(ref: string, file: string) {
  const template = await readGitHubTemplate(ref)
  if (!template?.components.includes(file)) throw new Error('Choose an indexed, downloaded component.')
  const key = `${template.ref}:${template.commit}:${file}`
  let result = cache.get(key)
  if (!result) {
    if (cache.size >= 24) cache.delete(cache.keys().next().value!)
    result = prepare()
    cache.set(key, result)
    result.catch(() => cache.delete(key))
  }
  return result

  async function prepare() {
    const record = template!
    const available = new Set(record.files)
    const sources: string[] = []
    const assets: Record<string, string> = Object.create(null)
    const notes = ['Browser component preview; Next.js Image and Link use local preview adapters. Server routes and external navigation are unavailable.']
    let bytes = 0
    let modules = 0
    const resolve = (candidate: string) => [candidate, ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'].map((ext) => candidate + ext)].find((name) => available.has(name))
    async function asset(name: string) {
      if (assets[name]) return assets[name]
      if (!available.has(name) || !/\.(?:png|jpe?g|svg|webp|gif|woff2?)$/i.test(name)) throw new Error(`Unsupported preview asset: ${name}`)
      const data = await fs.readFile(await savedFile(ref, name, 2_000_000))
      bytes += data.length
      if (bytes > 10_000_000) throw new Error('Component preview assets exceed 10 MB.')
      const extension = name.split('.').at(-1)!.toLowerCase()
      const type = extension === 'svg' ? 'image/svg+xml' : /woff/.test(extension) ? `font/${extension}` : `image/${extension === 'jpg' ? 'jpeg' : extension}`
      return assets[name] = `data:${type};base64,${data.toString('base64')}`
    }
    const source = await readTemplateSource(ref, file)
    const hasDefault = /export\s+default\s/.test(source)
    const isDialog = !hasDefault && /function DialogContent\b/.test(source)
    if (!hasDefault && !isDialog) throw new Error('This component needs a preview entry point. Its source and installer remain available.')
    let example = '<Component />'
    if (file.endsWith('/modal-video.tsx')) {
      const thumb = await asset('public/images/hero-image-01.jpg')
      example = `<Component thumb={${json(thumb)}} thumbWidth={1104} thumbHeight={576} thumbAlt="Saved template video thumbnail" video="" videoWidth={1104} videoHeight={576} />`
      notes.push('Sample thumbnail props are supplied. Video playback is disabled in this preview.')
    }
    if (file.endsWith('/spotlight.tsx')) {
      example = '<Component className="grid gap-6 p-10 sm:grid-cols-2"><article className="relative rounded-2xl border border-gray-700 bg-gray-900 p-10"><h2 className="text-2xl text-white">Spotlight example</h2><p className="mt-4 text-gray-300">Move the pointer across these sample children.</p></article><article className="rounded-2xl border border-gray-700 bg-gray-900 p-10 text-gray-300">Your content goes here.</article></Component>'
      notes.push('Spotlight receives sample child cards; the saved component supplies its pointer tracking behavior.')
    }
    if (file.endsWith('/page-illustration.tsx')) example = '<div style={{position:"relative",isolation:"isolate",minHeight:620}}><Component multiple /></div>'
    if (isDialog) {
      example = '<Component.Dialog defaultOpen><Component.DialogTrigger className="rounded-lg bg-blue-600 px-4 py-2 text-white">Open dialog</Component.DialogTrigger><Component.DialogContent><Component.DialogHeader><Component.DialogTitle>Dialog preview</Component.DialogTitle><Component.DialogDescription>Sample content for the downloaded dialog component.</Component.DialogDescription></Component.DialogHeader><p>This is an isolated component example.</p></Component.DialogContent></Component.Dialog>'
      notes.push('The dialog is shown with sample title and content.')
    }
    const bundle = await build({
      stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import ${isDialog ? '* as Component' : 'Component'} from 'preview-entry';\nclass Boundary extends React.Component { constructor(p){super(p);this.state={error:''}} static getDerivedStateFromError(e){return {error:String(e.message||e)}} componentDidCatch(e){parent.postMessage({type:'agenthub-preview',error:String(e.message||e)},'*')} render(){return this.state.error ? <pre role="alert">{this.state.error}</pre> : this.props.children}}\nfunction Ready(){React.useEffect(()=>{parent.postMessage({type:'agenthub-preview',ready:true},'*')},[]);return null}\ndocument.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault()},true); window.addEventListener('error',e=>parent.postMessage({type:'agenthub-preview',error:String(e.message)},'*')); createRoot(document.getElementById('root')).render(<Boundary>${example}<Ready /></Boundary>);`, loader: 'tsx', resolveDir: resolveProjectRoot() },
      write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', minify: true, logLevel: 'silent', target: 'es2020', tsconfigRaw: {}, define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [{ name: 'saved-component-only', setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.path === 'preview-entry') return { path: file, namespace: 'saved' }
          if (['next/image', 'next/link', '@headlessui/react'].includes(args.path)) return { path: args.path, namespace: 'adapter' }
          if (args.namespace === 'saved' || args.namespace === 'adapter') {
            if (args.path.startsWith('.') || args.path.startsWith('@/')) {
              const candidate = args.path.startsWith('@/') ? (available.has('src/app/layout.tsx') ? 'src/' : '') + args.path.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path))
              const local = resolve(candidate)
              if (!local) throw new Error(`Missing local import: ${args.path}`)
              return { path: local, namespace: 'saved' }
            }
            // Resolve only trusted, already installed browser packages. Never
            // search a downloaded repository's node_modules or package config.
            if (!/^(?:react(?:\/jsx-runtime)?|react-dom(?:\/client)?|@radix-ui\/react-dialog|lucide-react|clsx|tailwind-merge)$/.test(args.path)) throw new Error(`Browser preview does not support ${args.path}. Use the source or isolated full-template build.`)
            return builder.resolve(args.path, { kind: 'import-statement', resolveDir: resolveProjectRoot() })
          }
          return undefined
        })
        builder.onLoad({ filter: /.*/, namespace: 'adapter' }, (args) => {
          if (args.path === 'next/image') return { contents: `import React from 'react'; export default function Image({src,alt,fill,priority,quality,placeholder,blurDataURL,loader,unoptimized,...props}){const name=typeof src==='string'?src:src?.src;const resolved=name?.startsWith('/')?ASSETS['public'+name]:name;return <img {...props} alt={alt||''} src={resolved?.startsWith('data:image/')?resolved:undefined} style={{...props.style,...(fill?{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}:{})}} />}`, loader: 'jsx' }
          if (args.path === 'next/link') return { contents: `import React from 'react'; export default function Link({children,href,prefetch,replace,scroll,...props}){return <a {...props} href="#" onClick={e=>e.preventDefault()}>{children}</a>}`, loader: 'jsx' }
          notes.push('Headless UI dialog uses a browser-only preview adapter. Escape closes it; video and external embeds are disabled.')
          return { contents: `import React,{useEffect} from 'react'; export function Dialog({open,onClose,children}){useEffect(()=>{const f=e=>{if(e.key==='Escape')onClose?.()};document.addEventListener('keydown',f);return()=>document.removeEventListener('keydown',f)},[onClose]);return open?<div role="dialog" aria-modal="true" style={{position:'fixed',inset:0,zIndex:99999}}>{children}<button onClick={()=>onClose?.()} style={{position:'fixed',top:16,right:16,zIndex:100000,color:'white',background:'#222',padding:12}}>Close preview</button></div>:null} export function DialogBackdrop({className}){return <div className={className}/>};export function DialogPanel({children,className}){return <div className={className}>{children}<p style={{color:'white',padding:16}}>Video playback is disabled in component previews.</p></div>}`, loader: 'jsx' }
        })
        builder.onLoad({ filter: /.*/, namespace: 'saved' }, async (args) => {
          if (++modules > 80) throw new Error('Component preview dependency limit exceeded.')
          if (/\.(?:png|jpe?g|svg|webp|gif)$/i.test(args.path)) return { contents: `export default ${json(await asset(args.path))}`, loader: 'js' }
          if (!/\.[jt]sx?$/.test(args.path)) throw new Error(`Unsupported component import: ${args.path}`)
          const content = await readTemplateSource(ref, args.path)
          bytes += Buffer.byteLength(content)
          if (bytes > 10_000_000) throw new Error('Component preview source exceeds 10 MB.')
          sources.push(content)
          for (const match of content.matchAll(/["'`](\/(?!\/)[^"'`?#]+\.(?:png|jpe?g|svg|webp|gif))["'`]/gi)) if (available.has(`public${match[1]}`)) await asset(`public${match[1]}`)
          return { contents: content, loader: /x$/.test(args.path) ? 'tsx' : 'ts' }
        })
      } }],
    })
    // Preserve CSS declarations and utilities, but never load repository JS
    // plugins/configs or follow its CSS imports on the host.
    const cssSources: string[] = []
    for (const name of record.files.filter((name) => name.endsWith('.css')).slice(0, 20)) {
      const text = await readTemplateSource(ref, name)
      cssSources.push(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+[^;]+;/g, '').replace(/@plugin\s+[^;{]+(?:;|\{[^}]*\})/g, ''))
    }
    const classes = new Set<string>()
    for (const text of sources) {
      const parsed = ts.createSourceFile('preview.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node) => { if (ts.isStringLiteralLike(node)) for (const word of node.text.split(/\s+/)) if (word.length < 400) classes.add(word); ts.forEachChild(node, visit) }
      visit(parsed)
    }
    for (const word of example.split(/[\s"<>]+/)) classes.add(word)
    const tailwindRoot = path.join(resolveProjectRoot(), 'node_modules', 'tailwindcss')
    const compiler = await compile('@layer theme, base, components, utilities;\n@import "theme.css" layer(theme);\n@import "preflight.css" layer(base);\n@theme inline { --color-background: var(--background); --color-foreground: var(--foreground); }\n@tailwind utilities;\n' + cssSources.join('\n'), {
      loadModule: async () => { throw new Error('Repository CSS plugins and configuration are disabled in browser previews.') },
      loadStylesheet: async (name) => {
        if (!['theme.css', 'preflight.css'].includes(name)) throw new Error('Repository stylesheet imports are disabled.')
        return { path: name, base: tailwindRoot, content: await fs.readFile(path.join(tailwindRoot, name), 'utf8') }
      },
    })
    const dark = /(?:bg-gray-950|text-gray-400)/.test(await readTemplateSource(ref, record.files.includes('app/layout.tsx') ? 'app/layout.tsx' : 'src/app/layout.tsx'))
    const css = compiler.build([...classes]) + `\n:root{--font-inter:system-ui;--font-nacelle:system-ui;--background:white;--foreground:#171717}html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif;background:${dark ? '#030712' : '#fafafa'};color:${dark ? '#e5e7eb' : '#171717'}}#root{position:relative;isolation:isolate;min-height:240px;padding:24px}a,button{cursor:pointer}img{max-width:100%;height:auto}[data-aos]{opacity:1!important;transform:none!important}video,iframe{display:none}#root:has(>header),#root:has(>a){display:grid;align-content:center;min-height:300px} @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`
    const script = `const ASSETS=${json(assets)};\n${bundle.outputFiles[0].text}`.replace(/<\/script/gi, '<\\/script')
    const digest = createHash('sha256').update(script).digest('base64')
    const policy = `default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'`
    const document = `<!doctype html><html class="no-js" lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}"><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script>${script}</script></body></html>`
    return { document, notes: [...new Set(notes)] }
  }
}
