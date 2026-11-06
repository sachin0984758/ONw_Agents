'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ObsidianNoteMarkdown } from './obsidian-note-markdown'
import { BookOpen, FileText, Folder, Search, ArrowUpRight, Link2, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { MemoryNote, MemoryRead } from '@/lib/agent-hub/obsidian/types'
import { libraryFolders, noteLabel, readableNote } from '@/lib/agent-hub/obsidian/presentation'
import styles from './obsidian-library.module.css'

async function readApi(query: string, signal?: AbortSignal) {
  const response = await fetch(`/api/obsidian?${query}`, { cache: 'no-store', signal })
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error(data.error || 'Could not read your vault.')
  return data
}
export function ObsidianLibrary({ connectionId, revision }: { connectionId: string; revision: number }) {
  const [notes, setNotes] = useState<MemoryNote[]>([]), [folder, setFolder] = useState(''), [query, setQuery] = useState(''), [results, setResults] = useState<MemoryNote[] | null>(null)
  const [note, setNote] = useState<MemoryRead | null>(null), [source, setSource] = useState(false), [loading, setLoading] = useState(true), [reading, setReading] = useState(false), [searching, setSearching] = useState(false), [error, setError] = useState(''), [page, setPage] = useState(0)
  const request = useRef<AbortController | null>(null), searchRequest = useRef<AbortController | null>(null)
  const reader = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    void readApi('op=browse', controller.signal).then(async (data) => {
      setNotes(data.notes); setLoading(false)
      if (data.notes[0]) { const read = await readApi(`op=read&path=${encodeURIComponent(data.notes[0].path)}`, controller.signal); setNote(read.note) }
    }).catch((e) => { if (!controller.signal.aborted) { setError(e.message); setLoading(false) } })
    return () => { controller.abort(); request.current?.abort(); searchRequest.current?.abort() }
  }, [connectionId, revision])
  const folders = useMemo(() => libraryFolders(notes), [notes])
  const visible = useMemo(() => (results ?? notes).filter((item) => !folder || item.path.startsWith(folder + '/')), [notes, results, folder])
  const openNote = async (path: string) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    setReading(true); setError(''); setSource(false)
    try { const data = await readApi(`op=read&path=${encodeURIComponent(path)}`, controller.signal); setNote(data.note); reader.current?.scrollTo({ top: 0 }) }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not open note.') }
    finally { if (!controller.signal.aborted) setReading(false) }
  }
  const search = async () => {
    searchRequest.current?.abort(); const controller = new AbortController(); searchRequest.current = controller
    if (!query.trim()) { setResults(null); setSearching(false); setPage(0); return }
    setSearching(true); setError('')
    try { const data = await readApi(`op=search&q=${encodeURIComponent(query)}`, controller.signal); setResults(data.notes); setFolder(''); setPage(0) }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Search failed.') }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }
  return <div className={styles.library} aria-label="Vault library">
    <aside className={styles.folders} aria-label="Vault folders"><p className={styles.eyebrow}>YOUR COLLECTIONS</p><button aria-pressed={!folder} onClick={() => { setFolder(''); setPage(0) }}><BookOpen size={16} />All notes<span>{notes.length}</span></button>{folders.map((item) => <button key={item.path} aria-pressed={folder === item.path} onClick={() => { setFolder(item.path); setPage(0) }} style={{ paddingLeft: item.path.includes('/') ? 24 : 12 }}><Folder size={14} /><span className={styles.folderName}>{item.path.split('/').at(-1)}</span><small>{item.count}</small></button>)}</aside>
    <div className={styles.list}><form className={styles.search} onSubmit={(e) => { e.preventDefault(); void search() }}><Search size={15} /><input aria-label="Search vault memory" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a thought…" /><button aria-label="Search notes" disabled={searching}>{searching ? <Loader2 size={15} className="animate-spin" /> : <ArrowUpRight size={16} />}</button></form><div className={styles.listTitle}><span>{results ? 'Search results' : folder.split('/').at(-1) || 'All notes'}</span><small>{visible.length} notes</small></div>{results && <button className={styles.clear} onClick={() => { setResults(null); setQuery(''); setPage(0) }}>Clear search · browse all notes</button>}
      <div className={styles.noteList} aria-label="Notes in collection">{loading ? <p role="status" className={styles.empty}>Opening your library…</p> : visible.length === 0 ? <p className={styles.empty}>No notes here. Try a different collection or search.</p> : visible.slice(page * 40, (page + 1) * 40).map((item) => <button key={item.path} aria-pressed={note?.path === item.path} onClick={() => void openNote(item.path)}><FileText size={16} /><span><strong>{noteLabel(item)}</strong><small>{item.path.split('/').slice(0, -1).join(' / ') || 'Vault root'}</small>{item.snippet && <small className={styles.snippet}>{item.snippet}</small>}</span></button>)}</div>
      {visible.length > 40 && <div className={styles.pagination}><button aria-label="Previous notes" disabled={!page} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button><span>{page + 1} / {Math.ceil(visible.length / 40)}</span><button aria-label="Next notes" disabled={(page + 1) * 40 >= visible.length} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></div>}
    </div>
    <article className={styles.reader} aria-label="Note reader" aria-busy={reading}><header className={styles.readerToolbar}><span><span className={styles.dot} />Live vault file</span><div><button aria-pressed={!source} onClick={() => setSource(false)}>Read</button><button aria-pressed={source} onClick={() => setSource(true)}>Source</button></div></header>
      {error && <p role="alert" className={styles.error}>{error}</p>}{reading && <p role="status" className={styles.progress}><Loader2 size={14} className="animate-spin" />Opening note…</p>}
      <div ref={reader} className={styles.readerScroll}>{note ? <><div className={styles.noteHeader}><p className={styles.eyebrow}>{note.path.split('/').slice(0, -1).join(' / ') || 'YOUR VAULT'}</p><h3>{note.title}</h3><div><span>{Math.max(1, Math.ceil(note.content.split(/\s+/).length / 220))} min read · {note.links.length} linked notes</span><a href={note.obsidianUrl}>Open in Obsidian <ArrowUpRight size={13} /></a></div></div>{note.truncated && <p className={styles.error}>This note is larger than the reading limit. Showing the first 256 KB.</p>}{source ? <pre className={styles.source}>{note.content}</pre> : <div className={styles.prose}><ObsidianNoteMarkdown>{readableNote(note.content).replace(/^\s*#\s+[^\n]+\n/, '')}</ObsidianNoteMarkdown></div>}<footer className={styles.connections}><p className={styles.eyebrow}><Link2 size={13} />CONNECTED IDEAS</p>{[...note.links, ...note.backlinks].filter((item, index, all) => all.findIndex((other) => other.path === item.path) === index).map((item) => <button key={item.path} onClick={() => void openNote(item.path)}><FileText size={14} />{noteLabel(item)}<ArrowUpRight size={13} /></button>)}{!note.links.length && !note.backlinks.length && <p>No linked notes in the bounded scan.</p>}</footer></> : <div className={styles.empty}><BookOpen size={30} /><h3>Your ideas, ready to explore.</h3><p>Choose a note from the library to start reading.</p></div>}</div>
    </article>
  </div>
}
