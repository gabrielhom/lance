// Fits accuracy -> rating on real Lichess games and writes src/analysis/elo-table.json.
// node scripts/calibrate-elo.mjs [--month 2026-09] [--mb 800] [--pgn head.pgn]
// Streams the head of a monthly dump from database.lichess.org (never the whole file) and keeps the games Lichess
// analysed, with both ratings. Accuracies come from the app's own code, so the table matches what the review shows.
// --pgn reads the same bytes from a head saved earlier (curl <dump url> | zstd -dc | head -c <bytes> > head.pgn),
// since the server slows down repeated downloads.
import { spawn } from 'node:child_process'
import { createReadStream, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { runnerImport } from 'vite'

const { values: args } = parseArgs({
  options: { month: { type: 'string', default: '2026-09' }, mb: { type: 'string', default: '800' }, pgn: { type: 'string' } },
})
const OUT = 'src/analysis/elo-table.json'
const SCOPES = ['game', 'opening', 'middlegame', 'endgame']
/** Stands in for the app's 10 moves outside theory, which the dump can't tell: the book is a few moves deep. */
const MIN_GAME_MOVES = 15
const MIN_BIN = 400
const MAX_BINS = 40
/** A scope whose table can't beat always guessing the mean by this much on held-out games gets no estimate in the app. */
const MIN_GAIN = 0.01

const load = async (id) => (await runnerImport(id, { configFile: false, logLevel: 'error' })).module
const { gameFromPgn, MIN_PHASE_MOVES } = await load('./src/domain/index.ts')
const { completeEvals, gameAccuracy } = await load('./src/analysis/index.ts')
const { phaseAccuracy } = await load('./src/analysis/accuracy.ts')
const { divide } = await load('./src/analysis/phases.ts')

const source = args.pgn
  ? createReadStream(args.pgn, { end: Number(args.mb) * 1e6 - 1 })
  : spawn('sh', ['-c', `curl -sf https://database.lichess.org/standard/lichess_db_standard_rated_${args.month}.pgn.zst | zstd -dc | head -c ${Number(args.mb) * 1e6}`], {
      stdio: ['ignore', 'pipe', 'inherit'],
    }).stdout

const rows = []
let seen = 0
let analysed = 0
let header = []
for await (const line of createInterface({ input: source, crlfDelay: Infinity })) {
  if (line.startsWith('[')) header.push(line)
  else if (line.startsWith('1.') && header.length > 0) {
    seen++
    if (line.includes('[%eval')) {
      const game = sample(header, line)
      if (game) {
        analysed++
        rows.push(...game)
      }
    }
    header = []
    if (seen % 20000 === 0) process.stderr.write(`\r${seen} games read, ${analysed} analysed`)
  }
}
process.stderr.write(`\r${seen} games read, ${analysed} analysed\n`)

/** Both players' rows from one analysed game, or null when it can't be used. */
function sample(header, movetext) {
  const tag = (name) => header.find((h) => h.startsWith(`[${name} "`))?.slice(name.length + 3, -2)
  const ratings = { w: Number(tag('WhiteElo')), b: Number(tag('BlackElo')) }
  const speed = /^Rated (\w+)/.exec(tag('Event') ?? '')?.[1]?.toLowerCase()
  if (!speed || speed === 'correspondence' || !(ratings.w > 0 && ratings.b > 0) || tag('Variant')) return null
  const parsed = gameFromPgn(movetext.replace(/\{[^}]*\}/g, ''), { kind: 'pgn' })
  if (!parsed.ok) return null
  const game = parsed.value
  // Lichess writes one comment per move, holding the eval of the position after it; the mating move has none.
  const comments = [...movetext.matchAll(/\{([^}]*)\}/g)].map((m) => m[1])
  if (comments.length !== game.moves.length) return null
  const scores = [{ kind: 'cp', white: 15 }, ...comments.map(score)]
  const found = new Map()
  for (const p of game.positions) {
    const s = scores[p.index]
    if (p.kind === 'playable' && s) found.set(p.key, { depth: 20, lines: [{ score: s, pv: ['0000'] }] })
  }
  const evals = completeEvals(game, found)
  if (!evals.ok) return null
  const whole = gameAccuracy(game, evals.value)
  const phases = phaseAccuracy(game, evals.value, divide(game.positions.map((p) => p.fen)))
  return ['w', 'b'].map((c) => ({
    speed,
    rating: ratings[c],
    game: game.moves.filter((m) => m.mover === c).length >= MIN_GAME_MOVES ? whole[c] : null,
    opening: phases[c].opening.accuracy,
    middlegame: phases[c].middlegame.accuracy,
    endgame: phases[c].endgame.accuracy,
  }))
}

