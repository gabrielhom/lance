import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb'
import type { Backup, EvalCache, GameReview, Library, LibraryRecord, Store } from '../domain/types'
import { buildBackup, planImport } from './backup'
import { evalRow, parseEvalRow, parseLibraryRecord } from './parse'

interface Schema extends DBSchema {
  evals: { key: string; value: unknown }
  games: { key: string; value: unknown; indexes: { playedAt: number } }
}
type Db = IDBPDatabase<Schema>
type Step = (db: Db, tx: IDBPTransaction<Schema, StoreNames<Schema>[], 'versionchange'>) => void

/** STEPS[n] takes the database from version n to n + 1. A new version is one more step at the end; a shipped step never
 *  changes, because some browser out there already ran it. */
export const STEPS: readonly Step[] = [
  (db) => {
    db.createObjectStore('evals')
    db.createObjectStore('games', { keyPath: 'id' }).createIndex('playedAt', 'playedAt')
  },
]

/** What the app does when another tab needs the database at a newer version. */
export type StoreEvents = {
  /** An older tab keeps its connection open, so this one waits until it closes. */
  blocked(): void
  /** This tab closed its connection to let a newer tab upgrade; its code is out of date and every call now fails. */
  stale(): void
}

/** `steps` is only for tests, which rehearse the next version with one more step. */
export async function openStore(on: StoreEvents, steps: readonly Step[] = STEPS): Promise<Store> {
  globalThis.navigator?.storage?.persist?.().catch(() => false)
  const db = await openDB<Schema>('lance', steps.length, {
    upgrade(upgrading, oldVersion, _newVersion, tx) {
      for (const step of steps.slice(oldVersion)) step(upgrading, tx)
    },
    blocked: () => on.blocked(),
    blocking() {
      db.close()
      on.stale()
    },
  })
  return { evals: evalCache(db), library: library(db), backup: backup(db) }
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
    unreadable: async () => (await db.getAll('games')).filter((row) => parseLibraryRecord(row) === null).length,
    get: async (id) => parseLibraryRecord(await db.get('games', id)),
    remove: async (id) => {
      await db.delete('games', id)
    },
  }
}

function backup(db: Db): Backup {
  return {
    export: async (settings, now) => JSON.stringify(buildBackup({ games: await db.getAll('games') }, settings, now), null, 2),
    async import(text, identity) {
      // One transaction, so a review saved meanwhile in another tab can't be overwritten by an older copy.
      const tx = db.transaction('games', 'readwrite')
      const plan = planImport(text, await tx.store.getAll(), identity)
      const writes = plan.ok ? plan.value.put.map((r) => tx.store.put(r)) : []
      await Promise.all([...writes, tx.done])
      return plan.ok ? { ok: true, value: plan.value.report } : plan
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
