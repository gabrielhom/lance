import { openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore, type IDBPTransaction, type StoreNames } from 'idb'
import type { Backup, EvalCache, GameReview, Library, LibraryRecord, Phase, PlayerSummary, PuzzleStore, Store, TrainingStore } from '../domain/types'
import { nextSchedule, syncItems } from '../training/training'
import { buildBackup, planImport } from './backup'
import { evalRow, parseEvalRow, parseLibraryRecord, parsePuzzleAttempt, puzzleRow, parseTrainingItem, trainingRow } from './parse'

interface Schema extends DBSchema {
  evals: { key: string; value: unknown }
  games: { key: string; value: unknown; indexes: { playedAt: number } }
  training: { key: string; value: unknown; indexes: { gameId: string } }
  puzzles: { key: string; value: unknown }
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
  (db) => {
    db.createObjectStore('training', { keyPath: 'id' }).createIndex('gameId', 'gameId')
  },
  (db) => {
    db.createObjectStore('puzzles', { keyPath: 'id' })
  },
]

/** What the app does when another tab needs the database at a newer version. */
export type StoreEvents = {
  /** An older tab keeps its connection open, so this one waits until it closes. */
  blocked(): void
  /** This tab closed its connection to let a newer tab upgrade; its code is out of date and every call now fails. */
  stale(): void
  /** The database is already at a version newer than this code knows, so it can't open at all. */
  outdated(): void
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
  }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === 'VersionError') on.outdated()
    throw e
  })
  return { evals: evalCache(db), library: library(db), backup: backup(db), training: training(db), puzzles: puzzles(db) }
}

function evalCache(db: Db): EvalCache {
  return {
    get: async (key) => parseEvalRow(await db.get('evals', key)),
    put: async (key, value) => {
      await db.put('evals', evalRow(value), key)
    },
  }
}

/** In the caller's transaction, so a game is never saved without its items. */
async function syncTraining<T extends ArrayLike<StoreNames<Schema>>>(store: IDBPObjectStore<Schema, T, 'training', 'readwrite'>, review: GameReview, now: number) {
  const existing = (await store.index('gameId').getAll(review.game.id)).map(parseTrainingItem).filter((i) => i !== null)
  const { put, remove } = syncItems(existing, review, now)
  await Promise.all([...put.map((i) => store.put(trainingRow(i))), ...remove.map((id) => store.delete(id))])
}

function library(db: Db): Library {
  return {
    put: async (review, now) => {
      const tx = db.transaction(['games', 'training'], 'readwrite')
      await Promise.all([tx.objectStore('games').put(libraryRecord(review, now)), syncTraining(tx.objectStore('training'), review, now), tx.done])
    },
    list: async () =>
      (await db.getAll('games'))
        .map(parseLibraryRecord)
        .filter((r) => r !== null)
        .sort((a, b) => sortTime(b) - sortTime(a)),
    unreadable: async () => (await db.getAll('games')).filter((row) => parseLibraryRecord(row) === null).length,
    get: async (id) => parseLibraryRecord(await db.get('games', id)),
    remove: async (id) => {
      const tx = db.transaction(['games', 'training'], 'readwrite')
      const training = tx.objectStore('training')
      const items = await training.index('gameId').getAllKeys(id)
      await Promise.all([tx.objectStore('games').delete(id), ...items.map((k) => training.delete(k)), tx.done])
    },
  }
}

function training(db: Db): TrainingStore {
  return {
    list: async () => (await db.getAll('training')).map(parseTrainingItem).filter((i) => i !== null),
    async answer(id, correct, now) {
      const tx = db.transaction('training', 'readwrite')
      const item = parseTrainingItem(await tx.store.get(id))
      const writes = item ? [tx.store.put(trainingRow({ ...item, schedule: nextSchedule(item.schedule, correct, now) }))] : []
      await Promise.all([...writes, tx.done])
    },
    async sync(review, now) {
      const tx = db.transaction('training', 'readwrite')
      await Promise.all([syncTraining(tx.store, review, now), tx.done])
    },
  }
}

function puzzles(db: Db): PuzzleStore {
  return {
    list: async () => (await db.getAll('puzzles')).map(parsePuzzleAttempt).filter((a) => a !== null),
    async record(attempt) {
      const tx = db.transaction('puzzles', 'readwrite')
      const here = parsePuzzleAttempt(await tx.store.get(attempt.id))
      const writes = here && here.at <= attempt.at ? [] : [tx.store.put(puzzleRow(attempt))]
      await Promise.all([...writes, tx.done])
    },
  }
}

function backup(db: Db): Backup {
  return {
    export: async (settings, now) =>
      JSON.stringify(
        buildBackup({ games: await db.getAll('games'), training: await db.getAll('training'), puzzles: await db.getAll('puzzles') }, settings, now),
        null,
        2,
      ),
    async import(text, identity) {
      // One transaction, so a review saved meanwhile in another tab can't be overwritten by an older copy.
      const tx = db.transaction(['games', 'training', 'puzzles'], 'readwrite')
      const games = tx.objectStore('games')
      const training = tx.objectStore('training')
      const puzzles = tx.objectStore('puzzles')
      const plan = planImport(text, { games: await games.getAll(), training: await training.getAll(), puzzles: await puzzles.getAll() }, identity)
      const writes = plan.ok
        ? [
            ...plan.value.put.map((r) => games.put(r)),
            ...plan.value.training.map((i) => training.put(trainingRow(i))),
            ...plan.value.drop.map((id) => training.delete(id)),
            ...plan.value.puzzles.map((a) => puzzles.put(puzzleRow(a))),
          ]
        : []
      await Promise.all([...writes, tx.done])
      return plan.ok ? { ok: true, value: plan.value.report } : plan
    },
  }
}

/** A game without a date sorts by when it was reviewed, so a pasted PGN shows up on top. */
function sortTime(r: LibraryRecord): number {
  return r.playedAt ?? r.reviewedAt
}

export function libraryRecord(review: GameReview, now: number): LibraryRecord {
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
      phases: { w: phaseAccuracies(players.w), b: phaseAccuracies(players.b) },
    },
  }
}

function phaseAccuracies({ phases }: PlayerSummary): Record<Phase, number | null> {
  return { opening: phases.opening.accuracy, middlegame: phases.middlegame.accuracy, endgame: phases.endgame.accuracy }
}
