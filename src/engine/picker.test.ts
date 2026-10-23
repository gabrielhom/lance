import { describe, expect, it, vi } from 'vitest'
import type { EngineDescriptor, EngineInput, EngineTuning, PlayLevel, RuntimeEnv, Strength } from '../domain/types'
import { EngineFailure } from './failure'
import { createMovePicker } from './picker'
import { fakeEngine, recordedPosition, type FakeEngine } from './testing/fake-engine'
import type { LineTransport } from './transport'

const LITE: EngineDescriptor = { kind: 'wasm', flavor: 'lite' }
const ENV: RuntimeEnv = { crossOriginIsolated: false, cores: 8 }
const ONE: EngineTuning = { engines: 4, threadsPerEngine: 1, hashMb: 32 }

const level = (strength: Strength, movetimeMs = 300): PlayLevel => ({ id: 1, name: 'Nível', rating: '~1500', strength, movetimeMs })
const ELO_1500 = level({ kind: 'elo', elo: 1500 })
const MAX = level({ kind: 'max' })
const BLACK = recordedPosition('black-to-move').input
const TAIL = recordedPosition('tail').input
const MATE = recordedPosition('mate-in-1').input

const live = () => new AbortController().signal
const outcome = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (e instanceof EngineFailure ? e.reason : (e as Error).name))
const strengthLines = (lines: readonly string[]) => lines.filter((l) => /^setoption name (UCI_|Skill)/.test(l))
const searching = (engine: FakeEngine, count: number) => vi.waitFor(() => expect(engine.sent.filter((l) => l.startsWith('go ')).length).toBe(count))

function setup(engines: LineTransport[] = [], descriptor = LITE, env = ENV) {
  const made: LineTransport[] = []
  const connect = () => {
    const engine = engines[made.length] ?? fakeEngine('lite')
    made.push(engine)
    return engine
  }
  return { picker: createMovePicker(descriptor, ONE, env, connect), made }
}

describe('pick', () => {
  it('asks for one line at the level strength in a new game, searches the level movetime and plays the bestmove', async () => {
    const engine = fakeEngine('lite')
    const { picker } = setup([engine])
    expect(await picker.pick(BLACK, ELO_1500, live())).toBe('e7e5')
    expect(engine.sent).toEqual([
      'uci',
      'setoption name Threads value 1',
      'setoption name Hash value 32',
      'isready',
      'setoption name MultiPV value 1',
      'setoption name UCI_LimitStrength value true',
      'setoption name UCI_Elo value 1500',
      'ucinewgame',
      'isready',
      'position fen rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      'go movetime 300',
    ])
  })

  it.each([
    [{ kind: 'elo', elo: 800 }, ['setoption name UCI_LimitStrength value true', 'setoption name UCI_Elo value 1320']],
    [{ kind: 'elo', elo: 4000 }, ['setoption name UCI_LimitStrength value true', 'setoption name UCI_Elo value 3190']],
    [{ kind: 'skill', level: 3 }, ['setoption name UCI_LimitStrength value false', 'setoption name Skill Level value 3']],
    [{ kind: 'max' }, ['setoption name UCI_LimitStrength value false', 'setoption name Skill Level value 20']],
  ] as const)('sets %o as %o, an Elo clamped to the advertised range', async (strength, expected) => {
    const engine = fakeEngine('lite')
    await setup([engine]).picker.pick(BLACK, level(strength), live())
    expect(strengthLines(engine.sent)).toEqual(expected)
  })

  it.each([
    [1000, 0],
    [2255, 10],
    [3500, 20],
  ])('an engine with Skill Level but no UCI_Elo plays Elo %i at Skill Level %i', async (elo, skill) => {
    const engine = fakeEngine('lite', { without: ['UCI_Elo', 'UCI_LimitStrength'] })
    await setup([engine]).picker.pick(BLACK, level({ kind: 'elo', elo }), live())
    expect(strengthLines(engine.sent)).toEqual([`setoption name Skill Level value ${skill}`])
  })

  it('an engine with neither plays every strength at full strength', async () => {
    const engine = fakeEngine('lite', { without: ['UCI_Elo', 'UCI_LimitStrength', 'Skill Level'] })
    const { picker } = setup([engine])
    expect(await picker.pick(BLACK, level({ kind: 'elo', elo: 1500 }), live())).toBe('e7e5')
    expect(await picker.pick(TAIL, level({ kind: 'skill', level: 2 }), live())).toBe('e2e4')
    expect(strengthLines(engine.sent)).toEqual([])
  })

  it('sends a strength only when it changed since the last pick', async () => {
    const engine = fakeEngine('lite')
    const { picker } = setup([engine])
    const sentFor = async (at: EngineInput, l: PlayLevel) => {
      const from = engine.sent.length
      await picker.pick(at, l, live())
      return strengthLines(engine.sent.slice(from))
    }
    expect(await sentFor(BLACK, ELO_1500)).toEqual(['setoption name UCI_LimitStrength value true', 'setoption name UCI_Elo value 1500'])
    expect(await sentFor(TAIL, ELO_1500)).toEqual([])
    expect(await sentFor(MATE, MAX)).toEqual(['setoption name UCI_LimitStrength value false', 'setoption name Skill Level value 20'])
    expect(await sentFor(BLACK, ELO_1500)).toEqual(['setoption name UCI_LimitStrength value true'])
  })

})

