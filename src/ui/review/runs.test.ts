import { describe, expect, it } from 'vitest'
import type { Game, GameId, GameReview, GameSource, ReviewState, Services } from '../../domain/types'
import { cancelReview, finishedReviews, releaseReview, reviewRun, startReview } from './runs'

const PLAYED = (id: string): GameSource => ({ kind: 'played', id, you: 'w' })
const game = (id: string, source: GameSource = PLAYED(id)) => ({ id: `${source.kind}:${id}` as GameId, source, positions: [{}, {}] }) as unknown as Game
const ANALYZING: ReviewState = { phase: 'analyzing', done: 0, total: 2, progress: 0, engine: { kind: 'searching' }, series: [null, null] }
const DONE: ReviewState = { phase: 'done', review: {} as GameReview, saved: true }

/** reviewGame yields ANALYZING, then waits until the test calls finish or fail, and ends silently on abort. */
function fakeServices() {
  const signals = new Map<GameId, AbortSignal[]>()
  const pending = new Map<GameId, (s: ReviewState | null) => void>()
  const services = {
    async *reviewGame(g: Game, signal: AbortSignal): AsyncIterable<ReviewState> {
      signals.set(g.id, [...(signals.get(g.id) ?? []), signal])
      yield ANALYZING
      const end = await new Promise<ReviewState | null>((resolve) => {
        pending.set(g.id, resolve)
        signal.addEventListener('abort', () => {
          pending.delete(g.id)
          resolve(null)
        })
      })
      if (end) yield end
    },
  } as unknown as Services
  const settle = async (g: Game, s: ReviewState) => {
    await until(() => pending.has(g.id))
    pending.get(g.id)!(s)
    pending.delete(g.id)
    await until(() => reviewRun(g.id)?.state === s)
  }
  return {
    services,
    runs: (g: Game) => signals.get(g.id) ?? [],
    finish: (g: Game) => settle(g, DONE),
    fail: (g: Game) => settle(g, { phase: 'failed', failure: { kind: 'crashed', detail: 'x' }, series: [null, null] }),
  }
}

async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 0))
  expect(ok()).toBe(true)
}

describe('review runs', () => {
  it('stamps the pace while the engine searches and drops it when the review ends', async () => {
    const fake = fakeServices()
    const g = game('pace')
    startReview(fake.services, g)
    await until(() => reviewRun(g.id)?.state === ANALYZING)
    const run = reviewRun(g.id)
    expect(run?.kind === 'running' && run.pace?.first).toEqual({ at: expect.any(Number), done: 0 })
    await fake.finish(g)
    expect(reviewRun(g.id)).toEqual({ kind: 'running', state: DONE })
  })

  it('keeps reviewing a played game after its screen closes and the next game starts', async () => {
    const fake = fakeServices()
    const first = game('a1')
    startReview(fake.services, first)
    releaseReview(first)
    startReview(fake.services, game('a2'))
    await fake.finish(first)
    expect(fake.runs(first).map((s) => s.aborted)).toEqual([false])
    expect(reviewRun(first.id)).toEqual({ kind: 'running', state: DONE })
  })

  it('reuses the run when the same game is opened again, before and after it finishes', async () => {
    const fake = fakeServices()
    const g = game('b1')
    startReview(fake.services, g)
    startReview(fake.services, { ...g })
    await fake.finish(g)
    startReview(fake.services, g)
    expect(fake.runs(g)).toHaveLength(1)
  })

  it('stops reviewing an imported game when its screen closes', async () => {
    const fake = fakeServices()
    const g = game('c1', { kind: 'pgn' })
    startReview(fake.services, g)
    await until(() => fake.runs(g).length === 1)
    releaseReview(g)
    expect(fake.runs(g)[0].aborted).toBe(true)
    expect(reviewRun(g.id)).toBeUndefined()
  })

  it('starts again after a failure or a cancel', async () => {
    const fake = fakeServices()
    const g = game('d1')
    startReview(fake.services, g)
    await fake.fail(g)
    startReview(fake.services, g)
    await until(() => reviewRun(g.id)?.state === ANALYZING)
    cancelReview(g.id)
    expect(reviewRun(g.id)).toEqual({ kind: 'cancelled', state: ANALYZING })
    startReview(fake.services, g)
    await fake.finish(g)
    expect(fake.runs(g).map((s) => s.aborted)).toEqual([false, true, false])
  })

  it('counts each finished review once', async () => {
    const fake = fakeServices()
    const before = finishedReviews()
    const g = game('e1')
    startReview(fake.services, g)
    await fake.finish(g)
    cancelReview(g.id)
    expect(finishedReviews()).toBe(before + 1)
    expect(reviewRun(g.id)?.kind).toBe('running')
  })
})
