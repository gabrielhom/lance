import { describe, expect, it } from 'vitest'
import analysed from './fixtures/lichess-thibault-analysed.ndjson?raw'
import { gameFromPgn, type Fen, type Game, type PositionKey, type SearchedEval, type Uci } from '../domain'
import { completeEvals } from './evals'
import { phaseAccuracy } from './accuracy'
import { divide, phaseAt } from './phases'

function parse(pgn: string): Game {
  const r = gameFromPgn(pgn, { kind: 'pgn' })
  if (!r.ok) throw new Error(r.error.detail)
  return r.value
}
const fens = (g: Game) => g.positions.map((p) => p.fen)

describe('divide against the division Lichess publishes', () => {
  // GET lichess.org/game/export/<id>?division=true
  const published: Record<string, { middle: number; end?: number }> = {
    k8OVq8Y5: { middle: 19, end: 40 },
    aDN8u0zd: { middle: 28 },
    QgBb1l8L: { middle: 23 },
    fPQMtU5T: { middle: 15, end: 44 },
    N1SQKS1V: { middle: 14, end: 56 },
  }
  const games = analysed.trim().split('\n').map((line) => JSON.parse(line) as { id: string; pgn: string })

  it.each(games.map((g) => [g.id, g.pgn] as const))('splits game %s where Lichess does', (id, pgn) => {
    const { middle, end } = published[id]
    expect(divide(fens(parse(pgn)))).toEqual({ middlegame: middle, endgame: end ?? null })
  })
})

describe('divide', () => {
  it('leaves a short opening skirmish all opening', () => {
    expect(divide(fens(parse('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0')))).toEqual({ middlegame: null, endgame: null })
  })

  it('starts an endgame position in the endgame with no middlegame', () => {
    const pgn = '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/R3K2R w KQ - 0 1"]\n\n1. O-O Kd7 *'
    expect(divide(fens(parse(pgn)))).toEqual({ middlegame: null, endgame: 0 })
  })

  it('counts a sparse home rank as development', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' as Fen
    const developed = 'rnbqkbnr/pppppppp/8/8/2BPPB2/2N2N2/PPPQ1PPP/R3K2R w KQkq - 0 1' as Fen
    expect(divide([start, start, developed])).toEqual({ middlegame: 2, endgame: null })
  })
})

describe('phaseAt', () => {
  it('puts the move into the middlegame that reaches its first position', () => {
    const division = { middlegame: 19, endgame: 40 }
    expect([0, 18, 19, 39, 40, 80].map((i) => phaseAt(division, i))).toEqual([
      'opening', 'opening', 'middlegame', 'middlegame', 'endgame', 'endgame',
    ])
    expect(phaseAt({ middlegame: null, endgame: 0 }, 0)).toBe('endgame')
  })
})

describe('phaseAccuracy', () => {
  const plies = 30
  const cycle = ['Nf3', 'Nf6', 'Ng1', 'Ng8']
  const game = parse(Array.from({ length: plies }, (_, i) => cycle[i % 4]).join(' ') + ' *')
  // White's 13th move (index 12, in the middlegame) drops from +0.15 to -3.00; nothing else loses anything.
  const cps = Array.from({ length: plies + 1 }, (_, i) => (i <= 12 ? 15 : -300))
  const found = new Map<PositionKey, SearchedEval>()
  for (const p of game.positions) {
    if (p.kind === 'playable') found.set(p.key, { depth: 20, lines: [{ score: { kind: 'cp', white: cps[p.index] }, pv: ['0000' as Uci] }] })
  }
  const evals = completeEvals(game, found)
  if (!evals.ok) throw new Error('missing evals')

  it('scores each phase over its own moves and leaves a phase under the minimum blank', () => {
    const a = phaseAccuracy(game, evals.value, { middlegame: 10, endgame: 20 })
    expect({ w: a.w.opening, b: a.b.opening }).toEqual({ w: { moves: 5, accuracy: 100 }, b: { moves: 4, accuracy: null } })
    expect(a.w.middlegame.moves).toBe(5)
    expect(a.w.middlegame.accuracy).toBeCloseTo(54.45, 2)
    expect(a.w.endgame).toEqual({ moves: 5, accuracy: 100 })
    expect(a.b.middlegame).toEqual({ moves: 5, accuracy: 100 })
    expect(a.b.endgame).toEqual({ moves: 6, accuracy: 100 })
  })

  it('counts every move as opening when the game never leaves it', () => {
    const a = phaseAccuracy(game, evals.value, { middlegame: null, endgame: null })
    expect([a.w.opening.moves, a.w.middlegame.moves, a.w.endgame.moves, a.b.opening.moves]).toEqual([15, 0, 0, 15])
    expect(a.w.middlegame.accuracy).toBeNull()
  })
})
