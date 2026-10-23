import { DEFAULT_SETTINGS, type Settings } from '../domain/types'
import { parseEngine, parseIdentity, parseLimit, parseTuning } from './parse'

const KEY = 'lance.settings'

/** Never throws. Each bad or missing field falls back to its default alone, so one stale field keeps the rest. */
export function loadSettings(): Settings {
  let raw: unknown = null
  try {
    raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null')
  } catch {
    return DEFAULT_SETTINGS
  }
  const o = typeof raw === 'object' && raw !== null ? (raw as Readonly<Record<string, unknown>>) : {}
  return {
    v: 1,
    identity: parseIdentity(o.identity) ?? DEFAULT_SETTINGS.identity,
    engine: parseEngine(o.engine) ?? DEFAULT_SETTINGS.engine,
    limit: parseLimit(o.limit) ?? DEFAULT_SETTINGS.limit,
    tuning: parseTuning(o.tuning) ?? DEFAULT_SETTINGS.tuning,
  }
}

/** Never throws. Without storage (private mode, quota) the settings last for this page only. */
export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s))
  } catch {
    return
  }
}
