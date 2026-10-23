import { describe, expect, it } from 'vitest'
import scholar from '../../e2e/fixtures/scholar.pgn?raw'
import {
  gameFromPgn,
  type AnalysisProfile,
  type EngineId,
  type EvalProgress,
  type Evaluator,
  type Game,
  type GameReview,
  type Library,
  type PlayablePosition,
  type ReviewState,
  type SearchedEval,
  type Uci,
} from '../domain'
import { EngineFailure } from '../engine'
import { bookFrom } from '../openings'
import { reviewGame } from '.'

const PROFILE: AnalysisProfile = { engine: 'sf19/nn-61e7af4bb97d' as EngineId, limit: { kind: 'depth', depth: 2 } }
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function parse(pgn: string): Game {
  const r = gameFromPgn(pgn, { kind: 'pgn' })
  if (!r.ok) throw new Error(r.error.detail)
  return r.value
}

/** One engine working through positions in call order, like the real evaluator's FIFO. */
function fakeEvaluator(game: Game, opts: { cached?: boolean; failAt?: number } = {}) {
  const signals: AbortSignal[] = []
  let engine = Promise.resolve()
  const answer = (p: PlayablePosition): SearchedEval => ({
    depth: 2,
    lines: [{ score: { kind: 'cp', white: 20 }, pv: [game.moves[p.index]?.uci ?? ('0000' as Uci)] }],
  })
  const evaluator: Evaluator = {
    profile: PROFILE,
    evaluate(p, signal, onProgress) {
      signals.push(signal)
      if (opts.cached) return Promise.resolve(answer(p))
      const job = engine.then(async () => {
        signal.throwIfAborted()
        if (p.index === 0) onProgress?.({ kind: 'engine-loading', loaded: 1, total: 2 })
        for (const depth of [1, 2]) {
          await tick()
          signal.throwIfAborted()
          onProgress?.({ kind: 'depth', depth })
        }
        await tick()
        signal.throwIfAborted()
        if (p.index === opts.failAt) throw new EngineFailure({ kind: 'crashed', detail: 'wasm trap' })
        return answer(p)
      })
      engine = job.then(
        () => undefined,
        () => undefined,
      )
      return job
    },
    dispose() {},
  }
  return { evaluator, signals }
}

/** Every search waits for the test, which deepens it and then finishes it. */
function steeredEvaluator(game: Game, depth: number) {
  const jobs = new Map<number, { readonly onProgress: (e: EvalProgress) => void; readonly finish: () => void; reached: number }>()
  const evaluator: Evaluator = {
    profile: { ...PROFILE, limit: { kind: 'depth', depth } },
    evaluate: (p, _signal, onProgress = () => {}) =>
      new Promise((resolve) => {
        const pv = [game.moves[p.index]?.uci ?? ('0000' as Uci)] as const
        jobs.set(p.index, { onProgress, finish: () => resolve({ depth, lines: [{ score: { kind: 'cp', white: 0 }, pv }] }), reached: 0 })
      }),
    dispose() {},
  }
  const reach = (index: number, through: number) => {
    const job = jobs.get(index)
    for (; job && job.reached < through; job.reached++) job.onProgress({ kind: 'depth', depth: job.reached + 1 })
  }
  return { evaluator, reach, finish: (index: number) => jobs.get(index)?.finish() }
}

function memoryLibrary(fails = false) {
  const saved: GameReview[] = []
  const library: Library = {
    async put(review) {
      if (fails) throw new Error('quota')
      saved.push(review)
    },
    list: async () => [],
    get: async () => null,
    remove: async () => undefined,
  }
  return { library, saved }
}

async function collect(states: AsyncIterable<ReviewState>, onState?: (s: ReviewState) => void) {
  const all: ReviewState[] = []
  for await (const s of states) {
    all.push(s)
    onState?.(s)
  }
  return all
}

const deps = (evaluator: Evaluator, library: Library) => ({
  evaluator,
  library,
  book: bookFrom({}),
  identity: { accounts: [{ site: 'any', username: 'gabrielhom' }] } as const,
})

