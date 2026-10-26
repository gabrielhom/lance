import { Fragment } from 'react'
import type { Classification } from '../domain/types'
import { moveNumberLabel } from './format'
import { CLASSIFICATION_MARK } from './labels'

const FIGURINE: Readonly<Record<string, string>> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' }

/** SAN with solid figurines. Screen readers get the piece letter instead, the notation the move input takes. */
export function San({ san }: { san: string }) {
  return san.split(/([KQRBN])/).map((part, i) =>
    FIGURINE[part] ? (
      <Fragment key={i}>
        <span className="fig" aria-hidden>{FIGURINE[part]}</span>
        <span className="sr-only">{part}</span>
      </Fragment>
    ) : (
      part
    ),
  )
}

/** `sans[from..to)` as a book prints them, '2.♞f3 d6 3.d4', numbering a Black move that comes first '2…d6'. A line
 *  breaks only between moves. */
export function Moves({ sans, from = 0, to = sans.length }: { sans: readonly string[]; from?: number; to?: number }) {
  return sans.slice(from, to).map((san, i) => {
    const ply = from + i
    return (
      <Fragment key={ply}>
        {i > 0 && ' '}
        <span className="whitespace-nowrap">
          {(ply % 2 === 0 || i === 0) && moveNumberLabel(ply)}
          <San san={san} />
        </span>
      </Fragment>
    )
  })
}

/** The annotation mark in the class's color. The class name always sits nearby in words, so the mark is hidden from screen readers. */
export function Mark({ kind }: { kind: Classification }) {
  const mark = CLASSIFICATION_MARK[kind]
  if (!mark) return null
  return <span className="mk" style={{ color: `var(--c-${kind})` }} aria-hidden>{mark}</span>
}
