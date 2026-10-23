import type { Fen, Opening, OpeningBook } from '../domain'

/** `lookup` answers only for named positions. `has` also knows the unnamed positions between them. */
export interface Book extends OpeningBook {
  has(fen: Fen): boolean
}

type Table = Readonly<Partial<Record<string, readonly string[] | null>>>

export async function loadBook(): Promise<Book> {
  const { default: table } = await import('./openings.json')
  return bookFrom(table)
}

export function bookFrom(table: Table): Book {
  const entry = (fen: Fen) => table[fen.split(' ').slice(0, 4).join(' ')]
  return {
    has: (fen) => entry(fen) !== undefined,
    lookup(fen) {
      const e = entry(fen)
      return e ? { eco: e[0], name: e[1] } : null
    },
  }
}

/** The opening shown after each book move, so its length is the number of book moves. Book is a contiguous
 *  prefix: returning to theory after leaving it does not count. An unnamed position shows its latest named ancestor. */
export function bookPrefix(book: Book, after: readonly Fen[]): readonly (Opening | null)[] {
  const shown: (Opening | null)[] = []
  let named: Opening | null = null
  for (const fen of after) {
    if (!book.has(fen)) break
    named = book.lookup(fen) ?? named
    shown.push(named)
  }
  return shown
}
