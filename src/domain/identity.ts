import type { ByColor, Color, GameSource, Identity, Perspective, PlayerTag } from './types'

/** Derived on read and never stored, so a username change applies to old games. If both names match, White wins. */
export function perspective(identity: Identity, players: ByColor<PlayerTag>, source: GameSource): Perspective {
  const mine = identity.accounts
    .filter((a) => a.site === 'any' || a.site === source.kind || source.kind === 'pgn')
    .map((a) => a.username.toLowerCase())
  const color = (['w', 'b'] as const).find((c: Color) => mine.includes(players[c].name.toLowerCase()))
  return color ? { kind: 'me', color } : { kind: 'spectator' }
}
