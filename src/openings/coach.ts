import { Chess } from 'chess.js'
import type { BookContinuation, BookPosition, Coach, Opening, OpeningLine, San, Uci } from '../domain'

/** One move on the board, mine or the coach's, and where it landed in the family's book. */
export type CoachPly = { readonly uci: Uci; readonly san: San; readonly to: BookPosition }

/** My move that left the family. It stands on the board, explained, until I take it back. `opening` names it when it
 *  is theory of another opening; null when the book does not know it at all. */
export type Departure = { readonly uci: Uci; readonly san: San; readonly opening: Opening | null }

export type CoachState = {
  /** Every ply is in the family's book. */
  readonly plies: readonly CoachPly[]
  readonly departure: Departure | null
  /** The plies where I left the family, each once. */
  readonly slips: readonly { readonly ply: number; readonly otherOpening: boolean }[]
}

export type CoachEvent =
  /** The coach's turn. `roll` in [0, 1) picks among the family's moves by share, so the reducer stays pure. `seen` holds
   *  where earlier rounds ended, and a move that only leads there weighs less. */
  | { readonly kind: 'reply'; readonly roll: number; readonly seen: ReadonlySet<BookPosition> }
  | { readonly kind: 'move'; readonly uci: Uci }
  /** Takes the departure back. */
  | { readonly kind: 'retry' }

export type CoachTurn = 'mine' | 'theirs' | 'departed' | 'done'

export const COACH_START: CoachState = { plies: [], departure: null, slips: [] }

/** How much less often the coach plays a move whose every line ended an earlier round. */
export const SEEN_WEIGHT = 0.25

/** The book position on the board, departure aside. */
export function coachAt({ book }: Coach, { plies }: CoachState): BookPosition {
  return plies.at(-1)?.to ?? book.start
}

/** 'done' wherever the family has no move left, on either side's turn: the round reached the end of its theory. */
export function coachTurn(coach: Coach, state: CoachState): CoachTurn {
  if (state.departure) return 'departed'
  if (coachAt(coach, state).moves.length === 0) return 'done'
  return (state.plies.length % 2 === 0 ? 'w' : 'b') === coach.color ? 'mine' : 'theirs'
}

/** An event that doesn't fit the turn returns the same object, like stepDrill. Any move the family's book reaches from
 *  here is followed, whatever its share; any other is a departure, counted once per ply. */
export function stepCoach(coach: Coach, state: CoachState, event: CoachEvent): CoachState {
  const turn = coachTurn(coach, state)
  const at = coachAt(coach, state)
  switch (event.kind) {
    case 'reply': {
      if (turn !== 'theirs') return state
      const { uci, san, to } = pickReply(at, event.roll, event.seen)
      return { ...state, plies: [...state.plies, { uci, san, to }] }
    }
    case 'move': {
      if (turn !== 'mine') return state
      const san = at.moves.find((m) => m.uci === event.uci)?.san ?? (new Chess(at.fen).move(event.uci).san as San)
      const to = coach.book.follow(at, event.uci)
      if (to) return { ...state, plies: [...state.plies, { uci: event.uci, san, to }] }
      const opening = at.elsewhere.get(event.uci) ?? null
      const ply = state.plies.length
      const slips = state.slips.some((s) => s.ply === ply) ? state.slips : [...state.slips, { ply, otherOpening: opening !== null }]
      return { ...state, departure: { uci: event.uci, san, opening }, slips }
    }
    case 'retry':
      return turn === 'departed' ? { ...state, departure: null } : state
  }
}

/** The continuation whose cumulative weight first passes `roll`: its share, times SEEN_WEIGHT when every line after it
 *  ended an earlier round. The last move absorbs rounding. Never called where the family has no move. */
export function pickReply(at: BookPosition, roll: number, seen: ReadonlySet<BookPosition>): BookContinuation {
  const weights = at.moves.map((m) => m.share * (seen.size > 0 && endsIn(m.to, seen) ? SEEN_WEIGHT : 1))
  const total = weights.reduce((sum, w) => sum + w, 0)
  let passed = 0
  for (const [i, m] of at.moves.entries()) {
    passed += weights[i] / total
    if (roll < passed) return m
  }
  return at.moves[at.moves.length - 1]
}

/** Every end of theory reachable from `from` is in `seen`. */
function endsIn(from: BookPosition, seen: ReadonlySet<BookPosition>): boolean {
  const visited = new Set<BookPosition>()
  const all = (p: BookPosition): boolean => {
    if (visited.has(p)) return true
    visited.add(p)
    return p.moves.length === 0 ? seen.has(p) : p.moves.every((m) => all(m.to))
  }
  return all(from)
}

export type CoachSummary = {
  /** The deepest position named for the family the round passed through, else the family's trunk. */
  readonly reached: OpeningLine
  readonly myMoves: number
  /** My moves found on the first try. */
  readonly firstTry: number
  readonly offBook: number
  readonly otherOpening: number
}

export function coachSummary(coach: Coach, { plies, slips }: CoachState): CoachSummary {
  const family = coach.book.family
  const named = plies.findLast((p) => p.to.line?.family === family.name)
  const myMoves = plies.filter((_, i) => (i % 2 === 0 ? 'w' : 'b') === coach.color).length
  const otherOpening = slips.filter((s) => s.otherOpening).length
  return {
    reached: named?.to.line ?? family.trunk,
    myMoves,
    firstTry: myMoves - slips.length,
    offBook: slips.length - otherOpening,
    otherOpening,
  }
}
