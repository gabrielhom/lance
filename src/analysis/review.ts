import { Chess } from 'chess.js'
import {
  CLASSIFICATIONS,
  type AnalysisProfile,
  type Classification,
  type Color,
  type Fen,
  type Game,
  type GameReview,
  type GraphPoint,
  type KeyMoment,
  type MoveReview,
  type NonEmpty,
  type PlayedMove,
  type PlayerSummary,
  type Perspective,
  type PositionEval,
  type San,
  type Uci,
  type WinPct,
} from '../domain'
import { bookPrefix, type Book } from '../openings'
import { gameAccuracy, moveAccuracy, winPct } from './accuracy'
import { CLASSIFIER_VERSION, classify, moveFacts } from './classify'
import type { CompleteEvals } from './evals'

const KEY_MOMENTS = { limit: 5, turningSwing: 15 } as const
const NOTABLE: ReadonlySet<Classification> = new Set(['brilliant', 'great', 'miss', 'mistake', 'blunder'])

export function buildReview(game: Game, evals: CompleteEvals, book: Book, who: Perspective, profile: AnalysisProfile): GameReview {
  const shown = bookPrefix(book, game.moves.map((m) => m.after.fen))
  const moves: MoveReview[] = []
  let prev: { move: PlayedMove; loss: number } | null = null
  for (const move of game.moves) {
    const facts = moveFacts(move, evals, { inBook: move.index < shown.length, prev })
    const [best, alternative = null] = evals.of(move.before).lines
    moves.push({
      move,
      classification: classify(facts),
      winBefore: facts.wb,
      winAfter: facts.wa,
      accuracy: moveAccuracy(facts.wb, facts.wa),
      best,
      bestLineSan: pvSan(move.before.fen, best.pv),
      alternative,
      opening: shown[move.index] ?? null,
    })
    prev = { move, loss: facts.loss }
  }
  const accuracy = gameAccuracy(game, evals)
  const summary = (c: Color): PlayerSummary => ({
    player: game.players[c],
    accuracy: accuracy[c],
    counts: countClassifications(moves.filter((m) => m.move.mover === c)),
  })
  return {
    game,
    profile,
    perspective: who,
    classifierVersion: CLASSIFIER_VERSION,
    moves,
    players: { w: summary('w'), b: summary('b') },
    graph: graphPoints(game, evals),
    keyMoments: keyMoments(moves),
    opening: shown.at(-1) ?? null,
  }
}

export function graphPoints(game: Game, evals: CompleteEvals): NonEmpty<GraphPoint> {
  const point = (p: Game['positions'][number]): GraphPoint => {
    const e = evals.at(p)
    return { index: p.index, whiteWin: winPct(e, 'w'), label: evalLabel(e) }
  }
  const [first, ...rest] = game.positions
  return [point(first), ...rest.map(point)]
}

/** From White's side: '+1.3', '-0.4', '0.0', 'M3', '-M3', '#' after checkmate, '½' after stalemate. */
export function evalLabel(e: PositionEval): string {
  switch (e.kind) {
    case 'checkmate':
      return '#'
    case 'stalemate':
      return '½'
    case 'searched': {
      const score = e.lines[0].score
      if (score.kind === 'mate') return `${score.winner === 'w' ? '' : '-'}M${score.moves}`
      const pawns = Math.round(score.white / 10) / 10
      return pawns > 0 ? `+${pawns.toFixed(1)}` : pawns < 0 ? pawns.toFixed(1) : '0.0'
    }
  }
}

/** Notable labels and swings that cross 50%, the biggest few, in game order. A brilliant or great move
 *  barely moves the graph, so it ranks by how far line 2 fell short instead. */
export function keyMoments(moves: readonly MoveReview[]): readonly KeyMoment[] {
  const ranked = moves.flatMap((m) => {
    const before = whiteWin(m.winBefore, m.move.mover)
    const after = whiteWin(m.winAfter, m.move.mover)
    const swing = after - before
    const notable = NOTABLE.has(m.classification)
    const crosses = Math.abs(swing) >= KEY_MOMENTS.turningSwing && Math.sign(before - 50) !== Math.sign(after - 50)
    if (!notable && !crosses) return []
    const gap = m.alternative && (m.classification === 'brilliant' || m.classification === 'great')
      ? m.winBefore - winPct(m.alternative.score, m.move.mover)
      : Math.abs(swing)
    const moment: KeyMoment = { move: m, swing, why: notable ? m.classification : 'turning-point' }
    return [{ moment, rank: gap }]
  })
  return ranked
    .sort((a, b) => b.rank - a.rank)
    .slice(0, KEY_MOMENTS.limit)
    .map((r) => r.moment)
    .sort((a, b) => a.move.move.index - b.move.move.index)
}

/** The engine line in SAN, up to its first illegal move. */
export function pvSan(from: Fen, pv: readonly Uci[]): readonly San[] {
  const board = new Chess(from)
  const san: San[] = []
  for (const uci of pv) {
    try {
      san.push(board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined }).san as San)
    } catch {
      break
    }
  }
  return san
}

function whiteWin(w: WinPct, pov: Color): number {
  return pov === 'w' ? w : 100 - w
}

function countClassifications(moves: readonly MoveReview[]): Record<Classification, number> {
  const counts = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>
  for (const m of moves) counts[m.classification]++
  return counts
}
