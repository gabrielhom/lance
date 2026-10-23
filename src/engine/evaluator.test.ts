import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EngineDescriptor, EngineTuning, EvalCache, EvalProgress, RuntimeEnv, SearchLimit } from '../domain/types'
import { createEvaluator } from './evaluator'
import { EngineFailure } from './failure'
import { TIMEOUTS } from './session'
import { fakeEngine, memoryCache, recordedPosition, type FakeEngine } from './testing/fake-engine'
import { TRANSCRIPTS, type ScenarioName } from './testing/transcripts'
import type { LineTransport } from './transport'

const LITE: EngineDescriptor = { kind: 'wasm', flavor: 'lite' }
const BRIDGE: EngineDescriptor = { kind: 'bridge', url: 'http://127.0.0.1:7777', name: 'sf19', idName: 'Stockfish 19' }
const ENV: RuntimeEnv = { crossOriginIsolated: false, cores: 8 }
const ONE: EngineTuning = { engines: 1, threadsPerEngine: 1, hashMb: 32 }
const DEPTH_12: SearchLimit = { kind: 'depth', depth: 12 }

type Setup = { descriptor?: EngineDescriptor; limit?: SearchLimit; tuning?: EngineTuning; cache?: EvalCache; env?: RuntimeEnv; engines?: LineTransport[] }

function setup(o: Setup = {}) {
  const made: LineTransport[] = []
  const connect = () => {
    const engine = o.engines?.[made.length] ?? fakeEngine(o.descriptor?.kind === 'bridge' ? 'native' : 'lite')
    made.push(engine)
    return engine
  }
  const cache = o.cache ?? memoryCache()
  const evaluator = createEvaluator(o.descriptor ?? LITE, o.limit ?? DEPTH_12, o.tuning ?? ONE, cache, o.env ?? ENV, connect)
  return { evaluator, made, cache }
}

const live = () => new AbortController().signal
const outcome = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (e instanceof EngineFailure ? e.reason : (e as Error).name))
const settledYet = async (p: Promise<unknown>) => Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 20))])
const searching = (engine: FakeEngine, count = 1) => vi.waitFor(() => expect(engine.sent.filter((l) => l.startsWith('go ')).length).toBe(count))
const play = (engine: FakeEngine, name: ScenarioName) => TRANSCRIPTS.lite.scenarios[name].lines.forEach((l) => engine.emit(l))

afterEach(() => {
  vi.useRealTimers()
})

