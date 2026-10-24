import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLASSIFICATIONS,
  DEFAULT_SETTINGS,
  type AccuracyPct,
  type Classification,
  type EngineId,
  type EvalKey,
  type Fen,
  type Game,
  type GameId,
  type GameReview,
  type GameSource,
  type PositionKey,
  type SearchedEval,
  type Uci,
  type WinPct,
} from '../domain/types'
import { STEPS, openStore, type StoreEvents } from './store'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' as Fen
const ZERO = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>
const KEY = `c1|sf19/nn-61e7af4bb97d|d18|mpv2|${START}|` as EvalKey
const EVAL: SearchedEval = {
  depth: 18,
  lines: [
    { score: { kind: 'cp', white: 31 }, pv: ['e2e4', 'e7e5'] as [Uci, Uci] },
    { score: { kind: 'mate', winner: 'b', moves: 3 }, pv: ['f2f3'] as [Uci] },
  ],
}

function review(
  id: string,
  playedAt: number | null,
  accuracy: { w: number | null; b: number | null } = { w: 91.5, b: 73.2 },
  source: GameSource = { kind: 'lichess', id: id.slice(8), url: `https://lichess.org/${id.slice(8)}` },
): GameReview {
  const game: Game = {
    id: id as GameId,
    source,
    players: { w: { name: 'gabriel', rating: 1712 }, b: { name: 'rival', rating: null } },
    result: '1-0',
    playedAt,
    timeControl: '600+0',
    pgn: '[White "gabriel"]\n[Black "rival"]\n\n1. e4 1-0',
    positions: [{ kind: 'playable', index: 0, fen: START, turn: 'w', input: { root: START, tail: [] }, key: `${START}|` as PositionKey, legalMoves: 20 }],
    moves: [],
  }
  return {
    game,
    profile: { engine: 'sf19/nn-61e7af4bb97d' as EngineId, limit: { kind: 'depth', depth: 18 } },
    perspective: { kind: 'me', color: 'w' },
    classifierVersion: 1,
    moves: [],
    players: {
      w: { player: game.players.w, accuracy: accuracy.w as AccuracyPct | null, counts: { ...ZERO, best: 12, excellent: 4, blunder: 1 } },
      b: { player: game.players.b, accuracy: accuracy.b as AccuracyPct | null, counts: { ...ZERO, mistake: 3 } },
    },
    graph: [{ index: 0, whiteWin: 50 as WinPct, label: '+0.3' }],
    keyMoments: [],
    opening: { eco: 'B00', name: "King's Pawn Game" },
  }
}

async function writeRaw(store: 'evals' | 'games', value: unknown, key?: string) {
  const db = await openDB('lance', 1)
  await db.put(store, value, key)
  db.close()
}

const QUIET: StoreEvents = { blocked: () => {}, stale: () => {} }
const open = () => openStore(QUIET)

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})

const RECORD = {
  v: 1,
  id: 'lichess:abcd1234',
  source: { kind: 'lichess', id: 'abcd1234', url: 'https://lichess.org/abcd1234' },
  players: { w: { name: 'gabriel', rating: 1712 }, b: { name: 'rival', rating: null } },
  result: '1-0',
  playedAt: 1_700_000_000_000,
  reviewedAt: 1_800_000_000_000,
  pgn: '[White "gabriel"]\n[Black "rival"]\n\n1. e4 1-0',
  profile: { engine: 'sf19/nn-61e7af4bb97d', limit: { kind: 'depth', depth: 18 } },
  summary: {
    classifierVersion: 1,
    accuracy: { w: 91.5, b: 73.2 },
    counts: { w: { ...ZERO, best: 12, excellent: 4, blunder: 1 }, b: { ...ZERO, mistake: 3 } },
    opening: { eco: 'B00', name: "King's Pawn Game" },
  },
}

/** The database exactly as the first release created it, before upgrades went through STEPS. */
async function seedFirstRelease() {
  const db = await openDB('lance', 1, {
    upgrade(db) {
      db.createObjectStore('evals')
      db.createObjectStore('games', { keyPath: 'id' }).createIndex('playedAt', 'playedAt')
    },
  })
  await db.put('games', RECORD)
  await db.put('evals', { v: 1, depth: 18, lines: EVAL.lines }, KEY)
  db.close()
}

const TRAINING_STEP = (db: Parameters<(typeof STEPS)[number]>[0]) => {
  ;(db as unknown as IDBDatabase).createObjectStore('training', { keyPath: 'id' })
}

async function storeNames(version: number) {
  const db = await openDB('lance', version)
  const names = [...db.objectStoreNames]
  db.close()
  return names
}

