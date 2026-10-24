import type { Division, Fen, Phase } from '../domain'

// Ported from scalachess core/src/main/scala/Divider.scala (MIT), the split Lichess draws on its eval graph.
// A square is x + 8 * y with a1 = 0, as a scalachess bitboard bit.

/** Lichess's Divider over the positions of one game, start included. */
export function divide(fens: readonly Fen[]): Division {
  const boards = fens.map(board)
  const middle = boards.findIndex((b) => majorsAndMinors(b) <= 10 || backrankSparse(b) || mixedness(b) > 150)
  const end = middle === -1 ? -1 : boards.findIndex((b) => majorsAndMinors(b) <= 6)
  return {
    middlegame: middle !== -1 && (end === -1 || middle < end) ? middle : null,
    endgame: end === -1 ? null : end,
  }
}

/** The phase of the position at `index`. A move belongs to the phase of the position it leads to, as Lichess Insights counts it. */
export function phaseAt(division: Division, index: number): Phase {
  if (division.endgame !== null && index >= division.endgame) return 'endgame'
  if (division.middlegame !== null && index >= division.middlegame) return 'middlegame'
  return 'opening'
}

type Square = { readonly color: 'w' | 'b'; readonly piece: string } | null

function board(fen: Fen): readonly Square[] {
  const squares: Square[] = Array(64).fill(null)
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let x = 0
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') x += Number(ch)
      else squares[x++ + 8 * (7 - r)] = { color: ch === ch.toUpperCase() ? 'w' : 'b', piece: ch.toLowerCase() }
    }
  })
  return squares
}

function majorsAndMinors(b: readonly Square[]): number {
  return b.filter((s) => s !== null && s.piece !== 'k' && s.piece !== 'p').length
}

/** Fewer than four pieces on a home rank means that side has developed. */
function backrankSparse(b: readonly Square[]): boolean {
  const count = (from: number, color: 'w' | 'b') => b.slice(from, from + 8).filter((s) => s?.color === color).length
  return count(0, 'w') < 4 || count(56, 'b') < 4
}

/** Sums score() over every 2x2 block; high when the armies have met. */
function mixedness(b: readonly Square[]): number {
  let acc = 0
  for (let y = 0; y <= 6; y++) {
    for (let x = 0; x <= 6; x++) {
      const block = [x + 8 * y, x + 1 + 8 * y, x + 8 * (y + 1), x + 1 + 8 * (y + 1)].map((i) => b[i])
      acc += score(y + 1, block.filter((s) => s?.color === 'w').length, block.filter((s) => s?.color === 'b').length)
    }
  }
  return acc
}

function score(y: number, white: number, black: number): number {
  switch (white) {
    case 0:
      if (black === 1) return 1 + y
      if (black === 2) return y < 6 ? 2 + (6 - y) : 0
      if (black === 3 || black === 4) return y < 7 ? 3 + (7 - y) : 0
      return 0
    case 1:
      if (black === 0) return 1 + (8 - y)
      if (black === 1) return 5 + Math.abs(4 - y)
      if (black === 2) return 4 + (7 - y)
      if (black === 3) return 5 + (7 - y)
      return 0
    case 2:
      if (black === 0) return y > 2 ? 2 + (y - 2) : 0
      if (black === 1) return 4 + (y - 1)
      if (black === 2) return 7
      return 0
    case 3:
      if (black === 0) return y > 1 ? 3 + (y - 1) : 0
      if (black === 1) return 5 + (y - 1)
      return 0
    case 4:
      return black === 0 && y > 1 ? 3 + (y - 1) : 0
    default:
      return 0
  }
}
