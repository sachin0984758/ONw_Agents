// Editor theme for the playground's CodeMirror instance.
//
// Use a focused, high-contrast dark work surface in either app theme. The
// surrounding Playground remains theme-aware; code colors stay readable.

import type { Extension } from '@codemirror/state'

const MONO_FONT =
  'Consolas, "Cascadia Code", var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, "Liberation Mono", monospace'

export async function makeEditorTheme(): Promise<Extension> {
  const [{ EditorView }, { HighlightStyle, syntaxHighlighting }, { tags: t }] = await Promise.all([
    import('@codemirror/view'),
    import('@codemirror/language'),
    import('@lezer/highlight'),
  ])

  const highlight = HighlightStyle.define([
    { tag: t.comment, color: '#8fb39a', fontStyle: 'italic' },
    { tag: [t.keyword, t.definitionKeyword, t.bool, t.null], color: '#ff7b72', fontWeight: '600' },
    { tag: [t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#d2a8ff' },
    { tag: [t.string, t.special(t.string)], color: '#a5d6ff' },
    { tag: t.regexp, color: '#f2cc60' },
    { tag: t.number, color: '#79c0ff' },
    { tag: [t.variableName, t.definition(t.variableName), t.propertyName], color: '#e6edf3' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#d2a8ff' },
    { tag: [t.typeName, t.className, t.namespace], color: '#ffa657' },
    { tag: t.tagName, color: '#7ee787' },
    { tag: t.attributeName, color: '#79c0ff' },
    { tag: [t.operator, t.punctuation], color: '#ff7b72' },
    { tag: t.bracket, color: '#f2cc60' },
    { tag: [t.heading, t.strong], color: '#ff7b72', fontWeight: 'bold' },
    { tag: [t.link, t.url], color: '#79c0ff', textDecoration: 'underline' },
    { tag: t.meta, color: '#9da7b3' },
    { tag: t.invalid, color: '#ff7b72' },
  ])

  const base = EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: '#0b1220',
        color: '#e6edf3',
        fontSize: '13px',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: MONO_FONT,
        lineHeight: '1.6',
        overflow: 'auto',
      },
      '.cm-content': {
        padding: '10px 0',
        caretColor: '#f8fafc',
      },
      '.cm-gutters': {
        backgroundColor: '#101a2b',
        border: 'none',
        color: '#a7b4c4',
        paddingRight: '4px',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 12px' },
      '.cm-activeLine': { backgroundColor: 'rgba(148,163,184,0.10)' },
      '.cm-activeLineGutter': { backgroundColor: 'rgba(148,163,184,0.14)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'rgba(56,139,253,0.38)',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f8fafc' },
      '.cm-foldPlaceholder': {
        backgroundColor: 'transparent',
        border: 'none',
        color: '#a7b4c4',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--popover, #ffffff)',
        color: 'var(--popover-foreground, inherit)',
        border: '1px solid var(--border, #d4d4d8)',
        borderRadius: '6px',
        overflow: 'hidden',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': {
        fontFamily: MONO_FONT,
        fontSize: '12px',
        maxHeight: '14rem',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--accent, #f4f4f5)',
        color: 'var(--accent-foreground, inherit)',
      },
      '.cm-panels': {
        backgroundColor: 'var(--card, #ffffff)',
        color: 'var(--card-foreground, inherit)',
      },
      '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.35)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(250, 204, 21, 0.6)' },
    },
    { dark: true },
  )

  return [base, syntaxHighlighting(highlight)]
}