describe('schema', () => {
  it('reads a database created by the first release', async () => {
    await seedFirstRelease()
    const { library, evals } = await open()
    expect(await library.list()).toEqual([RECORD])
    expect(await evals.get(KEY)).toEqual(EVAL)
  })

  it('upgrades to a new version by running only the new step and keeps every row', async () => {
    await seedFirstRelease()
    const step = vi.fn(TRAINING_STEP)
    const { library, evals } = await openStore(QUIET, [...STEPS, step])
    expect(step).toHaveBeenCalledTimes(1)
    expect(await library.list()).toEqual([RECORD])
    expect(await evals.get(KEY)).toEqual(EVAL)
    expect(await storeNames(2)).toEqual(['evals', 'games', 'training'])
  })

  it('creates every store on a fresh browser', async () => {
    await openStore(QUIET, [...STEPS, TRAINING_STEP])
    expect(await storeNames(2)).toEqual(['evals', 'games', 'training'])
  })

  it('lets a newer tab upgrade by closing its own connection', async () => {
    await seedFirstRelease()
    const stale = vi.fn()
    const old = await openStore({ blocked: () => {}, stale })
    const blocked = vi.fn()
    const newer = await openStore({ blocked, stale: () => {} }, [...STEPS, TRAINING_STEP])
    expect(stale).toHaveBeenCalledTimes(1)
    expect(blocked).not.toHaveBeenCalled()
    expect(await newer.library.list()).toEqual([RECORD])
    await expect(old.library.list()).rejects.toThrow(/closed|InvalidState/i)
  })

  it('waits for an old tab that never closes, then upgrades', async () => {
    await seedFirstRelease()
    const oldTab = await openDB('lance', 1)
    const blocked = vi.fn()
    const opening = openStore({ blocked, stale: () => {} }, [...STEPS, TRAINING_STEP])
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledTimes(1))
    oldTab.close()
    expect(await (await opening).library.list()).toEqual([RECORD])
  })
})

describe('eval cache', () => {
  it('reads back what it stored and misses on an unknown key', async () => {
    const { evals } = await open()
    await evals.put(KEY, EVAL)
    expect(await evals.get(KEY)).toEqual(EVAL)
    expect(await evals.get(`${KEY}x` as EvalKey)).toBeNull()
  })

  it('survives reopening the database', async () => {
    await (await open()).evals.put(KEY, EVAL)
    expect(await (await open()).evals.get(KEY)).toEqual(EVAL)
  })

  it.each([
    ['an older row version', { v: 0, depth: 18, lines: EVAL.lines }],
    ['a missing depth', { v: 1, lines: EVAL.lines }],
    ['no lines', { v: 1, depth: 18, lines: [] }],
    ['three lines', { v: 1, depth: 18, lines: [...EVAL.lines, EVAL.lines[0]] }],
    ['mate 0', { v: 1, depth: 18, lines: [{ score: { kind: 'mate', winner: 'w', moves: 0 }, pv: ['e2e4'] }] }],
    ['an empty pv', { v: 1, depth: 18, lines: [{ score: { kind: 'cp', white: 0 }, pv: [] }] }],
    ['a non-UCI move', { v: 1, depth: 18, lines: [{ score: { kind: 'cp', white: 0 }, pv: ['e4'] }] }],
    ['a string', 'garbage'],
  ])('treats %s as a miss', async (_, row) => {
    const { evals } = await open()
    await writeRaw('evals', row, KEY)
    expect(await evals.get(KEY)).toBeNull()
  })
})

