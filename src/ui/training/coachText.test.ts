import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import type { Coach, NonEmpty, SearchedEval, Uci } from '../../domain'
import { COACH_START, explain, loadTree, stepCoach, type CoachEvent, type CoachState, type EvalsOf, type Explanation } from '../../openings'
import { engineText, factsText, placeText, suggestionsText, theoryText } from './coachText'

const NONE = new Map<string, number>()
const reply = (roll: number): CoachEvent => ({ kind: 'reply', roll, played: NONE })
const move = (uci: string): CoachEvent => ({ kind: 'move', uci: uci as Uci })
const run = (coach: Coach, ...events: CoachEvent[]) => events.reduce<CoachState>((s, e) => stepCoach(coach, s, e), COACH_START)
const line = (cp: number, pv: string) => ({ score: { kind: 'cp', white: cp } as const, pv: pv.split(' ') as unknown as NonEmpty<Uci> })

function fen(moves: string): string {
  const board = new Chess()
  for (const uci of moves.split(' ')) board.move(uci)
  return board.fen()
}
/** Evaluations of the positions after these moves; any other is still being searched. */
function evals(table: Record<string, SearchedEval['lines']>): EvalsOf {
  const byFen = new Map(Object.entries(table).map(([moves, lines]) => [fen(moves), { lines, depth: 18 }]))
  return (p) => {
    const found = byFen.get(p.fen)
    return found ? { kind: 'done', eval: found } : { kind: 'pending' }
  }
}
const ITALIAN = 'e2e4 e7e5 g1f3 b8c6 f1c4'
const ENGINE = evals({
  'e2e4 e7e5 g1f3': [line(30, 'b8c6 f1b5'), line(35, 'g8f6 d2d4 f6e4')],
  'e2e4 e7e5 g1f3 b8c6': [line(30, 'f1b5 a7a6'), line(20, 'f1c4 f8c5 c2c3')],
  [ITALIAN]: [line(20, 'f8c5 c2c3 g8f6')],
  [`${ITALIAN} f8c5`]: [line(20, 'e1g1 g8f6 d2d3'), line(10, 'c2c3 g8f6 d2d4 e5d4')],
  [`${ITALIAN} f8c5 f3g5`]: [line(-560, 'd8g5 e1g1 g5g2')],
})
const text = (e: Explanation) =>
  [theoryText(e), e.theory.kind === 'book' ? placeText(e.theory.reached) : '', factsText(e.facts), engineText(e), suggestionsText(e)].filter(Boolean)

describe('the coach on the Italian Game', async () => {
  const tree = await loadTree()
  const book = tree.book(tree.family('Italian Game')!)
  const white: Coach = { book, color: 'w' }
  const black: Coach = { book, color: 'b' }
  const giuoco = run(white, move('e2e4'), reply(0), move('g1f3'), reply(0), move('f1c4'), reply(0))

  it("explains my main move and the coach's answer by what they do, their theory and the line the engine expects", () => {
    const [bc4, bc5] = explain(white, giuoco, ENGINE).plies.slice(4).map(text)
    expect(bc4).toEqual([
      'É o lance principal desta abertura aqui, em 99% das partidas fortes.',
      'Posição: Abertura Italiana.',
      'Desenvolve o bispo para c4, ataca o peão de f7, que só o rei defende, e libera o roque pequeno.',
      'Avaliação +0.2 (era +0.3): excelente. A sequência mais forte segue 3…Bc5 4.c3.',
    ])
    expect(bc5).toEqual([
      'É o lance principal desta abertura aqui, em 50% das partidas fortes.',
      'Posição: Abertura Italiana: Giuoco Piano.',
      'Desenvolve o bispo para c5, ataca o peão de f2, que só o rei defende, e controla a casa central d4.',
      'Avaliação +0.2: é o lance da engine. A sequência mais forte segue 4.c3 Nf6.',
    ])
  })

  it('names the most played move next to a second choice', () => {
    expect(text(explain(white, stepCoach(white, giuoco, move('c2c3')), ENGINE).plies[6])).toEqual([
      'É teoria desta abertura, em 30% das partidas fortes daqui. O mais jogado é 4.O-O, com 51%.',
      'Posição: Abertura Italiana: Classical Variation.',
      'Prepara o avanço do peão para d4 e abre caminho para a dama.',
      'Avaliação +0.1 (era +0.2): excelente. A sequência mais forte segue 4…Nf6 5.d4 exd4.',
    ])
  })

  it("explains a move out of the book against the main move, with the engine's answer and what theory plays instead", () => {
    expect(text(explain(white, stepCoach(white, giuoco, move('f3g5')), ENGINE).departure!)).toEqual([
      '4.Ng5 não é teoria desta abertura.',
      'Deixa o cavalo de g5 à mercê da dama, ataca o peão de f7, que só o rei defende, e move o cavalo de novo, com peças ainda por desenvolver.',
      'Avaliação -5.6, contra +0.2 depois de 4.O-O: blunder, perde 41% de chance de vitória. A resposta da engine é 4…Qxg5, que captura o cavalo de g5 e ataca o peão de g2, que está sem defesa, seguida de 5.O-O.',
      'Aqui a teoria joga 4.O-O (51%), que faz o roque pequeno e tira o rei do centro; 4.c3 (30%), que prepara o avanço do peão para d4 e abre caminho para a dama; ou 4.d3 (16%), que abre caminho para o bispo.',
    ])
  })

  it("names another opening's theory and what the chosen opening plays here", () => {
    expect(text(explain(black, run(black, reply(0), move('e7e5'), reply(0), move('g8f6')), ENGINE).departure!)).toEqual([
      '2…Nf6 é teoria, mas de outra abertura: Defesa Petrov.',
      'Desenvolve o cavalo para f6, ataca o peão de e4, que está sem defesa, e controla a casa central d5.',
      'Avaliação +0.4, contra +0.3 depois de 2…Nc6: excelente. A resposta da engine é 3.d4, que desafia o peão de e5, ocupa o centro em d4 e abre caminho para o bispo e a dama, seguida de 3…Nxe4.',
      'Nesta abertura, as pretas jogam aqui 2…Nc6, que desenvolve o cavalo para c6, defende o peão de e5 e controla a casa central d4.',
    ])
  })

  it('says the engine is still thinking, or why it has no answer', () => {
    const [e4] = explain(white, giuoco, () => ({ kind: 'pending' })).plies
    expect(engineText(e4)).toBe('Avaliando…')
    const [failed] = explain(white, giuoco, () => ({ kind: 'failed', reason: { kind: 'timeout', during: 'search' } })).plies
    expect(engineText(failed)).toBe('Sem avaliação. A engine não respondeu a tempo.')
  })
})