function score(comment) {
  const e = /\[%eval (#?)(-?[\d.]+)\]/.exec(comment)
  if (!e) return null
  const n = Number(e[2])
  return e[1] ? { kind: 'mate', winner: n > 0 ? 'w' : 'b', moves: Math.abs(n) } : { kind: 'cp', white: Math.round(n * 100) }
}

/** Equal-count accuracy bins, each with the quartiles of rating, made non-decreasing by pooling adjacent violators. */
function fit(pairs) {
  const sorted = [...pairs].sort((a, b) => a.acc - b.acc)
  const size = Math.max(MIN_BIN, Math.ceil(sorted.length / MAX_BINS))
  const bins = []
  for (let i = 0; i + size <= sorted.length; i += size) {
    // The remainder joins the last bin.
    const chunk = i + 2 * size > sorted.length ? sorted.slice(i, (i = sorted.length)) : sorted.slice(i, i + size)
    const ratings = chunk.map((p) => p.rating).sort((a, b) => a - b)
    bins.push({ n: chunk.length, acc: quantile(chunk.map((p) => p.acc), 0.5), q: [0.25, 0.5, 0.75].map((q) => quantile(ratings, q)) })
  }
  const columns = [0, 1, 2].map((k) => isotonic(bins.map((b) => ({ n: b.n, y: b.q[k] }))))
  const points = bins.map((b, i) => [round(b.acc, 1), ...columns.map((col) => Math.round(col[i]))])
  return points.filter((p, i) => p[0] !== points[i + 1]?.[0])
}

function quantile(sorted, q) {
  const at = (sorted.length - 1) * q
  const lo = Math.floor(at)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (at - lo)
}

function isotonic(points) {
  const blocks = []
  for (const p of points) {
    blocks.push({ n: p.n, y: p.y, count: 1 })
    while (blocks.length > 1 && blocks.at(-2).y > blocks.at(-1).y) {
      const b = blocks.pop()
      const a = blocks.pop()
      blocks.push({ n: a.n + b.n, y: (a.y * a.n + b.y * b.n) / (a.n + b.n), count: a.count + b.count })
    }
  }
  return blocks.flatMap((b) => Array(b.count).fill(b.y))
}

/** The same interpolation as src/analysis/elo.ts. */
function lookup(points, acc) {
  if (acc <= points[0][0]) return points[0]
  if (acc >= points.at(-1)[0]) return points.at(-1)
  const i = points.findIndex((p) => p[0] >= acc)
  const [a, b] = [points[i - 1], points[i]]
  const t = b[0] === a[0] ? 0 : (acc - a[0]) / (b[0] - a[0])
  return a.map((v, k) => v + (b[k] - v) * t)
}

function errors(points, test, mean) {
  const err = test.map((p) => lookup(points, p.acc)[2] - p.rating)
  const base = test.map((p) => mean - p.rating)
  const inBand = test.filter((p) => {
    const [, lo, , hi] = lookup(points, p.acc)
    return p.rating >= lo && p.rating <= hi
  }).length
  return {
    heldOut: test.length,
    mae: Math.round(avg(err.map(Math.abs))),
    rmse: Math.round(Math.sqrt(avg(err.map((e) => e * e)))),
    baselineMae: Math.round(avg(base.map(Math.abs))),
    baselineRmse: Math.round(Math.sqrt(avg(base.map((e) => e * e)))),
    inBand: round(inBand / test.length, 2),
  }
}

function pearson(pairs) {
  const [mx, my] = [avg(pairs.map((p) => p.acc)), avg(pairs.map((p) => p.rating))]
  const cov = avg(pairs.map((p) => (p.acc - mx) * (p.rating - my)))
  return cov / Math.sqrt(avg(pairs.map((p) => (p.acc - mx) ** 2)) * avg(pairs.map((p) => (p.rating - my) ** 2)))
}

const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d

// Every fifth game is held out to measure the fit; the table written is refit on everything.
const isTest = (_, i) => Math.floor(i / 2) % 5 === 0
const pairsOf = (scope, list) => list.filter((r) => r[scope] !== null).map((r) => ({ acc: r[scope], rating: r.rating, speed: r.speed }))
const tables = {}
const report = {}
for (const scope of SCOPES) {
  const train = pairsOf(scope, rows.filter((r, i) => !isTest(r, i)))
  const test = pairsOf(scope, rows.filter(isTest))
  report[scope] = errors(fit(train), test, avg(train.map((p) => p.rating)))
  const all = [...train, ...test]
  const informative = report[scope].rmse <= report[scope].baselineRmse * (1 - MIN_GAIN)
  tables[scope] = { n: all.length, r: round(pearson(all), 2), ...report[scope], informative, points: fit(all) }
}

// Does a table per speed beat one table for all? Measured on the whole-game scope, against the pooled table above.
const speeds = [...new Set(rows.map((r) => r.speed))]
const bySpeed = {}
for (const speed of speeds) {
  const train = pairsOf('game', rows.filter((r, i) => !isTest(r, i) && r.speed === speed))
  const test = pairsOf('game', rows.filter((r, i) => isTest(r, i) && r.speed === speed))
  if (train.length < MIN_BIN * 5 || test.length === 0) continue
  const pooled = errors(tables.game.points, test, avg(train.map((p) => p.rating)))
  const own = errors(fit(train), test, avg(train.map((p) => p.rating)))
  bySpeed[speed] = { heldOut: test.length, pooledRmse: pooled.rmse, ownRmse: own.rmse, ownBaselineRmse: own.baselineRmse }
}

const table = {
  source: `lichess_db_standard_rated_${args.month}, first ${args.mb} MB`,
  analysedGames: analysed,
  minMoves: { game: MIN_GAME_MOVES, phase: MIN_PHASE_MOVES },
  scopes: tables,
}
writeFileSync(OUT, JSON.stringify(table, null, 1).replace(/\[\s+([\d.,\s-]+?)\s+\]/g, (_, xs) => `[${xs.split(/,\s*/).join(', ')}]`) + '\n')

console.log(`${table.source}: ${seen} games read, ${analysed} analysed, ${rows.length} player-games`)
console.log('scope       n       r     MAE  (mean)  RMSE (mean)  in 25-75 band  shown')
for (const scope of SCOPES) {
  const r = tables[scope]
  console.log(`${scope.padEnd(11)} ${String(r.n).padEnd(7)} ${r.r.toFixed(2)}  ${String(r.mae).padEnd(4)} (${r.baselineMae})   ${String(r.rmse).padEnd(4)} (${r.baselineRmse})   ${Math.round(r.inBand * 100)}%           ${r.informative ? 'yes' : 'no'}`)
}
console.log('one table per speed, whole game, held-out RMSE (pooled table / own table / own mean):')
for (const [speed, r] of Object.entries(bySpeed)) console.log(`  ${speed.padEnd(10)} n=${r.heldOut}  ${r.pooledRmse} / ${r.ownRmse} / ${r.ownBaselineRmse}`)
console.log(`wrote ${OUT}`)
