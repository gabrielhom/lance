import { WASM_FLAVORS, type EngineDescriptor, type EngineId, type EngineTuning, type Result, type RuntimeEnv } from '../domain/types'

export function runtimeEnv(): RuntimeEnv {
  return {
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    cores: Math.max(1, globalThis.navigator?.hardwareConcurrency || 1),
  }
}

/** Static, so a cache lookup never needs a live engine. The session checks the live engine against it. */
export function engineId(d: EngineDescriptor): EngineId {
  return (d.kind === 'wasm' ? `sf19/${WASM_FLAVORS[d.flavor].net}` : `uci/${d.idName}`) as EngineId
}

export function availability(d: EngineDescriptor, env: RuntimeEnv): Result<void, 'needs-cross-origin-isolation'> {
  if (d.kind === 'wasm' && WASM_FLAVORS[d.flavor].threaded && !env.crossOriginIsolated) {
    return { ok: false, error: 'needs-cross-origin-isolation' }
  }
  return { ok: true, value: undefined }
}

/** The one place tuning policy lives. One core stays free for the page. The single-threaded flavor runs a pool, the
 *  threaded flavor runs one engine on every spare core (each worker would load its own 99 MB net). */
export function effectiveTuning(d: EngineDescriptor, t: EngineTuning, env: RuntimeEnv): EngineTuning {
  const spare = Math.max(1, env.cores - 1)
  const hashMb = atLeastOne(t.hashMb)
  if (d.kind === 'wasm' && !WASM_FLAVORS[d.flavor].threaded) {
    return { engines: Math.min(atLeastOne(t.engines), spare), threadsPerEngine: 1, hashMb }
  }
  if (d.kind === 'wasm') return { engines: 1, threadsPerEngine: spare, hashMb }
  const engines = Math.min(atLeastOne(t.engines), spare)
  return { engines, threadsPerEngine: Math.min(atLeastOne(t.threadsPerEngine), Math.max(1, Math.floor(env.cores / engines))), hashMb }
}

function atLeastOne(n: number): number {
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1
}

/** Accepts what a person types: `127.0.0.1:7777`, `http://…`, or `ws://…`. Returns the HTTP base without a trailing slash. */
export function bridgeHttpBase(url: string): string | null {
  const text = url.trim()
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`)
    const protocol = { 'http:': 'http:', 'ws:': 'http:', 'https:': 'https:', 'wss:': 'https:' }[parsed.protocol]
    if (!protocol || !parsed.host) return null
    return `${protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export function bridgeEngineUrl(url: string, name: string): string | null {
  const base = bridgeHttpBase(url)
  return base && `${base.replace(/^http/, 'ws')}/engine/${encodeURIComponent(name)}`
}
