import { describe, expect, it } from 'vitest'
import opera from '../../e2e/fixtures/opera.pgn?raw'
import scholar from '../../e2e/fixtures/scholar.pgn?raw'
import {
  gameFromPgn,
  type AnalysisProfile,
  type Color,
  type EngineId,
  type EvalLine,
  type Game,
  type PositionKey,
  type Score,
  type SearchedEval,
  type Uci,
} from '../domain'
import { bookFrom, loadBook, type Book } from '../openings'
import { buildReview, completeEvals, isSacrifice } from '.'

const PROFILE: AnalysisProfile = { engine: 'sf19/nn-61e7af4bb97d' as EngineId, limit: { kind: 'depth', depth: 18 } }
const NO_BOOK = bookFrom({})
const STALEMATE_TRAP = '[SetUp "1"]\n[FEN "7k/8/6K1/8/8/8/8/5Q2 w - - 0 1"]\n\n1. Qf7 1/2-1/2'
const QUEEN_CHASED = '1. e4 e5 2. Qh5 Nc6 3. Bc4 g6 4. Qf3 *'

const cp = (white: number): Score => ({ kind: 'cp', white })
const mate = (winner: Color, moves: number): Score => ({ kind: 'mate', winner, moves })
const line = (score: Score, uci: string): EvalLine => ({ score, pv: [uci as Uci] })
const searched = (best: EvalLine, second?: EvalLine): SearchedEval => ({ depth: 18, lines: second ? [best, second] : [best] })

function parse(pgn: string): Game {
  const r = gameFromPgn(pgn, { kind: 'pgn' })
  if (!r.ok) throw new Error(r.error.detail)
  return r.value
}

/** Every position defaults to an even eval whose line 1 is the move actually played. */
function review(pgn: string, evals: Readonly<Record<number, SearchedEval>>, book: Book = NO_BOOK) {
  const game = parse(pgn)
  const found = new Map<PositionKey, SearchedEval>()
  for (const p of game.positions) {
    if (p.kind !== 'playable') continue
    const played = line(cp(0), game.moves[p.index]?.uci ?? '0000')
    found.set(p.key, evals[p.index] ?? searched(played, p.legalMoves > 1 ? line(cp(0), '0000') : undefined))
  }
  const complete = completeEvals(game, found)
  if (!complete.ok) throw new Error('missing evals')
  return buildReview(game, complete.value, book, { kind: 'spectator' }, PROFILE)
}

const labelOf = (pgn: string, index: number, evals: Readonly<Record<number, SearchedEval>>, book?: Book) =>
  review(pgn, evals, book).moves[index].classification

describe('rule 1: book', () => {
  it('labels theory as book and stops at the first move out of it', async () => {
    const r = review(scholar, {}, await loadBook())
    expect(r.moves.map((m) => m.classification)).toEqual(['book', 'book', 'book', 'book', 'book', 'best', 'best'])
    expect(r.moves[4].opening?.name).toBe("King's Pawn Game: Wayward Queen Attack")
    expect(r.moves[5].opening).toBeNull()
  })
})

describe('rule 2: forced moves and mate are best', () => {
  it('keeps a forced move best even when the evals disagree', () => {
    const r = review(opera, { 31: searched(line(cp(0), 'e6e5')), 32: searched(line(mate('w', 1), 'd1d8')) })
    expect(r.game.positions[31].kind === 'playable' && r.game.positions[31].legalMoves).toBe(1)
    expect(r.moves[31].classification).toBe('best')
  })

  it('labels delivering mate best even when the engine preferred another line', () => {
    expect(labelOf(scholar, 6, { 6: searched(line(cp(300), 'c4b5'), line(cp(0), 'h5f7')) })).toBe('best')
  })
})

describe('rule 3: brilliant', () => {
  const before = (second: Score) => searched(line(mate('w', 2), 'b3b8'), line(second, 'd1d6'))

  it('rewards a sound queen sacrifice that only the engine line wins', () => {
    expect(labelOf(opera, 30, { 30: before(cp(300)), 31: searched(line(mate('w', 1), 'd7b8')) })).toBe('brilliant')
  })

  it('is not brilliant when the sacrifice leaves the mover worse', () => {
    expect(labelOf(opera, 30, { 30: before(cp(300)), 31: searched(line(cp(-300), 'd7b8')) })).toBe('great')
  })

  it('demotes the sacrifice to best when the quiet line 2 also wins', () => {
    expect(labelOf(opera, 30, { 30: before(mate('w', 4)), 31: searched(line(mate('w', 1), 'd7b8')) })).toBe('best')
  })

  it('sees the queen left en prise by 16.Qb8+ and not the free retreat 4.Qf3', () => {
    const game = parse(opera)
    expect(isSacrifice(game.moves[30])).toBe(true)
    expect(isSacrifice(game.moves[16])).toBe(false)
    expect(isSacrifice(parse(QUEEN_CHASED).moves[6])).toBe(false)
  })
})

