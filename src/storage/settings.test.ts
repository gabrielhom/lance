import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../domain/types'
import { loadSettings, saveSettings } from './settings'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(seed))
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => {
      items.delete(k)
    },
    setItem: (k, v) => {
      items.set(k, String(v))
    },
  }
}

const CUSTOM: Settings = {
  v: 1,
  identity: { accounts: [{ site: 'lichess', username: 'gabriel' }, { site: 'chesscom', username: 'gabe' }] },
  engine: { kind: 'bridge', url: 'http://127.0.0.1:7777', name: 'sf19', idName: 'Stockfish 19' },
  limit: { kind: 'movetime', ms: 1500 },
  tuning: { engines: 2, threadsPerEngine: 4, hashMb: 256 },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settings', () => {
  it('starts from the defaults', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('reads back what it saved', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    saveSettings(CUSTOM)
    expect(loadSettings()).toEqual(CUSTOM)
  })

  it('replaces each bad field with its default and keeps the good ones', () => {
    const stored = { ...CUSTOM, engine: { kind: 'wasm', flavor: 'lite-single' }, tuning: { engines: '4' }, limit: { kind: 'nodes', nodes: 1e6 } }
    vi.stubGlobal('localStorage', memoryStorage({ 'lance.settings': JSON.stringify(stored) }))
    expect(loadSettings()).toEqual({ ...CUSTOM, engine: DEFAULT_SETTINGS.engine, tuning: DEFAULT_SETTINGS.tuning, limit: DEFAULT_SETTINGS.limit })
  })

  it('drops only the accounts that do not parse', () => {
    const identity = { accounts: [{ site: 'lichess', username: 'gabriel' }, { site: 'fics', username: 'x' }, { site: 'any', username: '' }, null] }
    vi.stubGlobal('localStorage', memoryStorage({ 'lance.settings': JSON.stringify({ identity }) }))
    expect(loadSettings().identity).toEqual({ accounts: [{ site: 'lichess', username: 'gabriel' }] })
  })

  it('never throws: unparseable JSON, a throwing storage and no storage all give defaults', () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'lance.settings': '{"v":1,' }))
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)

    const throwing = memoryStorage()
    throwing.getItem = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    throwing.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    vi.stubGlobal('localStorage', throwing)
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    expect(() => saveSettings(CUSTOM)).not.toThrow()

    vi.stubGlobal('localStorage', undefined)
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    expect(() => saveSettings(CUSTOM)).not.toThrow()
  })
})
