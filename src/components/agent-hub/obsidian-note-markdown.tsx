'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import styles from './obsidian-note-markdown.module.css'

interface MathNode { type: string; value?: string; children?: MathNode[] }
// Obsidian notes often put paired equations on consecutive source lines.
function mathLineBreaks() {
  return (tree: MathNode) => {
    const visit = (node: MathNode) => {
      if (node.type === 'paragraph' && node.children) {
        for (let index = 1; index < node.children.length - 1; index++) {
          const current = node.children[index]
          if (current.type === 'text' && /^\s*\n\s*$/.test(current.value ?? '') && node.children[index - 1].type === 'inlineMath' && node.children[index + 1].type === 'inlineMath') node.children[index] = { type: 'break' }
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

/** Vault reference data is never allowed to enable HTML, remote images or trusted TeX commands. */
export function ObsidianNoteMarkdown({ children }: { children: string }) {
  return <div className={styles.noteMath}><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath, mathLineBreaks]}
    rehypePlugins={[[rehypeKatex, { trust: false, strict: 'ignore', maxSize: 10, maxExpand: 200, output: 'htmlAndMathml' }]]}
    components={{ img: ({ alt }) => <span className={styles.asset}>Image: {alt || 'attachment'} · view in Obsidian</span>, a: ({ children: label }) => <span className={styles.reference}>{label}</span> }}
  >{children}</ReactMarkdown></div>
}
