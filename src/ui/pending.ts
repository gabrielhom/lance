import type { Game, GameId } from '../domain/types'

/** A game opened this session, maybe not in the library yet. */
export type Held = { readonly game: Game; readonly ply: number }

/** The review route resolves here before the library. */
const games = new Map<GameId, Held>()

export function holdGame(game: Game, ply = 0) {
  games.set(game.id, { game, ply })
}

export function heldGame(id: GameId): Held | undefined {
  return games.get(id)
}
