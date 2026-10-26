// Counts how often strong players reach each opening and writes src/openings/popularity.json, which orders the
// opening trainer's catalog and the branches of each family.
// node scripts/build-popularity.mjs [--from 2026-04] [--to 2026-09] [--min-avg 2200]
// Streams each month of the broadcast database from database.lichess.org (over-the-board events relayed on Lichess,
// about 18 MB a month) and keeps the games whose two ratings are known and average --min-avg or more. The rated
// online dump would count blitz by the million and rank 1.e3 above the Ruy Lopez. A game's Opening tag names the
// deepest position of src/openings/lines.json it reached; a name that file lacks is dropped and reported.
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { parseArgs } from 'node:util'
import { createZstdDecompress } from 'node:zlib'

const { values: args } = parseArgs({
  options: { from: { type: 'string', default: '2026-04' }, to: { type: 'string', default: '2026-09' }, 'min-avg': { type: 'string', default: '2200' } },
})
const OUT = 'src/openings/popularity.json'
const minAvg = Number(args['min-avg'])
const known = new Set(JSON.parse(readFileSync('src/openings/lines.json', 'utf8')).lines.map(([, name]) => name))

const months = []
for (const d = new Date(`${args.from}-01T00:00Z`); d.toISOString().slice(0, 7) <= args.to; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7))

const counts = new Map()
const dropped = { rating: 0, unnamed: 0, unknown: 0 }
let seen = 0
for (const month of months) {
  const res = await fetch(`https://database.lichess.org/broadcast/lichess_db_broadcast_${month}.pgn.zst`)
  if (!res.ok) throw new Error(`${month}: HTTP ${res.status}`)
  const lines = createInterface({ input: Readable.fromWeb(res.body).pipe(createZstdDecompress()), crlfDelay: Infinity })
  let tags = null
  for await (const line of lines) {
    if (line.startsWith('[Event ')) tags = {}
    if (tags === null) continue
    const tag = /^\[(\w+) "(.*)"\]$/.exec(line)
    if (tag) tags[tag[1]] = tag[2]
    else if (line !== '') {
      count(tags)
      tags = null
    }
  }
  console.log(month, 'done:', seen, 'games seen so far')
}

/** The first line of a game's moves, with every tag read. An unknown rating is NaN, so the average fails the test. */
function count(tags) {
  seen++
  if (!((Number(tags.WhiteElo) + Number(tags.BlackElo)) / 2 >= minAvg)) return dropped.rating++
  const name = tags.Opening
  if (name === undefined || name === '?') return dropped.unnamed++
  if (!known.has(name)) return dropped.unknown++
  counts.set(name, (counts.get(name) ?? 0) + 1)
}

const games = [...counts.values()].reduce((a, b) => a + b, 0)
const sorted = Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : 1)))
writeFileSync(OUT, JSON.stringify({ source: 'https://database.lichess.org/broadcast', months, minAvg, games, counts: sorted }))
console.log(`${seen} games seen, ${games} counted in ${counts.size} names; dropped ${dropped.rating} by rating, ${dropped.unnamed} without a name, ${dropped.unknown} with a name lines.json lacks`)
