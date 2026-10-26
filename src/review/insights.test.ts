import { describe, expect, it } from 'vitest'
import {
  CLASSIFICATIONS,
  type Classification,
  type Color,
  type Division,
  type EngineId,
  type GameId,
  type GameResult,
  type LibraryRecord,
  type Phase,
  type PhaseErrors,
} from '../domain'
import { weaknesses } from '.'

const ME = { accounts: [{ site: 'lichess', username: 'gabrielhom' }] } as const
const NO_COUNTS = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>
const NONE: PhaseErrors = { mistake: 0, blunder: 0, miss: 0 }

type Mine = {
  color?: Color
  result?: GameResult
  day?: number
  acc?: number
  opening?: [eco: string, name: string] | null
  counts?: Partial<Record<Classification, number>>
  phases?: Record<Phase, number | null> | null
  phaseErrors?: Record<Phase, PhaseErrors> | null
  division?: Division | null
  bookExit?: number | null
}

/** A game of mine on lichess, played on `day`; the opponent's side of the summary is filler. */
function game(id: string, m: Mine = {}): LibraryRecord {
  const color = m.color ?? 'w'
  const other = color === 'w' ? 'b' : 'w'
  const mine = { ...NO_COUNTS, book: 6, good: 12, ...m.counts }
  const opening = m.opening === undefined ? ['C41', 'Philidor Defense'] : m.opening
  const byColor = <T,>(mineV: T, theirs: T) => (color === 'w' ? { w: mineV, b: theirs } : { w: theirs, b: mineV })
  const phases = m.phases === undefined ? null : m.phases
  const phaseErrors = m.phaseErrors === undefined ? null : m.phaseErrors
  return {
    v: 1,
    id: `lichess:${id}` as GameId,
    source: { kind: 'lichess', id, url: `https://lichess.org/${id}` },
    players: { [color]: { name: 'gabrielhom', rating: 1500 }, [other]: { name: `rival-${id}`, rating: 1500 } } as LibraryRecord['players'],
    result: m.result ?? '1-0',
    playedAt: (m.day ?? 1) * 86_400_000,
    reviewedAt: 0,
    pgn: '1. e4 *',
    profile: { engine: 'sf19/nn-61e7af4bb97d' as EngineId, limit: { kind: 'depth', depth: 18 } },
    summary: {
      classifierVersion: 1,
      accuracy: byColor<number | null>(m.acc ?? 80, 50),
      counts: byColor(mine, { ...NO_COUNTS, good: 30 }),
      opening: opening && { eco: opening[0], name: opening[1] },
      phases: phases && byColor(phases, { opening: 0, middlegame: 0, endgame: 0 }),
      division: m.division === undefined ? null : m.division,
      phaseErrors: phaseErrors && byColor(phaseErrors, { opening: { mistake: 9, blunder: 9, miss: 9 }, middlegame: NONE, endgame: NONE }),
      bookExit: m.bookExit === undefined ? null : m.bookExit,
    },
  }
}

