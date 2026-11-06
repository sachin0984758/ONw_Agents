// Minimal ambient types for `react-syntax-highlighter`.
//
// The package ships no TypeScript definitions and `@types/react-syntax-highlighter`
// is not installed. Only the surface this app actually uses is declared here, so
// the Chat code blocks stay fully typed without pulling in another dependency.

declare module 'react-syntax-highlighter' {
  import type { ComponentType, CSSProperties, ElementType, HTMLAttributes, ReactNode } from 'react'

  export interface CodeLineProps extends HTMLAttributes<HTMLSpanElement> {
    'data-code-line'?: number
  }

  export interface SyntaxHighlighterProps {
    /** Prism/refractor language id. Unknown ids render as plain text. */
    language?: string
    /** Theme object (e.g. one-dark / one-light). */
    style?: Record<string, CSSProperties>
    children?: ReactNode
    className?: string
    /** Merged onto the outer <pre> element. */
    customStyle?: CSSProperties
    /** Props/style for the inner <code> element. */
    codeTagProps?: { className?: string; style?: CSSProperties }
    showLineNumbers?: boolean
    showInlineLineNumbers?: boolean
    startingLineNumber?: number
    lineNumberStyle?: CSSProperties
    wrapLines?: boolean
    lineProps?: CodeLineProps | ((lineNumber: number) => CodeLineProps)
    wrapLongLines?: boolean
    useInlineStyles?: boolean
    PreTag?: ElementType
    CodeTag?: ElementType
  }

  export type SyntaxHighlighterComponent = ComponentType<SyntaxHighlighterProps> & {
    registerLanguage: (name: string, language: unknown) => void
    alias: (name: string, aliases: string | string[]) => void
  }

  export const PrismLight: SyntaxHighlighterComponent
  export const Prism: SyntaxHighlighterComponent
  export const Light: SyntaxHighlighterComponent
  const defaultExport: SyntaxHighlighterComponent
  export default defaultExport
}

declare module 'react-syntax-highlighter/dist/esm/languages/prism/*' {
  const language: unknown
  export default language
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism/*' {
  import type { CSSProperties } from 'react'
  const style: Record<string, CSSProperties>
  export default style
}
