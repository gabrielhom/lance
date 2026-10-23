import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'

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
  className?: string
}

/** The game as a scoresheet: numbered rows, White and Black side by side. */
export function Scoresheet({ label, count, move, extra = {}, focus, minRows = 0, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const last = Math.max(count - 1, ...Object.keys(extra).map(Number))
  const rows = Math.max(Math.floor(last / 2) + 1, minRows)
  const filled = Math.floor(last / 2) + 1

  // Scrolls the sheet alone; scrollIntoView would also scroll the page under a phone user's thumb.
  useLayoutEffect(() => {
    const box = ref.current
    const row = box?.querySelectorAll('tbody tr')[Math.floor(Math.max(0, focus) / 2)]
    if (!box || !row) return
    const head = box.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const r = row.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (r.top < b.top + head) box.scrollTop -= b.top + head - r.top
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom
  }, [focus, count])

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
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r} className={r < filled ? undefined : r === filled ? 'blank' : 'blank extra'}>
              <td className="n">{r + 1}.</td>
              {[2 * r, 2 * r + 1].map((i) => (
                <td key={i} className="m">{i < count ? move(i) : extra[i]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
