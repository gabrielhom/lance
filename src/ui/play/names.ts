import type { ByColor, Identity, PlayLevel, PlaySetup } from '../../domain/types'
import { levelById } from '../../play'

export type Seat = { readonly name: string; readonly detail: string | null; readonly engine: boolean }

/** 'Clube ~1400', 'Iniciante, abaixo de 1300'. */
export function levelLabel(level: PlayLevel): string {
  return level.rating.startsWith('~') ? `${level.name} ${level.rating}` : `${level.name}, ${level.rating}`
}

/** Who sits at each color. The player takes their first account name so the review and the history know the game is theirs. */
export function seats(setup: PlaySetup, identity: Identity): ByColor<Seat> {
  if (setup.opponent.kind === 'local') {
    return { w: { name: 'Brancas', detail: null, engine: false }, b: { name: 'Pretas', detail: null, engine: false } }
  }
  const level = levelById(setup.opponent.levelId)
  const me: Seat = { name: identity.accounts[0]?.username ?? 'Você', detail: null, engine: false }
  const engine: Seat = { name: 'Stockfish', detail: level ? levelLabel(level) : null, engine: true }
  return setup.you === 'w' ? { w: me, b: engine } : { w: engine, b: me }
}

/** Names as the PGN and the library store them. */
export function pgnNames(setup: PlaySetup, identity: Identity): ByColor<string> {
  const s = seats(setup, identity)
  const level = setup.opponent.kind === 'engine' ? levelById(setup.opponent.levelId) : null
  const name = (seat: Seat) => (seat.engine && level ? `Stockfish (${level.name})` : seat.name)
  return { w: name(s.w), b: name(s.b) }
}
