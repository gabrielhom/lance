import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import type { Coach, NonEmpty, SearchedEval, Uci } from '../domain'
import { COACH_START, stepCoach, type CoachEvent, type CoachState } from './coach'
import { explain, type EvalsOf } from './explain'
import { buildTree } from './lines'
import { FILE, POPULARITY } from './testing'

const tree = buildTree(FILE, POPULARITY)
const black: Coach = { book: tree.book(tree.family('Sicilian Defense')!), color: 'b' }
const NONE = new Map<string, number>()
const reply: CoachEvent = { kind: 'reply', roll: 0, played: NONE }
const move = (uci: string): CoachEvent => ({ kind: 'move', uci: uci as Uci })
const run = (coach: Coach, ...events: CoachEvent[]) => events.reduce<CoachState>((s, e) => stepCoach(coach, s, e), COACH_START)
const kinds = (facts: readonly { kind: string }[]) => facts.map((f) => f.kind)

function fen(moves: string): string {
  const board = new Chess()
  for (const uci of moves.split(' ').filter(Boolean)) board.move(uci)
  return board.fen()
}
const line = (cp: number, pv: string) => ({ score: { kind: 'cp', white: cp } as const, pv: pv.split(' ') as unknown as NonEmpty<Uci> })
/** Evaluations of the positions after these moves; any other position is still being searched. */
function evals(table: Record<string, SearchedEval['lines']>): EvalsOf {
  const byFen = new Map(Object.entries(table).map(([moves, lines]) => [fen(moves), { lines, depth: 18 }]))
  return (p) => {
    const found = byFen.get(p.fen)
    return found ? { kind: 'done', eval: found } : { kind: 'pending' }
  }
}
const ENGINE = evals({
  '': [line(30, 'e2e4 c7c5 g1f3')],
  e2e4: [line(25, 'e7e5 g1f3'), line(35, 'c7c5 g1f3 d7d6')],
  'e2e4 c7c5': [line(30, 'g1f3 d7d6')],
  'e2e4 g7g5': [line(150, 'd2d4 h7h6 c2c4')],
})

describe('explain', () => {
  const sicilian = run(black, reply, move('c7c5'))

  it("explains every ply by what it does and its theory before the engine answers, and asks first for the board's position", () => {
    const { plies, departure, wanted } = explain(black, sicilian, () => ({ kind: 'pending' }))
    expect(plies.map((p) => [p.move.san, p.by])).toEqual([['e4', 'coach'], ['c5', 'me']])
    expect(kinds(plies[0].facts)).toEqual(['occupies-center', 'opens-line', 'controls-center'])
    expect(plies[1].theory).toMatchObject({ kind: 'book', rank: 0, of: 1, share: 1, games: 100, main: { san: 'c5' }, reached: { line: { name: 'Sicilian Defense' } } })
    expect(plies[1].engine).toEqual({ kind: 'pending' })
    expect(departure).toBeNull()
    expect(wanted.map((p) => p.fen)).toEqual([fen('e2e4 c7c5'), fen('e2e4'), fen('')])
  })

  it("judges a move heading the engine's first or second line by that line, and shows the engine's next moves", () => {
    const [e4, c5] = explain(black, sicilian, ENGINE).plies
    expect(e4.engine).toMatchObject({ kind: 'judged', before: { kind: 'cp', white: 30 }, after: { kind: 'cp', white: 30 }, loss: 0, band: 'top', reply: { sans: ['c5', 'Nf3'] }, compared: null })
    expect(c5.engine).toMatchObject({ kind: 'judged', before: { kind: 'cp', white: 25 }, after: { kind: 'cp', white: 35 }, band: 'excellent', reply: { sans: ['Nf3', 'd6'] }, compared: null })
    expect(c5.engine.kind === 'judged' && c5.engine.loss).toBeCloseTo(0.918, 3)
  })

  it("explains a move out of the book with the family's moves here, the engine's answer and the main move's score", () => {
    const off = run(black, reply, move('g7g5'))
    const { departure, wanted } = explain(black, off, ENGINE)
    expect(departure!.theory).toMatchObject({ kind: 'off-book', book: [{ move: { san: 'c5', share: 1 } }] })
    expect(departure!.engine).toMatchObject({ kind: 'judged', after: { kind: 'cp', white: 150 }, band: 'mistake', reply: { sans: ['d4', 'h6'] }, compared: { san: 'c5', after: { kind: 'cp', white: 35 } } })
    expect(departure!.engine.kind === 'judged' && kinds(departure!.engine.reply!.facts)).toEqual(['occupies-center', 'opens-line', 'controls-center'])
    expect(departure!.engine.kind === 'judged' && departure!.engine.loss).toBeCloseTo(11.168, 3)
    expect(wanted.map((p) => p.fen)).toEqual([fen('e2e4'), fen('e2e4 g7g5'), fen('')])
  })

  it('names another opening and still shows what the family plays here', () => {
    const { departure } = explain(black, run(black, reply, move('e7e6')), () => ({ kind: 'pending' }))
    expect(departure!.theory).toMatchObject({ kind: 'other-opening', opening: { name: 'French Defense' }, book: [{ move: { san: 'c5' } }] })
    expect(kinds(departure!.facts)).toEqual(['prepares-push', 'opens-line'])
  })

  it('keeps the facts and theory when the engine fails', () => {
    const [, c5] = explain(black, sicilian, () => ({ kind: 'failed', reason: { kind: 'timeout', during: 'search' } })).plies
    expect(c5.engine).toEqual({ kind: 'failed', reason: { kind: 'timeout', during: 'search' } })
    expect(c5.theory.kind).toBe('book')
  })

  it('calls a move the position does not list but the family reaches by another order a transposition', () => {
    const lines = buildTree({
      ...FILE,
      lines: [
        ['D32', "Queen's Gambit Declined: Tarrasch Defense", 'd2d4 d7d5 c2c4 e7e6 b1c3 c7c5', 'd4 d5 c4 e6 Nc3 c5'],
        ['D37', "Queen's Gambit Declined: Three Knights", 'd2d4 d7d5 c2c4 g8f6 b1c3 e7e6', 'd4 d5 c4 Nf6 Nc3 e6'],
      ],
    }, {})
    const qgd: Coach = { book: lines.book(lines.family("Queen's Gambit Declined")!), color: 'b' }
    const s = run(qgd, reply, move('d7d5'), reply, move('e7e6'), reply, move('g8f6'))
    expect(explain(qgd, s, () => ({ kind: 'pending' })).plies[5].theory).toMatchObject({ kind: 'transposition', reached: { line: { name: "Queen's Gambit Declined: Three Knights" } } })
  })
})
