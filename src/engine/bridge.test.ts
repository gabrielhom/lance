import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_ORIGINS, parseArgs, serve, type Bridge } from '../../bridge/server.mjs'
import type { EngineDescriptor } from '../domain/types'
import { probeBridge } from './bridge'
import { createEvaluator } from './evaluator'
import { memoryCache, recordedPosition } from './testing/fake-engine'
import { closeCodeWithOrigin, FAKE_UCI, fakeUciLog, hasNativeStockfish, NATIVE_STOCKFISH, statusWithHost } from './testing/node-engines.mjs'

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

const START = 'position startpos moves e2e4 e7e5'
const FEN = 'position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4'

describe('bridge guarding the engine', () => {
  let received: () => string[]
  let bridge: Bridge
  beforeAll(async () => {
    received = fakeUciLog()
    bridge = await serve({ port: 0, origins: DEFAULT_ORIGINS, engines: new Map([['fake', FAKE_UCI]]), log: () => {} })
  })
  afterAll(() => bridge.close())
  const url = () => `ws://127.0.0.1:${bridge.port}/engine/fake`
  const connect = (at = url()) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(at)
      ws.addEventListener('open', () => resolve(ws))
      ws.addEventListener('error', () => reject(new Error('socket failed')))
    })
  const closeOf = (ws: WebSocket) => new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)))
  // The engine appends quit when the bridge closes it, so seeing it means every earlier line is in the log.
  const untilQuit = async (before: number) => {
    for (let i = 0; i < 100 && received().slice(before).at(-1) !== 'quit'; i++) await new Promise((r) => setTimeout(r, 50))
    return received().slice(before)
  }

  it('relays the position, go, setoption and isready the app sends and returns the search', async () => {
    const before = received().length
    const ws = await connect()
    const lines: string[] = []
    ws.addEventListener('message', (e) => lines.push(String(e.data)))
    for (const frame of ['uci', 'setoption name Skill Level value 5', 'setoption name UCI_LimitStrength value true', START, FEN, 'isready', 'go movetime 200 nodes 3000000']) ws.send(frame)
    for (let i = 0; i < 100 && !lines.includes('bestmove e2e4'); i++) await new Promise((r) => setTimeout(r, 50))
    expect(lines).toContain('bestmove e2e4')
    ws.close()
    expect(await untilQuit(before)).toEqual(['uci', 'setoption name Skill Level value 5', 'setoption name UCI_LimitStrength value true', START, FEN, 'isready', 'go movetime 200 nodes 3000000', 'quit'])
  })

  it('never passes a file-writing option to the engine and closes the socket with 4400', async () => {
    const before = received().length
    const ws = await connect()
    const closed = closeOf(ws)
    ws.send('setoption name Debug Log File value /tmp/pwned')
    ws.send('setoption name EvalFile value /etc/passwd')
    expect(await closed).toBe(4400)
    expect(await untilQuit(before)).toEqual(['quit'])
  })

  it('refuses a frame with a line break, which would carry a second command', async () => {
    const before = received().length
    const ws = await connect()
    const closed = closeOf(ws)
    ws.send('isready\nsetoption name Debug Log File value /tmp/pwned')
    expect(await closed).toBe(4400)
    expect(await untilQuit(before)).toEqual(['quit'])
  })

  it.each(['foo', 'go infinite', 'go depth', 'position startpos moves', 'position fen x y z', 'position startpos moves e2e4; rm', 'setoption name Hash value 1 extra', 'setoption name Hash value -1', 'setoption name Threads value 9999'])(
    'refuses %s',
    async (frame) => {
      const ws = await connect()
      const closed = closeOf(ws)
      ws.send(frame)
      expect(await closed).toBe(4400)
    },
  )

  it('closes a socket whose frame is bigger than the payload limit', async () => {
    const ws = await connect()
    const closed = closeOf(ws)
    ws.send(`${START}${' e2e4'.repeat(20_000)}`)
    expect(await closed).toBe(1009)
  })

  it('refuses the connection past the engine cap with 4429 and frees the slot when one closes', async () => {
    const capped = await serve({ port: 0, origins: DEFAULT_ORIGINS, engines: new Map([['fake', FAKE_UCI]]), maxEngines: 2, log: () => {} })
    const at = `ws://127.0.0.1:${capped.port}/engine/fake`
    const first = await connect(at)
    const second = await connect(at)
    expect(await closeOf(new WebSocket(at))).toBe(4429)
    first.close()
    let third: WebSocket | undefined
    for (let i = 0; i < 100 && !third; i++) {
      const ws = new WebSocket(at)
      const code = await new Promise<number | 'open'>((resolve) => {
        ws.addEventListener('open', () => resolve('open'))
        ws.addEventListener('close', (e) => resolve(e.code))
      })
      if (code === 'open') third = ws
      else await new Promise((r) => setTimeout(r, 50))
    }
    expect(third).toBeDefined()
    second.close()
    third?.close()
    await capped.close()
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
