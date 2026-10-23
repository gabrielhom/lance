import { Chessboard } from 'react-chessboard'
import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Classification, Color, Square } from '../../domain/types'
import { useElementWidth } from '../useElementWidth'
import { ClassificationBadge } from './ClassificationBadge'

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export type BoardProps = {
  fen: string
  orientation: Color
  lastMove: { from: Square; to: Square } | null
  badge: { square: Square; kind: Classification } | null
  bestArrow: { from: Square; to: Square } | null
}

export function Board({ fen, orientation, lastMove, badge, bestArrow }: BoardProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>()
  const squareStyles = useMemo(() => {
    const s: Record<string, CSSProperties> = {}
    if (lastMove) {
      s[lastMove.from] = { background: 'var(--board-last)' }
      s[lastMove.to] = { background: 'var(--board-last)' }
    }
    return s
  }, [lastMove])
  const badgeSize = Math.max(16, Math.round((width / 8) * 0.42))

  // The board is a picture of the position; the move list and the live region carry it for assistive tech.
  // `inert` also drops dnd-kit's 32 unnamed focusable piece wrappers out of the tab order.
  return (
    <div ref={ref} className="w-full select-none" style={{ touchAction: 'manipulation' }} inert aria-hidden>
      <Chessboard
        options={{
          id: 'revisao',
          position: fen,
          boardOrientation: orientation === 'w' ? 'white' : 'black',
          allowDragging: false,
          allowDrawingArrows: false,
          showAnimations: !REDUCED_MOTION,
          animationDurationInMs: 180,
          boardStyle: { borderRadius: 8, overflow: 'hidden', boxShadow: 'var(--shadow)' },
          darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
          lightSquareStyle: { backgroundColor: 'var(--board-light)' },
          darkSquareNotationStyle: { color: 'var(--board-light)', fontSize: 11, fontWeight: 600 },
          lightSquareNotationStyle: { color: 'var(--board-dark)', fontSize: 11, fontWeight: 600 },
          arrows: bestArrow ? [{ startSquare: bestArrow.from, endSquare: bestArrow.to, color: 'var(--arrow-best)' }] : [],
          squareRenderer: ({ square, children }) => (
            <div style={{ width: '100%', height: '100%', position: 'relative', ...squareStyles[square] }}>
              {children}
              {badge && badge.square === square && (
                <ClassificationBadge kind={badge.kind} size={badgeSize} style={{ position: 'absolute', top: -badgeSize * 0.22, right: -badgeSize * 0.22, zIndex: 2 }} />
              )}
            </div>
          ),
        }}
      />
    </div>
  )
}
