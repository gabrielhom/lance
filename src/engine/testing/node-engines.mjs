// Node-only test plumbing, kept in plain JS so Node's types never enter the browser program.
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

export const NATIVE_STOCKFISH = fileURLToPath(new URL('../../../engines/stockfish-19', import.meta.url))

export function hasNativeStockfish() {
  return existsSync(NATIVE_STOCKFISH)
}

export function liteSingleTransport() {
  const path = require('stockfish').findEngine('lite-single')
  // The glue keeps its engine in module scope, so a cached module would hand every caller the same engine.
  delete require.cache[path]
  const engine = require(path)()
  let on = () => {}
  let open = true
  // A worker never delivers synchronously, while this engine prints from inside processCommand.
  engine.listener = (line) => setImmediate(() => open && on({ kind: 'line', line }))
  return {
    send(line) {
      if (!open) return
      // `quit` would call process.exit on the test runner.
      if (line === 'quit') open = false
      else engine.processCommand(line)
    },
    listen(f) {
      on = f
    },
    close() {
      if (open) engine.processCommand('stop')
      open = false
    },
  }
}

export function closeCodeWithOrigin(url, origin) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } })
    ws.addEventListener('close', (e) => resolve(e.code))
  })
}

export function statusWithHost(url, host) {
  return new Promise((resolve, reject) => {
    request(url, { headers: { Host: host } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
      .on('error', reject)
      .end()
  })
}
