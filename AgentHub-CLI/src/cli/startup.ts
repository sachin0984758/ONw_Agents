import type { AgentConfig } from '../config/types.ts'
import type { SkillIndex } from '../skills/discover.ts'
import { VERSION } from '../version.ts'
import type { Ansi } from '../utils/ansi.ts'
import { terminalText } from './terminal-ui.ts'

export function startupLines(config: AgentConfig, skills: SkillIndex, ansi: Ansi, maxRows = 19, provider?: string): string[] {
  const sep = config.ascii ? '|' : '·'
  const tile = (rgb: string, text: string): string => ansi.enabled ? `\u001b[38;2;${rgb}m${text}\u001b[0m` : text
  const mark = config.ascii ? [
    `${tile('218;139;121', 'S')} ${tile('232;183;89', 'A')}    `,
    '       ',
    '       ',
  ] : [
    `${tile('218;139;121', '█▀▀')} ${tile('77;149;181', '▄▀▄')}`,
    `${tile('218;139;121', '▀▀█')} ${tile('232;183;89', '█▄█')}`,
    `${tile('218;139;121', '▄▄█')} ${tile('77;149;181', '█ █')}`,
  ]
  const lines = [
    '',
    ` ${mark[0]} ${ansi.gray(`AgentHub v${VERSION}`)}`,
    ` ${mark[1]} ${ansi.gray(`escape interrupt ${sep} ctrl+c/ctrl+d clear/exit`)}`,
    ` ${mark[2]} ${ansi.gray(`/help commands ${sep} ctrl+o more ${sep} \\ multiline`)}`,
    ansi.gray(' Press ctrl+o for tool details; /skills for available resources.'),
    '',
    ansi.gray(' AgentHub can explain code, edit files, and run approved commands.'),
    '',
    ansi.yellow('[Skills]'),
  ]
  const installed = skills.entries.filter((entry) => entry.valid && !entry.shadowedBy)
  // Keep the banner visible above the composer in a standard 24-row window.
  const mcpRows = config.mcpServers.length ? 2 + Math.min(5, config.mcpServers.length) + Number(config.mcpServers.length > 5) : 0
  const skillLimit = Math.max(1, Math.min(8, maxRows - 13 - mcpRows - (provider ? 3 : 0)))
  if (installed.length === 0) lines.push(ansi.gray('  None found. Use /skills to see the searched folders.'))
  for (const entry of installed.slice(0, skillLimit)) lines.push(ansi.gray(`  ${terminalText(entry.name)}`))
  if (installed.length > skillLimit) lines.push(ansi.gray(`  + ${installed.length - skillLimit} more (/skills)`))
  if (provider) lines.push('', ansi.yellow('[Providers]'), ansi.gray(`  ${terminalText(provider)}`))
  if (config.mcpServers.length > 0) {
    lines.push('', ansi.yellow('[MCP servers configured]'))
    for (const server of config.mcpServers.slice(0, 5)) lines.push(ansi.gray(`  ${terminalText(server.id)}`))
    if (config.mcpServers.length > 5) lines.push(ansi.gray(`  + ${config.mcpServers.length - 5} more`))
  }
  lines.push('')
  return lines
}
