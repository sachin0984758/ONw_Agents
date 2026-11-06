// Independent highlighting helpers; no session state or initialization side effects.

export interface CodeToken {
  text: string
  /** '' = plain, otherwise one of kw/str/com/num/fn. */
  cls: '' | 'kw' | 'str' | 'com' | 'num' | 'fn'
}

const HIGHLIGHT_WORDS: Record<string, string[]> = {
  js: 'const let var function return if else for while new await async import from export class extends try catch throw typeof instanceof of in do switch case break continue'.split(' '),
  py: 'def return if elif else for while import from as class try except raise with lambda pass None True False and or not in is'.split(' '),
  sh: 'if then else fi for while do done in case esac function return exit echo cd export local readonly set unset'.split(' '),
  css: 'color background margin padding border display flex grid position font width height'.split(' '),
  // SQL (used by the teaching lessons) — clause/operator keywords.
  sql: 'select from where join inner left right full outer cross on as group by having order limit offset insert into values update set delete create table drop alter distinct count sum avg min max case when then else end and or not null is like between in exists union all asc desc primary foreign key references'.split(' '),
  // C (used by the teaching lessons) — types, control flow and preprocessor words.
  c: 'int char void float double long short unsigned signed const static struct union enum typedef return if else for while do switch case default break continue goto sizeof extern auto register volatile printf scanf malloc calloc realloc free include define'.split(' '),
}

function highlightLang(lang: string): string {
  const l = (lang ?? '').toLowerCase()
  if (['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'mjs', 'cjs', 'json'].includes(l)) return 'js'
  if (['py', 'python'].includes(l)) return 'py'
  if (['sh', 'bash', 'shell', 'ps1', 'powershell', 'cmd', 'yaml', 'yml'].includes(l)) return 'sh'
  if (['css', 'scss', 'less'].includes(l)) return 'css'
  if (['html', 'xml', 'vue', 'svelte'].includes(l)) return 'html'
  if (['sql'].includes(l)) return 'sql'
  if (['c', 'h', 'cpp', 'c++', 'cc', 'cxx', 'hpp'].includes(l)) return 'c'
  return ''
}

export function highlightCode(code: string, lang: string): CodeToken[] {
  const out: CodeToken[] = []
  const push = (text: string, cls: CodeToken['cls'] = '') => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.cls === cls) last.text += text
    else out.push({ text, cls })
  }
  const family = highlightLang(lang)
  if (!family) return code ? [{ text: code, cls: '' }] : []
  const words = new Set(family === 'html' ? [] : (HIGHLIGHT_WORDS[family] ?? HIGHLIGHT_WORDS.js).map((w) => w.toLowerCase()))
  // Order matters: comments, strings, numbers, words, calls, tags.
  // SQL uses `--` line comments; C uses `//` and `/* */` but not `#`, so each
  // family gets a comment prefix it actually understands. Every other family
  // keeps the original generic pattern unchanged.
  const re =
    family === 'html'
      ? /(<!--[\s\S]*?-->|<\/?[a-zA-Z][^<>]*>)/g
      : family === 'sql'
        ? /(--[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[^A-Za-z_$"'`#/\d-]+|\S)/g
        : family === 'c'
          ? /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[^A-Za-z_$"'`#/\d]+|\S)/g
          : /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[^A-Za-z_$"'`#/\d]+|\S)/g
  const src = code ?? ''
  let m: RegExpExecArray | null
  let last = 0
  const flushPlain = (to: number) => {
    if (to > last) push(src.slice(last, to))
    last = to
  }
  while ((m = re.exec(src)) !== null) {
    flushPlain(m.index)
    const t = m[0]
    if (family === 'html') {
      push(t, t.startsWith('<!--') ? 'com' : 'kw')
    } else if (/^(\/\/|\/\*|"""|'''|--)/.test(t) || (family !== 'c' && family !== 'sql' && /^#/.test(t))) {
      push(t, 'com')
    } else if (/^["'`]/.test(t)) {
      push(t, 'str')
    } else if (/^\d/.test(t)) {
      push(t, 'num')
    } else if (/^[A-Za-z_$]/.test(t)) {
      const next = src.slice(re.lastIndex).match(/^\s*\(/)
      if (words.has(t.toLowerCase())) push(t, 'kw')
      else if (next) push(t, 'fn')
      else push(t)
    } else {
      push(t)
    }
    last = re.lastIndex
    if (m.index === re.lastIndex) re.lastIndex += 1
  }
  flushPlain(src.length)
  return out
}

