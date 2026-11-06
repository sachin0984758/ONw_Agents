'use client'

// ── Playground spreadsheet grid (Excel mode) ─────────────────────────────────
// A lightweight editing surface for spreadsheet practice: column letters, row
// numbers, a selected-cell indicator, a formula bar and editable cells.
// Cells hold RAW text. A formula such as "=SUM(B2:B6)" stays exactly as typed
// — there is NO calculation engine, so the grid never shows a computed value
// and the UI says so. Undo is a value-level stack owned by the parent view.

import { useRef } from 'react'
import { Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ANALYSIS_LABELS } from '@/lib/agent-hub/playground-types'
import type { ExcelSheet } from '@/lib/agent-hub/playground-types'

export interface ExcelGridProps {
  sheet: ExcelSheet
  /** Selected address, e.g. "B9". */
  selected: string
  onSelect: (addr: string) => void
  /** Live edit (every keystroke) — updates the sheet without touching undo. */
  onDraft: (addr: string, value: string) => void
  /** Edit committed (blur / Enter / Tab / navigation) — pushes one undo step. */
  onCommit: (addr: string, prev: string, next: string) => void
  onUndo: () => void
  canUndo: boolean
  className?: string
}

function colLetter(index: number): string {
  let out = ''
  let i = index
  while (i >= 0) {
    out = String.fromCharCode(65 + (i % 26)) + out
    i = Math.floor(i / 26) - 1
  }
  return out
}

function parseAddr(addr: string): { row: number; col: number } {
  const match = /^([A-Z]{1,2})(\d{1,3})$/.exec(addr.trim().toUpperCase())
  if (!match) return { row: 0, col: 0 }
  let col = 0
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(match[2]) - 1, col: col - 1 }
}

function addrOf(row: number, col: number): string {
  return `${colLetter(col)}${row + 1}`
}

export function ExcelGrid({
  sheet,
  selected,
  onSelect,
  onDraft,
  onCommit,
  onUndo,
  canUndo,
  className,
}: ExcelGridProps) {
  const cols = Math.max(1, Math.min(26, sheet.columns))
  const rows = Math.max(1, Math.min(200, sheet.rows))

  const rawSel = parseAddr(selected)
  const selRow = Math.min(Math.max(rawSel.row, 0), rows - 1)
  const selCol = Math.min(Math.max(rawSel.col, 0), cols - 1)
  const selAddr = addrOf(selRow, selCol)

  // The value the edited cell had when the current edit run started. It is
  // captured from the first draft event — that handler's closure still holds
  // the pre-draft sheet — so committing never depends on focus/blur events
  // firing (programmatic focus and unfocused windows skip those events).
  const editStartRef = useRef<{ addr: string; value: string } | null>(null)
  // The latest draft value for the cell being edited.
  const pendingRef = useRef<{ addr: string; value: string } | null>(null)
  const cancelRef = useRef(false)

  const valueAt = (addr: string): string => sheet.cells[addr] ?? ''

  function onDraftInput(addr: string, value: string) {
    if (!editStartRef.current || editStartRef.current.addr !== addr) {
      editStartRef.current = { addr, value: sheet.cells[addr] ?? '' }
    }
    pendingRef.current = { addr, value }
    onDraft(addr, value)
  }

  function commitCurrent() {
    const start = editStartRef.current
    editStartRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    if (!start || !pending || pending.addr !== start.addr) return
    if (pending.value !== start.value) onCommit(start.addr, start.value, pending.value)
  }

  function moveBy(rowDelta: number, colDelta: number) {
    const nextRow = Math.min(Math.max(selRow + rowDelta, 0), rows - 1)
    const nextCol = Math.min(Math.max(selCol + colDelta, 0), cols - 1)
    onSelect(addrOf(nextRow, nextCol))
  }

  function handleCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      editStartRef.current = null
      pendingRef.current = null
      onUndo()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      commitCurrent()
      moveBy(1, 0)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      commitCurrent()
      moveBy(0, e.shiftKey ? -1 : 1)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      commitCurrent()
      moveBy(1, 0)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      commitCurrent()
      moveBy(-1, 0)
      return
    }
    if (e.key === 'Escape') {
      const start = editStartRef.current
      if (start) {
        cancelRef.current = true
        editStartRef.current = null
        pendingRef.current = null
        onDraft(start.addr, start.value)
        e.currentTarget.blur()
      }
    }
  }

  function handleCellBlur() {
    if (cancelRef.current) {
      cancelRef.current = false
      editStartRef.current = null
      pendingRef.current = null
      return
    }
    commitCurrent()
  }

  const cellTextClass = 'truncate text-xs'
  const formulaClass = 'truncate font-mono text-[11px] italic text-emerald-700 dark:text-emerald-400'

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-2', className)} data-testid="excel-grid">
      {/* Formula bar */}
      <div className="flex items-center gap-2">
        <div
          className="flex h-8 w-16 shrink-0 items-center justify-center rounded-md border bg-secondary/50 font-mono text-[11px] font-semibold text-muted-foreground"
          data-testid="excel-selected-cell"
        >
          {selAddr}
        </div>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border bg-card px-2">
          <span className="shrink-0 text-[11px] italic text-muted-foreground">fx</span>
          <input
            data-testid="excel-formula-bar"
            aria-label="Formula bar — raw cell text, not calculated"
            title="Raw cell content. Formulas stay as text — nothing is recalculated."
            value={valueAt(selAddr)}
            onChange={(e) => onDraftInput(selAddr, e.target.value)}
            onBlur={handleCellBlur}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault()
                editStartRef.current = null
                pendingRef.current = null
                onUndo()
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                commitCurrent()
                e.currentTarget.blur()
              }
            }}
            className="h-full w-full min-w-0 bg-transparent font-mono text-xs outline-none"
          />
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo the last cell change (Ctrl+Z)"
            className={cn(
              'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
              canUndo ? 'text-muted-foreground hover:text-foreground' : 'cursor-not-allowed text-muted-foreground/40',
            )}
          >
            <Undo2 className="size-3" />
            Undo
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="hub-scroll min-h-0 flex-1 overflow-auto rounded-md border bg-card" data-testid="excel-cells">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `2.75rem repeat(${cols}, minmax(7rem, 1fr))`,
            minWidth: `${2.75 + cols * 7}rem`,
            gridAutoRows: '1.75rem',
          }}
        >
          {/* Header row */}
          <div className="sticky left-0 top-0 z-20 border-b border-r bg-muted" />
          {Array.from({ length: cols }, (_, c) => (
            <div
              key={`h-${c}`}
              className="sticky top-0 z-10 flex items-center justify-center border-b border-r bg-muted font-mono text-[10px] text-muted-foreground"
            >
              {colLetter(c)}
            </div>
          ))}

          {/* Body rows */}
          {Array.from({ length: rows }, (_, r) => (
            <RowCells
              key={`r-${r}`}
              row={r}
              cols={cols}
              selRow={selRow}
              selCol={selCol}
              valueAt={valueAt}
              onSelect={onSelect}
              onDraftInput={onDraftInput}
              onCellKeyDown={handleCellKeyDown}
              onCellBlur={handleCellBlur}
              cellTextClass={cellTextClass}
              formulaClass={formulaClass}
            />
          ))}
        </div>
      </div>

      <div className="text-[11px] leading-snug text-muted-foreground">
        {ANALYSIS_LABELS.excel} Cells show raw text; formulas appear exactly as typed.{' '}
        {canUndo ? 'Ctrl+Z (or Undo) reverts the last cell change.' : ''}
      </div>
    </div>
  )
}

