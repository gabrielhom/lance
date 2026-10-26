import { describe, expect, it } from 'vitest'
import type { GameId } from '../domain/types'
import { href, parseRoute } from './router'

describe('training route', () => {
  it('carries a list of games through the hash, ids with colons and commas included', () => {
    const games = ['lichess:abcd1234', 'pgn:x,y'] as GameId[]
    expect(href({ name: 'training', games })).toBe('#/treino/lichess%3Aabcd1234,pgn%3Ax%2Cy')
    expect(parseRoute(href({ name: 'training', games }))).toEqual({ name: 'training', games })
  })

  it('trains what is due with no games, and one game as before', () => {
    expect(parseRoute('#/treino')).toEqual({ name: 'training', games: [] })
    expect(parseRoute('#/treino/lichess%3Aabcd1234')).toEqual({ name: 'training', games: ['lichess:abcd1234'] })
  })
})

describe('openings routes', () => {
  it('carries a family with its color through the hash, colons and spaces included', () => {
    const route = { name: 'opening', family: "Queen's Pawn Game: London System", color: 'w' } as const
    expect(href(route)).toBe("#/treino/aberturas/Queen's%20Pawn%20Game%3A%20London%20System/brancas")
    expect(parseRoute(href(route))).toEqual(route)
    expect(parseRoute('#/treino/aberturas/Sicilian%20Defense/pretas')).toEqual({ name: 'opening', family: 'Sicilian Defense', color: 'b' })
  })

  it('opens the catalog without a family, and for a family it cannot decode', () => {
    expect(parseRoute(href({ name: 'openings' }))).toEqual({ name: 'openings' })
    expect(parseRoute('#/treino/aberturas/Sicilian%E/pretas')).toEqual({ name: 'openings' })
  })
})
