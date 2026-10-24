// Relays WebSocket frames to native UCI engines named on the command line, one child process per connection.
// node bridge/server.mjs --engine sf19=/path/to/stockfish [--engine lc0=/path] [--port 7777] [--origin http://host:port]
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { refusal } from './commands.mjs'

export const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://127.0.0.1:5199', 'http://localhost:4173']
const USAGE = 'usage: npm run bridge -- --engine <name>=<path> [--engine <name>=<path>] [--port 7777] [--origin <url>]'
const ENGINE_NAME = /^[\w.-]+$/
const HANDSHAKE_MS = 10_000
const QUIT_GRACE_MS = 2_000
// A `position` with 600 moves is about 4 KB.
export const MAX_FRAME_BYTES = 64 * 1024
export const MAX_ENGINES = 8
// Close codes in the 4000s are ours: 4403 origin, 4404 engine name, 4429 engine cap, 4400 refused command.

export function parseArgs(argv) {
  const engines = new Map()
  const origins = [...DEFAULT_ORIGINS]
  let port = 7777
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (value === undefined) return { ok: false, error: `${flag} needs a value` }
    if (flag === '--engine') {
      const at = value.indexOf('=')
      const name = value.slice(0, at)
      if (at < 0 || !ENGINE_NAME.test(name) || at === value.length - 1) return { ok: false, error: `--engine wants name=path, got ${value}` }
      engines.set(name, resolve(value.slice(at + 1)))
    } else if (flag === '--port') {
      port = Number(value)
      if (!Number.isInteger(port) || port < 0 || port > 65535) return { ok: false, error: `--port wants a port number, got ${value}` }
    } else if (flag === '--origin') {
      if (!URL.canParse(value)) return { ok: false, error: `--origin wants a URL, got ${value}` }
      origins.push(new URL(value).origin)
    } else {
      return { ok: false, error: `unknown option ${flag}` }
    }
  }
  if (engines.size === 0) return { ok: false, error: 'name at least one --engine' }
  return { ok: true, value: { port, origins, engines } }
}

/** Runs the uci handshake once, so /engines can report each engine's id name without the browser naming a path. */
function identify(path) {
  return new Promise((done, fail) => {
    const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'ignore'] })
    let idName = null
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`${path} did not finish the uci handshake in ${HANDSHAKE_MS} ms`))
    }, HANDSHAKE_MS)
    child.stdin.on('error', () => {})
    child.on('error', (e) => {
      clearTimeout(timer)
      fail(new Error(`cannot start ${path}: ${e.message}`))
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`${path} exited (${code}) before uciok`))
    })
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.startsWith('id name ')) idName = line.slice('id name '.length).trim()
      if (line.trim() !== 'uciok') return
      clearTimeout(timer)
      child.stdin.end('quit\n')
      if (idName) done(idName)
      else fail(new Error(`${path} sent no id name`))
    })
    child.stdin.write('uci\n')
  })
}

export async function serve({ port, origins, engines, maxEngines = MAX_ENGINES, log = console.error }) {
  const listed = []
  for (const [name, path] of engines) listed.push({ name, idName: await identify(path) })
  const allowedOrigins = new Set(origins)
  const children = new Set()
  let hosts = new Set()

  // Browsers always send Origin on WebSocket and CORS requests, so a missing one is a local non-browser client.
  // The Host check stops a DNS-rebound page, which would otherwise be same-origin with the bridge.
  const allowed = (req) => hosts.has(req.headers.host) && (req.headers.origin === undefined || allowedOrigins.has(req.headers.origin))

  const server = createServer((req, res) => {
    const headers = { 'Cross-Origin-Resource-Policy': 'cross-origin', Vary: 'Origin', 'Content-Type': 'application/json' }
    // Echoed on refusals too, so the settings page can tell a refused origin from a bridge that is not running.
    if (req.headers.origin) headers['Access-Control-Allow-Origin'] = req.headers.origin
    const reply = (status, body) => res.writeHead(status, headers).end(JSON.stringify(body))
    if (!allowed(req)) return reply(403, { error: 'origin not allowed' })
    if (new URL(req.url ?? '/', 'http://bridge').pathname !== '/engines') return reply(404, { error: 'not found' })
    if (req.method === 'OPTIONS') {
      return res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Private-Network': 'true' }).end()
    }
    if (req.method !== 'GET') return reply(405, { error: 'GET only' })
    reply(200, listed)
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!allowed(req)) return ws.close(4403, 'origin not allowed')
      const path = engines.get(engineName(req.url))
      if (!path) return ws.close(4404, 'unknown engine')
      if (children.size >= maxEngines) return ws.close(4429, `at most ${maxEngines} engines at once`)
      relay(ws, path, children, log)
    })
  })

  await new Promise((listening, failed) => {
    server.once('error', failed)
    server.listen(port, '127.0.0.1', listening)
  })
  const actual = server.address().port
  hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`])

  return {
    port: actual,
    engines: listed,
    close: () =>
      new Promise((closed) => {
        for (const ws of wss.clients) ws.terminate()
        for (const child of children) child.kill('SIGKILL')
        server.close(() => closed())
        server.closeAllConnections()
      }),
  }
}

function engineName(url) {
  const path = new URL(url ?? '/', 'http://bridge').pathname
  if (!path.startsWith('/engine/')) return null
  try {
    return decodeURIComponent(path.slice('/engine/'.length))
  } catch {
    return null
  }
}

function relay(ws, path, children, log) {
  const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'ignore'] })
  children.add(child)
  child.stdin.on('error', () => {})
  createInterface({ input: child.stdout }).on('line', (line) => {
    if (ws.readyState === ws.OPEN) ws.send(line)
  })
  child.on('error', (e) => ws.close(1011, `engine failed to start: ${e.code ?? e.message}`.slice(0, 120)))
  child.on('exit', (code, signal) => {
    children.delete(child)
    if (ws.readyState === ws.OPEN) ws.close(1011, `engine exited (${code ?? signal})`)
  })
  // A refused frame closes the socket instead of being dropped: the app never sends one, so the peer is not our client.
  ws.on('message', (data, isBinary) => {
    if (ws.readyState !== ws.OPEN) return
    const frame = isBinary ? null : data.toString()
    const why = frame === null ? 'binary frame' : refusal(frame)
    if (why === null) return void child.stdin.write(`${frame}\n`)
    log(`bridge: refused client frame (${why}), closing`)
    ws.close(4400, why.slice(0, 120))
  })
  ws.on('error', () => ws.terminate())
  ws.on('close', () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.stdin.end('quit\n')
    setTimeout(() => child.kill('SIGKILL'), QUIT_GRACE_MS).unref()
  })
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  const args = parseArgs(process.argv.slice(2))
  if (!args.ok) {
    console.error(`${args.error}\n${USAGE}`)
    process.exit(2)
  }
  try {
    const bridge = await serve(args.value)
    console.log(`Lance bridge on http://127.0.0.1:${bridge.port}`)
    for (const e of bridge.engines) console.log(`  ${e.name}: ${e.idName}`)
    console.log(`Allowed origins: ${args.value.origins.join(', ')}`)
    const stop = () => bridge.close().then(() => process.exit(0))
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  }
}
