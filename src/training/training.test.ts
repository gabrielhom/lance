import { describe, expect, it } from 'vitest'
import type { EvalLine, Fen, PlayablePosition, San, Schedule, SearchedEval, TrainingItem, Uci } from '../domain'
import { checkAnswer, isRetry, nextSchedule, requeue, syncItems, trainingItems, trainingProgress, trainingQueue } from '.'
import { operaReview } from './testing'

const NOW = new Date(2026, 9, 24, 20, 0).getTime()
const ROOT = 'rn2kb1r/pp2qppp/2p2n2/4p3/2B1P3/1QN5/PPP2PPP/R1B1K2R w KQkq - 0 9' as Fen

const B5: TrainingItem = {
  id: 'pgn:2dbw2vp1o9w#17' as TrainingItem['id'],
  gameId: 'pgn:2dbw2vp1o9w' as TrainingItem['gameId'],
  index: 17,
  input: { root: ROOT, tail: ['c1g5' as Uci] },
  lastMove: 'c1g5' as Uci,
  played: { san: 'b5' as TrainingItem['played']['san'], uci: 'b7b5' as Uci, classification: 'blunder' },
  best: { score: { kind: 'cp', white: 0 }, pv: ['a7a6' as Uci] },
  bestLineSan: ['a6' as San],
  alternative: null,
  schedule: { box: 0, due: NOW, last: null },
}

describe('trainingItems', () => {
  it('turns my blunder into the position before it, due at once', () => {
    expect(trainingItems(operaReview({ kind: 'me', color: 'b' }), NOW)).toEqual([B5])
  })

  it('takes nothing from the side without mistakes or from a spectator', () => {
    expect(trainingItems(operaReview({ kind: 'me', color: 'w' }), NOW)).toEqual([])
    expect(trainingItems(operaReview({ kind: 'spectator' }), NOW)).toEqual([])
  })
})

describe('syncItems', () => {
  const review = operaReview({ kind: 'me', color: 'b' })
  const answered: Schedule = { box: 2, due: NOW + 5, last: { at: NOW - 5, correct: true } }

  it('adds the items of a game reviewed for the first time', () => {
    expect(syncItems([], review, NOW)).toEqual({ put: [B5], remove: [] })
  })

  it('keeps the schedule of an item a second review still marks and drops one it no longer marks', () => {
    const gone = { ...B5, id: 'pgn:2dbw2vp1o9w#3' as TrainingItem['id'], index: 3 }
    expect(syncItems([{ ...B5, schedule: answered }, gone], review, NOW + 1000)).toEqual({
      put: [{ ...B5, schedule: answered }],
      remove: ['pgn:2dbw2vp1o9w#3'],
    })
  })
})

describe('nextSchedule', () => {
  const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()
  const fresh: Schedule = { box: 0, due: at(2026, 10, 24, 9), last: null }

  it('moves a right answer up a box and brings it back after that box\'s interval', () => {
    expect(nextSchedule(fresh, true, at(2026, 10, 24, 20))).toEqual({ box: 1, due: at(2026, 10, 27), last: { at: at(2026, 10, 24, 20), correct: true } })
    expect(nextSchedule({ box: 2, due: at(2026, 10, 24), last: null }, true, at(2026, 10, 24, 8))).toMatchObject({ box: 3, due: at(2026, 11, 7) })
  })

  it('stays in the last box', () => {
    expect(nextSchedule({ box: 4, due: at(2026, 10, 24), last: null }, true, at(2026, 10, 24, 8))).toMatchObject({ box: 4, due: at(2026, 11, 23) })
  })

  it('sends a wrong answer back to box 0, due tomorrow', () => {
    expect(nextSchedule({ box: 3, due: at(2026, 10, 20), last: null }, false, at(2026, 10, 24, 23))).toEqual({
      box: 0,
      due: at(2026, 10, 25),
      last: { at: at(2026, 10, 24, 23), correct: false },
    })
  })

  it('leaves an item answered before its day as it was', () => {
    const waiting: Schedule = { box: 1, due: at(2026, 10, 27), last: { at: at(2026, 10, 24, 20), correct: true } }
    expect(nextSchedule(waiting, false, at(2026, 10, 26, 12))).toEqual(waiting)
  })
})