describe('abort and lifecycle', () => {
  it('abort sends stop, rejects with AbortError once its bestmove arrives, and keeps the engine', async () => {
    const engine = fakeEngine('lite', { hold: true })
    const { picker, made } = setup([engine])
    const ac = new AbortController()
    const running = outcome(picker.pick(BLACK, MAX, ac.signal))
    await searching(engine, 1)
    ac.abort()
    expect(engine.sent.at(-1)).toBe('stop')
    engine.emit('bestmove e7e5')
    expect(await running).toBe('AbortError')

    const next = picker.pick(BLACK, MAX, live())
    await searching(engine, 2)
    engine.emit('bestmove d7d5')
    expect(await next).toBe('d7d5')
    expect(made).toHaveLength(1)
  })

  it('a pick asked while the last one is stopping waits for its bestmove', async () => {
    const engine = fakeEngine('lite', { hold: true })
    const { picker } = setup([engine])
    const ac = new AbortController()
    const aborted = outcome(picker.pick(BLACK, MAX, ac.signal))
    await searching(engine, 1)
    ac.abort()
    const next = picker.pick(TAIL, MAX, live())
    await new Promise((r) => setTimeout(r, 20))
    expect(engine.sent.at(-1)).toBe('stop')

    engine.emit('bestmove e7e5')
    expect(await aborted).toBe('AbortError')
    await searching(engine, 2)
    engine.emit('bestmove e2e4')
    expect(await next).toBe('e2e4')
  })

  it('retries a crashed pick once on a fresh engine', async () => {
    const { picker, made } = setup([fakeEngine('lite', { crashOnGo: true }), fakeEngine('lite')])
    expect(await picker.pick(BLACK, MAX, live())).toBe('e7e5')
    expect(made).toHaveLength(2)
  })

  it('dispose rejects the pick in flight, quits the engine and refuses new picks', async () => {
    const engine = fakeEngine('lite', { hold: true })
    const { picker } = setup([engine])
    const running = outcome(picker.pick(BLACK, MAX, live()))
    await searching(engine, 1)
    picker.dispose()
    expect(await running).toBe('AbortError')
    expect(engine.sent.at(-1)).toBe('quit')
    expect(await outcome(picker.pick(BLACK, MAX, live()))).toBe('AbortError')
  })

  it('the threaded flavor without cross-origin isolation is unavailable and boots nothing', async () => {
    const { picker, made } = setup([], { kind: 'wasm', flavor: 'full' })
    expect(await outcome(picker.pick(BLACK, MAX, live()))).toEqual({ kind: 'unavailable', why: 'needs-cross-origin-isolation' })
    expect(made).toHaveLength(0)
  })
})
