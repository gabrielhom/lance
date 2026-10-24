import { describe, expect, it } from 'vitest'
import opera from '../../../e2e/fixtures/opera.pgn?raw'
import { gameFromPgn } from '../../domain/game'
import type { Game, Uci } from '../../domain/types'
import { bestLine, bestLinePlies, gameAt, moveOnBoard, shown, step, type View } from './view'

const parsed = gameFromPgn(opera, { kind: 'pgn' })
if (!parsed.ok) throw new Error(parsed.error.detail)
const game: Game = parsed.value

const play = (view: View, ...ucis: string[]) => ucis.reduce((v, u) => moveOnBoard(v, game, u as Uci), view)
const sans = (view: View) => (view.kind === 'line' ? view.moves.map((m) => m.san) : null)
const onBoard = (view: View) => {
  const { position, lastMove } = shown(view, game)
  return { fen: position.fen, last: lastMove?.san ?? null }
}

describe('moves made on the review board', () => {
  it("steps the game when the move is the game's own", () => {
    expect(play(gameAt(game, 0), 'e2e4', 'e7e5')).toEqual({ kind: 'game', ply: 2 })
  })

  it('branches a line off the game ply and keeps building it', () => {
    const line = play(gameAt(game, 2), 'b1c3', 'g8f6')
    expect(line).toMatchObject({ kind: 'line', ply: 2, at: 2 })
    expect(sans(line)).toEqual(['Nc3', 'Nf6'])
    expect(onBoard(line)).toEqual({ fen: 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3', last: 'Nf6' })
  })

  it("follows the line's own next move and replaces the rest with any other", () => {
    const back = step(step(play(gameAt(game, 2), 'b1c3', 'g8f6', 'f1c4'), game, -1), game, -1)
    expect(play(back, 'g8f6')).toMatchObject({ at: 2, moves: { length: 3 } })
    const replaced = play(back, 'b8c6')
    expect(sans(replaced)).toEqual(['Nc3', 'Nc6'])
    expect(replaced).toMatchObject({ at: 2 })
  })

  it('ignores an illegal move and any move after checkmate', () => {
    const start = gameAt(game, 0)
    expect(play(start, 'e2e5')).toBe(start)
    const mated = gameAt(game, 33)
    expect(play(mated, 'e8e7')).toBe(mated)
  })
})

describe('stepping', () => {
  it('walks the game within its ends', () => {
    expect(step(gameAt(game, 0), game, -1)).toEqual({ kind: 'game', ply: 0 })
    expect(step(gameAt(game, 33), game, 1)).toEqual({ kind: 'game', ply: 33 })
  })

  it('walks a line, stops at its end, and returns to its game ply from its first move', () => {
    const line = play(gameAt(game, 4), 'b1c3', 'b8c6')
    expect(step(line, game, 1)).toMatchObject({ at: 2 })
    expect(onBoard(step(line, game, -1)).last).toBe('Nc3')
    expect(step(step(line, game, -1), game, -1)).toEqual({ kind: 'game', ply: 4 })
  })
})

describe('the best line as a line', () => {
  // An engine line instead of 3...Bg4, ending in a move that is not one.
  const move = game.moves[5]
  const pv = ['e5d4', 'd1d4', 'b8c6', 'zz'] as Uci[]

  it('starts before the move, returns after it, and stops at the first illegal move', () => {
    const line = bestLine(move, pv, 2)
    expect(line).toMatchObject({ kind: 'line', ply: 6, at: 2 })
    expect(sans(line)).toEqual(['exd4', 'Qxd4', 'Nc6'])
    expect(onBoard(line).last).toBe('Qxd4')
    expect(step(step(line, game, -1), game, -1)).toEqual({ kind: 'game', ply: 6 })
  })

  it('tells how far into the best line the board is until the line leaves it', () => {
    const line = bestLine(move, pv, 2)
    expect(bestLinePlies(line, move, pv)).toBe(2)
    expect(bestLinePlies(play(line, 'b8d7'), move, pv)).toBeNull()
    expect(bestLinePlies(play(gameAt(game, 6), 'b1c3'), move, pv)).toBeNull()
    expect(bestLinePlies(gameAt(game, 6), move, pv)).toBeNull()
  })
})
