import type { MemoryNote } from './types'
export function noteLabel(note: Pick<MemoryNote, 'title'>) {
  return note.title.replace(/^\d+[ _-]+/, '').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
export function libraryFolders(notes: MemoryNote[]) {
  const counts = new Map<string, number>()
  for (const note of notes) {
    const parts = note.path.split('/').slice(0, -1)
    for (let depth = 1; depth <= Math.min(parts.length, 2); depth++) {
      const key = parts.slice(0, depth).join('/')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path))
}
/** Reading transformations only; original bytes remain available in Source. */
export function readableNote(content: string) {
  return content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/\[\[([^\]\n]+)\]\]/g, (_whole, target: string) => {
    const [location, alias] = target.replace(/\\\|/g, '|').split('|')
    const label = alias || location.split('/').at(-1) || location
    return label.replace(/[\[\]]/g, '')
  })
}
