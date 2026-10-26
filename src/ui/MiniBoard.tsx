import { Chess } from 'chess.js'
import { memo, useMemo } from 'react'
import { defaultPieces } from 'react-chessboard'
import type { Color, Uci } from '../domain/types'

const PIECES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'] as const
/** A piece of the set leaves a fifth of its square empty around it, too much on a square a few pixels wide. */
const GROW = 0.24
const DARK = Array.from({ length: 32 }, (_, i) => {
  const y = Math.floor(i / 4)
  return `M${(i % 4) * 2 + ((y + 1) % 2)} ${y}h1v1h-1z`
}).join('')

/** The pieces of the playing board, drawn once per screen for every MiniBoard on it to point at. */
export function PieceSprite() {
  return (
    <svg width="0" height="0" className="mini-sprite absolute" aria-hidden>
      <defs>
        {PIECES.map((p) => (
          <symbol key={p} id={`mini-${p}`} viewBox="0 0 45 45">
            {defaultPieces[p]()}
          </symbol>
        ))}
      </defs>
    </svg>
  )
}

/** The position after `moves`, as a picture: no coordinates, the last move marked. Needs a PieceSprite on the screen.
 *  Its size comes from the --mini CSS variable. */
export const MiniBoard = memo(function MiniBoard({ moves, orientation }: { moves: readonly Uci[]; orientation: Color }) {
  const board = useMemo(() => {
    const chess = new Chess()
    for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.slice(4) || undefined })
    return chess.board()
  }, [moves])
  // Square (file, rank) from a1 = (0, 0) to its place on the picture.
  const at = (file: number, rank: number) => (orientation === 'w' ? { x: file, y: 7 - rank } : { x: 7 - file, y: rank })
  const last = moves.at(-1)
  return (
    <svg viewBox="0 0 8 8" className="mini" aria-hidden>
      <rect width="8" height="8" className="mini-light" />
      <path d={DARK} className="mini-dark" />
      {last &&
        [last.slice(0, 2), last.slice(2, 4)].map((sq) => {
          const { x, y } = at(sq.charCodeAt(0) - 97, Number(sq[1]) - 1)
          return <rect key={sq} x={x} y={y} width="1" height="1" className="mini-last" />
        })}
      {board.flatMap((row, r) =>
        row.flatMap((piece, f) => {
          if (!piece) return []
          const { x, y } = at(f, 7 - r)
          return [<use key={`${f}${r}`} href={`#mini-${piece.color}${piece.type.toUpperCase()}`} x={x - GROW / 2} y={y - GROW / 2} width={1 + GROW} height={1 + GROW} />]
        }),
      )}
    </svg>
  )
})