const item = (index: number, due: number, last: Schedule['last'] = null): TrainingItem => ({
  ...B5,
  id: `pgn:2dbw2vp1o9w#${index}` as TrainingItem['id'],
  index,
  schedule: { box: 0, due, last },
})

describe('trainingQueue', () => {
  it('asks the oldest due first, then holds the rest in the order they come due', () => {
    const items = [item(9, NOW + 200), item(5, NOW), item(3, NOW - 100), item(1, NOW), item(7, NOW + 100)]
    const { due, later } = trainingQueue(items, NOW)
    expect(due.map((i) => i.index)).toEqual([3, 1, 5])
    expect(later.map((i) => i.index)).toEqual([7, 9])
  })
})

describe('the session queue', () => {
  const [a, b] = [item(1, NOW), item(3, NOW)]
  const ids = (queue: readonly TrainingItem[]) => queue.map((i) => i.id)

  it('brings a missed item back once at the end of the session', () => {
    expect(ids(requeue([a, b], 0, false))).toEqual(['pgn:2dbw2vp1o9w#1', 'pgn:2dbw2vp1o9w#3', 'pgn:2dbw2vp1o9w#1'])
    expect(ids(requeue([a, b, a], 2, false))).toEqual(['pgn:2dbw2vp1o9w#1', 'pgn:2dbw2vp1o9w#3', 'pgn:2dbw2vp1o9w#1'])
  })

  it('leaves the queue alone after a right answer, so the session still ends', () => {
    expect(ids(requeue([a, b], 1, true))).toEqual(['pgn:2dbw2vp1o9w#1', 'pgn:2dbw2vp1o9w#3'])
  })

  it('tells the retry from the first time the item was asked', () => {
    expect([0, 1, 2].map((at) => isRetry([a, b, a], at))).toEqual([false, false, true])
  })
})

describe('trainingProgress', () => {
  it('counts what is due and what was answered since midnight', () => {
    const midnight = new Date(2026, 9, 24).getTime()
    const items = [
      item(1, NOW),
      item(3, NOW + 1, { at: midnight + 10, correct: true }),
      item(5, NOW + 1, { at: midnight + 20, correct: false }),
      item(7, NOW + 1, { at: midnight - 10, correct: true }),
    ]
    expect(trainingProgress(items, NOW)).toEqual({ due: 1, done: 2, right: 1 })
  })
})

describe('checkAnswer', () => {
  const never = () => Promise.reject(new Error('should not search'))
  const searched = (white: number) => async (): Promise<SearchedEval> => ({ depth: 18, lines: [{ score: { kind: 'cp', white }, pv: ['e1c1' as Uci] }] })
  const withAlternative = (white: number): TrainingItem => ({ ...B5, alternative: { score: { kind: 'cp', white }, pv: ['h7h6' as Uci] } as EvalLine })

  it('settles the best move and the move played in the game without the engine', async () => {
    expect(await checkAnswer(B5, 'a7a6' as Uci, never)).toBe('best')
    expect(await checkAnswer(B5, 'b7b5' as Uci, never)).toBe('wrong')
  })

  it('accepts the second engine line when it loses less than the margin, without the engine', async () => {
    expect(await checkAnswer(withAlternative(20), 'h7h6' as Uci, never)).toBe('close')
    expect(await checkAnswer(withAlternative(30), 'h7h6' as Uci, never)).toBe('wrong')
  })

  it('searches any other move from the position it leads to and judges the loss', async () => {
    const seen: PlayablePosition[] = []
    const evaluate = async (p: PlayablePosition) => {
      seen.push(p)
      return searched(10)()
    }
    expect(await checkAnswer(B5, 'b8d7' as Uci, evaluate)).toBe('close')
    expect(seen.map((p) => p.input)).toEqual([{ root: ROOT, tail: ['c1g5', 'b8d7'] }])
    expect(await checkAnswer(B5, 'b8d7' as Uci, searched(50))).toBe('wrong')
  })
})
