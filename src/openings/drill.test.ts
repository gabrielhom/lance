import { describe, expect, it } from 'vitest'
import type { BookMove, Drill, LineId, San, Uci, Variation } from '../domain'
import { DRILL_START, drillHint, drillNames, drillOutcome, drillTurn, stepDrill, type DrillState } from './drill'

const uci = (s: string) => s as Uci
const FRENCH: BookMove = { san: 'e6' as San, opening: { eco: 'C00', name: 'French Defense' }, sameFamily: false }
const DRAGON: BookMove = { san: 'g6' as San, opening: { eco: 'B27', name: 'Sicilian Defense: Hyperaccelerated Dragon' }, sameFamily: true }
const MODERN: Variation = {
  line: {
    id: 'e2e4 c7c5 g1f3 d7d6' as LineId,
    eco: 'B50',
    name: 'Sicilian Defense: Modern Variations',
    family: 'Sicilian Defense',
    moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6'].map(uci),
    sans: ['e4', 'c5', 'Nf3', 'd6'] as San[],
  },
  path: ['Modern Variations'],
  distinctFrom: null,
}
const NAMES = [{ eco: 'B00', name: "King's Pawn Game" }, { eco: 'B20', name: 'Sicilian Defense' }, null, { eco: 'B50', name: 'Sicilian Defense: Modern Variations' }]
/** Playing the Modern as Black: at 1...c5 the French is theory elsewhere; at 3...d6 the Dragon is another Sicilian. */
const drill = (learn: boolean, color: 'w' | 'b' = 'b'): Drill => ({
  variation: MODERN,
  color,
  learn,
  book: new Map([
    [1, new Map([[uci('e7e6'), FRENCH]])],
    [3, new Map([[uci('g7g6'), DRAGON]])],
  ]),
  names: NAMES,
})
const recall = drill(false)
const at = (ply: number, misses: number[] = []): DrillState => ({ ply, misses, feedback: null })

describe('stepDrill', () => {
  it("plays the opponent's reply and clears the feedback", () => {
    expect(stepDrill(recall, DRILL_START, { kind: 'reply' })).toEqual(at(1))
    const after = stepDrill(recall, { ...at(1), feedback: { kind: 'miss', move: uci('a7a6'), book: null } }, { kind: 'move', uci: uci('c7c5') })
    expect(stepDrill(recall, after, { kind: 'reply' })).toEqual(at(3))
  })

  it("advances on the line's move, clearing the feedback and keeping the misses so far", () => {
    const missed = stepDrill(recall, at(1), { kind: 'move', uci: uci('a7a6') })
    expect(stepDrill(recall, missed, { kind: 'move', uci: uci('c7c5') })).toEqual(at(2, [1]))
  })

  it('names another variation of the family and keeps the board and the misses as they were', () => {
    expect(stepDrill(recall, at(3), { kind: 'move', uci: uci('g7g6') })).toEqual({ ply: 3, misses: [], feedback: { kind: 'variation', move: 'g7g6', book: DRAGON } })
  })

  it("counts any other move as a miss at that ply, once, naming it when it is another family's theory", () => {
    const first = stepDrill(recall, at(1), { kind: 'move', uci: uci('e7e6') })
    expect(first).toEqual({ ply: 1, misses: [1], feedback: { kind: 'miss', move: 'e7e6', book: FRENCH } })
    expect(stepDrill(recall, first, { kind: 'move', uci: uci('a7a6') })).toEqual({ ply: 1, misses: [1], feedback: { kind: 'miss', move: 'a7a6', book: null } })
  })

  it('returns the same state for an event out of turn or after the end', () => {
    const theirs = DRILL_START
    const mine = at(1)
    const done = at(4)
    expect(stepDrill(recall, theirs, { kind: 'move', uci: uci('e2e4') })).toBe(theirs)
    expect(stepDrill(recall, mine, { kind: 'reply' })).toBe(mine)
    expect(stepDrill(recall, done, { kind: 'reply' })).toBe(done)
    expect(stepDrill(recall, done, { kind: 'move', uci: uci('d2d4') })).toBe(done)
  })

  it("finishes a line that ends on the opponent's move with their reply", () => {
    const white = drill(false, 'w')
    const state = stepDrill(white, at(3), { kind: 'reply' })
    expect(drillTurn(white, state)).toBe('done')
    expect(drillOutcome(white, state)).toBe('clean')
  })
})

describe('drillTurn', () => {
  it('is mine on my plies, theirs on the others and done once the line is on the board', () => {
    expect([0, 1, 2, 3, 4].map((ply) => drillTurn(recall, at(ply)))).toEqual(['theirs', 'mine', 'theirs', 'mine', 'done'])
    expect([0, 1, 4].map((ply) => drillTurn(drill(false, 'w'), at(ply)))).toEqual(['mine', 'theirs', 'done'])
  })
})

describe('drillHint', () => {
  it("shows the line's move on every one of my turns while learning", () => {
    expect([0, 1, 2, 3, 4].map((ply) => drillHint(drill(true), at(ply)))).toEqual([null, 'c7c5', null, 'd7d6', null])
  })

  it('shows it from memory only after a miss at that ply, until I play it', () => {
    expect(drillHint(recall, at(1))).toBeNull()
    expect(drillHint(recall, at(1, [1]))).toBe('c7c5')
    expect(drillHint(recall, at(3, [1]))).toBeNull()
  })
})

describe('drillOutcome', () => {
  it('is nothing until the end, then learned for a first drill, clean or missed from memory', () => {
    expect(drillOutcome(recall, at(3))).toBeNull()
    expect(drillOutcome(drill(true), at(4))).toBe('learned')
    expect(drillOutcome(drill(true), at(4, [1]))).toBe('learned')
    expect(drillOutcome(recall, at(4))).toBe('clean')
    expect(drillOutcome(recall, at(4, [3]))).toBe('missed')
  })
})

describe('drillNames', () => {
  it('lists the names passed so far, each once, skipping unnamed positions', () => {
    const repeated: Drill = { ...recall, names: [NAMES[0], NAMES[1], NAMES[1], NAMES[3]] }
    expect(drillNames(repeated, at(0))).toEqual([])
    expect(drillNames(repeated, at(3)).map((o) => o.name)).toEqual(["King's Pawn Game", 'Sicilian Defense'])
    expect(drillNames(recall, at(4)).map((o) => o.eco)).toEqual(['B00', 'B20', 'B50'])
  })
})
