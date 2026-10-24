import { playMove } from '../../domain/game'
import type { Game, NonEmpty, PlayedMove, Position, Uci } from '../../domain/types'

/** What the review board shows: a game position, or a line of moves that branches off the game. A line keeps the
 *  game ply it returns to, and `at`, how many of its moves are on the board, from 1 to moves.length. */
export type View =
  | { readonly kind: 'game'; readonly ply: number }
  | { readonly kind: 'line'; readonly ply: number; readonly moves: NonEmpty<PlayedMove>; readonly at: number }

export const gameAt = (game: Game, ply: number): View => ({ kind: 'game', ply: Math.max(0, Math.min(game.moves.length, ply)) })

/** The position on the board and the move that reached it. */
export function shown(view: View, game: Game): { readonly position: Position; readonly lastMove: PlayedMove | null } {
  if (view.kind === 'line') {
    const m = view.moves[view.at - 1]
    return { position: m.after, lastMove: m }
  }
  return { position: game.positions[view.ply], lastMove: view.ply > 0 ? game.moves[view.ply - 1] : null }
}

/** A move made on the board. The game's own next move steps the game and the line's own next move steps the line.
 *  Any other move starts a line, or replaces what the line had after the board. */
export function moveOnBoard(view: View, game: Game, uci: Uci): View {
  const { position } = shown(view, game)
  if (position.kind !== 'playable') return view
  if (view.kind === 'game' && game.moves[view.ply]?.uci === uci) return gameAt(game, view.ply + 1)
  if (view.kind === 'line' && view.moves[view.at]?.uci === uci) return { ...view, at: view.at + 1 }
  const m = playMove(position, uci)
  if (!m) return view
  if (view.kind === 'game') return { kind: 'line', ply: view.ply, moves: [m], at: 1 }
  return { ...view, moves: [view.moves[0], ...view.moves.slice(1, view.at), m], at: view.at + 1 }
}

/** `pv` played on the board move by move, as the engine's line from the position shown. */
export function follow(view: View, game: Game, pv: readonly Uci[]): View {
  return pv.reduce((v, uci) => moveOnBoard(v, game, uci), view)
}

/** The arrow keys. In a line they walk it, and stepping back from its first move returns to the game. */
export function step(view: View, game: Game, delta: 1 | -1): View {
  if (view.kind === 'game') return gameAt(game, view.ply + delta)
  const at = view.at + delta
  return at < 1 ? gameAt(game, view.ply) : { ...view, at: Math.min(at, view.moves.length) }
}

/** `plies` moves into the engine's line instead of `move`. It returns to the game after `move`. */
export function bestLine(move: PlayedMove, pv: readonly Uci[], plies: number): View {
  const moves: PlayedMove[] = []
  let at: Position = move.before
  for (const uci of pv) {
    const m: PlayedMove | null = at.kind === 'playable' ? playMove(at, uci) : null
    if (!m) break
    moves.push(m)
    at = m.after
  }
  const [first, ...rest] = moves
  if (!first) return { kind: 'game', ply: move.index + 1 }
  return { kind: 'line', ply: move.index + 1, moves: [first, ...rest], at: Math.max(1, Math.min(plies, moves.length)) }
}

/** How many moves of the engine's line instead of `move` are on the board, or null when the board shows something else. */
export function bestLinePlies(view: View, move: PlayedMove, pv: readonly Uci[]): number | null {
  if (view.kind !== 'line' || view.ply !== move.index + 1 || view.moves[0].before.index !== move.index) return null
  return view.moves.slice(0, view.at).every((m, i) => m.uci === pv[i]) ? view.at : null
}
