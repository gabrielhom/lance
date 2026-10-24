import opera from '../../e2e/fixtures/opera.pgn?raw'
import { buildReview, completeEvals } from '../analysis'
import { gameFromPgn, type AnalysisProfile, type EngineId, type Game, type GameReview, type OpeningBook, type Perspective, type PositionKey, type SearchedEval, type Uci } from '../domain'

export const NO_BOOK: OpeningBook = { has: () => false, lookup: () => null }
export const PROFILE: AnalysisProfile = { engine: 'sf19/nn-61e7af4bb97d' as EngineId, limit: { kind: 'depth', depth: 18 } }

export function operaGame(): Game {
  const g = gameFromPgn(opera, { kind: 'pgn' })
  if (!g.ok) throw new Error(g.error.detail)
  return g.value
}

/** Every move is the engine's choice, except Black's 9...b5, which turns an equal game into a lost one. */
export function operaEvals(game: Game): Map<PositionKey, SearchedEval> {
  const found = new Map<PositionKey, SearchedEval>()
  for (const p of game.positions) {
    if (p.kind !== 'playable') continue
    const pv = [p.index === 17 ? 'a7a6' : game.moves[p.index].uci] as [Uci]
    found.set(p.key, { depth: 18, lines: [{ score: { kind: 'cp', white: p.index <= 17 ? 0 : 1000 }, pv }] })
  }
  return found
}

export function operaReview(who: Perspective): GameReview {
  const game = operaGame()
  const evals = completeEvals(game, operaEvals(game))
  if (!evals.ok) throw new Error('missing evals')
  return buildReview(game, evals.value, NO_BOOK, who, PROFILE)
}
