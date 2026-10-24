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

/** Games reviewed before training existed have no items, and games reviewed before the summary held phases, errors
 *  per phase and the exit from theory have nulls there. Their evals sit in the cache under the profile that reviewed
 *  them, so the review is rebuilt from the cache alone and the engine never starts; a game missing any eval waits for
 *  its next review. Safe to run on every start: a game with items and a full summary is skipped, sync keeps schedules,
 *  and a refreshed summary has no nulls left to fill. */
export async function backfill(deps: BackfillDeps, now: number): Promise<void> {
  const [records, items] = await Promise.all([deps.library.list(), deps.training.list()])
  const done = new Set<string>(items.map((i) => i.gameId))
  for (const record of records) {
    const needsItems = !done.has(record.id) && hasMyMistakes(record, deps.identity)
    const needsSummary = isOldSummary(record)
    if (!needsItems && !needsSummary) continue
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
    const review = buildReview(game.value, evals.value, deps.book, who, record.profile)
    if (needsSummary) await deps.library.refresh(review)
    if (needsItems) await deps.training.sync(review, now)
  }
}

/** `bookExit` is left out: it stays null for a game that never left theory. */
function isOldSummary({ summary }: LibraryRecord): boolean {
  return summary.phases === null || summary.division === null || summary.phaseErrors === null
}

/** Read from the stored summary, so a game with nothing to train costs no rebuild. */
function hasMyMistakes(record: LibraryRecord, identity: Identity): boolean {
  const who = perspective(identity, record.players, record.source)
  if (who.kind !== 'me') return false
  const c = record.summary.counts[who.color]
  return c.mistake + c.blunder + c.miss > 0
}
