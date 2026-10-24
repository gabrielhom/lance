import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameId, Identity, Store, TrainingItemId } from '../domain'
import { evalKey } from '../engine'
import { STEPS, openStore } from '../storage/store'
import { backfill } from './backfill'
import { NO_BOOK, PROFILE, operaEvals, operaReview } from './testing'

const OPERA = 'pgn:2dbw2vp1o9w' as GameId
const B5 = `${OPERA}#17` as TrainingItemId
const BLACK: Identity = { accounts: [{ site: 'any', username: 'Duke Karl / Count Isouard' }] }
const NOW = new Date(2026, 9, 24, 20).getTime()

/** A library saved before training existed: the game and its cached evals, no items. */
async function reviewedBeforeTraining(uncached: number | null = null): Promise<Store> {
  const store = await openStore({ blocked: () => {}, stale: () => {}, outdated: () => {} })
  const review = operaReview({ kind: 'me', color: 'b' })
  await store.library.put(review, 1000)
  const db = await openDB('lance', STEPS.length)
  await db.clear('training')
  db.close()
  const evals = operaEvals(review.game)
  for (const p of review.game.positions) {
    if (p.kind === 'playable' && p.index !== uncached) await store.evals.put(evalKey(PROFILE, p.key), evals.get(p.key)!)
  }
  return store
}

/** A library saved before the summary held phases, errors per phase and the exit from theory, with its cached evals. */
async function reviewedBeforePhases(uncached: number | null = null): Promise<Store> {
  const store = await reviewedBeforeTraining(uncached)
  const db = await openDB('lance', STEPS.length)
  const row = await db.get('games', OPERA)
  const { phases: _phases, division: _division, phaseErrors: _errors, bookExit: _exit, ...summary } = row.summary
  await db.put('games', { ...row, summary })
  db.close()
  return store
}

const run = (store: Store, identity: Identity, now = NOW) =>
  backfill({ library: store.library, training: store.training, evals: store.evals, book: NO_BOOK, identity }, now)

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})

describe('backfill', () => {
  it('rebuilds the items of a game reviewed before training existed from the cached evals', async () => {
    const store = await reviewedBeforeTraining()
    await run(store, BLACK)
    expect((await store.training.list()).map((i) => [i.id, i.schedule])).toEqual([[B5, { box: 0, due: NOW, last: null }]])
  })

  it('leaves a game that already has items as it is', async () => {
    const store = await reviewedBeforeTraining()
    await run(store, BLACK)
    await store.training.answer(B5, false, NOW)
    const before = await store.training.list()
    await run(store, BLACK, NOW + 1000)
    expect(await store.training.list()).toEqual(before)
  })

  it('waits for the next review when an eval is missing from the cache', async () => {
    const store = await reviewedBeforeTraining(17)
    await run(store, BLACK)
    expect(await store.training.list()).toEqual([])
  })

  it('makes nothing from a game where I am not one of the players', async () => {
    const store = await reviewedBeforeTraining()
    await run(store, { accounts: [] })
    expect(await store.training.list()).toEqual([])
  })
})

describe('backfill of old summaries', () => {
  const NONE = { mistake: 0, blunder: 0, miss: 0 }

  it('fills the phases, errors per phase and exit from theory of an old row from the cached evals, keeping when it was reviewed', async () => {
    const store = await reviewedBeforePhases()
    expect((await store.library.get(OPERA))!.summary).toMatchObject({ phases: null, division: null, phaseErrors: null, bookExit: null })
    await run(store, BLACK)
    const record = (await store.library.get(OPERA))!
    expect(record.reviewedAt).toBe(1000)
    expect(record.summary).toMatchObject({
      division: { middlegame: 17, endgame: 32 },
      phaseErrors: {
        w: { opening: NONE, middlegame: NONE, endgame: NONE },
        b: { opening: NONE, middlegame: { mistake: 0, blunder: 1, miss: 0 }, endgame: NONE },
      },
      bookExit: 50,
    })
    expect(Math.round(record.summary.phases!.b.middlegame! * 10) / 10).toBe(37.3)
    expect((await store.training.list()).map((i) => i.id)).toEqual([B5])
  })

  it('leaves an old row as it is when an eval is missing from the cache', async () => {
    const store = await reviewedBeforePhases(17)
    const before = await store.library.get(OPERA)
    await run(store, BLACK)
    expect(await store.library.get(OPERA)).toEqual(before)
  })

  it('refreshes the summary of a game I did not play without touching training, and changes nothing on a second run', async () => {
    const store = await reviewedBeforePhases()
    await run(store, { accounts: [] })
    const once = await store.library.get(OPERA)
    expect(once!.summary.division).toEqual({ middlegame: 17, endgame: 32 })
    expect(await store.training.list()).toEqual([])
    await run(store, { accounts: [] }, NOW + 1000)
    expect(await store.library.get(OPERA)).toEqual(once)
  })
})