describe('library', () => {
  it('stores a review as a record with its summary', async () => {
    const { library } = await open()
    await library.put(review('lichess:abcd1234', 1_700_000_000_000), 1_800_000_000_000)
    expect(await library.get('lichess:abcd1234' as GameId)).toEqual({
      v: 1,
      id: 'lichess:abcd1234',
      source: { kind: 'lichess', id: 'abcd1234', url: 'https://lichess.org/abcd1234' },
      players: { w: { name: 'gabriel', rating: 1712 }, b: { name: 'rival', rating: null } },
      result: '1-0',
      playedAt: 1_700_000_000_000,
      reviewedAt: 1_800_000_000_000,
      pgn: '[White "gabriel"]\n[Black "rival"]\n\n1. e4 1-0',
      profile: { engine: 'sf19/nn-61e7af4bb97d', limit: { kind: 'depth', depth: 18 } },
      summary: {
        classifierVersion: 1,
        accuracy: { w: 91.5, b: 73.2 },
        counts: { w: { ...ZERO, best: 12, excellent: 4, blunder: 1 }, b: { ...ZERO, mistake: 3 } },
        opening: { eco: 'B00', name: "King's Pawn Game" },
      },
    })
  })

  it('upserts by game id, so a re-review replaces the record', async () => {
    const { library } = await open()
    await library.put(review('lichess:abcd1234', 1000), 2000)
    await library.put(review('lichess:abcd1234', 1000, { w: 88, b: null }), 3000)
    const records = await library.list()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ reviewedAt: 3000, summary: { accuracy: { w: 88, b: null } } })
  })

  it('lists newest first, an undated game by when it was reviewed', async () => {
    const { library } = await open()
    await library.put(review('lichess:old00000', 1000), 9000)
    await library.put(review('lichess:undated0', null), 5000)
    await library.put(review('lichess:new00000', 7000), 9000)
    expect((await library.list()).map((r) => r.id)).toEqual(['lichess:new00000', 'lichess:undated0', 'lichess:old00000'])
  })

  it('counts no unreadable rows in a healthy library', async () => {
    const { library } = await open()
    expect(await library.unreadable()).toBe(0)
    await library.put(review('lichess:abcd1234', 1000), 2000)
    expect(await library.unreadable()).toBe(0)
  })

  it('removes a record', async () => {
    const { library } = await open()
    await library.put(review('lichess:abcd1234', 1000), 2000)
    await library.remove('lichess:abcd1234' as GameId)
    expect(await library.get('lichess:abcd1234' as GameId)).toBeNull()
    expect(await library.list()).toEqual([])
  })

  it.each<[string, GameSource]>([
    ['played in Lance', { kind: 'played', id: 'k3x9', you: 'b' }],
    ['pasted PGN', { kind: 'pgn' }],
    ['chess.com', { kind: 'chesscom', uuid: 'u-1', url: 'https://www.chess.com/game/live/1' }],
  ])('reads back the source of a game %s', async (_, source) => {
    const { library } = await open()
    await library.put(review('x:1', 1000, undefined, source), 2000)
    expect((await (await open()).library.get('x:1' as GameId))?.source).toEqual(source)
  })

  it.each([
    ['without a side', { kind: 'played', id: 'k3x9' }],
    ['with an unknown side', { kind: 'played', id: 'k3x9', you: 'white' }],
    ['without an id', { kind: 'played', id: '', you: 'w' }],
  ])('misses a played game stored %s', async (_, source) => {
    const { library } = await open()
    await library.put(review('played:k3x9', 1000, undefined, { kind: 'played', id: 'k3x9', you: 'w' }), 2000)
    const db = await openDB('lance', 1)
    const row = await db.get('games', 'played:k3x9')
    await db.put('games', { ...row, source })
    db.close()
    expect(await library.get('played:k3x9' as GameId)).toBeNull()
  })

  it('skips a corrupted row in the list and misses it on get', async () => {
    const { library } = await open()
    await library.put(review('lichess:good0000', 1000), 2000)
    await writeRaw('games', { v: 1, id: 'lichess:bad00000', pgn: 1, playedAt: 3000 })
    await writeRaw('games', { v: 2, id: 'lichess:future00' })
    expect((await library.list()).map((r) => r.id)).toEqual(['lichess:good0000'])
    expect(await library.unreadable()).toBe(2)
    expect(await library.get('lichess:bad00000' as GameId)).toBeNull()
  })
})

describe('backup', () => {
  const settings = { ...DEFAULT_SETTINGS, identity: { accounts: [{ site: 'lichess' as const, username: 'gabrielhom' }] } }

  it('brings the library back after the site data is cleared, unreadable rows left in the file', async () => {
    await seedFirstRelease()
    await writeRaw('games', { v: 2, id: 'lichess:future00' })
    const text = await (await open()).backup.export(settings, 1_900_000_000_000)
    expect(JSON.parse(text).stores.games).toEqual([RECORD, { v: 2, id: 'lichess:future00' }])

    vi.stubGlobal('indexedDB', new IDBFactory())
    const { library, backup } = await open()
    expect(await backup.import(text, { accounts: [] })).toEqual({
      ok: true,
      value: { imported: 1, alreadyHere: 0, ignored: 1, identity: { accounts: [{ site: 'lichess', username: 'gabrielhom' }] } },
    })
    expect(await library.list()).toEqual([RECORD])
    expect(await library.unreadable()).toBe(0)
    expect(await backup.import(text, settings.identity)).toEqual({ ok: true, value: { imported: 0, alreadyHere: 1, ignored: 1, identity: null } })
  })

  it('writes nothing from a file that is not a backup', async () => {
    const { library, backup } = await open()
    expect(await backup.import('{"games":[]}', { accounts: [] })).toEqual({ ok: false, error: { kind: 'not-backup' } })
    expect(await library.list()).toEqual([])
  })
})
