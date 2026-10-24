import { buildReview, completeEvals, winPct } from '../analysis'
import {
  perspective,
  type EngineActivity,
  type EvalProgress,
  type Evaluator,
  type Game,
  type Identity,
  type Library,
  type PlayablePosition,
  type PositionKey,
  type ReviewState,
  type SearchedEval,
  type WinPct,
  type OpeningBook,
} from '../domain'
import { failureReason } from '../engine'

export type ReviewDeps = {
  readonly evaluator: Evaluator
  readonly book: OpeningBook
  readonly identity: Identity
  readonly library: Library
}

/** Search time grows about 1.5 times per depth (lite-single near depth 18, measured), so a search that reached depth d
 *  of D has done about 1.5^(d-D) of its work. Counting depths linearly put the bar near the end long before it was. */
const DEPTH_COST = 1.5

type Event =
  | { readonly kind: 'progress'; readonly p: PlayablePosition; readonly e: EvalProgress }
  | { readonly kind: 'evaluated'; readonly p: PlayablePosition; readonly eval: SearchedEval }
  | { readonly kind: 'rejected'; readonly error: unknown }


/** Evaluates every playable position, then builds the review and saves it to the library.
 *  Ends with no final state when aborted, since the caller already knows it cancelled. */
export async function* reviewGame(game: Game, deps: ReviewDeps, signal: AbortSignal): AsyncGenerator<ReviewState, void, undefined> {
  if (signal.aborted) return
  const { evaluator } = deps
  const limit = evaluator.profile.limit
  const playable = game.positions.filter((p) => p.kind === 'playable')
  const series: (WinPct | null)[] = game.positions.map((p) =>
    p.kind === 'checkmate' ? winPct({ kind: 'checkmate', loser: p.turn }, 'w') : p.kind === 'stalemate' ? winPct({ kind: 'stalemate' }, 'w') : null,
  )
  const found = new Map<PositionKey, SearchedEval>()
  const searching = new Map<PositionKey, { depth: number; since: number }>()
  let engine: EngineActivity = { kind: 'not-needed' }

  // Stops queued and running searches once this review fails or its consumer stops listening.
  const stop = new AbortController()
  const jobs = AbortSignal.any([signal, stop.signal])
  const queue: Event[] = []
  let wake = () => {}
  const push = (e: Event) => {
    queue.push(e)
    wake()
  }
  const onAbort = () => wake()
  signal.addEventListener('abort', onAbort, { once: true })

  const fraction = (job: { depth: number; since: number }) =>
    limit.kind === 'depth' ? DEPTH_COST ** (job.depth - limit.depth) : (Date.now() - job.since) / limit.ms
  // Never moves back: a retried search starts over at depth 1, and the sum shifts by rounding as searches finish.
  let shown = 0
  const analyzing = (): ReviewState => {
    let partial = 0
    for (const job of searching.values()) partial += Math.min(1, fraction(job))
    shown = Math.max(shown, Math.min(1, (found.size + partial) / playable.length))
    return {
      phase: 'analyzing',
      done: found.size,
      total: playable.length,
      progress: shown,
      engine,
      series: [...series],
    }
  }

  try {
    for (const p of playable) {
      evaluator.evaluate(p, jobs, (e) => push({ kind: 'progress', p, e })).then(
        (value) => push({ kind: 'evaluated', p, eval: value }),
        (error: unknown) => push({ kind: 'rejected', error }),
      )
    }
    yield analyzing()
    while (found.size < playable.length) {
      while (queue.length === 0 && !signal.aborted) await new Promise<void>((resolve) => (wake = resolve))
      const event = queue.shift()
      if (signal.aborted || !event) return
      switch (event.kind) {
        case 'progress':
          if (event.e.kind === 'depth') {
            engine = { kind: 'searching' }
            const job = searching.get(event.p.key)
            searching.set(event.p.key, { depth: event.e.depth, since: job?.since ?? Date.now() })
          } else if (engine.kind !== 'searching') {
            engine = { kind: 'loading', loaded: event.e.loaded, total: event.e.total }
          }
          break
        case 'evaluated':
          found.set(event.p.key, event.eval)
          searching.delete(event.p.key)
          series[event.p.index] = winPct(event.eval.lines[0].score, 'w')
          break
        case 'rejected':
          yield { phase: 'failed', failure: failureReason(event.error), series: [...series] }
          return
      }
      yield analyzing()
    }
    const evals = completeEvals(game, found)
    if (!evals.ok) throw new Error(`review of ${game.id} finished without ${evals.error.missing.length} evals`)
    const who = perspective(deps.identity, game.players, game.source)
    const review = buildReview(game, evals.value, deps.book, who, evaluator.profile)
    const saved = await deps.library.put(review, Date.now()).then(
      () => true,
      () => false,
    )
    if (signal.aborted) return
    yield { phase: 'done', review, saved }
  } finally {
    signal.removeEventListener('abort', onAbort)
    stop.abort()
  }
}
