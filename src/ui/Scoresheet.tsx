import { useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SheetRow } from './review/sections'

type Props = {
  label: string
  /** Moves played so far. */
  count: number
  /** The content of the cell for move `i`. */
  move: (i: number) => ReactNode
  /** Cells after the last move, by index: the typed-move input during a game. */
  extra?: Readonly<Record<number, ReactNode>>
  /** The cell to keep scrolled into view. */
  focus: number
  /** Ruled rows printed even before moves fill them. */
  minRows?: number
  /** Rows laid out by the caller, with section headings; default is one row per full move. */
  rows?: readonly SheetRow[]
  heading?: (phase: Extract<SheetRow, { kind: 'heading' }>['phase']) => ReactNode
  className?: string
}

/** The game as a scoresheet: numbered rows, White and Black side by side. */
export function Scoresheet({ label, count, move, extra = {}, focus, minRows = 0, rows: given, heading, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const last = Math.max(count - 1, ...Object.keys(extra).map(Number))
  const filled = Math.floor(last / 2) + 1
  const layout = useMemo<readonly SheetRow[]>(
    () => given ?? Array.from({ length: Math.max(filled, minRows) }, (_, r) => ({ kind: 'moves', number: r + 1, white: 2 * r, black: 2 * r + 1 })),
    [given, filled, minRows],
  )

  // Scrolls the sheet alone; scrollIntoView would also scroll the page under a phone user's thumb.
  useLayoutEffect(() => {
    const box = ref.current
    const at = layout.findIndex((r) => r.kind === 'moves' && (r.white === Math.max(0, focus) || r.black === Math.max(0, focus)))
    const row = box?.querySelectorAll('tbody tr')[at]
    if (!box || !row) return
    const head = box.querySelector('thead')?.getBoundingClientRect().height ?? 0
    // A section heading just above the row scrolls into view with it.
    const above = row.previousElementSibling?.classList.contains('sect') ? row.previousElementSibling : row
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (above.getBoundingClientRect().top < b.top + head) box.scrollTop -= b.top + head - above.getBoundingClientRect().top
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom
    // No row stays half under the sticky header: scroll back to show the cut one, or on to hide it when the focus would leave the box.
    const line = box.getBoundingClientRect().top + head
    const cut = [...box.querySelectorAll('tbody tr')].find((t) => t !== row && t !== above && t.getBoundingClientRect().top < line - 0.5 && t.getBoundingClientRect().bottom > line + 0.5)
    if (cut) {
      const reveal = line - cut.getBoundingClientRect().top
      if (row.getBoundingClientRect().bottom + reveal <= box.getBoundingClientRect().bottom) box.scrollTop -= reveal
      else if (above.getBoundingClientRect().top - (cut.getBoundingClientRect().bottom - line) >= line) box.scrollTop += cut.getBoundingClientRect().bottom - line
    }
  }, [focus, count, layout])

  return (
    <div ref={ref} className={`sheet-box ${className}`}>
      <table className="sheet" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className="n">Nº</th>
            <th scope="col">Brancas</th>
            <th scope="col">Pretas</th>
          </tr>
        </thead>
        <tbody>
          {layout.map((row, r) =>
            row.kind === 'heading' ? (
              <tr key={`h${row.phase}`} className="sect">
                <th scope="colgroup" colSpan={3}>{heading?.(row.phase)}</th>
              </tr>
            ) : (
              <tr key={r} className={given || r < filled ? undefined : r === filled ? 'blank' : 'blank extra'}>
                <td className="n">{row.number}.</td>
                {[row.white, row.black].map((i, c) => (
                  <td key={c} className="m">
                    {i === null ? (c === 0 ? <span className="mv waiting" aria-hidden>…</span> : null) : i < count ? move(i) : extra[i]}
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}
