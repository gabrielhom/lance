import { describe, expect, it } from 'vitest'
import analysed from './fixtures/lichess-thibault-analysed.ndjson?raw'
import { gameFromPgn, type Game, type PositionKey, type Score, type SearchedEval, type Uci } from '../domain'
import { completeEvals, gameAccuracy, moveAccuracy, winPct, type CompleteEvals } from '.'

type LichessEval = { eval?: number; mate?: number }
type LichessGame = {
  id: string
  pgn: string
  analysis: LichessEval[]
  players: { white: { analysis: { accuracy: number } }; black: { analysis: { accuracy: number } } }
}

const NO_PV = ['0000' as Uci] as const

function parse(pgn: string): Game {
  const r = gameFromPgn(pgn, { kind: 'pgn' })
  if (!r.ok) throw new Error(r.error.detail)
  return r.value
}

/** Scores per position index; positions without one must be terminal. */
function evalsFrom(game: Game, scores: readonly (Score | undefined)[]): CompleteEvals {
  const found = new Map<PositionKey, SearchedEval>()
  for (const p of game.positions) {
    const score = scores[p.index]
    if (p.kind === 'playable' && score) found.set(p.key, { depth: 20, lines: [{ score, pv: NO_PV }] })
  }
  const r = completeEvals(game, found)
  if (!r.ok) throw new Error(`missing ${r.error.missing.map((p) => p.index).join(',')}`)
  return r.value
}

const cp = (white: number): Score => ({ kind: 'cp', white })
const fromLichess = (e: LichessEval): Score =>
  e.mate !== undefined ? { kind: 'mate', winner: e.mate > 0 ? 'w' : 'b', moves: Math.abs(e.mate) } : cp(e.eval ?? 0)

describe('gameAccuracy against Lichess published accuracy', () => {
  const games = analysed.trim().split('\n').map((line) => JSON.parse(line) as LichessGame)

  it.each(games.map((g) => [g.id, g] as const))('rounds to the published accuracy of game %s', (_, g) => {
    const game = parse(g.pgn)
    // Lichess seeds the start with cp 15; the first move's accuracy is 100 either way.
    const evals = evalsFrom(game, [cp(15), ...g.analysis.map(fromLichess)])
    const ours = gameAccuracy(game, evals)
    expect({ w: Math.round(ours.w ?? NaN), b: Math.round(ours.b ?? NaN) }).toEqual({
      w: g.players.white.analysis.accuracy,
      b: g.players.black.analysis.accuracy,
    })
  })
})

describe('gameAccuracy on Lichess test cases', () => {
  const shuffle = (plies: number) => {
    const cycle = ['Nf3', 'Nf6', 'Ng1', 'Ng8']
    return parse(Array.from({ length: plies }, (_, i) => cycle[i % 4]).join(' ') + ' *')
  }
  const accuracyOf = (cps: readonly number[]) => {
    const game = shuffle(cps.length)
    return gameAccuracy(game, evalsFrom(game, [cp(15), ...cps.map(cp)]))
  }

  it('gives no accuracy to a side without moves', () => {
    expect(accuracyOf([15])).toEqual({ w: 100, b: null })
  })

  it('scores a first-move blunder near 10 and the reply near 100', () => {
    const a = accuracyOf([-900, -900])
    expect(a.w).toBeCloseTo(10, -1)
    expect(a.b).toBeGreaterThanOrEqual(99)
  })

  it('weighs one blunder after 20 perfect moves to about 50', () => {
    const a = accuracyOf([...Array(20).fill(15), -900])
    expect(Math.abs((a.w ?? 0) - 50)).toBeLessThanOrEqual(5)
    expect(a.b).toBeGreaterThanOrEqual(99)
  })

  it('puts 65 centipawn losses on each side near 76', () => {
    const a = accuracyOf(Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? -50 : 15)))
    expect(Math.abs((a.w ?? 0) - 76)).toBeLessThanOrEqual(8)
    expect(Math.abs((a.b ?? 0) - 76)).toBeLessThanOrEqual(8)
  })
})

describe('winPct and moveAccuracy', () => {
  it('treats any mate as the cp ceiling for the winner', () => {
    expect(winPct({ kind: 'mate', winner: 'w', moves: 3 }, 'w')).toBeCloseTo(97.5, 1)
    expect(winPct({ kind: 'mate', winner: 'w', moves: 3 }, 'b')).toBeCloseTo(2.5, 1)
    expect(winPct(cp(1500), 'w')).toBe(winPct({ kind: 'mate', winner: 'w', moves: 9 }, 'w'))
    expect(winPct({ kind: 'checkmate', loser: 'b' }, 'w')).toBe(winPct(cp(1000), 'w'))
    expect(winPct({ kind: 'stalemate' }, 'b')).toBe(50)
  })

  it('reads a searched eval from its best line', () => {
    const lines = [{ score: cp(-200), pv: NO_PV }, { score: cp(-400), pv: NO_PV }] as const
    expect(winPct({ kind: 'searched', depth: 18, lines }, 'b')).toBe(winPct(cp(-200), 'b'))
  })

  it('gives 100 for no loss and falls toward 0 for a lost game', () => {
    expect(moveAccuracy(winPct(cp(0), 'w'), winPct(cp(50), 'w'))).toBe(100)
    expect(moveAccuracy(winPct(cp(0), 'w'), winPct(cp(-30), 'w'))).toBeGreaterThan(85)
    expect(moveAccuracy(winPct(cp(1000), 'w'), winPct(cp(-1000), 'w'))).toBe(0)
  })
})