describe('rule 4: great', () => {
  const onlyMove = (uci: string) => searched(line(cp(150), uci), line(cp(-150), '0000'))

  it('marks the only good quiet move great', () => {
    expect(labelOf(opera, 16, { 16: onlyMove('c1g5'), 17: searched(line(cp(150), 'b7b5')) })).toBe('great')
  })

  it('does not call an obvious recapture great', () => {
    // 15...Nxd7 takes back the bishop; the knight on f6 was defended, so this is not also an escape.
    const evals = { 29: searched(line(cp(150), 'f6d7'), line(cp(600), 'e6d7')), 30: searched(line(cp(150), 'b3b8')) }
    expect(labelOf(opera, 29, evals)).toBe('best')
  })

  it('still lets a king stepping out of check be great', () => {
    const evals = { 0: searched(line(cp(-300), 'e1d2'), line(cp(-900), 'e1f1')), 1: searched(line(cp(-300), 'e8d8')) }
    expect(labelOf('[SetUp "1"]\n[FEN "4q1k1/8/8/8/8/8/8/4K3 w - - 0 1"]\n\n1. Kd2 *', 0, evals)).toBe('great')
  })

  it('does not call moving an attacked queen away great', () => {
    expect(labelOf(QUEEN_CHASED, 6, { 6: onlyMove('h5f3'), 7: searched(line(cp(150), 'g8f6')) })).toBe('best')
  })
})

describe('rule 5: best', () => {
  it('labels the top move best when line 2 is close', () => {
    const evals = { 16: searched(line(cp(150), 'c1g5'), line(cp(100), 'c3d5')), 17: searched(line(cp(150), 'b7b5')) }
    expect(labelOf(opera, 16, evals)).toBe('best')
  })
})

describe('rule 6: miss', () => {
  // 9...b5 throws the game away (+4 for White), then 10.Nxb5 gives most of it back.
  const after = (white: number) => ({
    17: searched(line(cp(0), 'e7e6'), line(cp(-20), 'h7h6')),
    18: searched(line(cp(400), 'c4b5'), line(cp(300), 'c4d3')),
    19: searched(line(cp(white), 'c6b5')),
  })

  it('labels a squandered chance a miss while the mover stays ahead', () => {
    expect(labelOf(opera, 18, after(100))).toBe('miss')
  })

  it('keeps it a blunder when the advantage is gone', () => {
    expect(labelOf(opera, 18, after(-100))).toBe('blunder')
  })

  it('never counts the opponent\'s top move as handing over a chance', () => {
    expect(labelOf(opera, 18, { ...after(100), 17: searched(line(cp(0), 'b7b5'), line(cp(-20), 'h7h6')) })).toBe('blunder')
  })
})

describe('rules 7 to 11: loss bands', () => {
  // Line 1 keeps the balance; 1.e4 leaves White worse by the given centipawns.
  it.each([
    [-11, 'excellent'],
    [-33, 'good'],
    [-77, 'inaccuracy'],
    [-165, 'mistake'],
    [-340, 'blunder'],
  ] as const)('labels a drop to %i cp %s', (white, label) => {
    const evals = { 0: searched(line(cp(0), 'd2d4'), line(cp(0), 'g1f3')), 1: searched(line(cp(white), 'e7e5')) }
    expect(labelOf(scholar, 0, evals)).toBe(label)
  })
})

describe('mate edge cases', () => {
  const quiet = (best: Score, after: Score) => ({
    4: searched(line(best, 'h5f7'), line(cp(0), 'd1e2')),
    5: searched(line(after, 'g8f6')),
  })

  it('delivering mate is best', () => {
    expect(labelOf(scholar, 6, { 6: searched(line(mate('w', 1), 'h5f7'), line(cp(500), 'c4b5')) })).toBe('best')
  })

  it('keeping a forced mate at a longer distance loses nothing', () => {
    expect(labelOf(scholar, 4, quiet(mate('w', 3), mate('w', 5)))).toBe('excellent')
  })

  it('losing a forced mate while staying at +6 is a miss', () => {
    expect(labelOf(scholar, 4, quiet(mate('w', 3), cp(600)))).toBe('miss')
  })

  it('allowing mate from an equal position is a blunder', () => {
    expect(labelOf(scholar, 4, quiet(cp(0), mate('b', 2)))).toBe('blunder')
  })

  it('being mated already means no move could lose anything', () => {
    const evals = { 5: searched(line(mate('w', 1), 'd8e7'), line(mate('w', 1), 'g8h6')), 6: searched(line(mate('w', 1), 'h5f7')) }
    expect(labelOf(scholar, 5, evals)).toBe('excellent')
  })

  it('stalemating a beaten opponent is a blunder', () => {
    expect(labelOf(STALEMATE_TRAP, 0, { 0: searched(line(mate('w', 1), 'f1f8'), line(mate('w', 2), 'f1f6')) })).toBe('blunder')
  })

  it('cannot tell +10 from a forced mate', () => {
    expect(labelOf(scholar, 4, quiet(mate('w', 3), cp(1500)))).toBe('excellent')
  })
})
