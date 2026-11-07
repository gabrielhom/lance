import { CLASSIFIER, describeMove, pvSan, winPct, type MoveFact } from '../analysis'
import { playableAt, playMove, type BookContinuation, type BookPosition, type Coach, type EngineFailureReason, type Opening, type PlayablePosition, type PlayedMove, type PositionEval, type PositionKey, type San, type Score, type SearchedEval, type Uci } from '../domain'
import { coachAt, type CoachState } from './coach'

export type EvalStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'done'; readonly eval: SearchedEval }
  | { readonly kind: 'failed'; readonly reason: EngineFailureReason }
export type EvalsOf = (p: PlayablePosition) => EvalStatus

/** A family move here and what it does, for "aqui a teoria joga...". */
export type Suggestion = { readonly move: BookContinuation; readonly facts: readonly MoveFact[] }

export type Theory =
  /** A listed family move. rank 0 is the most played, `main`. */
  | { readonly kind: 'book'; readonly rank: number; readonly of: number; readonly share: number; readonly games: number; readonly main: BookContinuation; readonly reached: BookPosition }
  /** Not listed from here, but the family reaches the position by another order. */
  | { readonly kind: 'transposition'; readonly reached: BookPosition }
  /** Theory, but of another opening. `book` is what the family plays here, most played first, up to 3. */
  | { readonly kind: 'other-opening'; readonly opening: Opening; readonly book: readonly Suggestion[] }
  | { readonly kind: 'off-book'; readonly book: readonly Suggestion[] }

/** CLASSIFIER.bands on the win% loss; 'top' is the engine's own first line, whose loss is 0 by definition, since two
 *  searches disagree by noise. */
export type Band = 'top' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

/** What the engine expects next, in SAN from the position after the move, and what its first move does. */
export type Reply = { readonly sans: readonly San[]; readonly facts: readonly MoveFact[] }

/** The score after a move: a line's score, or the end of the game. */
export type After = Score | Extract<PositionEval, { readonly kind: 'checkmate' | 'stalemate' }>

export type EngineView =
  | { readonly kind: 'pending' }
  | { readonly kind: 'failed'; readonly reason: EngineFailureReason }
  | {
      readonly kind: 'judged'
      /** Line 1 before the move, for "era +0.3". */
      readonly before: Score
      readonly after: After
      readonly loss: number
      readonly band: Band
      /** For a book move the next 3 plies the engine expects; for a departure, its answer and one more ply. */
      readonly reply: Reply | null
      /** For a departure, the score after the family's main move here, once known. */
      readonly compared: { readonly san: San; readonly after: After } | null
    }

export type Explanation = {
  readonly move: PlayedMove
  readonly by: 'me' | 'coach'
  readonly facts: readonly MoveFact[]
  readonly theory: Theory
  readonly engine: EngineView
}

export type Explained = {
  /** One per ply, in order. */
  readonly plies: readonly Explanation[]
  readonly departure: Explanation | null
  /** The positions the text reads an evaluation of, most urgent first: the board's position (the one my next move is
   *  judged from), then the departure's, then the plies' newest first. Never a finished game. */
  readonly wanted: readonly PlayablePosition[]
}

const PLAN_PLIES = 3
const ANSWER_PLIES = 2
const SUGGESTIONS = 3

/** Everything the coach says about the moves on the board, derived from the round and the evaluations known so far.
 *  Facts and theory never wait for the engine; an evaluation that is pending or failed changes only `engine`. */
