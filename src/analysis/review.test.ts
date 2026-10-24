import { describe, expect, it } from 'vitest'
import opera from '../../e2e/fixtures/opera.pgn?raw'
import {
  gameFromPgn,
  type AnalysisProfile,
  type Color,
  type EngineId,
  type EvalLine,
  type Fen,
  type Game,
  type PositionKey,
  type Score,
  type SearchedEval,
  type Uci,
  type OpeningBook,
} from '../domain'
import { bookFrom, loadBook } from '../openings'
import { buildReview, CLASSIFIER_VERSION, completeEvals, pvSan } from '.'

const PROFILE: AnalysisProfile = { engine: 'sf19/nn-61e7af4bb97d' as EngineId, limit: { kind: 'depth', depth: 18 } }
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' as Fen

const cp = (white: number): Score => ({ kind: 'cp', white })
const mate = (winner: Color, moves: number): Score => ({ kind: 'mate', winner, moves })
const line = (score: Score, uci: string): EvalLine => ({ score, pv: [uci as Uci] })
const searched = (best: EvalLine, second?: EvalLine): SearchedEval => ({ depth: 18, lines: second ? [best, second] : [best] })

function parse(pgn: string): Game {
  const r = gameFromPgn(pgn, { kind: 'pgn' })
  if (!r.ok) throw new Error(r.error.detail)
  return r.value
}

function review(pgn: string, evals: Readonly<Record<number, SearchedEval>> = {}, book: OpeningBook = bookFrom({})) {
  const game = parse(pgn)
  const found = new Map<PositionKey, SearchedEval>()
  for (const p of game.positions) {
    if (p.kind !== 'playable') continue
    const played = line(cp(0), game.moves[p.index]?.uci ?? '0000')
    found.set(p.key, evals[p.index] ?? searched(played, p.legalMoves > 1 ? line(cp(0), '0000') : undefined))
  }
  const complete = completeEvals(game, found)
  if (!complete.ok) throw new Error('missing evals')
  return buildReview(game, complete.value, book, { kind: 'me', color: 'w' }, PROFILE)
}

describe('buildReview', () => {
  it('summarizes both players and names the last book opening', async () => {
    const r = review(opera, {}, await loadBook())
    expect(r.classifierVersion).toBe(CLASSIFIER_VERSION)
    expect(r.perspective).toEqual({ kind: 'me', color: 'w' })
    expect(r.opening).toEqual({ eco: 'C41', name: 'Philidor Defense' })
    expect(r.players.w.player.name).toBe('Paul Morphy')
    // With level evals everywhere, 13.Rxd7 and 16.Qb8+ are sound sacrifices.
    expect(r.players.w.counts).toMatchObject({ book: 4, brilliant: 2, best: 11 })
    expect(r.players.b.counts).toMatchObject({ book: 3, best: 13 })
    expect(r.players.w.accuracy).toBe(100)
  })

  it('splits the game into phases and scores each player in each', () => {
    const r = review(opera)
    expect(r.division).toEqual({ middlegame: 17, endgame: 32 })
    expect(r.players.w.phases.opening).toMatchObject({ moves: 8, accuracy: 100 })
    expect(r.players.b.phases.middlegame).toMatchObject({ moves: 7, accuracy: 100 })
    expect(r.players.w.phases.endgame).toEqual({ moves: 1, accuracy: null, elo: null })
    expect(r.players.w.phases.opening.elo).not.toBeNull()
    expect(r.players.w.elo).not.toBeNull()
  })

  it('gives no estimated rating for a game too short to say anything', () => {
    const r = review('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0')
    expect(r.players.w.accuracy).toBe(100)
    expect(r.players.w.elo).toBeNull()
  })

  it('writes the best line in SAN from the position before the move', () => {
    const r = review(opera)
    expect(r.moves[22].bestLineSan).toEqual(['O-O-O'])
    expect(r.moves[0].alternative).not.toBeNull()
    expect(r.moves[31].alternative).toBeNull()
  })

  it('reports win% from the mover side and Lichess accuracy per move', () => {
    const r = review(opera, { 0: searched(line(cp(0), 'd2d4'), line(cp(0), 'e2e4')), 1: searched(line(cp(-100), 'e7e5')) })
    expect(r.moves[0].winBefore).toBe(50)
    expect(r.moves[0].winAfter).toBeLessThan(42)
    expect(r.moves[0].accuracy).toBeLessThan(80)
    expect(r.moves[1].winBefore).toBeGreaterThan(58)
  })
})