describe('reviewGame', () => {
  const game = parse(scholar)

  it('reports progress while the engine loads and searches, then saves the review', async () => {
    const { evaluator } = fakeEvaluator(game)
    const { library, saved } = memoryLibrary()
    const states = await collect(reviewGame(game, deps(evaluator, library), new AbortController().signal))

    const analyzing = states.flatMap((s) => (s.phase === 'analyzing' ? [s] : []))
    expect(analyzing[0]).toMatchObject({ done: 0, total: 7, progress: 0, engine: { kind: 'not-needed' } })
    expect(analyzing[0].series.slice(0, 7)).toEqual(Array(7).fill(null))
    expect(analyzing[0].series[7]).toBeCloseTo(97.5, 1)
    expect(analyzing.some((s) => s.engine.kind === 'loading')).toBe(true)
    expect(analyzing.some((s) => s.engine.kind === 'searching')).toBe(true)
    for (let i = 1; i < analyzing.length; i++) {
      expect(analyzing[i].done).toBeGreaterThanOrEqual(analyzing[i - 1].done)
      expect(analyzing[i].progress).toBeGreaterThanOrEqual(analyzing[i - 1].progress)
    }
    expect(analyzing.some((s) => s.progress > s.done / s.total)).toBe(true)
    expect(analyzing.at(-1)).toMatchObject({ done: 7, progress: 1 })
    expect(analyzing.at(-1)?.series.every((w) => w !== null)).toBe(true)

    const last = states.at(-1)
    if (last?.phase !== 'done') throw new Error(`ended in ${last?.phase}`)
    expect(last.saved).toBe(true)
    expect(saved).toEqual([last.review])
    expect(last.review.moves).toHaveLength(7)
    expect(last.review.perspective).toEqual({ kind: 'me', color: 'w' })
    expect(last.review.profile).toBe(PROFILE)
  })

  it('weighs a search by the work its depth stands for, so half the positions done and the rest at half depth is about half', async () => {
    const opening = parse('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *')
    const { evaluator, reach, finish } = steeredEvaluator(opening, 18)
    const progress: number[] = []
    const states = collect(reviewGame(opening, deps(evaluator, memoryLibrary().library), new AbortController().signal), (s) => {
      if (s.phase === 'analyzing') progress.push(s.progress)
    })
    const settled = async () => {
      for (let seen = -1; seen !== progress.length; ) {
        seen = progress.length
        await tick()
      }
    }
    await settled()
    for (const index of [0, 1, 2, 3]) {
      reach(index, 18)
      finish(index)
    }
    for (const index of [4, 5, 6, 7]) reach(index, 9)
    await settled()
    expect(progress.at(-1)).toBeGreaterThanOrEqual(0.5)
    expect(progress.at(-1)).toBeLessThanOrEqual(0.6)

    for (const index of [4, 5, 6, 7]) {
      reach(index, 18)
      finish(index)
    }
    expect((await states).at(-1)?.phase).toBe('done')
    expect(progress.at(-1)).toBe(1)
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]!)
  })

  it('never reports the engine when every position is cached', async () => {
    const { evaluator } = fakeEvaluator(game, { cached: true })
    const states = await collect(reviewGame(game, deps(evaluator, memoryLibrary().library), new AbortController().signal))
    expect(states.at(-1)?.phase).toBe('done')
    expect(states.every((s) => s.phase !== 'analyzing' || s.engine.kind === 'not-needed')).toBe(true)
  })

  it('still finishes when the library cannot save', async () => {
    const { evaluator } = fakeEvaluator(game, { cached: true })
    const states = await collect(reviewGame(game, deps(evaluator, memoryLibrary(true).library), new AbortController().signal))
    expect(states.at(-1)).toMatchObject({ phase: 'done', saved: false })
  })

  it('fails with the engine reason, keeps the partial graph and stops the remaining searches', async () => {
    const { evaluator, signals } = fakeEvaluator(game, { failAt: 2 })
    const { library, saved } = memoryLibrary()
    const states = await collect(reviewGame(game, deps(evaluator, library), new AbortController().signal))
    const last = states.at(-1)
    if (last?.phase !== 'failed') throw new Error(`ended in ${last?.phase}`)
    expect(last.failure).toEqual({ kind: 'crashed', detail: 'wasm trap' })
    expect(last.series.map((w) => w !== null)).toEqual([true, true, false, false, false, false, false, true])
    expect(saved).toEqual([])
    expect(signals.every((s) => s.aborted)).toBe(true)
  })

  it('ends without a final state when the caller aborts', async () => {
    const { evaluator, signals } = fakeEvaluator(game)
    const { library, saved } = memoryLibrary()
    const ac = new AbortController()
    const states = await collect(reviewGame(game, deps(evaluator, library), ac.signal), (s) => {
      if (s.phase === 'analyzing' && s.done === 2) ac.abort()
    })
    expect(states.every((s) => s.phase === 'analyzing')).toBe(true)
    expect(states.at(-1)).toMatchObject({ done: 2 })
    expect(saved).toEqual([])
    expect(signals.every((s) => s.aborted)).toBe(true)
  })

  it('drops results that were already queued when the caller aborts', async () => {
    const { evaluator } = fakeEvaluator(game, { cached: true })
    const { library, saved } = memoryLibrary()
    const ac = new AbortController()
    const states = await collect(reviewGame(game, deps(evaluator, library), ac.signal), () => ac.abort())
    expect(states).toHaveLength(1)
    expect(saved).toEqual([])
  })

  it('stays silent when the caller aborts while the review is being saved', async () => {
    const { evaluator } = fakeEvaluator(game, { cached: true })
    const ac = new AbortController()
    const library: Library = { ...memoryLibrary().library, put: async () => ac.abort() }
    const states = await collect(reviewGame(game, deps(evaluator, library), ac.signal))
    expect(states.every((s) => s.phase === 'analyzing')).toBe(true)
  })

  it('yields nothing when already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const { evaluator, signals } = fakeEvaluator(game)
    expect(await collect(reviewGame(game, deps(evaluator, memoryLibrary().library), ac.signal))).toEqual([])
    expect(signals).toEqual([])
  })
})
