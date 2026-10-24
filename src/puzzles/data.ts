import { PUZZLE_THEMES, type Fen, type Puzzle, type PuzzleId, type PuzzleTheme, type Uci } from '../domain'
import { replay } from './puzzles'

/** How the Lichess database rates a puzzle's quality. Only the bundling script reads it. */
export type PuzzleQuality = { readonly popularity: number; readonly plays: number; readonly deviation: number }

const ID = /^[0-9A-Za-z]{5,8}$/
const UCI = /^[a-h][1-8][a-h][1-8][nbrq]?$/
const GAME_URL = /^https:\/\/lichess\.org\/[0-9A-Za-z]{8}(?:\/(?:white|black))?(?:#\d+)?$/
const KNOWN = new Set<string>(PUZZLE_THEMES)

/** One line of lichess_db_puzzle.csv: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,...
 *  null for the header, a malformed row, a line that isn't legal from its FEN, or a game URL off lichess.org.
 *  Themes the app doesn't name are dropped. */
export function parsePuzzleRow(line: string): { readonly puzzle: Puzzle; readonly quality: PuzzleQuality } | null {
  const [id, fen, moveText, rating, deviation, popularity, plays, themeText, gameUrl] = line.split(',')
  if (gameUrl === undefined || !ID.test(id) || !GAME_URL.test(gameUrl)) return null
  const numbers = [rating, deviation, popularity, plays].map(Number)
  if (!numbers.every(Number.isInteger)) return null
  const moves = moveText.split(' ')
  if (moves.length < 2 || moves.length % 2 !== 0 || !moves.every((m) => UCI.test(m)) || !legal(fen, moves)) return null
  const themes = themeText.split(' ').filter((t): t is PuzzleTheme => KNOWN.has(t))
  const [r, d, pop, n] = numbers
  return {
    puzzle: { id: id as PuzzleId, fen: fen as Fen, moves: moves as [Uci, Uci, ...Uci[]], rating: r, themes, gameUrl },
    quality: { popularity: pop, plays: n, deviation: d },
  }
}

function legal(fen: string, moves: readonly string[]): boolean {
  try {
    replay(fen, moves)
    return true
  } catch {
    return false
  }
}

/** A puzzle as one row of the bundled file: [id, fen, moves, rating, themes, game URL], with moves and themes space-separated. */
export type PuzzleTuple = readonly [string, string, string, number, string, string]
export type PuzzleFile = {
  readonly source: string
  readonly license: string
  /** When Lichess last updated the database the puzzles come from. */
  readonly updated: string
  readonly puzzles: readonly PuzzleTuple[]
}

export function toTuple(p: Puzzle): PuzzleTuple {
  return [p.id, p.fen, p.moves.join(' '), p.rating, p.themes.join(' '), p.gameUrl]
}

/** Trusts its input: the file is built by scripts/build-puzzles.mjs from rows parsePuzzleRow accepted. */
export function fromTuple([id, fen, moves, rating, themes, gameUrl]: PuzzleTuple): Puzzle {
  return {
    id: id as PuzzleId,
    fen: fen as Fen,
    moves: moves.split(' ') as [Uci, Uci, ...Uci[]],
    rating,
    themes: themes ? (themes.split(' ') as PuzzleTheme[]) : [],
    gameUrl,
  }
}

/** A separate chunk, fetched the first time someone opens the puzzles; the service worker keeps it for offline use. */
export async function loadPuzzles(): Promise<readonly Puzzle[]> {
  const { default: file } = await import('./puzzles.json')
  return (file as unknown as PuzzleFile).puzzles.map(fromTuple)
}
