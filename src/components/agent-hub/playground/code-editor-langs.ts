// CodeMirror language loaders for the playground editor.
//
// Each loader dynamically imports exactly one language package so the editor
// bundle stays small and only the selected language is fetched. C#, Bash and
// PowerShell have no native CodeMirror 6 parser; they use the maintained
// `@codemirror/legacy-modes` stream parsers instead (syntax highlighting
// only — the playground never compiles or type-checks anything).

import type { Extension } from '@codemirror/state'
import type { SqlDialectId } from '@/lib/agent-hub/playground-languages'

export async function loadLanguageExtension(cm: string, sqlDialect?: SqlDialectId): Promise<Extension> {
  switch (cm) {
    case 'python':
      return (await import('@codemirror/lang-python')).python()
    case 'c':
      // The C++ package's language covers C too; plain `cppLanguage` avoids
      // offering C++-only keyword completion in C mode.
      return (await import('@codemirror/lang-cpp')).cppLanguage
    case 'cpp':
      return (await import('@codemirror/lang-cpp')).cpp()
    case 'java':
      return (await import('@codemirror/lang-java')).java()
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true })
    case 'typescript':
      // JSX + TSX both highlight: the parser accepts TSX when jsx is enabled.
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true })
    case 'html':
      return (await import('@codemirror/lang-html')).html()
    case 'css':
      return (await import('@codemirror/lang-css')).css()
    case 'go':
      return (await import('@codemirror/lang-go')).go()
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust()
    case 'php':
      return (await import('@codemirror/lang-php')).php()
    case 'json':
      return (await import('@codemirror/lang-json')).json()
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml()
    case 'sql': {
      const { sql, PostgreSQL, MySQL, SQLite, MSSQL, StandardSQL } = await import('@codemirror/lang-sql')
      const dialect =
        sqlDialect === 'postgresql'
          ? PostgreSQL
          : sqlDialect === 'mysql'
            ? MySQL
            : sqlDialect === 'sqlite'
              ? SQLite
              : sqlDialect === 'mssql'
                ? MSSQL
                : StandardSQL
      return sql({ dialect })
    }
    case 'bash': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { shell } = await import('@codemirror/legacy-modes/mode/shell')
      return StreamLanguage.define(shell)
    }
    case 'powershell': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { powerShell } = await import('@codemirror/legacy-modes/mode/powershell')
      return StreamLanguage.define(powerShell)
    }
    case 'csharp': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { csharp } = await import('@codemirror/legacy-modes/mode/clike')
      return StreamLanguage.define(csharp)
    }
    default:
      // Unknown language id: plain editable text, no highlighting claims.
      return []
  }
}
