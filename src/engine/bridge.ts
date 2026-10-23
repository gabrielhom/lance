import type { BridgeEngine, BridgeProbeError, Result } from '../domain/types'
import { bridgeHttpBase } from './descriptor'

/** Asks a running bridge which engines it serves. Rejects with AbortError when the signal aborts. */
export async function probeBridge(url: string, signal: AbortSignal): Promise<Result<readonly BridgeEngine[], BridgeProbeError>> {
  const base = bridgeHttpBase(url)
  if (base === null) return { ok: false, error: { kind: 'unreachable' } }
  let res: Response
  try {
    res = await fetch(`${base}/engines`, { signal })
  } catch (error) {
    if (signal.aborted) throw error
    return { ok: false, error: { kind: 'unreachable' } }
  }
  if (res.status === 403) return { ok: false, error: { kind: 'refused' } }
  if (!res.ok) return { ok: false, error: { kind: 'not-uci', detail: `GET /engines answered ${res.status}` } }
  const body: unknown = await res.json().catch(() => null)
  const engines = Array.isArray(body) ? body.filter(isBridgeEngine) : []
  if (!Array.isArray(body) || engines.length !== body.length || engines.length === 0) {
    return { ok: false, error: { kind: 'not-uci', detail: 'GET /engines did not list any engines' } }
  }
  return { ok: true, value: engines.map(({ name, idName }) => ({ name, idName })) }
}

function isBridgeEngine(x: unknown): x is BridgeEngine {
  return typeof x === 'object' && x !== null && 'name' in x && 'idName' in x && typeof x.name === 'string' && typeof x.idName === 'string'
}
