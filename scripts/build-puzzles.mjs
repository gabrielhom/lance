// Picks the puzzles bundled with the app from the Lichess puzzle database (CC0) and writes src/puzzles/puzzles.json.
// node scripts/build-puzzles.mjs [--csv lichess_db_puzzle.csv.zst] [--updated 2026-10-05]
// Streams https://database.lichess.org/lichess_db_puzzle.csv.zst through zstd, or reads a copy saved earlier with --csv.
// The rows come in puzzle id order, which is random, so each band fills with an unbiased sample. Keeps well liked,
// often played puzzles with a settled rating, the same number in every 100-point band, picked round-robin over the
// themes the filter offers so each theme shows up at every level that has it.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { runnerImport } from 'vite'

const { values: args } = parseArgs({
  options: { csv: { type: 'string' }, updated: { type: 'string', default: '2026-10-05' } },
})
const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst'
const OUT = 'src/puzzles/puzzles.json'
const LOW = 400
const HIGH = 2800
const BAND = 100
const PER_BAND = 150
/** Candidates kept per band before picking: plenty for the round-robin, and bounded memory. */
const POOL = 4000
const MIN_POPULARITY = 80
const MIN_PLAYS = 300
const MAX_DEVIATION = 90

const load = async (id) => (await runnerImport(id, { configFile: false, logLevel: 'error' })).module
const { parsePuzzleRow, toTuple, FILTER_THEMES } = await load('./src/puzzles/index.ts')

const source = spawn('sh', ['-c', args.csv ? `zstd -dc "${args.csv}"` : `curl -sf ${URL} | zstd -dc`], { stdio: ['ignore', 'pipe', 'inherit'] }).stdout

const bands = Array.from({ length: (HIGH - LOW) / BAND }, () => [])
let scanned = 0
let rejected = 0
for await (const line of createInterface({ input: source, crlfDelay: Infinity })) {
  if (scanned++ === 0) continue
  // Cheap checks on the raw columns first, so only candidates pay for the full parse and its legality check.
  const [, , , rating, deviation, popularity, plays] = line.split(',', 7)
  const band = Math.floor((Number(rating) - LOW) / BAND)
  if (!(band >= 0 && band < bands.length) || bands[band].length >= POOL) continue
  if (Number(popularity) < MIN_POPULARITY || Number(plays) < MIN_PLAYS || Number(deviation) > MAX_DEVIATION) continue
  const row = parsePuzzleRow(line)
  if (row) bands[band].push(row)
  else rejected++
  if (scanned % 500_000 === 0) process.stderr.write(`\r${scanned} rows`)
}
process.stderr.write(`\r${scanned - 1} rows scanned, ${rejected} candidates rejected by the parser\n`)

const byQuality = (a, b) => b.quality.popularity - a.quality.popularity || b.quality.plays - a.quality.plays
const chosen = bands.flatMap((pool) => pick([...pool].sort(byQuality).map((r) => r.puzzle)))
chosen.sort((a, b) => (a.id < b.id ? -1 : 1))

/** Round-robin over the filter themes, each turn taking the best puzzle left with that theme, then the best of the rest. */
function pick(pool) {
  const taken = new Set()
  const out = []
  const take = (p) => {
    taken.add(p.id)
    out.push(p)
  }
  for (let progress = true; progress && out.length < PER_BAND; ) {
    progress = false
    for (const theme of FILTER_THEMES) {
      if (out.length >= PER_BAND) break
      const p = pool.find((x) => !taken.has(x.id) && x.themes.includes(theme))
      if (p) {
        take(p)
        progress = true
      }
    }
  }
  for (const p of pool) if (out.length < PER_BAND && !taken.has(p.id)) take(p)
  return out
}

writeFileSync(OUT, JSON.stringify({ source: URL, license: 'CC0', updated: args.updated, puzzles: chosen.map(toTuple) }))

console.log(`${chosen.length} puzzles`)
for (let i = 0; i < bands.length; i++) {
  const lo = LOW + i * BAND
  console.log(`${lo}-${lo + BAND - 1}: ${chosen.filter((p) => p.rating >= lo && p.rating < lo + BAND).length} of ${bands[i].length} candidates`)
}
for (const theme of FILTER_THEMES) console.log(`${theme}: ${chosen.filter((p) => p.themes.includes(theme)).length}`)
