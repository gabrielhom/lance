// Builds src/openings/openings.json from lichess-org/chess-openings (CC0) TSVs.
// Usage: node scripts/build-openings.mjs <dir with a.tsv..e.tsv>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Chess } from 'chess.js'

const dir = process.argv[2]
const book = {}
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  for (const row of readFileSync(join(dir, `${f}.tsv`), 'utf8').trim().split('\n').slice(1)) {
    const [eco, name, pgn] = row.split('\t')
    const chess = new Chess()
    for (const san of pgn.replace(/\d+\.\s*/g, '').split(/\s+/).filter(Boolean)) {
      chess.move(san)
      const key = chess.fen().split(' ').slice(0, 4).join(' ')
      book[key] ??= null
    }
    book[chess.fen().split(' ').slice(0, 4).join(' ')] = [eco, name]
  }
}
writeFileSync('src/openings/openings.json', JSON.stringify(book))
console.log(Object.keys(book).length, 'positions')
