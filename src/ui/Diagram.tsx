import type { ReactNode } from 'react'
import type { Color } from '../domain/types'

const FILES = 'abcdefgh'.split('')
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']

/** A board as a book prints it: a thin frame with the ranks and files set outside. */
export function Diagram({ orientation, children }: { orientation: Color; children: ReactNode }) {
  const files = orientation === 'w' ? FILES : [...FILES].reverse()
  const ranks = orientation === 'w' ? RANKS : [...RANKS].reverse()
  return (
    <div className="diagram">
      <div className="ranks" aria-hidden>
        {ranks.map((r) => <span key={r}>{r}</span>)}
      </div>
      <div className="frame">{children}</div>
      <div className="files" aria-hidden>
        {files.map((f) => <span key={f}>{f}</span>)}
      </div>
    </div>
  )
}
