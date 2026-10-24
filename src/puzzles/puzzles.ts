import { Chess, type Move } from 'chess.js'
import type { Color, Puzzle, PuzzleAttempt, PuzzleTheme, San, Uci } from '../domain'

/** The themes the filter offers, most asked for first. */
export const FILTER_THEMES: readonly PuzzleTheme[] = [
  'mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'skewer', 'discoveredAttack', 'sacrifice', 'deflection', 'attraction',
  'hangingPiece', 'backRankMate', 'advancedPawn', 'promotion', 'defensiveMove', 'quietMove', 'endgame', 'advantage',
]

/** `played` is every move on the board since the puzzle's FEN, the opponent's setup move first. */
export type AttemptState =
  /** The opponent's next move in the line plays itself. */
  | { readonly phase: 'opponent'; readonly played: readonly Uci[] }
  | { readonly phase: 'player'; readonly played: readonly Uci[] }
  /** `played` ends with the player's last move, which may be another mate than the line's. */
  | { readonly phase: 'solved'; readonly played: readonly Uci[] }
  /** `wrong` is the player's move off the line, not in `played`; null when the player gave up. */
  | { readonly phase: 'failed'; readonly played: readonly Uci[]; readonly wrong: Uci | null }
export type AttemptEvent = { readonly kind: 'reply' } | { readonly kind: 'move'; readonly uci: Uci } | { readonly kind: 'give-up' }

export const START: AttemptState = { phase: 'opponent', played: [] }

/** Lichess's rule: every player move must be the line's, except that when the line's move mates, any mate wins.
 *  An event that doesn't fit the phase, or an illegal move, leaves the state alone. */
export function stepAttempt(puzzle: Puzzle, state: AttemptState, event: AttemptEvent): AttemptState {
  const { played } = state
  const expected = puzzle.moves[played.length]
  if (state.phase === 'opponent' && event.kind === 'reply') return { phase: 'player', played: [...played, expected] }
  if (state.phase !== 'player') return state
  if (event.kind === 'give-up') return { phase: 'failed', played, wrong: null }
  if (event.kind !== 'move') return state
  const board = replay(puzzle.fen, played)
  const move = tryMove(board, event.uci)
  if (!move) return state
  const right = move.lan === expected || (board.isCheckmate() && mates(puzzle.fen, [...played, expected]))
  if (!right) return { phase: 'failed', played, wrong: move.lan as Uci }
  const next = [...played, move.lan as Uci]
  return { phase: next.length === puzzle.moves.length || board.isCheckmate() ? 'solved' : 'opponent', played: next }
}

/** The side the player solves for: the one the setup move hands the turn to. */
export function puzzleSide(puzzle: Puzzle): Color {
  return puzzle.fen.split(' ')[1] === 'w' ? 'b' : 'w'
}

/** The board after `moves` from `fen`. Throws on an illegal move: callers pass moves the puzzle or chess.js produced. */
export function replay(fen: string, moves: readonly string[]): Chess {
  const board = new Chess(fen)
  for (const m of moves) if (!tryMove(board, m)) throw new Error(`${m} is illegal after ${board.fen()}`)
  return board
}

/** Every move of the line in SAN, with its ply counted from the game's start, for move numbers. */
export function puzzleLine(puzzle: Puzzle): readonly { readonly ply: number; readonly san: San }[] {
  const [, turn, , , , fullmove] = puzzle.fen.split(' ')
  const first = (Number(fullmove) - 1) * 2 + (turn === 'b' ? 1 : 0)
  const board = new Chess(puzzle.fen)
  return puzzle.moves.map((m, i) => ({ ply: first + i, san: tryMove(board, m)!.san as San }))
}

function mates(fen: string, moves: readonly string[]): boolean {
  return replay(fen, moves).isCheckmate()
}

function tryMove(board: Chess, uci: string): Move | null {
  try {
    return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
  } catch {
    return null
  }
}

export const PUZZLE_RATING = { start: 1500, minK: 16 } as const

export type PlayerRating = { readonly rating: number; readonly played: number }

/** Elo against the puzzle's fixed rating. K = 800 / (played + 5) is about the step size that makes Elo converge on the
 *  maximum-likelihood rating (roughly 700 / played), with five imaginary puzzles at 1500 so the first ones don't swing
 *  wildly. From the 45th puzzle K stays at 16, so the rating keeps following a player who improves. */
export function rate(player: PlayerRating, puzzleRating: number, solved: boolean): PlayerRating {
  const k = Math.max(PUZZLE_RATING.minK, 800 / (player.played + 5))
  const expected = 1 / (1 + 10 ** ((puzzleRating - player.rating) / 400))
  return { rating: player.rating + k * ((solved ? 1 : 0) - expected), played: player.played + 1 }
}

/** The rating is never stored: it is the attempts replayed in order, so a backup merge can't leave it out of step. */
export function playerRating(attempts: readonly PuzzleAttempt[]): PlayerRating {
  return [...attempts]
    .sort((a, b) => a.at - b.at)
    .reduce<PlayerRating>((p, a) => rate(p, a.puzzleRating, a.solved), { rating: PUZZLE_RATING.start, played: 0 })
}

/** Rating distances tried in turn for a puzzle not done yet. */
export const WINDOWS = [100, 200, 400] as const

/** A puzzle not done yet in the narrowest window around the rating; when the widest has none, the one done longest ago
 *  in it; when a theme has nothing that close at all, the nearest one, fresh first. null only when no puzzle has the theme. */
export function nextPuzzle(
  puzzles: readonly Puzzle[],
  attempts: readonly PuzzleAttempt[],
  rating: number,
  theme: PuzzleTheme | null,
  random: () => number,
): Puzzle | null {
  const done = new Map(attempts.map((a) => [a.id, a.at]))
  const pool = theme ? puzzles.filter((p) => p.themes.includes(theme)) : puzzles
  const distance = (p: Puzzle) => Math.abs(p.rating - rating)
  for (const w of WINDOWS) {
    const fresh = pool.filter((p) => distance(p) <= w && !done.has(p.id))
    if (fresh.length > 0) return fresh[Math.floor(random() * fresh.length)]
  }
  const near = pool.filter((p) => distance(p) <= WINDOWS[WINDOWS.length - 1])
  if (near.length > 0) return minBy(near, (p) => done.get(p.id) ?? 0)
  return minBy(pool, (p) => (done.has(p.id) ? 10_000 : 0) + distance(p))
}

function minBy<T>(xs: readonly T[], key: (x: T) => number): T | null {
  let best: T | null = null
  let bestKey = Infinity
  for (const x of xs) {
    const k = key(x)
    if (k < bestKey) {
      best = x
      bestKey = k
    }
  }
  return best
}
