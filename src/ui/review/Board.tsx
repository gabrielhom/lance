import { Chessboard } from 'react-chessboard'
import { useMemo } from 'react'
import type { Classification, Color, Square } from '../../domain/types'
import { BOARD_STYLE, tint } from '../boardStyle'
import { Diagram } from '../Diagram'
import { CLASSIFICATION_MARK } from '../labels'

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export type BoardProps = {
  fen: string
  orientation: Color
  lastMove: { from: Square; to: Square } | null
  /** The class of the move that reached this position, printed on its square. */
  badge: { square: Square; kind: Classification } | null
  bestArrow: { from: Square; to: Square } | null
}

export function Board({ fen, orientation, lastMove, badge, bestArrow }: BoardProps) {
  const blunder = badge?.kind === 'blunder'
  const squares = useMemo(() => {
    const s: Record<string, string> = {}
    if (lastMove) {
      s[lastMove.from] = tint(blunder ? 'var(--hl-bad-from)' : 'var(--hl)')
      s[lastMove.to] = tint(blunder ? 'var(--hl-bad)' : 'var(--hl)')
    }
    return s
  }, [lastMove, blunder])
  const mark = badge ? CLASSIFICATION_MARK[badge.kind] : ''

  // The board is a picture of the position; the move list and the live region carry it for assistive tech.
  // `inert` also drops dnd-kit's 32 unnamed focusable piece wrappers out of the tab order.
  return (
    <Diagram orientation={orientation}>
      <div className="select-none" style={{ touchAction: 'manipulation' }} inert aria-hidden>
        <Chessboard
          options={{
            ...BOARD_STYLE,
            id: 'revisao',
            position: fen,
            boardOrientation: orientation === 'w' ? 'white' : 'black',
            allowDragging: false,
            allowDrawingArrows: false,
            showAnimations: !REDUCED_MOTION,
            animationDurationInMs: 180,
            arrows: bestArrow ? [{ startSquare: bestArrow.from, endSquare: bestArrow.to, color: 'var(--arrow)' }] : [],
            squareRenderer: ({ square, children }) => (
              <div style={{ width: '100%', height: '100%', position: 'relative', background: squares[square] }}>
                {children}
                {badge && mark && badge.square === square && (
                  <span className="sq-badge" style={{ background: `var(--c-${badge.kind})` }}>{mark}</span>
                )}
              </div>
            ),
          }}
        />
      </div>
    </Diagram>
  )
}
