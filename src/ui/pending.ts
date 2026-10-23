import type { Game, GameId } from '../domain/types'

/** Games imported this session but not yet in the library. The review route resolves here before the library. */
const games = new Map<GameId, Game>()

export function holdGame(game: Game) {
  games.set(game.id, game)
}

export function heldGame(id: GameId): Game | undefined {
  return games.get(id)
}
