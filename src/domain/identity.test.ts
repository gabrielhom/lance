import { describe, expect, it } from 'vitest'
import { perspective } from './identity'
import type { ByColor, Identity, PlayerTag } from './types'

const players = (w: string, b: string): ByColor<PlayerTag> => ({ w: { name: w, rating: null }, b: { name: b, rating: null } })
const NOBODY: Identity = { accounts: [] }
const GABRIEL: Identity = { accounts: [{ site: 'lichess', username: 'Gabriel' }] }

describe('perspective', () => {
  it('makes a game played in Lance mine with no account set', () => {
    expect(perspective(NOBODY, players('Você', 'Stockfish (Iniciante)'), { kind: 'played', id: 'a', you: 'w' })).toEqual({ kind: 'me', color: 'w' })
    expect(perspective(NOBODY, players('Brancas', 'Pretas'), { kind: 'played', id: 'b', you: 'b' })).toEqual({ kind: 'me', color: 'b' })
  })

  it('takes the side of a game played in Lance over a name match', () => {
    expect(perspective(GABRIEL, players('gabriel', 'Stockfish'), { kind: 'played', id: 'a', you: 'b' })).toEqual({ kind: 'me', color: 'b' })
  })

  it('matches account names for imported games', () => {
    expect(perspective(GABRIEL, players('rival', 'GABRIEL'), { kind: 'lichess', id: 'x', url: 'u' })).toEqual({ kind: 'me', color: 'b' })
    expect(perspective(GABRIEL, players('rival', 'gabriel'), { kind: 'chesscom', uuid: 'x', url: 'u' })).toEqual({ kind: 'spectator' })
    expect(perspective(GABRIEL, players('gabriel', 'rival'), { kind: 'pgn' })).toEqual({ kind: 'me', color: 'w' })
    expect(perspective(NOBODY, players('Você', 'rival'), { kind: 'pgn' })).toEqual({ kind: 'spectator' })
  })
})