describe('weaknesses: openings', () => {
  it('groups my games by opening family and color, with score, accuracy and the games newest first', () => {
    const { openings } = weaknesses(
      [
        game('s1', { color: 'b', result: '1-0', day: 1, acc: 70, opening: ['B90', 'Sicilian Defense: Najdorf Variation'] }),
        game('s2', { color: 'b', result: '1/2-1/2', day: 2, acc: 74, opening: ['B33', 'Sicilian Defense: Sveshnikov Variation'] }),
        game('s3', { color: 'b', result: '0-1', day: 3, acc: 78, opening: ['B20', 'Sicilian Defense'] }),
        game('w1', { color: 'w', result: '1-0', day: 4, acc: 90, opening: ['B20', 'Sicilian Defense'] }),
        game('none', { day: 5, opening: null }),
      ],
      ME,
    )
    expect(openings.unnamed).toBe(1)
    expect(openings.groups).toEqual([
      {
        name: 'Sicilian Defense',
        eco: 'B20–B90',
        color: 'b',
        games: ['lichess:s3', 'lichess:s2', 'lichess:s1'],
        score: 0.5,
        accuracy: 74,
        bookExit: { known: 0, worse: 0 },
        verdict: 'fine',
      },
      { name: 'Sicilian Defense', eco: 'B20', color: 'w', games: ['lichess:w1'], score: 1, accuracy: 90, bookExit: { known: 0, worse: 0 }, verdict: 'few' },
    ])
  })

  it('flags an opening I score 40% or less in, or play 5 points under my average in, once it has 3 games', () => {
    const french = (id: string, result: GameResult, acc = 80) => game(id, { color: 'b', result, acc, opening: ['C11', 'French Defense: Classical Variation'] })
    const italian = (id: string, acc: number) => game(id, { color: 'w', result: '1-0', acc, opening: ['C50', 'Italian Game'] })
    const caro = (id: string, result: GameResult) => game(id, { color: 'b', result, opening: ['B12', 'Caro-Kann Defense: Advance Variation'] })
    const london = (id: string) => game(id, { color: 'w', result: '0-1', opening: ['D02', 'London System'] })
    const { openings } = weaknesses(
      [
        ...[french('f1', '0-1'), french('f2', '1/2-1/2'), french('f3', '1-0')],
        ...[italian('i1', 70), italian('i2', 72), italian('i3', 74)],
        ...[caro('c1', '1-0'), caro('c2', '1-0'), caro('c3', '1/2-1/2')],
        ...[london('l1'), london('l2')],
      ],
      ME,
    )
    // My average is 77.8: the Italian sits more than 5 under it though I won every game. Two London losses are too few to judge.
    expect(openings.groups.map((g) => [g.name, Math.round(g.score! * 100), g.verdict])).toEqual([
      ['Caro-Kann Defense', 17, 'weak'],
      ['Italian Game', 100, 'weak'],
      ['French Defense', 50, 'fine'],
      ['London System', 0, 'few'],
    ])
  })

  it('counts the games I was already a pawn down in when theory ended, from my side of the board', () => {
    const { openings } = weaknesses(
      [
        game('a', { color: 'b', bookExit: 65 }),
        game('b', { color: 'b', bookExit: 55 }),
        game('c', { color: 'b', bookExit: 30 }),
        game('d', { color: 'b', bookExit: null }),
      ],
      ME,
    )
    expect(openings.groups[0].bookExit).toEqual({ known: 3, worse: 1 })
  })

  it('leaves out games I did not play and games too short to count', () => {
    const stranger = { ...game('x'), players: { w: { name: 'a', rating: null }, b: { name: 'b', rating: null } } }
    const short = game('short', { counts: { book: 20, good: 3 } })
    const result = weaknesses([stranger, short, game('mine')], ME)
    expect([result.games, result.shortGames, result.openings.groups.map((g) => g.games)]).toEqual([1, 1, [['lichess:mine']]])
  })
})

