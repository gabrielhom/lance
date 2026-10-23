import { describe, expect, it } from 'vitest'
import opera from '../../e2e/fixtures/opera.pgn?raw'
import { gameFromPgn } from '../domain'
import { bookPrefix, loadBook } from '.'

const book = await loadBook()

function afterFens(pgn: string) {
  const r = gameFromPgn(pgn, { kind: 'pgn' })
  if (!r.ok) throw new Error(r.error.detail)
  return r.value.moves.map((m) => m.after.fen)
}

describe('opening book', () => {
  it('names a position by its first four FEN fields', () => {
    const [e4] = afterFens('1. e4 *')
    expect(book.lookup(e4)).toEqual({ eco: 'B00', name: "King's Pawn Game" })
    expect(book.lookup(e4.replace(/ \d+ \d+$/, ' 7 40') as typeof e4)).toEqual({ eco: 'B00', name: "King's Pawn Game" })
  })

  it('shows the latest named opening through unnamed book positions', () => {
    const shown = bookPrefix(book, afterFens(opera))
    expect(shown).toHaveLength(7)
    expect(shown.slice(3).map((o) => o?.name)).toEqual(Array(4).fill('Philidor Defense'))
  })

  it('stops at the first move out of book, even if the game returns to theory', () => {
    const shown = bookPrefix(book, afterFens('1. Nf3 Nf6 2. Ng1 Ng8 3. e4 e5 *'))
    expect(shown.map((o) => o?.eco)).toEqual(['A04', 'A05'])
  })
})
