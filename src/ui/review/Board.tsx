import { Chessboard } from 'react-chessboard'
import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Classification, Color, Square } from '../../domain/types'
import { BOARD_STYLE } from '../boardStyle'
import { CLASSIFICATION_MARK } from '../labels'

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export type BoardProps = {
  fen: string
  orientation: Color
  lastMove: { from: Square; to: Square } | null
  badge: { square: Square; kind: Classification } | null
  bestArrow: { from: Square; to: Square } | null
}

export function Board({ fen, orientation, lastMove, badge, bestArrow }: BoardProps) {
  const squareStyles = useMemo(() => {
    const s: Record<string, CSSProperties> = {}
    if (lastMove) {
      s[lastMove.from] = { background: 'var(--board-last)' }
      s[lastMove.to] = { background: 'var(--board-last)' }
    }
    return s
  }, [lastMove])

  // The board is a picture of the position; the move list and the live region carry it for assistive tech.
  // `inert` also drops dnd-kit's 32 unnamed focusable piece wrappers out of the tab order.
  return (
    <div className="w-full select-none" style={{ touchAction: 'manipulation' }} inert aria-hidden>
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
          arrows: bestArrow ? [{ startSquare: bestArrow.from, endSquare: bestArrow.to, color: 'var(--arrow-best)' }] : [],
          squareRenderer: ({ square, children }) => (
            <div style={{ width: '100%', height: '100%', position: 'relative', ...squareStyles[square] }}>
              {children}
              {badge && badge.square === square && CLASSIFICATION_MARK[badge.kind] && (
                <span style={{ position: 'absolute', top: 2, right: 3, zIndex: 2, fontWeight: 700 }}>{CLASSIFICATION_MARK[badge.kind]}</span>
              )}
            </div>
          ),
        }}
      />
    </div>
  )
}
