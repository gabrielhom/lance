import { describe, expect, it } from 'vitest'
import type { Coach, Fen, Uci } from '../domain'
import { COACH_START, coachAt, coachSummary, coachTurn, pickReply, stepCoach, withPlayed, type CoachEvent, type CoachState, type PlayedCounts } from './coach'
import { buildTree, loadTree } from './lines'
import { FILE, POPULARITY } from './testing'

const tree = buildTree(FILE, POPULARITY)
const black: Coach = { book: tree.book(tree.family('Sicilian Defense')!), color: 'b' }
const NONE: PlayedCounts = new Map()
const reply = (roll: number, played = NONE): CoachEvent => ({ kind: 'reply', roll, played })
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

  const at = coachAt(black, sicilian)
  const [d4, nf3, c3] = [at.moves.find((m) => m.san === 'd4')!, at.moves.find((m) => m.san === 'Nf3')!, at.moves.find((m) => m.san === 'c3')!]

  it('samples by share among the moves played least from here', () => {
    expect(pickReply(at, 0.5, NONE, 0).san).toBe('d4')
    expect(pickReply(at, 0, withPlayed(NONE, at, d4.uci), 0).san).toBe('Nf3')
    expect(pickReply(at, 0.5, withPlayed(withPlayed(NONE, at, d4.uci), at, nf3.uci), 0).san).toBe('c3')
  })

  it('restarts the cycle once every candidate was played, and counts transpositions as one position', () => {
    const all = [d4, nf3, c3].reduce((p, m) => withPlayed(p, at, m.uci), NONE)
    expect(pickReply(at, 0, withPlayed(all, at, d4.uci), 0).san).toBe('Nf3')
    expect(pickReply(at, 0.5, all, 0).san).toBe('d4')
    expect(pickReply({ ...at, fen: at.fen.replace(/ \d+ \d+$/, ' 9 9') as Fen }, 0, withPlayed(NONE, at, d4.uci), 0).san).toBe('Nf3')
  })

  it('leaves out moves with fewer games than the minimum, unless none has enough', () => {
    expect(pickReply(at, 0.99, NONE, 0).san).toBe('c3')
    expect(pickReply(at, 0.99, NONE, d4.games).san).toBe('d4')
    expect(pickReply(at, 0.99, NONE, Infinity).san).toBe('c3')
  })
})

describe('coachSummary', () => {
  it('names the deepest position of the family reached and counts my moves, first tries and departures', () => {
    const s = run(black, reply(0), move('e7e6'), { kind: 'retry' }, move('g7g5'), { kind: 'retry' }, move('c7c5'), reply(0))
    expect(coachSummary(black, s)).toMatchObject({ reached: { name: 'Sicilian Defense: Smith-Morra Gambit' }, myMoves: 1, firstTry: 0, offBook: 0, otherOpening: 1 })
  })
})

describe('rounds against the real Sicilian Defense', () => {
  it('does not open the same variation every round when I always answer with the first book move', async () => {
    const real = await loadTree()
    const coach: Coach = { book: real.book(real.family('Sicilian Defense')!), color: 'b' }
    let played: PlayedCounts = NONE
    const whiteSecond: string[] = []
    for (let round = 0; round < 4; round++) {
      let s = COACH_START
      while (coachTurn(coach, s) !== 'done') {
        const here = coachAt(coach, s)
        const theirs = coachTurn(coach, s) === 'theirs'
        s = stepCoach(coach, s, theirs ? reply(0, played) : move(here.moves[0].uci))
        if (theirs) played = withPlayed(played, here, s.plies.at(-1)!.uci)
      }
      whiteSecond.push(s.plies[2].san)
    }
    expect(whiteSecond).toEqual(['Nf3', 'Nc3', 'c3', 'Nf3'])
  })
})
