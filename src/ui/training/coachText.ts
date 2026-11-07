import { evalLabel, type FactKind, type MoveFact } from '../../analysis'
import type { BookContinuation, BookPosition, Opening, PieceKind, San } from '../../domain'
import type { Band, Explanation, Suggestion } from '../../openings'
import { colorLabel, moveNumberLabel } from '../format'
import { engineFailureText } from '../labels'
import { openingName } from '../openingNames'

const PIECE: Readonly<Record<PieceKind, { readonly the: string; readonly of: string }>> = {
  p: { the: 'o peão', of: 'do peão' },
  n: { the: 'o cavalo', of: 'do cavalo' },
  b: { the: 'o bispo', of: 'do bispo' },
  r: { the: 'a torre', of: 'da torre' },
  q: { the: 'a dama', of: 'da dama' },
  k: { the: 'o rei', of: 'do rei' },
}
const LIST = new Intl.ListFormat('pt-BR', { type: 'conjunction' })
const on = (piece: PieceKind, square: string) => (piece === 'k' ? 'o rei' : `${PIECE[piece].the} de ${square}`)

/** Exhaustive by construction: a new kind of fact does not compile until it has its words. */
const CLAUSE: { readonly [K in FactKind]: (f: Extract<MoveFact, { kind: K }>) => string } = {
  castles: (f) => `faz o roque ${f.side === 'king' ? 'pequeno' : 'grande'} e tira o rei do centro`,
  captures: (f) => (f.recapture ? `retoma ${PIECE[f.piece].the} em ${f.square}` : `captura ${on(f.piece, f.square)}`),
  check: (f) => (f.mate ? 'dá xeque-mate' : 'dá xeque'),
  hangs: (f) => `deixa ${on(f.piece, f.square)} à mercê ${PIECE[f.by].of}`,
  escapes: (f) => `tira ${PIECE[f.piece].the} do ataque ${PIECE[f.by].of}`,
  develops: (f) => `desenvolve ${PIECE[f.piece].the} para ${f.to}`,
  forks: (f) => `ataca ao mesmo tempo ${LIST.format(f.targets.map((t) => on(t.piece, t.square)))}, um garfo`,
  attacks: (f) =>
    f.why === 'undefended' ? `ataca ${on(f.target, f.square)}, que está sem defesa`
    : f.why === 'king-only' ? `ataca ${on(f.target, f.square)}, que só o rei defende`
    : `ataca ${on(f.target, f.square)}`,
  pins: (f) => (f.behind === 'k' ? `crava ${on(f.target, f.square)}, que não pode sair da frente do rei` : `crava ${on(f.target, f.square)} contra ${PIECE[f.behind].the}`),
  defends: (f) => `defende ${on(f.target, f.square)}`,
  gambit: (f) => `oferece o peão de ${f.square} em gambito`,
  'pawn-break': (f) => `desafia o peão de ${f.target}`,
  'prepares-castling': (f) => `libera o roque ${f.side === 'king' ? 'pequeno' : 'grande'}`,
  'occupies-center': (f) => `ocupa o centro em ${f.square}`,
  'prepares-push': (f) => `prepara o avanço do peão para ${f.square}`,
  fianchetto: (f) => (f.step === 'pawn' ? `prepara o fianqueto do bispo ${f.side === 'king' ? 'do rei' : 'da dama'}` : 'põe o bispo em fianqueto, na grande diagonal'),
  'opens-line': (f) => `abre caminho para ${LIST.format(f.pieces.map((p) => PIECE[p].the))}`,
  'controls-center': (f) => (f.squares.length === 1 ? `controla a casa central ${f.squares[0]}` : `controla as casas centrais ${LIST.format(f.squares)}`),
  'gains-space': (f) => `ganha espaço com o peão em ${f.square}`,
  'moves-again': (f) => `move ${PIECE[f.piece].the} de novo, com peças ainda por desenvolver`,
}

const BAND: Readonly<Record<Band, string>> = {
  top: 'o lance da engine',
  excellent: 'excelente',
  good: 'bom',
  inaccuracy: 'imprecisão',
  mistake: 'erro',
  /** CLASSIFICATION_LABEL's word, so the coach and the review say the same thing. */
  blunder: 'blunder',
}

/** '3…Bc5'. */
export function moveText(index: number, san: string): string {
  return `${moveNumberLabel(index)}${san}`
}

/** 'desenvolve o cavalo para f3, ataca o peão de e5, que está sem defesa, e controla a casa central d4'; '' with no fact. */
function clauses(facts: readonly MoveFact[]): string {
  const parts = facts.map((f) => (CLAUSE[f.kind] as (f: MoveFact) => string)(f))
  return parts.reduce((text, part, i) => (i === 0 ? part : `${text}${i < parts.length - 1 ? ', ' : parts[i - 1].includes(',') ? ', e ' : ' e '}${part}`), '')
}

/** The facts as a sentence; '' when no rule recognised the move, so the coach never invents an intention. */
export function factsText(facts: readonly MoveFact[]): string {
  const text = clauses(facts)
  return text ? `${text[0].toUpperCase()}${text.slice(1)}.` : ''
}

