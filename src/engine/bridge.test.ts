import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_ORIGINS, parseArgs, serve, type Bridge } from '../../bridge/server.mjs'
import type { EngineDescriptor } from '../domain/types'
import { probeBridge } from './bridge'
import { createEvaluator } from './evaluator'
import { memoryCache, recordedPosition } from './testing/fake-engine'
import { closeCodeWithOrigin, hasNativeStockfish, NATIVE_STOCKFISH, statusWithHost } from './testing/node-engines.mjs'

const live = () => new AbortController().signal

describe('bridge arguments', () => {
  it('names engines on the command line and extends the default origins', () => {
    const parsed = parseArgs(['--engine', 'sf19=engines/stockfish-19', '--origin', 'https://lance.example/app', '--port', '9000'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.port).toBe(9000)
    expect(parsed.value.origins).toEqual([...DEFAULT_ORIGINS, 'https://lance.example'])
    expect(parsed.value.engines.get('sf19')).toMatch(/^\/.*\/engines\/stockfish-19$/)
  })

  it('rejects a run without engines, a malformed engine and an unknown flag', () => {
    expect(parseArgs([]).ok).toBe(false)
    expect(parseArgs(['--engine', 'stockfish']).ok).toBe(false)
    expect(parseArgs(['--engine', 'sf19=x', '--token', 'y']).ok).toBe(false)
  })
})

describe.skipIf(!hasNativeStockfish())('bridge serving the native Stockfish 19', () => {
  let bridge: Bridge
  beforeAll(async () => {
    bridge = await serve({ port: 0, origins: DEFAULT_ORIGINS, engines: new Map([['sf19', NATIVE_STOCKFISH]]) })
  })
  afterAll(() => bridge.close())
  const http = () => `http://127.0.0.1:${bridge.port}`
  const socket = (name: string) => `ws://127.0.0.1:${bridge.port}/engine/${name}`

  it('lists its engines with the handshake id name, readable from an allowed cross-origin isolated page', async () => {
    const res = await fetch(`${http()}/engines`, { headers: { Origin: 'http://localhost:5173' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(await res.json()).toEqual([{ name: 'sf19', idName: 'Stockfish 19' }])
    expect(await probeBridge(`127.0.0.1:${bridge.port}`, live())).toEqual({ ok: true, value: [{ name: 'sf19', idName: 'Stockfish 19' }] })
  })

  it('refuses other origins over HTTP and over the socket, unknown engine names and rebound host names', async () => {
    expect((await fetch(`${http()}/engines`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
    expect(await closeCodeWithOrigin(socket('sf19'), 'https://evil.example')).toBe(4403)
    expect(await closeCodeWithOrigin(socket('sf18'), 'http://localhost:5173')).toBe(4404)
    expect(await statusWithHost(`${http()}/engines`, `rebound.example:${bridge.port}`)).toBe(403)
    expect(await statusWithHost(`${http()}/engines`, `localhost:${bridge.port}`)).toBe(200)
  })

  it('runs a search over the WebSocket and reports the bridge refusal to the evaluator', async () => {
    const sf19: EngineDescriptor = { kind: 'bridge', url: http(), name: 'sf19', idName: 'Stockfish 19' }
    const evaluator = createEvaluator(sf19, { kind: 'depth', depth: 12 }, { engines: 1, threadsPerEngine: 1, hashMb: 16 }, memoryCache(), { crossOriginIsolated: false, cores: 2 })
    const result = await evaluator.evaluate(recordedPosition('black-to-move'), live())
    evaluator.dispose()
    expect(result.depth).toBe(12)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].pv[0]).not.toBe(result.lines[1]?.pv[0])

    const missing = createEvaluator({ ...sf19, name: 'sf18' }, { kind: 'depth', depth: 12 }, { engines: 1, threadsPerEngine: 1, hashMb: 16 }, memoryCache(), { crossOriginIsolated: false, cores: 2 })
    await expect(missing.evaluate(recordedPosition('black-to-move'), live())).rejects.toMatchObject({ reason: { kind: 'unavailable', why: 'bridge-refused' } })
  })

  it('probeBridge reports a closed port, a bad address and a server that is not a bridge', async () => {
    expect(await probeBridge('http://127.0.0.1:1', live())).toEqual({ ok: false, error: { kind: 'unreachable' } })
    expect(await probeBridge('ftp://nowhere', live())).toEqual({ ok: false, error: { kind: 'unreachable' } })
    expect(await probeBridge(`${http()}/missing`, live())).toMatchObject({ ok: false, error: { kind: 'not-uci' } })
  })
})
