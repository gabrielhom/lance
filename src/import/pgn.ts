import { gameFromPgn, type Game, type GameRejection, type ImportResult } from '../domain'

/** A pasted or uploaded PGN file, which may hold many games. */
export function parsePgnText(text: string): ImportResult {
  const games: Game[] = []
  const rejected: { index: number; rejection: GameRejection }[] = []
  splitGames(text).forEach((pgn, index) => {
    const r = gameFromPgn(pgn, { kind: 'pgn' })
    if (r.ok) games.push(r.value)
    else rejected.push({ index, rejection: r.error })
  })
  return { games, rejected }
}

/** A new game starts at a tag line that follows movetext. */
function splitGames(text: string): string[] {
  const games: string[][] = []
  let current: string[] = []
  let sawMoves = false
  for (const line of text.replace(/^﻿/, '').split(/\r\n?|\n/)) {
    const isTag = /^\s*\[\w+\s+"/.test(line)
    if (isTag && sawMoves) {
      games.push(current)
      current = []
      sawMoves = false
    }
    if (!isTag && line.trim() !== '') sawMoves = true
    current.push(line)
  }
  games.push(current)
  return games.map((g) => g.join('\n').trim()).filter((g) => g !== '')
}
