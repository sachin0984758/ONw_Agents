/** Lexical validation only. File/exec services still enforce realpath,
 * symlink and workspace policy before any filesystem access. */
export function relativeProjectPath(value: string, message: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '') || '.'
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some((part) => part === '..' || part.includes('\0'))) {
    throw new Error(message)
  }
  return normalized
}
