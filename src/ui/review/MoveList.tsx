import type { MoveReview, PlayedMove } from '../../domain/types'
import { CLASSIFICATION_LABEL } from '../labels'
import { Mark, San } from '../san'
import { Scoresheet } from '../Scoresheet'

type Props = {
  moves: readonly PlayedMove[]
  reviews: readonly MoveReview[] | null
  ply: number
  onSelect: (ply: number) => void
}

export function MoveList({ moves, reviews, ply, onSelect }: Props) {
  return (
    <Scoresheet
      label="Lista de lances"
      className="review-sheet"
      count={moves.length}
      focus={ply - 1}
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
  )
}