describe('evaluate', () => {
  it('answers with both lines of the deepest finished depth, scored from White', async () => {
    const { evaluator } = setup()
    expect(evaluator.profile).toEqual({ engine: 'sf19/nn-61e7af4bb97d', limit: DEPTH_12 })
    const result = await evaluator.evaluate(recordedPosition('black-to-move'), live())
    expect(result.depth).toBe(12)
    expect(result.lines.map((l) => [l.score, l.pv[0]])).toEqual([
      [{ kind: 'cp', white: 23 }, 'e7e5'],
      [{ kind: 'cp', white: 30 }, 'e7e6'],
    ])
  })

  it('speaks the handshake, the tuning and the exact engine input', async () => {
    const engine = fakeEngine('native')
    const { evaluator } = setup({ descriptor: BRIDGE, engines: [engine], tuning: { engines: 1, threadsPerEngine: 2, hashMb: 64 } })
    await evaluator.evaluate(recordedPosition('tail'), live())
    expect(engine.sent).toEqual([
      'uci',
      'setoption name Threads value 2',
      'setoption name Hash value 64',
      'isready',
      'setoption name MultiPV value 2',
      'isready',
      'position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves g1f3 g8f6 f3g1 f6g8',
      'go depth 12',
    ])
  })

  it('fails as a protocol error when the engine cannot show two lines', async () => {
    const { evaluator } = setup({ engines: [fakeEngine('lite', { without: ['MultiPV'] })] })
    expect(await outcome(evaluator.evaluate(recordedPosition('mate-in-1'), live()))).toEqual({ kind: 'protocol', detail: 'the engine has no MultiPV option' })
  })

  it('answers a position with one legal move with one line', async () => {
    const { evaluator } = setup()
    const result = await evaluator.evaluate(recordedPosition('one-legal-move'), live())
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].pv[0]).toBe('h8g7')
  })

  it('reports each new depth while searching', async () => {
    const { evaluator } = setup()
    const seen: EvalProgress[] = []
    await evaluator.evaluate(recordedPosition('mate-in-1'), live(), (e) => seen.push(e))
    expect(seen.map((e) => (e.kind === 'depth' ? e.depth : null))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('fails a terminal position, which callers never send, as a protocol error instead of scoring mate 0', async () => {
    const { evaluator } = setup()
    expect(await outcome(evaluator.evaluate(recordedPosition('checkmated'), live()))).toMatchObject({ kind: 'protocol' })
  })
})

describe('cache', () => {
  it('a hit boots no engine, a miss boots one', async () => {
    const cache = memoryCache()
    const first = setup({ cache })
    const answer = await first.evaluator.evaluate(recordedPosition('mate-in-1'), live())
    expect(first.made).toHaveLength(1)
    await vi.waitFor(() => expect(cache.rows.size).toBe(1))

    const second = setup({ cache })
    expect(await second.evaluator.evaluate(recordedPosition('mate-in-1'), live())).toEqual(answer)
    expect(second.made).toHaveLength(0)
  })

  it('keys by engine, limit and exact position', async () => {
    const cache = memoryCache()
    const base = setup({ cache })
    await base.evaluator.evaluate(recordedPosition('black-to-move'), live())
    await vi.waitFor(() => expect(cache.rows.size).toBe(1))

    const deeper = setup({ cache, limit: { kind: 'depth', depth: 14 } })
    await deeper.evaluator.evaluate(recordedPosition('black-to-move'), live())
    const otherEngine = setup({ cache, descriptor: BRIDGE })
    await otherEngine.evaluator.evaluate(recordedPosition('black-to-move'), live())
    const timed = setup({ cache, limit: { kind: 'movetime', ms: 12 } })
    await timed.evaluator.evaluate(recordedPosition('black-to-move'), live()).catch(() => {})
    expect([deeper.made.length, otherEngine.made.length, timed.made.length]).toEqual([1, 1, 1])

    const engine = base.made[0] as FakeEngine
    await base.evaluator.evaluate(recordedPosition('tail'), live())
    await base.evaluator.evaluate(recordedPosition('black-to-move'), live())
    expect(engine.sent.filter((l) => l.startsWith('go '))).toHaveLength(2)
  })

  it('a failing cache is a miss, not a failure', async () => {
    const broken: EvalCache = { get: () => Promise.reject(new Error('quota')), put: () => Promise.reject(new Error('quota')) }
    const { evaluator } = setup({ cache: broken })
    expect((await evaluator.evaluate(recordedPosition('mate-in-1'), live())).depth).toBe(12)
  })
})

describe('abort', () => {
  it('stops a running search, settles only when its bestmove arrives, and keeps the engine', async () => {
    const engine = fakeEngine('lite', { hold: true })
    const { evaluator, made } = setup({ engines: [engine] })
    const ac = new AbortController()
    const running = evaluator.evaluate(recordedPosition('black-to-move'), ac.signal)
    await searching(engine)
    engine.emit('info depth 1 seldepth 2 multipv 1 score cp -6 nodes 39 nps 9750 hashfull 0 time 4 pv e7e5')
    ac.abort()
    expect(engine.sent.at(-1)).toBe('stop')
    expect(await settledYet(running)).toBe(false)
    engine.emit('bestmove e7e5')
    expect(await outcome(running)).toBe('AbortError')

    const next = evaluator.evaluate(recordedPosition('mate-in-1'), live())
    await searching(engine, 2)
    play(engine, 'mate-in-1')
    expect((await next).lines[0].score).toEqual({ kind: 'mate', winner: 'w', moves: 1 })
    expect(made).toHaveLength(1)
  })

  it('sends nothing between stop and its bestmove', async () => {
    const engine = fakeEngine('lite', { hold: true })
    const { evaluator } = setup({ engines: [engine] })
    const ac = new AbortController()
    const aborted = outcome(evaluator.evaluate(recordedPosition('black-to-move'), ac.signal))
    await searching(engine)
    ac.abort()
    const queued = evaluator.evaluate(recordedPosition('mate-in-1'), live())
    expect(await settledYet(queued)).toBe(false)
    expect(engine.sent.at(-1)).toBe('stop')

    engine.emit('bestmove e7e5')
    expect(await aborted).toBe('AbortError')
    await searching(engine, 2)
    play(engine, 'mate-in-1')
    expect((await queued).depth).toBe(12)
  })

  it('drops a queued job without touching the engine', async () => {
    const engine = fakeEngine('lite', { hold: true })
    const { evaluator } = setup({ engines: [engine] })
    const running = evaluator.evaluate(recordedPosition('mate-in-1'), live())
    const ac = new AbortController()
    const queued = outcome(evaluator.evaluate(recordedPosition('black-to-move'), ac.signal))
    await searching(engine)
    ac.abort()
    expect(await queued).toBe('AbortError')

    play(engine, 'mate-in-1')
    expect((await running).depth).toBe(12)
    await new Promise((r) => setTimeout(r, 20))
    expect(engine.sent.filter((l) => l.startsWith('position'))).toHaveLength(1)
  })

  it('an already aborted signal is rejected before any work', async () => {
    const { evaluator, made } = setup()
    const ac = new AbortController()
    ac.abort()
    expect(await outcome(evaluator.evaluate(recordedPosition('mate-in-1'), ac.signal))).toBe('AbortError')
    expect(made).toHaveLength(0)
  })
})

describe('failures', () => {
  it('retries a crashed search once on a fresh engine', async () => {
    const fresh = fakeEngine('lite')
    const { evaluator, made } = setup({ engines: [fakeEngine('lite', { crashOnGo: true }), fresh] })
    expect((await evaluator.evaluate(recordedPosition('black-to-move'), live())).depth).toBe(12)
    expect(made).toHaveLength(2)
    expect(fresh.sent).toContain('go depth 12')
  })

  it('fails as crashed when the retry crashes too', async () => {
    const { evaluator, made } = setup({ engines: [fakeEngine('lite', { crashOnGo: true }), fakeEngine('lite', { crashOnGo: true })] })
    expect(await outcome(evaluator.evaluate(recordedPosition('black-to-move'), live()))).toEqual({ kind: 'crashed', detail: 'RuntimeError: unreachable' })
    expect(made).toHaveLength(2)
  })

  it('refuses an engine whose net or id name differs from the cache namespace', async () => {
    const wrongNet = setup({ engines: [fakeEngine('native')] })
    expect(await outcome(wrongNet.evaluator.evaluate(recordedPosition('mate-in-1'), live()))).toEqual({
      kind: 'mismatch',
      expected: 'nn-61e7af4bb97d.nnue',
      got: 'nn-1a298aa575a0.nnue',
    })
    const renamed = setup({ descriptor: { ...BRIDGE, idName: 'Stockfish 18' } })
    expect(await outcome(renamed.evaluator.evaluate(recordedPosition('mate-in-1'), live()))).toEqual({
      kind: 'mismatch',
      expected: 'Stockfish 18',
      got: 'Stockfish 19',
    })
    expect([wrongNet.made.length, renamed.made.length]).toEqual([1, 1])
  })

  it('times out a silent handshake, but download progress keeps it alive and reaches every queued job', async () => {
    vi.useFakeTimers()
    const engine = fakeEngine('lite', { silent: true })
    const { evaluator } = setup({ engines: [engine] })
    const progress: EvalProgress[][] = [[], []]
    const jobs = (['mate-in-1', 'black-to-move'] as const).map((name, i) => outcome(evaluator.evaluate(recordedPosition(name), live(), (e) => progress[i]!.push(e))))
    await vi.advanceTimersByTimeAsync(TIMEOUTS.silenceMs - 1000)
    engine.load(900_000, 1_845_971)
    let settled = 0
    for (const job of jobs) void job.then(() => settled++)
    await vi.advanceTimersByTimeAsync(TIMEOUTS.silenceMs - 1000)
    expect(settled).toBe(0)
    expect(progress).toEqual([[{ kind: 'engine-loading', loaded: 900_000, total: 1_845_971 }], [{ kind: 'engine-loading', loaded: 900_000, total: 1_845_971 }]])
    await vi.advanceTimersByTimeAsync(1000)
    expect(await Promise.all(jobs)).toEqual([
      { kind: 'timeout', during: 'handshake' },
      { kind: 'timeout', during: 'handshake' },
    ])
  })

  it('times out a search that goes silent and boots a fresh engine for the next one', async () => {
    vi.useFakeTimers()
    const hung = fakeEngine('lite', { hold: true })
    const { evaluator, made } = setup({ engines: [hung] })
    const job = outcome(evaluator.evaluate(recordedPosition('mate-in-1'), live()))
    await vi.advanceTimersByTimeAsync(TIMEOUTS.silenceMs)
    expect(await job).toEqual({ kind: 'timeout', during: 'search' })
    expect(hung.closed).toBe(true)
    vi.useRealTimers()
    await evaluator.evaluate(recordedPosition('mate-in-1'), live())
    expect(made).toHaveLength(2)
  })

  it('the threaded flavor without cross-origin isolation still answers from the cache', async () => {
    const cache = memoryCache()
    const full: EngineDescriptor = { kind: 'wasm', flavor: 'full' }
    const { evaluator, made } = setup({ descriptor: full, cache })
    expect(await outcome(evaluator.evaluate(recordedPosition('mate-in-1'), live()))).toEqual({ kind: 'unavailable', why: 'needs-cross-origin-isolation' })

    const isolated = setup({ descriptor: full, cache, env: { crossOriginIsolated: true, cores: 8 }, engines: [fakeEngine('native')] })
    const answer = await isolated.evaluator.evaluate(recordedPosition('mate-in-1'), live())
    await vi.waitFor(() => expect(cache.rows.size).toBe(1))
    expect(await evaluator.evaluate(recordedPosition('mate-in-1'), live())).toEqual(answer)
    expect(made).toHaveLength(0)
  })

  it('a transport that cannot even be created fails the job instead of hanging', async () => {
    const made: number[] = []
    const throwing = () => {
      made.push(1)
      throw new DOMException('Worker is blocked', 'SecurityError')
    }
    const evaluator = createEvaluator(LITE, DEPTH_12, ONE, memoryCache(), ENV, throwing)
    expect(await outcome(evaluator.evaluate(recordedPosition('mate-in-1'), live()))).toMatchObject({ kind: 'crashed' })
    expect(made).toHaveLength(2)
  })

  it('an unreachable bridge fails as unavailable without a retry', async () => {
    const unreachable: LineTransport = {
      send: () => {},
      close: () => {},
      listen: (on) => queueMicrotask(() => on({ kind: 'closed', reason: { kind: 'unavailable', why: 'bridge-unreachable' } })),
    }
    const { evaluator, made } = setup({ descriptor: BRIDGE, engines: [unreachable, unreachable] })
    expect(await outcome(evaluator.evaluate(recordedPosition('mate-in-1'), live()))).toEqual({ kind: 'unavailable', why: 'bridge-unreachable' })
    expect(made).toHaveLength(1)
  })
})

describe('pool and lifecycle', () => {
  it('boots one engine per waiting job, up to the tuning', async () => {
    const { evaluator, made } = setup({ tuning: { engines: 4, threadsPerEngine: 1, hashMb: 16 } })
    await evaluator.evaluate(recordedPosition('mate-in-1'), live())
    expect(made).toHaveLength(1)
  })

  it('boots no more engines than the tuning allows and spreads queued jobs over them', async () => {
    const engines = [fakeEngine('lite', { hold: true }), fakeEngine('lite', { hold: true }), fakeEngine('lite', { hold: true })]
    const { evaluator, made } = setup({ engines, tuning: { engines: 2, threadsPerEngine: 1, hashMb: 16 } })
    const names = ['mate-in-1', 'mated-in-1', 'one-legal-move'] as const
    const jobs = names.map((n) => evaluator.evaluate(recordedPosition(n), live()))
    await searching(engines[0]!)
    await searching(engines[1]!)
    expect(made).toHaveLength(2)
    play(engines[0]!, 'mate-in-1')
    await searching(engines[0]!, 2)
    play(engines[1]!, 'mated-in-1')
    play(engines[0]!, 'one-legal-move')
    expect((await Promise.all(jobs)).map((r) => r.lines.length)).toEqual([2, 2, 1])
    expect(made).toHaveLength(2)
  })

  it('dispose rejects queued and running jobs, quits the engine, and refuses new work', async () => {
    const engine = fakeEngine('lite', { hold: true })
    const { evaluator } = setup({ engines: [engine] })
    const running = outcome(evaluator.evaluate(recordedPosition('mate-in-1'), live()))
    const queued = outcome(evaluator.evaluate(recordedPosition('black-to-move'), live()))
    await searching(engine)
    evaluator.dispose()
    expect(await Promise.all([running, queued])).toEqual(['AbortError', 'AbortError'])
    expect(engine.sent.at(-1)).toBe('quit')
    expect(engine.closed).toBe(true)
    expect(await outcome(evaluator.evaluate(recordedPosition('mate-in-1'), live()))).toBe('AbortError')
  })
})
