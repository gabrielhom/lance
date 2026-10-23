import { describe, expect, it } from 'vitest'
import type { EngineDescriptor, EngineTuning } from '../domain/types'
import { availability, bridgeEngineUrl, bridgeHttpBase, effectiveTuning, engineId } from './descriptor'

const lite: EngineDescriptor = { kind: 'wasm', flavor: 'lite' }
const full: EngineDescriptor = { kind: 'wasm', flavor: 'full' }
const bridge: EngineDescriptor = { kind: 'bridge', url: 'http://127.0.0.1:7777', name: 'sf19', idName: 'Stockfish 19' }
const asked: EngineTuning = { engines: 4, threadsPerEngine: 4, hashMb: 32 }

describe('engineId', () => {
  it('names the net for WASM flavors and the id name for bridge engines', () => {
    expect(engineId(lite)).toBe('sf19/nn-61e7af4bb97d')
    expect(engineId(full)).toBe('sf19/nn-1a298aa575a0')
    expect(engineId(bridge)).toBe('uci/Stockfish 19')
  })
})

describe('availability', () => {
  it('needs cross-origin isolation only for the threaded flavor', () => {
    expect(availability(full, { crossOriginIsolated: false, cores: 8 })).toEqual({ ok: false, error: 'needs-cross-origin-isolation' })
    expect(availability(full, { crossOriginIsolated: true, cores: 8 }).ok).toBe(true)
    expect(availability(lite, { crossOriginIsolated: false, cores: 8 }).ok).toBe(true)
    expect(availability(bridge, { crossOriginIsolated: false, cores: 8 }).ok).toBe(true)
  })
})

describe('effectiveTuning', () => {
  it('runs a pool of single-threaded lite engines, leaving one core free', () => {
    expect(effectiveTuning(lite, asked, { crossOriginIsolated: false, cores: 12 })).toEqual({ engines: 4, threadsPerEngine: 1, hashMb: 32 })
    expect(effectiveTuning(lite, asked, { crossOriginIsolated: false, cores: 3 })).toEqual({ engines: 2, threadsPerEngine: 1, hashMb: 32 })
    expect(effectiveTuning(lite, asked, { crossOriginIsolated: false, cores: 1 })).toEqual({ engines: 1, threadsPerEngine: 1, hashMb: 32 })
  })

  it('runs one threaded full engine on every spare core', () => {
    expect(effectiveTuning(full, asked, { crossOriginIsolated: true, cores: 12 })).toEqual({ engines: 1, threadsPerEngine: 11, hashMb: 32 })
  })

  it('keeps bridge engines times threads within the cores', () => {
    const t = effectiveTuning(bridge, asked, { crossOriginIsolated: false, cores: 8 })
    expect(t.engines * t.threadsPerEngine).toBeLessThanOrEqual(8)
    expect(t).toEqual({ engines: 4, threadsPerEngine: 2, hashMb: 32 })
  })

  it('turns nonsense into the smallest working value', () => {
    expect(effectiveTuning(bridge, { engines: 0, threadsPerEngine: Number.NaN, hashMb: -5 }, { crossOriginIsolated: false, cores: 4 })).toEqual({
      engines: 1,
      threadsPerEngine: 1,
      hashMb: 1,
    })
  })
})

describe('bridge URLs', () => {
  it('accepts what a person types and derives the engine socket', () => {
    expect(bridgeHttpBase('127.0.0.1:7777')).toBe('http://127.0.0.1:7777')
    expect(bridgeHttpBase(' ws://localhost:7777/ ')).toBe('http://localhost:7777')
    expect(bridgeHttpBase('https://box.local:9000')).toBe('https://box.local:9000')
    expect(bridgeEngineUrl('http://127.0.0.1:7777', 'sf 19')).toBe('ws://127.0.0.1:7777/engine/sf%2019')
    expect(bridgeHttpBase('ftp://127.0.0.1')).toBeNull()
    expect(bridgeHttpBase('')).toBeNull()
  })
})
