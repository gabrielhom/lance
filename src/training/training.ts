import { CLASSIFIER, winPct } from '../analysis'
import {
  playableAt,
  playMove,
  type Classification,
  type GameReview,
  type PlayablePosition,
  type Schedule,
  type SearchedEval,
  type TrainingClass,
  type TrainingItem,
  type TrainingItemId,
  type Uci,
  type Verdict,
} from '../domain'

export const TRAINING = {
  /** A move other than the best is right when it loses less win% than this: a move the review would call excellent. */
  acceptLoss: CLASSIFIER.bands.excellent,
  /** Days until an item comes back, by Leitner box. A wrong answer sends it to box 0. */
  intervalDays: [1, 3, 7, 14, 30],
} as const

const isTrained = (c: Classification): c is TrainingClass => c === 'mistake' || c === 'blunder' || c === 'miss'

/** My mistakes, blunders and misses in the review, each as the position before it. A spectator's review has none. */
export function trainingItems(review: GameReview, now: number): TrainingItem[] {
  const { game, perspective: who } = review
  if (who.kind !== 'me') return []
  return review.moves.flatMap(({ move, classification, best, bestLineSan, alternative }) =>
    move.mover === who.color && isTrained(classification)
      ? [{
          id: `${game.id}#${move.index}` as TrainingItemId,
          gameId: game.id,
          index: move.index,
          input: move.before.input,
          lastMove: game.moves[move.index - 1]?.uci ?? null,
          played: { san: move.san, uci: move.uci, classification },
          best,
          bestLineSan,
          alternative,
          schedule: { box: 0, due: now, last: null },
        }]
      : [],
  )
}

/** What saving `review` writes, given the items its game already has. Reviewing a game again yields the same ids,
 *  so each item that stays keeps its schedule; an item the new review no longer marks goes away. */
export function syncItems(existing: readonly TrainingItem[], review: GameReview, now: number): { put: TrainingItem[]; remove: TrainingItemId[] } {
  const schedules = new Map(existing.map((i) => [i.id, i.schedule]))
  const put = trainingItems(review, now).map((i) => ({ ...i, schedule: schedules.get(i.id) ?? i.schedule }))
  const kept = new Set(put.map((i) => i.id))
  return { put, remove: existing.filter((i) => !kept.has(i.id)).map((i) => i.id) }
}

/** Leitner boxes. Right moves the item up a box and waits that box's interval; wrong sends it back to box 0, for tomorrow.
 *  An answer before the due day is practice and changes nothing: an early right answer would stretch the interval
 *  without testing the forgetting it waits for, and retrying a missed item at once would erase the miss. */
export function nextSchedule(s: Schedule, correct: boolean, now: number): Schedule {
  if (s.due > now) return s
  const box = correct ? Math.min(s.box + 1, TRAINING.intervalDays.length - 1) : 0
  return { box, due: addDays(startOfDay(now), TRAINING.intervalDays[box]), last: { at: now, correct } }
}

/** A session's queue after the answer to its item at `at`. A miss comes back once at the end, to be tried again in the same
 *  sitting. The retry is practice: the miss already set the item due tomorrow, and an answer before that changes nothing. */
export function requeue(queue: readonly TrainingItem[], at: number, correct: boolean): readonly TrainingItem[] {
  const item = queue[at]
  return correct || queue.filter((i) => i.id === item.id).length > 1 ? queue : [...queue, item]
}

/** Whether the session already asked the item at `at` earlier on. */
export function isRetry(queue: readonly TrainingItem[], at: number): boolean {
  return queue.findIndex((i) => i.id === queue[at].id) < at
}

/** Due items, oldest due first, then the rest in the order they come due. */
export function trainingQueue(items: readonly TrainingItem[], now: number): { due: TrainingItem[]; later: TrainingItem[] } {
  const sorted = [...items].sort((a, b) => a.schedule.due - b.schedule.due || a.gameId.localeCompare(b.gameId) || a.index - b.index)
  return { due: sorted.filter((i) => i.schedule.due <= now), later: sorted.filter((i) => i.schedule.due > now) }
}

export type TrainingProgress = { readonly due: number; readonly done: number; readonly right: number }

/** Due now, and answered today with how many right. */
export function trainingProgress(items: readonly TrainingItem[], now: number): TrainingProgress {
  const today = startOfDay(now)
  const answered = items.flatMap((i) => (i.schedule.last && i.schedule.last.at >= today ? [i.schedule.last] : []))
  return { due: items.filter((i) => i.schedule.due <= now).length, done: answered.length, right: answered.filter((a) => a.correct).length }
}

/** The position the item asks about. A stored item always has one, since it was saved from a reviewed game. */
export function itemPosition(item: TrainingItem): PlayablePosition {
  const p = playableAt(item.input, item.index)
  if (!p) throw new Error(`training item ${item.id} has no position`)
  return p
}

/** The stored lines settle the best move, the move played in the game and the second engine line. Any other move is
 *  searched, and judged like the review judges a move: win% at the best line before against the eval after. */
export async function checkAnswer(item: TrainingItem, move: Uci, evaluate: (p: PlayablePosition) => Promise<SearchedEval>): Promise<Verdict> {
  if (move === item.best.pv[0]) return 'best'
  if (move === item.played.uci) return 'wrong'
  const answer = playMove(itemPosition(item), move)
  if (!answer) throw new Error(`${move} is not legal in training item ${item.id}`)
  const { mover, after } = answer
  const won =
    item.alternative?.pv[0] === move ? winPct(item.alternative.score, mover)
    : after.kind === 'playable' ? winPct((await evaluate(after)).lines[0].score, mover)
    : after.kind === 'checkmate' ? winPct({ kind: 'checkmate', loser: after.turn }, mover)
    : winPct({ kind: 'stalemate' }, mover)
  return winPct(item.best.score, mover) - won < TRAINING.acceptLoss ? 'close' : 'wrong'
}

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function addDays(t: number, days: number): number {
  const d = new Date(t)
  d.setDate(d.getDate() + days)
  return d.getTime()
}
