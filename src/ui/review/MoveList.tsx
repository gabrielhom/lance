import { useMemo } from 'react'
import { phaseAt } from '../../analysis'
import { PHASES } from '../../domain/types'
import type { Color, Division, GameReview, MoveReview, PlayedMove } from '../../domain/types'
import { colorLabel, formatAccuracy } from '../format'
import { CLASSIFICATION_LABEL, PHASE_LABEL } from '../labels'
import { Mark, San } from '../san'
import { Scoresheet } from '../Scoresheet'
import { phaseStarts, sheetRows } from './sections'

type Props = {
  moves: readonly PlayedMove[]
  reviews: readonly MoveReview[] | null
  division: Division
  /** Phase accuracies; null while the review is still running. */
  review: GameReview | null
  /** The reader's colour, whose accuracy alone the headings show. */
  me: Color | null
  ply: number
  onSelect: (ply: number) => void
}

export function MoveList({ moves, reviews, division, review, me, ply, onSelect }: Props) {
  const starts = useMemo(() => phaseStarts(moves.length, division), [moves.length, division])
  const rows = useMemo(() => sheetRows(moves.length, division), [moves.length, division])
  const present = PHASES.filter((p) => starts[p] !== undefined)
  const here = phaseAt(division, ply)

  const accuracy = (phase: (typeof PHASES)[number]) => {
    if (!review) return null
    const colors: readonly Color[] = me ? [me] : ['w', 'b']
    return colors.map((c) => ({ c, text: formatAccuracy(review.players[c].phases[phase].accuracy) }))
  }

  return (
    <>
      {present.length > 1 && (
        <div className="phase-nav" role="group" aria-label="Ir para a fase">
          {present.map((p) => (
            <button key={p} type="button" className="tl tl-quiet" aria-current={here === p ? 'true' : undefined} onClick={() => onSelect(starts[p]! + 1)}>
              {PHASE_LABEL[p]}
            </button>
          ))}
        </div>
      )}
      <Scoresheet
        label="Lista de lances"
        className="review-sheet"
        count={moves.length}
        focus={ply - 1}
        rows={rows}
        heading={(p) => {
          const acc = accuracy(p)
          return (
            <>
              <span className="sect-name">{PHASE_LABEL[p]}</span>
              {' '}
              {acc && (
                <span className="sect-acc">
                  <span className="sr-only">Precisão: </span>
                  {acc.map(({ c, text }, i) => (
                    <span key={c}>
                      {i > 0 && ' · '}
                      {me ? '' : `${colorLabel(c)} `}
                      {text}
                    </span>
                  ))}
                </span>
              )}
            </>
          )
        }}
        move={(i) => {
          const m = moves[i]
          const cls = reviews?.[i]?.classification
          return (
            <button
              type="button"
              className={`mv ${cls === 'book' ? 'book' : ''} ${cls === 'blunder' ? 'bad' : ''}`}
              aria-current={ply === i + 1 ? 'true' : undefined}
              onClick={() => onSelect(i + 1)}
              aria-label={`${m.mover === 'w' ? 'Brancas' : 'Pretas'}: ${m.san}${cls ? `, ${CLASSIFICATION_LABEL[cls]}` : ''}`}
            >
              <San san={m.san} />
              {cls && <Mark kind={cls} />}
            </button>
          )
        }}
      />
    </>
  )
}