describe('graph', () => {
  it('labels each position from White and ends on # after mate', () => {
    const r = review(opera, {
      1: searched(line(cp(130), 'e7e5')),
      2: searched(line(cp(-44), 'g1f3')),
      3: searched(line(cp(4), 'd7d6')),
      4: searched(line(mate('w', 3), 'd2d4')),
      5: searched(line(mate('b', 3), 'c8g4')),
    })
    expect(r.graph).toHaveLength(34)
    expect(r.graph.slice(1, 6).map((p) => p.label)).toEqual(['+1.3', '-0.4', '0.0', 'M3', '-M3'])
    expect(r.graph[33]).toMatchObject({ index: 33, label: '#' })
    expect(r.graph[33].whiteWin).toBeCloseTo(97.5, 1)
    expect(r.graph[5].whiteWin).toBeCloseTo(2.5, 1)
  })

  it('marks a stalemate as a draw', () => {
    const r = review('[SetUp "1"]\n[FEN "7k/8/6K1/8/8/8/8/5Q2 w - - 0 1"]\n\n1. Qf7 1/2-1/2')
    expect(r.graph[1]).toMatchObject({ whiteWin: 50, label: '½' })
  })
})

describe('key moments', () => {
  const SHUFFLE = '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. Nf3 Nf6 6. Ng1 Ng8 *'

  it('keeps the five biggest swings in game order', () => {
    // White drops a little more each move; Black keeps the gain with its top move.
    const evals: Record<number, SearchedEval> = {}
    for (let k = 0; k < 6; k++) {
      evals[2 * k] = searched(line(cp(-1), '0000'), line(cp(-1), '0001'))
      const black = cp(-150 - 60 * k)
      evals[2 * k + 1] = searched(line(black, k % 2 === 0 ? 'g8f6' : 'f6g8'), line(black, '0001'))
    }
    evals[12] = searched(line(cp(-1), '0000'))
    const r = review(SHUFFLE, evals)
    expect(r.moves.filter((m) => m.move.mover === 'w').every((m) => ['mistake', 'blunder'].includes(m.classification))).toBe(true)
    expect(r.keyMoments.map((k) => k.move.move.index)).toEqual([2, 4, 6, 8, 10])
    expect(r.keyMoments.map((k) => k.why)).toEqual([2, 4, 6, 8, 10].map((i) => r.moves[i].classification))
    expect(r.keyMoments.every((k) => k.swing < 0)).toBe(true)
  })

  it('names a best move that flips the evaluation a turning point', () => {
    const r = review('1. Nf3 Nf6 2. Ng1 Ng8 *', {
      2: searched(line(cp(-60), 'f3g1'), line(cp(-80), 'b1c3')),
      3: searched(line(cp(200), 'f6g8')),
      4: searched(line(cp(200), 'g1f3')),
    })
    expect(r.moves[2].classification).toBe('best')
    expect(r.keyMoments.map((k) => [k.move.move.index, k.why])).toEqual([[2, 'turning-point']])
    expect(r.keyMoments[0].swing).toBeGreaterThan(15)
  })

  it('includes brilliant moves even though they barely move the graph', () => {
    const r = review(opera, {
      30: searched(line(mate('w', 2), 'b3b8'), line(cp(300), 'd1d6')),
      31: searched(line(mate('w', 1), 'd7b8')),
    })
    expect(r.keyMoments.map((k) => [k.move.move.san, k.why])).toEqual(
      expect.arrayContaining([
        ['Rxd7', 'brilliant'],
        ['Qb8+', 'brilliant'],
      ]),
    )
  })
})

describe('pvSan', () => {
  it('turns an engine line into SAN, castling and promotion included', () => {
    expect(pvSan(START, ['e2e4', 'e7e5', 'g1f3'] as Uci[])).toEqual(['e4', 'e5', 'Nf3'])
    expect(pvSan('4k3/8/8/8/8/8/8/4K2R w K - 0 1' as Fen, ['e1g1'] as Uci[])).toEqual(['O-O'])
    expect(pvSan('8/4P3/8/8/8/8/k7/4K3 w - - 0 1' as Fen, ['e7e8n'] as Uci[])).toEqual(['e8=N'])
  })

  it('stops at the first move that is not legal', () => {
    expect(pvSan(START, ['e2e4', 'e2e4', 'g1f3'] as Uci[])).toEqual(['e4'])
  })
})
