import { afterAll, describe, expect, it } from 'vitest'
import type { EngineDescriptor, EngineTuning, RuntimeEnv } from '../domain/types'
import { createEvaluator } from './evaluator'
import { memoryCache, recordedPosition } from './testing/fake-engine'
import { liteSingleTransport } from './testing/node-engines.mjs'

const LITE: EngineDescriptor = { kind: 'wasm', flavor: 'lite' }
const ONE: EngineTuning = { engines: 1, threadsPerEngine: 1, hashMb: 16 }
const ENV: RuntimeEnv = { crossOriginIsolated: false, cores: 2 }
const live = () => new AbortController().signal

describe('the real lite-single Stockfish 19, in process', () => {
  const evaluator = createEvaluator(LITE, { kind: 'depth', depth: 12 }, ONE, memoryCache(), ENV, liteSingleTransport)
  afterAll(() => evaluator.dispose())

  it('finds the mate in one for White to move', async () => {
    const result = await evaluator.evaluate(recordedPosition('mate-in-1'), live())
    expect(result.lines[0]).toEqual({ score: { kind: 'mate', winner: 'w', moves: 1 }, pv: ['a1a8'] })
    expect(result.lines[1]?.score.kind).toBe('cp')
  })

  it('scores Black to move, mated next move, as a White mate', async () => {
    const result = await evaluator.evaluate(recordedPosition('mated-in-1'), live())
    expect(result.lines.map((l) => l.score)).toEqual([
      { kind: 'mate', winner: 'w', moves: 1 },
      { kind: 'mate', winner: 'w', moves: 1 },
    ])
  })

  it('returns two different lines at the target depth for a normal position', async () => {
    const result = await evaluator.evaluate(recordedPosition('black-to-move'), live())
    expect(result.depth).toBe(12)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].pv[0]).not.toBe(result.lines[1]?.pv[0])
  })

  it('returns one line when only one move is legal', async () => {
    const result = await evaluator.evaluate(recordedPosition('one-legal-move'), live())
    expect(result.lines.map((l) => l.pv[0])).toEqual(['h8g7'])
  })

  it('stops a long search soon after abort', async () => {
    const timed = createEvaluator(LITE, { kind: 'movetime', ms: 20_000 }, ONE, memoryCache(), ENV, liteSingleTransport)
    const ac = new AbortController()
    const started = Date.now()
    const running = timed.evaluate(recordedPosition('stop'), ac.signal, (e) => e.kind === 'depth' && e.depth >= 10 && ac.abort())
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - started).toBeLessThan(10_000)
    timed.dispose()
  }, 15_000)
})
