/** Shared by the interactive picker and /help so advertised commands agree. */
export const SLASH_COMMANDS = [
  { name: '/help', args: '', description: 'Show commands and shortcuts' },
  { name: '/model', args: '[id]', description: 'Show or switch the model' },
  { name: '/provider', args: '[id]', description: 'Show or switch the provider' },
  { name: '/status', args: '', description: 'Show workspace, model, mode and usage' },
  { name: '/skills', args: '', description: 'List installed skills' },
  { name: '/skill', args: '<name>', description: 'Load a skill into the conversation' },
  { name: '/memory', args: '[list|search <text>|delete <index>] [--user]', description: 'View, search or remove saved memory' },
  { name: '/plan', args: '', description: 'Show the current plan' },
  { name: '/diff', args: '', description: 'Show unstaged Git changes' },
  { name: '/undo', args: '', description: 'Restore the most recent file backup' },
  { name: '/permissions', args: '[mode]', description: 'Show or change permission mode' },
  { name: '/usage', args: '', description: 'Show session token usage' },
  { name: '/compact', args: '', description: 'Compact older conversation messages' },
  { name: '/clear', args: '', description: 'Start a new session' },
  { name: '/resume', args: '[id|last]', description: 'Resume a session' },
  { name: '/sessions', args: '', description: 'List sessions' },
  { name: '/verbose', args: '', description: 'Toggle tool-output detail' },
  { name: '/quit', args: '', description: 'Exit AgentHub' },
] as const

export function matchingCommands(line: string) {
  if (!/^\/[a-z]*$/i.test(line)) return []
  const query = line.toLowerCase()
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(query))
    .sort((a, b) => Number(b.name === query) - Number(a.name === query))
}
