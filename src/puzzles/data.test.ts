import { describe, expect, it } from 'vitest'
import { PUZZLE_THEMES } from '../domain'
import { fromTuple, parsePuzzleRow, toTuple, type PuzzleFile } from './data'
import { puzzleSide, replay } from './puzzles'
import file from './puzzles.json'

const ROW =
  '00sHx,q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17,e8d7 a2e6 d7d8 f7f8,1760,80,83,72,mate mateIn2 middlegame short,https://lichess.org/yyznGmXs/black#34,Italian_Game Italian_Game_Classical_Variation,'
const PUZZLE = {
  id: '00sHx',
  fen: 'q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17',
  moves: ['e8d7', 'a2e6', 'd7d8', 'f7f8'],
  rating: 1760,
  themes: ['mate', 'mateIn2', 'middlegame'],
  gameUrl: 'https://lichess.org/yyznGmXs/black#34',
}
const withColumn = (i: number, value: string) => ROW.split(',').map((c, j) => (j === i ? value : c)).join(',')

describe('parsePuzzleRow', () => {
  it('reads a row of the Lichess database, dropping themes the app does not name', () => {
    expect(parsePuzzleRow(ROW)).toEqual({ puzzle: PUZZLE, quality: { popularity: 83, plays: 72, deviation: 80 } })
  })

  it.each([
    ['the header', 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate'],
    ['a game URL over http', withColumn(8, 'http://lichess.org/yyznGmXs/black#34')],
    ['a game URL on another site', withColumn(8, 'https://lichess.org.evil.com/yyznGmXs#34')],
    ['a game URL with a script', withColumn(8, 'javascript:alert(1)')],
    ['an illegal move', withColumn(2, 'e8d7 a2e6 d7d8 f7f1')],
    ['a line that ends on the opponent', withColumn(2, 'e8d7 a2e6 d7d8')],
    ['a bad FEN', withColumn(1, 'not a fen')],
    ['a rating that is not a number', withColumn(3, 'abc')],
    ['a truncated row', ROW.split(',').slice(0, 5).join(',')],
  ])('rejects %s', (_, line) => {
    expect(parsePuzzleRow(line)).toBe(null)
  })

  it('round-trips a puzzle through the bundled row', () => {
    const p = parsePuzzleRow(ROW)!.puzzle
    expect(toTuple(p)).toEqual(['00sHx', PUZZLE.fen, 'e8d7 a2e6 d7d8 f7f8', 1760, 'mate mateIn2 middlegame', PUZZLE.gameUrl])
    expect(fromTuple(toTuple(p))).toEqual(p)
    expect(fromTuple(toTuple({ ...p, themes: [] })).themes).toEqual([])
  })
})

describe('the bundled puzzles', () => {
  const { puzzles: rows, source, license } = file as unknown as PuzzleFile
  const puzzles = rows.map(fromTuple)

  it('come from the CC0 Lichess database, 150 in each 100-point band from 400 to 2799', () => {
    expect({ source, license, count: puzzles.length }).toEqual({ source: 'https://database.lichess.org/lichess_db_puzzle.csv.zst', license: 'CC0', count: 3600 })
    const bands = new Map<number, number>()
    for (const p of puzzles) bands.set(Math.floor(p.rating / 100) * 100, (bands.get(Math.floor(p.rating / 100) * 100) ?? 0) + 1)
    expect([...bands.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => 400 + i * 100))
    expect(new Set(bands.values())).toEqual(new Set([150]))
  })

  // chess.js takes several ms a puzzle, so the legality check samples: the script already parsed every row it kept.
  it('have unique ids and pass the row parser again, legal and ending on the player', () => {
    expect(new Set(puzzles.map((p) => p.id)).size).toBe(puzzles.length)
    const known = new Set<string>(PUZZLE_THEMES)
    const bad = puzzles.filter((_, i) => i % 40 === 0).filter((p) => {
      const line = [p.id, p.fen, p.moves.join(' '), p.rating, 80, 90, 1000, p.themes.join(' '), p.gameUrl].join(',')
      const board = replay(p.fen, p.moves)
      return parsePuzzleRow(line)?.puzzle.id !== p.id || p.moves.length % 2 !== 0 || board.turn() === puzzleSide(p) || !p.themes.every((t) => known.has(t))
    })
    expect(bad.map((p) => p.id)).toEqual([])
  })
})
