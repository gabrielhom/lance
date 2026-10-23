import { Fragment } from 'react'
import type { Classification } from '../domain/types'
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

/** The annotation mark in the class's color. The class name always sits nearby in words, so the mark is hidden from screen readers. */
export function Mark({ kind }: { kind: Classification }) {
  const mark = CLASSIFICATION_MARK[kind]
  if (!mark) return null
  return <span className="mk" style={{ color: `var(--c-${kind})` }} aria-hidden>{mark}</span>
}
