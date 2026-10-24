import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Identity, Store, TrainingItemId } from '../domain'
import { evalKey } from '../engine'
import { STEPS, openStore } from '../storage/store'
import { backfill } from './backfill'
import { NO_BOOK, PROFILE, operaEvals, operaReview } from './testing'

const B5 = 'pgn:2dbw2vp1o9w#17' as TrainingItemId
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
