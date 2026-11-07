import { Chess } from 'chess.js'
import type { BookContinuation, BookPosition, Coach, Opening, OpeningLine, San, Uci } from '../domain'
import { OPENINGS } from './study'

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
  /** The coach's turn. `roll` in [0, 1) picks among the moves it has played least from here, by share, so the reducer
   *  stays pure. `played` counts the moves it played in earlier rounds, by `playedKey`. */
  | { readonly kind: 'reply'; readonly roll: number; readonly played: PlayedCounts }
  | { readonly kind: 'move'; readonly uci: Uci }
  /** Takes the departure back. */
  | { readonly kind: 'retry' }

export type CoachTurn = 'mine' | 'theirs' | 'departed' | 'done'

export const COACH_START: CoachState = { plies: [], departure: null, slips: [] }

/** How many times the coach played each move from each position, by `playedKey`. */
export type PlayedCounts = ReadonlyMap<string, number>

/** The position without its move counters, so transpositions share it, plus the move. */
export function playedKey(at: BookPosition, uci: Uci): string {
  return `${at.fen.split(' ').slice(0, 4).join(' ')} ${uci}`
}

/** `played` with one more play of `uci` from `at`. */
export function withPlayed(played: PlayedCounts, at: BookPosition, uci: Uci): PlayedCounts {
  const key = playedKey(at, uci)
  return new Map(played).set(key, (played.get(key) ?? 0) + 1)
}

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
      const { uci, san, to } = pickReply(at, event.roll, event.played, coach.book.family.games * OPENINGS.mainShare)
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

/** Among the moves with at least `minGames` games (all of them when none has), the ones the coach played least from
 *  here, then the one whose cumulative share first passes `roll`. The last absorbs rounding. Never called where the
 *  family has no move. */
export function pickReply(at: BookPosition, roll: number, played: PlayedCounts, minGames: number): BookContinuation {
  const main = at.moves.filter((m) => m.games >= minGames)
  const pool = main.length > 0 ? main : at.moves
  const times = (m: BookContinuation) => played.get(playedKey(at, m.uci)) ?? 0
  const least = Math.min(...pool.map(times))
  const candidates = pool.filter((m) => times(m) === least)
  const total = candidates.reduce((sum, m) => sum + m.share, 0)
  let passed = 0
  for (const m of candidates) {
    passed += m.share / total
    if (roll < passed) return m
  }
  return candidates[candidates.length - 1]
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