describe('weaknesses: phases', () => {
  const phases = (opening: number | null, middlegame: number | null, endgame: number | null) => ({ opening, middlegame, endgame })

  it('averages my accuracy per phase and ranks it among Lichess players, with no verdict under 5 games', () => {
    const { phases: p } = weaknesses(
      [
        game('a', { day: 1, phases: phases(85, 66.8, null) }),
        game('b', { day: 2, color: 'b', phases: phases(85, 66.8, 90) }),
        game('old', { day: 3 }),
      ],
      ME,
    )
    expect([p.byPhase.opening.games, p.byPhase.opening.accuracy, Math.round(p.byPhase.opening.percentile!)]).toEqual([2, 85, 37])
    expect([p.byPhase.middlegame.games, p.byPhase.middlegame.accuracy, Math.round(p.byPhase.middlegame.percentile!)]).toEqual([2, 66.8, 27])
    expect([p.byPhase.endgame.games, p.byPhase.endgame.accuracy]).toEqual([1, 90])
    expect(p.weakest).toBeNull()
  })

  it('names the phase where my games rank lowest once two phases have 5 games, not the one with the lowest accuracy', () => {
    // 85 in the opening ranks at 37%; 78.1 in the middlegame, lower, still ranks at 50%.
    const games = [1, 2, 3, 4, 5].map((day) => game(`g${day}`, { day, phases: phases(85, 78.1, null) }))
    const { phases: p } = weaknesses(games, ME)
    expect(p.weakest).toBe('opening')
  })

  it('compares my last 5 games in a phase with the 5 before them', () => {
    const games = [70, 70, 70, 70, 70, 80, 80, 80, 80, 90, 90].map((acc, day) => game(`g${day}`, { day, phases: phases(null, acc, null) }))
    expect(weaknesses(games, ME).phases.byPhase.middlegame.trend).toEqual({ recent: 84, previous: 72 })
    expect(weaknesses(games.slice(0, 9), ME).phases.byPhase.middlegame.trend).toBeNull()
  })

  it('points at my least accurate recent game in a phase, opened where the phase starts', () => {
    const division = { middlegame: 20, endgame: 61 }
    const { byPhase } = weaknesses(
      [
        game('ancient', { day: 1, phases: phases(40, 40, 40), division }),
        ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((day) => game(`g${day}`, { day, phases: phases(90, 80, 85), division })),
        game('bad', { day: 11, counts: { book: 7 }, phases: phases(70, 60, 75), division: { middlegame: 24, endgame: 70 } }),
        game('before-division', { day: 12, phases: phases(95, 50, 50) }),
      ],
      ME,
    ).phases
    // The opening starts where theory ends, which needs no division: 7 book moves, all mine here.
    expect(byPhase.opening.worst).toEqual({ gameId: 'lichess:bad', opponent: 'rival-bad', ply: 7, accuracy: 70 })
    expect(byPhase.middlegame.worst).toEqual({ gameId: 'lichess:bad', opponent: 'rival-bad', ply: 24, accuracy: 60 })
    expect(byPhase.endgame.worst).toEqual({ gameId: 'lichess:bad', opponent: 'rival-bad', ply: 70, accuracy: 75 })
  })

  it('counts my errors per game in a phase over the games saved with them', () => {
    const { phases: p } = weaknesses(
      [
        game('a', { phases: phases(90, 70, null), phaseErrors: { opening: NONE, middlegame: { mistake: 1, blunder: 2, miss: 0 }, endgame: NONE } }),
        game('b', { color: 'b', phases: phases(90, 70, null), phaseErrors: { opening: { mistake: 1, blunder: 0, miss: 0 }, middlegame: { mistake: 0, blunder: 0, miss: 1 }, endgame: NONE } }),
        game('before-errors', { phases: phases(90, 70, null) }),
      ],
      ME,
    )
    expect(p.byPhase.opening.errors).toEqual({ games: 2, perGame: { mistake: 0.5, blunder: 0, miss: 0 } })
    expect(p.byPhase.middlegame.errors).toEqual({ games: 2, perGame: { mistake: 0.5, blunder: 1, miss: 0.5 } })
    expect(p.byPhase.endgame.errors).toBeNull()
    expect(p.withoutPhaseErrors).toBe(1)
  })
})

describe('weaknesses: errors', () => {
  it('follows my errors per game with a rolling average over the last 5 games', () => {
    const totals = [0, 2, 4, 2, 2, 6, 0]
    const { points } = weaknesses(totals.map((n, day) => game(`g${day}`, { day, counts: { mistake: n / 2, blunder: n / 2 } })), ME).errors
    expect(points.map((p) => p.rolling)).toEqual([0, 1, 2, 2, 2, 3.2, 2.8])
    expect(points[1]).toMatchObject({ gameId: 'lichess:g1', errors: { mistake: 1, blunder: 1, miss: 0 } })
  })

  it('compares my errors per game in the last 5 games with the 5 before them', () => {
    const games = [3, 3, 3, 3, 3, 1, 1, 1, 1, 1].map((n, day) => game(`g${day}`, { day, counts: { miss: n } }))
    expect(weaknesses(games, ME).errors.trend).toEqual({ recent: 1, previous: 3 })
  })

  it('lists my losses with a blunder, newest first', () => {
    const { errors } = weaknesses(
      [
        game('lost-blunder', { day: 1, color: 'w', result: '0-1', counts: { blunder: 1 } }),
        game('lost-clean', { day: 2, color: 'w', result: '0-1' }),
        game('won-blunder', { day: 3, color: 'b', result: '0-1', counts: { blunder: 2 } }),
        game('lost-blunder-black', { day: 4, color: 'b', result: '1-0', counts: { blunder: 1 } }),
      ],
      ME,
    )
    expect([errors.losses, errors.withBlunder, errors.lossesWithBlunder]).toEqual([3, 3, ['lichess:lost-blunder-black', 'lichess:lost-blunder']])
  })
})