interface RowCellsProps {
  row: number
  cols: number
  selRow: number
  selCol: number
  valueAt: (addr: string) => string
  onSelect: (addr: string) => void
  onDraftInput: (addr: string, value: string) => void
  onCellKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onCellBlur: () => void
  cellTextClass: string
  formulaClass: string
}

function RowCells({
  row,
  cols,
  selRow,
  selCol,
  valueAt,
  onSelect,
  onDraftInput,
  onCellKeyDown,
  onCellBlur,
  cellTextClass,
  formulaClass,
}: RowCellsProps) {
  return (
    <>
      <div className="sticky left-0 z-10 flex items-center justify-center border-b border-r bg-muted font-mono text-[10px] text-muted-foreground">
        {row + 1}
      </div>
      {Array.from({ length: cols }, (_, c) => {
        const addr = addrOf(row, c)
        const value = valueAt(addr)
        const isSelected = row === selRow && c === selCol
        if (isSelected) {
          return (
            <div
              key={addr}
              className="relative border-b border-r bg-primary/5 ring-2 ring-inset ring-primary/60"
              data-cell={addr}
            >
              <input
                autoFocus
                data-cell-input={addr}
                aria-label={`Cell ${addr}`}
                value={value}
                onChange={(e) => onDraftInput(addr, e.target.value)}
                onBlur={onCellBlur}
                onKeyDown={onCellKeyDown}
                className={cn(
                  'h-full w-full min-w-0 bg-transparent px-1.5 outline-none',
                  value.startsWith('=') ? 'font-mono text-[11px] italic text-emerald-700 dark:text-emerald-400' : 'text-xs',
                )}
              />
            </div>
          )
        }
        return (
          <div
            key={addr}
            data-cell={addr}
            role="gridcell"
            onClick={() => onSelect(addr)}
            className="flex min-w-0 cursor-cell items-center overflow-hidden border-b border-r bg-transparent px-1.5 hover:bg-secondary/40"
          >
            <span className={value.startsWith('=') ? formulaClass : cellTextClass}>{value}</span>
          </div>
        )
      })}
    </>
  )
}
