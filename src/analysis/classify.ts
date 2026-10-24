import type { Classification, Fen, PlayedMove, WinPct } from '../domain'
import { winPct } from './accuracy'
import type { CompleteEvals } from './evals'
import { captures, PIECE_VALUE, see } from './material'

export const CLASSIFIER_VERSION = 1

/** Every threshold the rule table reads. Win values are Lichess win% for the mover, material is in pawns.
 *  Bump CLASSIFIER_VERSION with any change. The loss bands are chess.com's published expected-points bands
 *  applied to the Lichess curve; brilliant, great and miss are guesses awaiting calibration. */
export const CLASSIFIER = {
  bands: { excellent: 2, good: 5, inaccuracy: 10, mistake: 20 },
  brilliant: { minWinAfter: 45, maxAlternative: 90 },
  great: { minGap: 20 },
  miss: { opponentLoss: 10, minWinBefore: 60, minLoss: 5, blunderLoss: 20, blunderWinAfter: 50 },
  sacrifice: { minExposure: 3, minNet: 2 },
  escape: { minGain: 2 },
} as const

const { bands, brilliant, great, miss } = CLASSIFIER

/** Everything the rule table reads about one move. */
export type MoveFacts = {
  readonly inBook: boolean
  readonly forced: boolean
  readonly mates: boolean
  /** The played move is line 1 at `before`. */
  readonly isTop: boolean
  /** Line 1 at `before` and the eval at `after`. They come from different searches. */
  readonly wb: WinPct
  readonly wa: WinPct
  /** 0 for the top move, so horizon noise between the two searches never marks a best move down. */
  readonly loss: number
  /** Line 2 at `before`; null only when the move was forced. */
  readonly w2: WinPct | null
  readonly sacrifice: boolean
  readonly recapture: boolean
  readonly escape: boolean
  /** The opponent just handed over a chance, or a forced mate was on the board. */
  readonly opportunity: boolean
}

export type MoveContext = {
  readonly inBook: boolean
  readonly prev: { readonly move: PlayedMove; readonly loss: number } | null
}

export function moveFacts(move: PlayedMove, evals: CompleteEvals, { inBook, prev }: MoveContext): MoveFacts {
  const [best, second] = evals.of(move.before).lines
  const wb = winPct(best.score, move.mover)
  const wa = winPct(evals.at(move.after), move.mover)
  const isTop = move.uci === best.pv[0]
  return {
    inBook,
    forced: move.before.legalMoves === 1,
    mates: move.after.kind === 'checkmate',
    isTop,
    wb,
    wa,
    loss: isTop ? 0 : Math.max(0, wb - wa),
    w2: second ? winPct(second.score, move.mover) : null,
    sacrifice: isSacrifice(move),
    recapture: prev !== null && prev.move.captured !== null && prev.move.to === move.to,
    escape: wasEnPrise(move),
    opportunity:
      (prev !== null && prev.loss >= miss.opponentLoss && wb >= miss.minWinBefore) ||
      (best.score.kind === 'mate' && best.score.winner === move.mover),
  }
}

/** Ordered; the first row that holds wins, and a move no row takes is a blunder. */
const RULES: readonly (readonly [Classification, (f: MoveFacts) => boolean])[] = [
  ['book', (f) => f.inBook],
  ['best', (f) => f.forced || f.mates],
  ['brilliant', (f) => f.isTop && f.sacrifice && f.wa >= brilliant.minWinAfter && f.w2 !== null && f.w2 < brilliant.maxAlternative],
  ['great', (f) => f.isTop && f.w2 !== null && f.wb - f.w2 >= great.minGap && !f.recapture && !f.escape],
  ['best', (f) => f.isTop],
  ['miss', (f) => f.opportunity && f.loss >= miss.minLoss && !(f.loss >= miss.blunderLoss && f.wa <= miss.blunderWinAfter)],
  ['excellent', (f) => f.loss < bands.excellent],
  ['good', (f) => f.loss < bands.good],
  ['inaccuracy', (f) => f.loss < bands.inaccuracy],
  ['mistake', (f) => f.loss < bands.mistake],
]

export function classify(f: MoveFacts): Classification {
  return RULES.find(([, holds]) => holds(f))?.[0] ?? 'blunder'
}

/** The move leaves at least a minor piece en prise, net of what it took. A pawn sacrifice never counts. */
export function isSacrifice(move: PlayedMove): boolean {
  if (move.after.kind !== 'playable') return false
  const { minExposure, minNet } = CLASSIFIER.sacrifice
  const gain = (move.captured ? PIECE_VALUE[move.captured] : 0) + (move.promotion ? PIECE_VALUE[move.promotion] - 1 : 0)
  const fen = move.after.fen
  const exposure = Math.max(0, ...captures(fen).map((c) => see(fen, c)))
  return exposure >= minExposure && exposure - gain >= minNet
}

/** The moved piece stood en prise before the move. A king is never en prise; leaving check is a different thing. */
function wasEnPrise(move: PlayedMove): boolean {
  if (move.piece === 'k') return false
  const [placement, turn, castling, , halfmove, fullmove] = move.before.fen.split(' ')
  const flipped = [placement, turn === 'w' ? 'b' : 'w', castling, '-', halfmove, fullmove].join(' ') as Fen
  return captures(flipped).some((c) => c.to === move.from && see(flipped, c) >= CLASSIFIER.escape.minGain)
}