export function explain(coach: Coach, state: CoachState, evals: EvalsOf): Explained {
  const wanted = new Map<PositionKey, PlayablePosition>()
  const read = (p: PlayablePosition) => {
    if (!wanted.has(p.key)) wanted.set(p.key, p)
    return evals(p)
  }
  let at = playableAt({ root: coach.book.start.fen, tail: [] }, 0)!
  const earlier: PlayedMove[] = []
  const moves = state.plies.map((ply) => {
    const move = playMove(at, ply.uci)!
    earlier.push(move)
    if (move.after.kind === 'playable') at = move.after
    return move
  })
  if (moves.at(-1)?.after.kind !== 'checkmate' && moves.at(-1)?.after.kind !== 'stalemate') read(at)

  const from = coachAt(coach, state)
  let departure: Explanation | null = null
  if (state.departure) {
    const move = playMove(at, state.departure.uci)!
    const book = from.moves.slice(0, SUGGESTIONS).map((m) => ({ move: m, facts: describeMove(playMove(at, m.uci)!, moves) }))
    const theory: Theory = state.departure.opening ? { kind: 'other-opening', opening: state.departure.opening, book } : { kind: 'off-book', book }
    departure = { move, by: 'me', facts: describeMove(move, moves), theory, engine: judge(move, moves, read, ANSWER_PLIES, from.moves[0] ?? null) }
  }

  const engines: EngineView[] = []
  for (let i = moves.length - 1; i >= 0; i--) engines[i] = judge(moves[i], moves.slice(0, i), read, PLAN_PLIES, null)
  const plies = state.plies.map((ply, i): Explanation => {
    const before = i === 0 ? coach.book.start : state.plies[i - 1].to
    const rank = before.moves.findIndex((m) => m.uci === ply.uci)
    const listed = before.moves[rank]
    const theory: Theory = listed
      ? { kind: 'book', rank, of: before.moves.length, share: listed.share, games: listed.games, main: before.moves[0], reached: ply.to }
      : { kind: 'transposition', reached: ply.to }
    return { move: moves[i], by: moves[i].mover === coach.color ? 'me' : 'coach', facts: describeMove(moves[i], moves.slice(0, i)), theory, engine: engines[i] }
  })
  return { plies, departure, wanted: [...wanted.values()] }
}

/** loss → Band, on CLASSIFIER.bands, so "excelente" means what it means in the review. */
export function bandOf(isTop: boolean, loss: number): Band {
  if (isTop) return 'top'
  const { excellent, good, inaccuracy, mistake } = CLASSIFIER.bands
  return loss < excellent ? 'excellent' : loss < good ? 'good' : loss < inaccuracy ? 'inaccuracy' : loss < mistake ? 'mistake' : 'blunder'
}

/** Like checkAnswer: the move heading line 1 or line 2 of the position before takes that line's score with no search
 *  of its own; any other move is searched after. The loss is line 1 before against the score after, from the mover's
 *  side. `main`, for a departure, is the family move whose score it is compared with. */
function judge(move: PlayedMove, earlier: readonly PlayedMove[], read: (p: PlayablePosition) => EvalStatus, plies: number, main: BookContinuation | null): EngineView {
  const before = read(move.before)
  if (before.kind !== 'done') return before
  const outcome = scoreAfter(move.uci, move.before, before.eval, read)
  if (outcome.kind !== 'done') return outcome
  const [best] = before.eval.lines
  const isTop = move.uci === best.pv[0]
  const loss = isTop ? 0 : Math.max(0, winPct(best.score, move.mover) - winPct(outcome.after, move.mover))
  let reply: Reply | null = null
  if (move.after.kind === 'playable' && outcome.pv.length > 0) {
    const first = playMove(move.after, outcome.pv[0])
    reply = first && { sans: pvSan(move.after.fen, outcome.pv.slice(0, plies)), facts: describeMove(first, [...earlier, move]) }
  }
  let compared: { san: San; after: After } | null = null
  if (main && main.uci !== move.uci) {
    const answer = scoreAfter(main.uci, move.before, before.eval, read)
    if (answer.kind === 'done') compared = { san: main.san, after: answer.after }
  }
  return { kind: 'judged', before: best.score, after: outcome.after, loss, band: bandOf(isTop, loss), reply, compared }
}

type Outcome = { readonly kind: 'done'; readonly after: After; readonly pv: readonly Uci[] } | Exclude<EvalStatus, { readonly kind: 'done' }>

/** The score after `uci` at `before`, and the engine line from there. */
function scoreAfter(uci: Uci, before: PlayablePosition, searched: SearchedEval, read: (p: PlayablePosition) => EvalStatus): Outcome {
  const line = searched.lines.find((l) => l.pv[0] === uci)
  if (line) return { kind: 'done', after: line.score, pv: line.pv.slice(1) }
  const move = playMove(before, uci)!
  if (move.after.kind !== 'playable') return { kind: 'done', after: move.after.kind === 'checkmate' ? { kind: 'checkmate', loser: move.after.turn } : { kind: 'stalemate' }, pv: [] }
  const after = read(move.after)
  if (after.kind !== 'done') return after
  return { kind: 'done', after: after.eval.lines[0].score, pv: after.eval.lines[0].pv }
}
