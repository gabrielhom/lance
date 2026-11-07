import { describe, expect, it } from 'vitest'
import type { BookPosition, Coach, Uci } from '../domain'
import { COACH_START, coachAt, coachSummary, coachTurn, pickReply, stepCoach, type CoachEvent, type CoachState } from './coach'
import { buildTree } from './lines'
import { FILE, POPULARITY } from './testing'

const tree = buildTree(FILE, POPULARITY)
const black: Coach = { book: tree.book(tree.family('Sicilian Defense')!), color: 'b' }
const NONE: ReadonlySet<BookPosition> = new Set()
const reply = (roll: number, seen = NONE): CoachEvent => ({ kind: 'reply', roll, seen })
const move = (uci: string): CoachEvent => ({ kind: 'move', uci: uci as Uci })
const run = (coach: Coach, ...events: CoachEvent[]) => events.reduce<CoachState>((s, e) => stepCoach(coach, s, e), COACH_START)
const sans = (s: CoachState) => s.plies.map((p) => p.san).join(' ')

describe('stepCoach', () => {
  it("plays the coach's side by the share of strong games and follows any book move of mine", () => {
    const s = run(black, reply(0), move('c7c5'))
    expect([sans(s), coachTurn(black, s)]).toEqual(['e4 c5', 'theirs'])
    expect(sans(stepCoach(black, s, reply(0.59)))).toBe('e4 c5 d4')
    expect(sans(stepCoach(black, s, reply(0.6)))).toBe('e4 c5 Nf3')
    expect(sans(stepCoach(black, s, reply(0.99)))).toBe('e4 c5 c3')
  })

  it('ends the round where the family has no move left', () => {
    const s = run(black, reply(0), move('c7c5'), reply(0))
    expect(coachTurn(black, s)).toBe('done')
    expect(stepCoach(black, s, reply(0))).toBe(s)
  })

  it('stands a move of another opening on the board, named, until I take it back, and counts the ply once', () => {
    const off = run(black, reply(0), move('e7e6'))
    expect(off.departure).toEqual({ uci: 'e7e6', san: 'e6', opening: { eco: 'C00', name: 'French Defense' } })
    expect(coachTurn(black, off)).toBe('departed')
    expect(stepCoach(black, off, move('c7c5'))).toBe(off)
    const back = stepCoach(black, off, { kind: 'retry' })
    expect([back.plies, back.departure]).toEqual([off.plies, null])
    const again = stepCoach(black, back, move('a7a6'))
    expect([again.departure, again.slips]).toEqual([{ uci: 'a7a6', san: 'a6', opening: null }, [{ ply: 1, otherOpening: true }]])
  })

  it('takes nothing back when nothing departed and ignores my move on its turn', () => {
    expect(stepCoach(black, COACH_START, { kind: 'retry' })).toBe(COACH_START)
    expect(stepCoach(black, COACH_START, move('e2e4'))).toBe(COACH_START)
  })
})

describe('pickReply', () => {
  const sicilian = run(black, reply(0), move('c7c5'))

  it('plays less often a move whose every line ended an earlier round', () => {
    const morra = coachAt(black, stepCoach(black, sicilian, reply(0)))
    const at = coachAt(black, sicilian)
    expect(pickReply(at, 0.5, NONE).san).toBe('d4')
    expect(pickReply(at, 0.5, new Set([morra])).san).toBe('Nf3')
    expect(pickReply(at, 0.2, new Set([morra])).san).toBe('d4')
  })
})

describe('coachSummary', () => {
  it('names the deepest position of the family reached and counts my moves, first tries and departures', () => {
    const s = run(black, reply(0), move('e7e6'), { kind: 'retry' }, move('g7g5'), { kind: 'retry' }, move('c7c5'), reply(0))
    expect(coachSummary(black, s)).toMatchObject({ reached: { name: 'Sicilian Defense: Smith-Morra Gambit' }, myMoves: 1, firstTry: 0, offBook: 0, otherOpening: 1 })
  })
})
