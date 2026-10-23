// Records real Stockfish 19 UCI output for the parser and session tests.
// node scripts/record-uci.mjs [path/to/native/stockfish]   (default engines/stockfish-19)
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { Chess } from 'chess.js'

const require = createRequire(import.meta.url)
const OUT = 'src/engine/fixtures/sf19-transcripts.json'

const SCENARIOS = [
  { name: 'black-to-move', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', go: 'go depth 12', legal: 20 },
  { name: 'mate-in-1', fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', go: 'go depth 12', legal: 20 },
  { name: 'mated-in-1', fen: '7k/p4Q2/6K1/8/8/8/8/8 b - - 0 1', go: 'go depth 12', legal: 2 },
  { name: 'checkmated', fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', go: 'go depth 12', legal: 0 },
  { name: 'one-legal-move', fen: 'R6k/8/6P1/8/8/8/8/7K b - - 0 1', go: 'go depth 12', legal: 1 },
  {
    name: 'tail',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: ['g1f3', 'g8f6', 'f3g1', 'f6g8'],
    go: 'go depth 10',
    legal: 20,
  },
  { name: 'stop', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', go: 'go movetime 10000', legal: 27, stop: true },
]

function nativeEngine(path) {
  const child = spawn(path, [], { stdio: ['pipe', 'pipe', 'inherit'] })
  const listeners = new Set()
  createInterface({ input: child.stdout }).on('line', (line) => listeners.forEach((l) => l(line)))
  return { send: (c) => child.stdin.write(c + '\n'), listeners, quit: () => child.stdin.end('quit\n') }
}

function liteEngine() {
  const listeners = new Set()
  const sf = require('stockfish')('lite-single', (line) => listeners.forEach((l) => l(line)))
  return { send: (c) => sf.processCommand(c), listeners, quit: () => sf.terminate() }
}

function collect(engine, commands, done, onLine = () => {}) {
  return new Promise((resolve) => {
    const lines = []
    const listener = (line) => {
      lines.push(line)
      onLine(line)
      if (done(line)) {
        engine.listeners.delete(listener)
        resolve(lines)
      }
    }
    engine.listeners.add(listener)
    for (const c of commands) engine.send(c)
  })
}

async function stopScenario(engine, s) {
  // A bounded final line only shows up when stop lands mid-iteration, so retry until one does.
  for (let attempt = 0; attempt < 20; attempt++) {
    let timer
    const lines = await collect(engine, [s.go], (l) => l.startsWith('bestmove'), (l) => {
      if (!timer && /^info depth (\d+)/.exec(l)?.[1] >= 8) timer = setTimeout(() => engine.send('stop'), 50 + attempt * 37)
    })
    const lastInfo = lines.filter((l) => l.includes(' pv ')).at(-1) ?? ''
    if (/(lower|upper)bound/.test(lastInfo)) return lines
    await collect(engine, ['isready'], (l) => l === 'readyok')
  }
  throw new Error('no bounded line after stop in 20 attempts')
}

async function record(engine) {
  const handshake = await collect(engine, ['uci'], (l) => l === 'uciok')
  await collect(engine, ['setoption name MultiPV value 2', 'setoption name Hash value 16', 'isready'], (l) => l === 'readyok')
  const scenarios = {}
  for (const s of SCENARIOS) {
    const chess = new Chess(s.fen)
    for (const m of s.moves ?? []) chess.move(m)
    if (chess.moves().length !== s.legal) throw new Error(`${s.name}: ${chess.moves().length} legal moves, expected ${s.legal}`)
    const position = `position fen ${s.fen}${s.moves ? ` moves ${s.moves.join(' ')}` : ''}`
    await collect(engine, ['ucinewgame', position, 'isready'], (l) => l === 'readyok')
    const started = performance.now()
    const lines = s.stop ? await stopScenario(engine, s) : await collect(engine, [s.go], (l) => l.startsWith('bestmove'))
    console.log(`${s.name}: ${lines.length} lines, ${Math.round(performance.now() - started)} ms`)
    scenarios[s.name] = { fen: s.fen, moves: s.moves ?? [], go: s.go, legalMoves: s.legal, lines }
  }
  engine.quit()
  return { handshake, scenarios }
}

const nativePath = process.argv[2] ?? 'engines/stockfish-19'
const native = await record(nativeEngine(nativePath))
const lite = await record(liteEngine())
writeFileSync(OUT, JSON.stringify({ native, lite }, null, 1) + '\n')
console.log(`wrote ${OUT}`)
process.exit(0)