/** 'Italian Game: Two Knights Defense' reads 'Abertura Italiana: Two Knights Defense'. */
export function lineName({ name }: Opening): string {
  const at = name.search(/[:,]/)
  return at < 0 ? openingName(name) : `${openingName(name.slice(0, at))}${name.slice(at)}`
}

function share(n: number): string {
  return n < 0.005 ? 'menos de 1%' : `${Math.round(n * 100)}%`
}

/** What the book says of the move. The screen names the opening, so the text says "desta abertura". */
export function theoryText({ theory, move }: Explanation): string {
  switch (theory.kind) {
    case 'book': {
      const main = moveText(move.index, theory.main.san)
      if (theory.of === 1) return 'É o único lance desta abertura aqui.'
      if (theory.games === 0) return `É teoria desta abertura, mas rara: nenhuma partida forte o jogou aqui.${theory.main.games > 0 ? ` O mais jogado é ${main}.` : ''}`
      if (theory.rank === 0) return `É o lance principal desta abertura aqui, em ${share(theory.share)} das partidas fortes.`
      return `É teoria desta abertura, em ${share(theory.share)} das partidas fortes daqui. O mais jogado é ${main}, com ${share(theory.main.share)}.`
    }
    case 'transposition':
      return 'É teoria desta abertura por outra ordem de lances: ela chega a esta mesma posição por outro caminho.'
    case 'other-opening':
      return `${moveText(move.index, move.san)} é teoria, mas de outra abertura: ${lineName(theory.opening)}.`
    case 'off-book':
      return `${moveText(move.index, move.san)} não é teoria desta abertura.`
  }
}

/** The named position the move reached, or the one it is heading to. */
export function placeText(reached: BookPosition): string {
  return reached.line ? `Posição: ${lineName(reached.line)}.` : `A caminho de ${lineName(reached.toward)}.`
}

/** The engine's sentence: the score, how good the move is and what comes next. A book move gets the line the engine
 *  expects; a departure is compared with the opening's main move and gets the engine's answer. */
export function engineText({ engine, theory, move }: Explanation): string {
  if (engine.kind === 'pending') return 'Avaliando…'
  if (engine.kind === 'failed') return `Sem avaliação. ${engineFailureText(engine.reason).title}.`
  const departed = theory.kind === 'off-book' || theory.kind === 'other-opening'
  const versus =
    engine.compared ? `, contra ${evalLabel(engine.compared.after)} depois de ${moveText(move.index, engine.compared.san)}`
    : engine.band === 'top' || evalLabel(engine.before) === evalLabel(engine.after) ? ''
    : ` (era ${evalLabel(engine.before)})`
  const cost = engine.band === 'inaccuracy' || engine.band === 'mistake' || engine.band === 'blunder' ? `, perde ${Math.round(engine.loss)}% de chance de vitória` : ''
  const verdict = `Avaliação ${evalLabel(engine.after)}${versus}: ${engine.band === 'top' ? 'é o lance da engine' : BAND[engine.band]}${cost}.`
  const disliked = !departed && cost ? ' A teoria registra o lance, mas a engine não gosta dele.' : ''
  const reply = engine.reply
  if (!reply || reply.sans.length === 0) return verdict + disliked
  if (!departed) return `${verdict}${disliked} A sequência mais forte segue ${sequence(reply.sans, move.index + 1)}.`
  const [answer, then] = reply.sans
  const does = clauses(reply.facts)
  return `${verdict} A resposta da engine é ${moveText(move.index + 1, answer)}${does ? `, que ${does}` : ''}${then ? `, seguida de ${moveText(move.index + 2, then)}` : ''}.`
}

/** For a departure, what the opening plays here instead and what each move does. '' for a book move. */
export function suggestionsText({ theory, move }: Explanation): string {
  if (theory.kind !== 'off-book' && theory.kind !== 'other-opening') return ''
  const items = theory.book.map((s) => suggestion(s, move.index, theory.book.length > 1))
  const list = items.length > 1 ? `${items.slice(0, -1).join('; ')}; ou ${items[items.length - 1]}` : items[0]
  return theory.kind === 'other-opening' ? `Nesta abertura, as ${colorLabel(move.mover)} jogam aqui ${list}.` : `Aqui a teoria joga ${list}.`
}

function suggestion({ move, facts }: Suggestion, index: number, withShare: boolean): string {
  const does = clauses(facts)
  return `${moveText(index, move.san)}${withShare ? ` (${share(move.share)})` : ''}${does ? `, que ${does}` : ''}`
}

/** '4.c3 Nf6 5.d4', numbering a Black move that comes first. */
function sequence(sans: readonly San[], from: number): string {
  return sans.map((san, i) => (i === 0 || (from + i) % 2 === 0 ? moveText(from + i, san) : san)).join(' ')
}

/** '4.O-O (51%)', for the list of the book's moves here. */
export function continuationText(c: BookContinuation, index: number): string {
  return `${moveText(index, c.san)} (${c.games > 0 ? share(c.share) : 'sem partidas fortes'})`
}
