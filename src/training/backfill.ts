import { buildReview, completeEvals } from '../analysis'
import {
  gameFromPgn,
  perspective,
  type EvalCache,
  type Identity,
  type Library,
  type LibraryRecord,
  type OpeningBook,
  type PositionKey,
  type SearchedEval,
  type TrainingStore,
} from '../domain'
import { evalKey } from '../engine'

export type BackfillDeps = {
  readonly library: Library
  readonly training: TrainingStore
  readonly evals: EvalCache
  readonly book: OpeningBook
  readonly identity: Identity
}

/** Games reviewed before training existed have no items. Their evals sit in the cache under the profile that reviewed
 *  them, so the review is rebuilt from the cache alone and the engine never starts; a game missing any eval gets its
 *  items at its next review. Safe to run on every start: a game with items is skipped, and sync keeps schedules. */
export async function backfill(deps: BackfillDeps, now: number): Promise<void> {
  const [records, items] = await Promise.all([deps.library.list(), deps.training.list()])
  const done = new Set<string>(items.map((i) => i.gameId))
  for (const record of records) {
    if (done.has(record.id) || !hasMyMistakes(record, deps.identity)) continue
    const game = gameFromPgn(record.pgn, record.source)
    if (!game.ok) continue
    const found = new Map<PositionKey, SearchedEval>()
    for (const p of game.value.positions) {
      if (p.kind !== 'playable') continue
      const e = await deps.evals.get(evalKey(record.profile, p.key))
      if (!e) break
      found.set(p.key, e)
    }
    const evals = completeEvals(game.value, found)
    if (!evals.ok) continue
    const who = perspective(deps.identity, game.value.players, game.value.source)
    await deps.training.sync(buildReview(game.value, evals.value, deps.book, who, record.profile), now)
  }
}

/** Read from the stored summary, so a game with nothing to train costs no rebuild. */
function hasMyMistakes(record: LibraryRecord, identity: Identity): boolean {
  const who = perspective(identity, record.players, record.source)
  if (who.kind !== 'me') return false
  const c = record.summary.counts[who.color]
  return c.mistake + c.blunder + c.miss > 0
}
