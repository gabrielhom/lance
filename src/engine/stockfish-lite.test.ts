import { Chess } from 'chess.js'
import { afterAll, describe, expect, it } from 'vitest'
import opera from '../../e2e/fixtures/opera.pgn?raw'
import { gameFromPgn, type EngineDescriptor, type EngineInput, type EngineTuning, type PlayablePosition, type PlayLevel, type RuntimeEnv, type Strength } from '../domain'
import { createEvaluator } from './evaluator'
import { createMovePicker } from './picker'
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

describe('the real lite-single Stockfish 19 analyses a game the same way every time', () => {
  it('gives the same eval for every position whatever the pool size and the order the positions are searched in', async () => {
    const game = gameFromPgn(opera, { kind: 'pgn' })
    if (!game.ok) throw new Error(game.error.detail)
    const playable = game.value.positions.filter((p): p is PlayablePosition => p.kind === 'playable')
    const analyse = async (engines: number, order: readonly PlayablePosition[]) => {
      const evaluator = createEvaluator(LITE, { kind: 'depth', depth: 12 }, { engines, threadsPerEngine: 1, hashMb: 16 }, memoryCache(), { crossOriginIsolated: false, cores: 8 }, liteSingleTransport)
      const evals = await Promise.all(order.map((p) => evaluator.evaluate(p, live())))
      evaluator.dispose()
      return new Map(order.map((p, i) => [p.index, evals[i]]))
    }
    const forward = await analyse(3, playable)
    const backward = await analyse(2, [...playable].reverse())
    expect(playable.length).toBe(33)
    for (const p of playable) expect(backward.get(p.index), `position ${p.index}`).toEqual(forward.get(p.index))
  }, 30_000)
})

describe('the real lite-single Stockfish 19 picks moves to play', () => {
  const picker = createMovePicker(LITE, ONE, ENV, liteSingleTransport)
  afterAll(() => picker.dispose())
  const level = (strength: Strength, movetimeMs: number): PlayLevel => ({ id: 0, name: 'Nível', rating: '?', strength, movetimeMs })
  const legal = (input: EngineInput) => {
    const board = new Chess(input.root)
    for (const move of input.tail) board.move(move)
    return board.moves({ verbose: true }).map((m) => m.lan)
  }
  const opening = recordedPosition('stop').input

  it.each([
    ['Skill Level 0', { kind: 'skill', level: 0 }],
    ['Elo 1320', { kind: 'elo', elo: 1320 }],
    ['full strength', { kind: 'max' }],
  ] as const)('plays a legal move at %s', async (_name, strength) => {
    expect(legal(opening)).toContain(await picker.pick(opening, level(strength, 200), live()))
  })

  it('finds the mate in one at full strength', async () => {
    expect(await picker.pick(recordedPosition('mate-in-1').input, level({ kind: 'max' }, 300), live())).toBe('a1a8')
  })
})
