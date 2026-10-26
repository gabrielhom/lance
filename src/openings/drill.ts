import type { BookMove, Drill, DrillOutcome, Opening, Uci } from '../domain'

export type Feedback =
  /** Another variation of the family: named, free, try again. */
  | { readonly kind: 'variation'; readonly move: Uci; readonly book: BookMove }
  /** A miss. `book` names it when it is theory of another family. The line's move shows as an arrow until played. */
  | { readonly kind: 'miss'; readonly move: Uci; readonly book: BookMove | null }

export type DrillState = {
  /** Plies of the line on the board. */
  readonly ply: number
  /** Plies where I missed, each once. */
  readonly misses: readonly number[]
  /** About my latest move that did not advance the line; cleared by the next move that does. */
  readonly feedback: Feedback | null
}
export type DrillEvent = { readonly kind: 'reply' } | { readonly kind: 'move'; readonly uci: Uci }
export type DrillTurn = 'mine' | 'theirs' | 'done'

export const DRILL_START: DrillState = { ply: 0, misses: [], feedback: null }

export function drillTurn({ variation, color }: Drill, { ply }: DrillState): DrillTurn {
  if (ply === variation.line.moves.length) return 'done'
  return (ply % 2 === 0 ? 'w' : 'b') === color ? 'mine' : 'theirs'
}

/** An event that doesn't fit the turn leaves the state as it is (the same object), like stepAttempt.
 *  The line's move advances. Another variation of the family is feedback only. Anything else is a miss at this ply. */
export function stepDrill(drill: Drill, state: DrillState, event: DrillEvent): DrillState {
  const turn = drillTurn(drill, state)
  if (event.kind === 'reply') return turn === 'theirs' ? { ...state, ply: state.ply + 1, feedback: null } : state
  if (turn !== 'mine') return state
  if (event.uci === drill.variation.line.moves[state.ply]) return { ...state, ply: state.ply + 1, feedback: null }
  const book = drill.book.get(state.ply)?.get(event.uci) ?? null
  if (book?.sameFamily) return { ...state, feedback: { kind: 'variation', move: event.uci, book } }
  const misses = state.misses.includes(state.ply) ? state.misses : [...state.misses, state.ply]
  return { ...state, misses, feedback: { kind: 'miss', move: event.uci, book } }
}

/** The line's move as an arrow, on my turn: every time while learning, and after a miss until I play it. */
export function drillHint(drill: Drill, state: DrillState): Uci | null {
  if (drillTurn(drill, state) !== 'mine') return null
  return drill.learn || state.misses.includes(state.ply) ? drill.variation.line.moves[state.ply] : null
}

/** null until the line is on the board in full. */
export function drillOutcome(drill: Drill, state: DrillState): DrillOutcome | null {
  if (drillTurn(drill, state) !== 'done') return null
  return drill.learn ? 'learned' : state.misses.length > 0 ? 'missed' : 'clean'
}

/** The named positions reached so far, each name once, in the order first reached. */
export function drillNames(drill: Drill, { ply }: DrillState): readonly Opening[] {
  const seen = new Set<string>()
  const names: Opening[] = []
  for (const opening of drill.names.slice(0, ply)) {
    if (!opening || seen.has(opening.name)) continue
    seen.add(opening.name)
    names.push(opening)
  }
  return names
}
