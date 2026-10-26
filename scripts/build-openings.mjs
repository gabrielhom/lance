// Builds src/openings/openings.json (the FEN book) and src/openings/lines.json (the move sequences) from
// lichess-org/chess-openings (CC0) TSVs, in one pass so the two can't drift.
// Usage: node scripts/build-openings.mjs <dir with a.tsv..e.tsv>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Chess } from 'chess.js'

const dir = process.argv[2]
const book = {}
const lines = []
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  for (const row of readFileSync(join(dir, `${f}.tsv`), 'utf8').trim().split('\n').slice(1)) {
    const [eco, name, pgn] = row.split('\t')
    const chess = new Chess()
    const uci = []
    const san = []
    for (const token of pgn.replace(/\d+\.\s*/g, '').split(/\s+/).filter(Boolean)) {
      const move = chess.move(token)
      uci.push(move.lan)
      san.push(move.san)
      const key = chess.fen().split(' ').slice(0, 4).join(' ')
      book[key] ??= null
    }
    book[chess.fen().split(' ').slice(0, 4).join(' ')] = [eco, name]
    lines.push([eco, name, uci.join(' '), san.join(' ')])
  }
}
if (new Set(lines.map((l) => l[2])).size !== lines.length) throw new Error('two rows share a move sequence; LineId would collide')
writeFileSync('src/openings/openings.json', JSON.stringify(book))
writeFileSync('src/openings/lines.json', JSON.stringify({ source: 'https://github.com/lichess-org/chess-openings', license: 'CC0', lines }))
console.log(Object.keys(book).length, 'positions,', lines.length, 'lines')
