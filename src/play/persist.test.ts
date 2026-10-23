import { Chess } from 'chess.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { gameFromPgn } from '../domain'
import type { PlaySetup, PlayState, Uci } from '../domain/types'
import { DEFAULT_CHOICE, loadChoice, loadPlay, parsePlay, resolveChoice, saveChoice, savePlay } from './persist'
import { toPgn } from './pgn'
import { newPlay, reducePlay } from './play'

const T0 = Date.UTC(2026, 9, 23, 18, 30, 5)
const setup: PlaySetup = { opponent: { kind: 'engine', levelId: 3 }, you: 'w', time: { kind: 'clock', initialMs: 300_000, incrementMs: 2000 } }

function played(sans: string, s: PlaySetup = setup): PlayState {
  const b = new Chess()
  return sans.split(' ').reduce((st, san, i) => reducePlay(st, { kind: 'move', uci: b.move(san).lan as Uci, at: T0 + (i + 1) * 1000 }), newPlay(s, T0))
}

class MemoryStorage {
  private m = new Map<string, string>()
  getItem = (k: string) => this.m.get(k) ?? null
  setItem = (k: string, v: string) => void this.m.set(k, v)
  removeItem = (k: string) => void this.m.delete(k)
}

describe('toPgn', () => {
  it('writes the tags a finished game needs and reads back as the same game', () => {
    const over = played('f3 e5 g4 Qh4#')
    const pgn = toPgn(over, { w: 'Você', b: 'Stockfish (Clube)' })
    for (const tag of ['[Event "Lance"]', '[Date "2026.10.23"]', '[White "Você"]', '[Black "Stockfish (Clube)"]', '[Result "0-1"]', '[TimeControl "300+2"]', '[Termination "Normal"]', '[UTCTime "18:30:05"]']) {
      expect(pgn).toContain(tag)
    }
    const game = gameFromPgn(pgn, { kind: 'pgn' })
    expect(game.ok && game.value.moves.map((m) => m.uci)).toEqual(over.moves)
    expect(game.ok && game.value).toMatchObject({ result: '0-1', timeControl: '300+2', playedAt: T0 })
  })

  it('marks a loss on time and an untimed game', () => {
    const s = played('e4 e5')
    const flagged = reducePlay(s, { kind: 'flag', at: T0 + 10_000_000 })
    expect(toPgn(flagged, { w: 'a', b: 'b' })).toContain('[Termination "Time forfeit"]')
    const untimed = played('e4', { ...setup, time: { kind: 'none' } })
    expect(toPgn(untimed, { w: 'a', b: 'b' })).toMatch(/\[TimeControl "-"\][\s\S]*\[Result "\*"\]|\[Result "\*"\][\s\S]*\[TimeControl "-"\]/)
  })
})

describe('parsePlay', () => {
  it('round-trips a game in progress and a finished one through JSON', () => {
    for (const s of [played('e4 e5 Nf3'), played('f3 e5 g4 Qh4#')]) expect(parsePlay(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })

  it.each([
    ['not an object', 'oops'],
    ['an illegal move', { ...played('e4'), moves: ['e2e4', 'e2e4'] }],
    ['an unknown level', { ...played('e4'), setup: { ...setup, opponent: { kind: 'engine', levelId: 99 } } }],
    ['clocks on an untimed game', { ...played('e4'), setup: { ...setup, time: { kind: 'none' } } }],
    ['no clocks on a timed game', { ...played('e4'), clocks: null }],
    ['a game in progress whose position is already over', { ...played('f3 e5 g4 Qh4#'), phase: 'playing', turnStartedAt: T0 }],
    ['an unknown termination', { ...played('f3 e5 g4 Qh4#'), termination: 'boredom' }],
  ])('rejects %s', (_, raw) => {
    expect(parsePlay(raw)).toBeNull()
  })
})

describe('storage', () => {
  beforeEach(() => {
    globalThis.localStorage = new MemoryStorage() as unknown as Storage
  })

  it('keeps the game in progress and clears it with null', () => {
    const s = played('e4 e5')
    savePlay(s)
    expect(loadPlay()).toEqual(s)
    savePlay(null)
    expect(loadPlay()).toBeNull()
  })

  it('treats a corrupt key as no game', () => {
    localStorage.setItem('lance.play', '{"id":')
    expect(loadPlay()).toBeNull()
  })

  it('remembers the last setup, random color included, and falls back to the default', () => {
    expect(loadChoice()).toEqual(DEFAULT_CHOICE)
    const choice = { opponent: { kind: 'engine', levelId: 5 }, color: 'random', time: { kind: 'clock', initialMs: 180_000, incrementMs: 2000 } } as const
    saveChoice(choice)
    expect(loadChoice()).toEqual(choice)
    expect(resolveChoice(choice, () => 0.9).you).toBe('b')
    expect(resolveChoice({ ...choice, opponent: { kind: 'local' } }, () => 0.9).you).toBe('w')
  })
})
