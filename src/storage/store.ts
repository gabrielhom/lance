import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { EvalCache, GameReview, Library, LibraryRecord, Store } from '../domain/types'
import { evalRow, parseEvalRow, parseLibraryRecord } from './parse'

interface Schema extends DBSchema {
  evals: { key: string; value: unknown }
  games: { key: string; value: unknown; indexes: { playedAt: number } }
}
type Db = IDBPDatabase<Schema>

export async function openStore(): Promise<Store> {
  globalThis.navigator?.storage?.persist?.().catch(() => false)
  const db = await openDB<Schema>('lance', 1, {
    upgrade(db) {
      db.createObjectStore('evals')
      db.createObjectStore('games', { keyPath: 'id' }).createIndex('playedAt', 'playedAt')
    },
  })
  return { evals: evalCache(db), library: library(db) }
}

function evalCache(db: Db): EvalCache {
  return {
    get: async (key) => parseEvalRow(await db.get('evals', key)),
    put: async (key, value) => {
      await db.put('evals', evalRow(value), key)
    },
  }
}

function library(db: Db): Library {
  return {
    put: async (review, now) => {
      await db.put('games', libraryRecord(review, now))
    },
    list: async () =>
      (await db.getAll('games'))
        .map(parseLibraryRecord)
        .filter((r) => r !== null)
        .sort((a, b) => sortTime(b) - sortTime(a)),
    get: async (id) => parseLibraryRecord(await db.get('games', id)),
    remove: async (id) => {
      await db.delete('games', id)
    },
  }
}

/** A game without a date sorts by when it was reviewed, so a pasted PGN shows up on top. */
function sortTime(r: LibraryRecord): number {
  return r.playedAt ?? r.reviewedAt
}

function libraryRecord(review: GameReview, now: number): LibraryRecord {
  const { game, players } = review
  return {
    v: 1,
    id: game.id,
    source: game.source,
    players: game.players,
    result: game.result,
    playedAt: game.playedAt,
    reviewedAt: now,
    pgn: game.pgn,
    profile: review.profile,
    summary: {
      classifierVersion: review.classifierVersion,
      accuracy: { w: players.w.accuracy, b: players.b.accuracy },
      counts: { w: players.w.counts, b: players.b.counts },
      opening: review.opening,
    },
  }
}
