import type { Game, GameId, Perspective } from '../domain/types'

/** A game opened this session, maybe not in the library yet. A game played here also knows whose side the player
 *  was on, which the identity in the settings cannot tell for a local opponent or a player with no account set. */
export type Held = { readonly game: Game; readonly perspective: Perspective | null; readonly ply: number }

/** The review route resolves here before the library. */
const games = new Map<GameId, Held>()

export function holdGame(game: Game, opts: { perspective?: Perspective; ply?: number } = {}) {
  games.set(game.id, { game, perspective: opts.perspective ?? null, ply: opts.ply ?? 0 })
}

export function heldGame(id: GameId): Held | undefined {
  return games.get(id)
}
