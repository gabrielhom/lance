import { describe, expect, it } from 'vitest'
import type { Fen, Puzzle, PuzzleAttempt, PuzzleId, PuzzleTheme, Uci } from '../domain'
import { nextPuzzle, playerRating, puzzleLine, puzzleSide, rate, START, stepAttempt, type AttemptEvent, type AttemptState } from './puzzles'

/** Lichess puzzle 05AVd: after ...Rf8, Bxg7+ Nxg7 Qxf8#. Qxg7# mates too. */
const PUZZLE: Puzzle = {
  id: '05AVd' as PuzzleId,
  fen: 'r6k/p3RQbp/2pq2pB/1p5n/8/2N4P/PP3PP1/6K1 b - - 2 23' as Fen,
  moves: ['a8f8', 'h6g7', 'h5g7', 'f7f8'] as [Uci, Uci, Uci, Uci],
  rating: 1262,
  themes: ['fork', 'mate', 'mateIn2', 'middlegame'],
  gameUrl: 'https://lichess.org/gFIz2Iat/black#46',
}

const reply: AttemptEvent = { kind: 'reply' }
const move = (uci: string): AttemptEvent => ({ kind: 'move', uci: uci as Uci })
const run = (events: readonly AttemptEvent[]): AttemptState => events.reduce((s, e) => stepAttempt(PUZZLE, s, e), START)

describe('stepAttempt', () => {
  it('plays the setup move, takes the line, answers it and ends solved on the last move', () => {
    expect(run([reply])).toEqual({ phase: 'player', played: ['a8f8'] })
    expect(run([reply, move('h6g7')])).toEqual({ phase: 'opponent', played: ['a8f8', 'h6g7'] })
    expect(run([reply, move('h6g7'), reply])).toEqual({ phase: 'player', played: ['a8f8', 'h6g7', 'h5g7'] })
    expect(run([reply, move('h6g7'), reply, move('f7f8')])).toEqual({ phase: 'solved', played: ['a8f8', 'h6g7', 'h5g7', 'f7f8'] })
  })

  it('accepts another mate where the line mates', () => {
    expect(run([reply, move('h6g7'), reply, move('f7g7')])).toEqual({ phase: 'solved', played: ['a8f8', 'h6g7', 'h5g7', 'f7g7'] })
  })

  it('fails on a move off the line where the line does not mate, even a check', () => {
    expect(run([reply, move('f7f8')])).toEqual({ phase: 'failed', played: ['a8f8'], wrong: 'f7f8' })
  })

  it('fails on a move that does not mate where the line mates', () => {
    expect(run([reply, move('h6g7'), reply, move('e7e8')])).toEqual({ phase: 'failed', played: ['a8f8', 'h6g7', 'h5g7'], wrong: 'e7e8' })
  })

  it('fails when the player gives up', () => {
    expect(run([reply, move('h6g7'), reply, { kind: 'give-up' }])).toEqual({ phase: 'failed', played: ['a8f8', 'h6g7', 'h5g7'], wrong: null })
  })

  it('ignores an illegal move, a move while the opponent is to play and anything after the end', () => {
    expect(run([reply, move('h6h1')])).toEqual({ phase: 'player', played: ['a8f8'] })
    expect(run([move('h6g7')])).toEqual(START)
    expect(run([reply, move('f7f8'), move('h6g7'), reply])).toEqual({ phase: 'failed', played: ['a8f8'], wrong: 'f7f8' })
  })

  it('solves for the side the setup move hands the turn to', () => {
    expect(puzzleSide(PUZZLE)).toBe('w')
  })

  it('writes the line in SAN with plies counted from the start of the game', () => {
    expect(puzzleLine(PUZZLE)).toEqual([
      { ply: 45, san: 'Rf8' },
      { ply: 46, san: 'Bxg7+' },
      { ply: 47, san: 'Nxg7' },
      { ply: 48, san: 'Qxf8#' },
    ])
  })
})

describe('rating', () => {
  it('moves a new player a lot on the first puzzle, by the expected score', () => {
    expect(rate({ rating: 1500, played: 0 }, 1500, true)).toEqual({ rating: 1580, played: 1 })
    expect(rate({ rating: 1500, played: 0 }, 1900, false).rating).toBeCloseTo(1485.4545, 4)
  })

  it('settles at K 16 after many puzzles', () => {
    expect(rate({ rating: 2000, played: 100 }, 2000, true)).toEqual({ rating: 2008, played: 101 })
  })

  it('replays the attempts in the order they happened, whatever order they come in', () => {
    const attempts: PuzzleAttempt[] = [
      { id: 'b' as PuzzleId, at: 2000, solved: false, puzzleRating: 1500 },
      { id: 'a' as PuzzleId, at: 1000, solved: true, puzzleRating: 1500 },
    ]
    const { rating, played } = playerRating(attempts)
    expect([rating.toFixed(4), played]).toEqual(['1498.2484', 2])
    expect(playerRating([])).toEqual({ rating: 1500, played: 0 })
  })
})

describe('nextPuzzle', () => {
  const at = (id: string, rating: number, themes: PuzzleTheme[] = []): Puzzle => ({ ...PUZZLE, id: id as PuzzleId, rating, themes })
  const POOL = [at('a', 1500), at('b', 1580), at('c', 1700), at('d', 2100, ['fork'])]
  const done = (...ids: [string, number][]): PuzzleAttempt[] => ids.map(([id, t]) => ({ id: id as PuzzleId, at: t, solved: true, puzzleRating: 1500 }))
  const pick = (attempts: PuzzleAttempt[], theme: PuzzleTheme | null = null, r = 0) => nextPuzzle(POOL, attempts, 1520, theme, () => r)?.id ?? null

  it('picks at random among the fresh puzzles within 100 points', () => {
    expect([pick([], null, 0), pick([], null, 0.99)]).toEqual(['a', 'b'])
  })

  it('widens the window before repeating a puzzle', () => {
    expect(pick(done(['a', 1], ['b', 2]))).toBe('c')
  })

  it('repeats the puzzle done longest ago once every one within 400 points is done', () => {
    expect(pick(done(['a', 3], ['b', 1], ['c', 2]))).toBe('b')
  })

  it('keeps to the theme, going as far as it takes', () => {
    expect(pick([], 'fork')).toBe('d')
    expect(pick(done(['d', 1]), 'fork')).toBe('d')
    expect(pick([], 'pin')).toBe(null)
  })
})
