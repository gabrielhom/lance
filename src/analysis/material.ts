import { Chess, type Move } from 'chess.js'
import type { Color, Fen, PieceKind, Square } from '../domain'

/** The king never trades, so its value only has to outweigh everything else. */
export const PIECE_VALUE: Readonly<Record<PieceKind, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 }

/** Static exchange evaluation of a legal capture, in pawns for the capturer. The first capture respects pins;
 *  later recaptures ignore them, and x-rays open up as pieces leave the board. */
export function see(fen: Fen, capture: { readonly from: Square; readonly to: Square }): number {
  const board = new Chess(fen)
  const first = board.move({ from: capture.from, to: capture.to, promotion: 'q' })
  const to = capture.to
  const gains = [PIECE_VALUE[first.captured ?? 'p']]
  let occupant = PIECE_VALUE[first.promotion ?? first.piece]
  let side = other(first.color)
  for (;;) {
    const from = cheapestAttacker(board, to, side)
    const piece = from && board.get(from)
    if (!from || !piece) break
    if (piece.type === 'k' && board.attackers(to, other(side)).length > 0) break
    gains.push(occupant - gains[gains.length - 1])
    board.remove(from)
    board.put(piece, to)
    occupant = PIECE_VALUE[piece.type]
    side = other(side)
  }
  for (let i = gains.length - 1; i > 0; i--) gains[i - 1] = -Math.max(-gains[i - 1], gains[i])
  return gains[0]
}

/** Legal captures for the side to move. An illegal position (side not to move in check) also yields king captures. */
export function captures(fen: Fen): Move[] {
  return new Chess(fen).moves({ verbose: true }).filter((m) => m.captured)
}

function cheapestAttacker(board: Chess, to: Square, side: Color): Square | null {
  let best: { square: Square; value: number } | null = null
  for (const square of board.attackers(to, side)) {
    const piece = board.get(square)
    if (piece && (best === null || PIECE_VALUE[piece.type] < best.value)) best = { square, value: PIECE_VALUE[piece.type] }
  }
  return best?.square ?? null
}

function other(c: Color): Color {
  return c === 'w' ? 'b' : 'w'
}
