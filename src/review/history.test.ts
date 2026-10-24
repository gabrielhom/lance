import { describe, expect, it } from 'vitest'
import { CLASSIFICATIONS, type EngineId, type GameId, type GameSource, type LibraryRecord } from '../domain'
import { accuracyHistory } from '.'

const NO_COUNTS = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as LibraryRecord['summary']['counts']['w']
const counts = (c: Partial<typeof NO_COUNTS>) => ({ ...NO_COUNTS, ...c })
const FULL = counts({ book: 6, good: 12 })

function record(id: string, white: string, black: string, opts: Partial<LibraryRecord> & { acc?: [number | null, number | null]; counts?: LibraryRecord['summary']['counts']; phases?: LibraryRecord['summary']['phases'] }): LibraryRecord {
  const source: GameSource = opts.source ?? { kind: 'lichess', id, url: `https://lichess.org/${id}` }
  return {
    v: 1,
    id: `${source.kind}:${id}` as GameId,
    source,
    players: { w: { name: white, rating: 1500 }, b: { name: black, rating: 1600 } },
    result: opts.result ?? '1-0',
    playedAt: opts.playedAt === undefined ? 1000 : opts.playedAt,
    reviewedAt: opts.reviewedAt ?? 5000,
    pgn: '1. e4 *',
    profile: { engine: 'sf19/nn-61e7af4bb97d' as EngineId, limit: { kind: 'depth', depth: 18 } },
    summary: {
      classifierVersion: 1,
      accuracy: { w: opts.acc ? opts.acc[0] : 80, b: opts.acc ? opts.acc[1] : 70 },
      counts: opts.counts ?? { w: FULL, b: FULL },
      opening: null,
      phases: opts.phases ?? null,
      division: null,
      phaseErrors: null,
      bookExit: null,
    },
  }
}

describe('accuracyHistory', () => {
  const identity = { accounts: [{ site: 'lichess', username: 'gabrielhom' }] } as const

  it('plots my accuracy with my color and opponent, oldest first', () => {
    const { points } = accuracyHistory(
      [
        record('new', 'rival', 'GabrielHom', { playedAt: 3000, result: '0-1', acc: [60, 91] }),
        record('old', 'gabrielhom', 'rival', { playedAt: 2000 }),
      ],
      identity,
    )
    expect(points.map((p) => ({ ...p, elo: undefined }))).toEqual([
      { gameId: 'lichess:old', playedAt: 2000, color: 'w', accuracy: 80, result: '1-0', opponent: { name: 'rival', rating: 1600 } },
      { gameId: 'lichess:new', playedAt: 3000, color: 'b', accuracy: 91, result: '0-1', opponent: { name: 'rival', rating: 1500 } },
    ])
    expect(points[1].elo!.elo).toBeGreaterThan(points[0].elo!.elo)
  })

  it('leaves out games I did not play, other sites, and moves I never made', () => {
    const chesscom: GameSource = { kind: 'chesscom', uuid: 'u', url: 'https://www.chess.com/game/live/1' }
    const { points } = accuracyHistory(
      [
        record('a', 'someone', 'else', {}),
        record('b', 'gabrielhom', 'x', { source: chesscom }),
        record('c', 'gabrielhom', 'x', { acc: [null, 50] }),
      ],
      identity,
    )
    expect(points).toEqual([])
  })

  it('places an undated game at the time it was reviewed', () => {
    const [point] = accuracyHistory([record('p', 'gabrielhom', 'x', { playedAt: null, reviewedAt: 7777 })], identity).points
    expect(point.playedAt).toBe(7777)
  })

  it('counts a game played in Lance with no account set', () => {
    const played: GameSource = { kind: 'played', id: 'k3x9', you: 'b' }
    const { points } = accuracyHistory([record('k3x9', 'Stockfish (Iniciante)', 'Você', { source: played, acc: [99, 64] })], { accounts: [] })
    expect(points).toMatchObject([{ gameId: 'played:k3x9', color: 'b', accuracy: 64, opponent: { name: 'Stockfish (Iniciante)' } }])
  })

  it('leaves out games with fewer than 10 of my moves outside theory and counts them', () => {
    const short = { w: counts({ book: 2 }), b: counts({ good: 9, book: 20 }) }
    const edge = { w: counts({ good: 4, inaccuracy: 3, blunder: 3, book: 1 }), b: FULL }
    const history = accuracyHistory(
      [
        record('twomoves', 'gabrielhom', 'x', { counts: short, acc: [100, 50] }),
        record('nine', 'x', 'gabrielhom', { counts: short, playedAt: 2000, acc: [50, 88] }),
        record('ten', 'gabrielhom', 'x', { counts: edge, playedAt: 3000, acc: [71, 50] }),
        record('stranger', 'a', 'b', { counts: short }),
      ],
      identity,
    )
    expect(history.points.map((p) => [p.gameId, p.accuracy])).toEqual([['lichess:ten', 71]])
    expect(history.shortGames).toBe(2)
  })

  it('averages my accuracy per phase over counted games that have it', () => {
    const short = { w: counts({ book: 2 }), b: FULL }
    const { phases } = accuracyHistory(
      [
        record('a', 'gabrielhom', 'x', { phases: { w: { opening: 90, middlegame: 70, endgame: null }, b: { opening: 10, middlegame: 10, endgame: 10 } } }),
        record('b', 'x', 'gabrielhom', { phases: { w: { opening: 10, middlegame: 10, endgame: 10 }, b: { opening: 96, middlegame: 80, endgame: 66 } } }),
        record('saved-before-phases', 'gabrielhom', 'x', {}),
        record('short', 'gabrielhom', 'x', { counts: short, phases: { w: { opening: 0, middlegame: 0, endgame: 0 }, b: { opening: 0, middlegame: 0, endgame: 0 } } }),
      ],
      identity,
    )
    expect(phases).toEqual({
      opening: { accuracy: 93, games: 2 },
      middlegame: { accuracy: 75, games: 2 },
      endgame: { accuracy: 66, games: 1 },
    })
  })
})
