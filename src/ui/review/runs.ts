import type { Game, GameId, ReviewState, Services } from '../../domain/types'

export type ReviewRun =
  | { readonly kind: 'running'; readonly state: ReviewState | null }
  | { readonly kind: 'cancelled'; readonly state: ReviewState | null }

type Entry = { run: ReviewRun; readonly abort: AbortController }

/** Every review of this session, by game. reviewGame saves the game to the library only when it finishes, so a game
 *  played in Lance keeps its review running after its screen closes: a rematch must not lose the game just played. */
const entries = new Map<GameId, Entry>()
const listeners = new Set<() => void>()

const live = (run: ReviewRun) => run.kind === 'running' && run.state?.phase !== 'failed'

/** Starts the review of `game` unless one is already running or finished. A failed or cancelled one starts again. */
export function startReview(services: Services, game: Game): void {
  const current = entries.get(game.id)
  if (current && live(current.run)) return
  const entry: Entry = { run: { kind: 'running', state: null }, abort: new AbortController() }
  entries.set(game.id, entry)
  notify()
  const { signal } = entry.abort
  void (async () => {
    try {
      for await (const state of services.reviewGame(game, signal)) {
        if (signal.aborted) return
        entry.run = { kind: 'running', state }
        notify()
      }
    } catch (e) {
      if (signal.aborted) return
      const last = entry.run.state
      const series = last && last.phase !== 'done' ? last.series : game.positions.map(() => null)
      entry.run = { kind: 'running', state: { phase: 'failed', failure: { kind: 'crashed', detail: e instanceof Error ? e.message : String(e) }, series } }
      notify()
    }
  })()
}

export function cancelReview(id: GameId): void {
  const entry = entries.get(id)
  if (!entry || !live(entry.run) || entry.run.state?.phase === 'done') return
  entry.abort.abort()
  entry.run = { kind: 'cancelled', state: entry.run.state }
  notify()
}

/** The screen showing `game` closed. Only a game played in Lance keeps its review. */
export function releaseReview(game: Game): void {
  if (game.source.kind === 'played') return
  entries.get(game.id)?.abort.abort()
  if (entries.delete(game.id)) notify()
}

export function reviewRun(id: GameId): ReviewRun | undefined {
  return entries.get(id)?.run
}

/** How many reviews finished this session, which changes when one more game reaches the library. */
export function finishedReviews(): number {
  let n = 0
  for (const { run } of entries.values()) if (run.state?.phase === 'done') n++
  return n
}

export function subscribeReviews(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  for (const l of listeners) l()
}
