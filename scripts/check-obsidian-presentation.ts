import assert from 'node:assert/strict'
import { libraryFolders, noteLabel, readableNote } from '../src/lib/agent-hub/obsidian/presentation'
const notes = ['LEARN/Aptitude/001_natural_numbers.md', 'LEARN/Aptitude/002_whole_numbers.md', 'LEARN/Code/intro.md', 'HOME.md'].map((path) => ({ path, title: path.split('/').at(-1)!.replace(/\.md$/, ''), bytes: 10, modifiedAt: '2026-11-05' }))
assert.deepEqual(libraryFolders(notes), [{ path: 'LEARN', count: 3 }, { path: 'LEARN/Aptitude', count: 2 }, { path: 'LEARN/Code', count: 1 }])
assert.equal(noteLabel(notes[0]), 'Natural Numbers')
const original = '---\ntags: [math]\n---\n# Note\n\n[[LEARN/Aptitude/INDEX|Index]] and [[002_whole_numbers]]'
assert.equal(readableNote(original), '# Note\n\nIndex and 002_whole_numbers')
assert.equal(readableNote('---\r\ntags: [a]\r\n---\r\n# Windows'), '# Windows')
assert.equal(readableNote('A horizontal rule\n---\nText'), 'A horizontal rule\n---\nText')
assert.ok(original.startsWith('---\n'), 'rendering must not mutate original source')
assert.equal(libraryFolders([]).length, 0)
console.log('7/7 library presentation checks passed.')
