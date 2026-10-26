import type { LineFile, LineTuple } from './lines'

/** A corner of the book: four e4 families and three d4 ones, in dataset order. */
export const LINES: readonly LineTuple[] = [
  ['B00', "King's Pawn Game", 'e2e4', 'e4'],
  ['C00', 'French Defense', 'e2e4 e7e6', 'e4 e6'],
  ['B12', 'Caro-Kann Defense: Advance Variation', 'e2e4 c7c6 d2d4 d7d5 e4e5', 'e4 c6 d4 d5 e5'],
  ['B20', 'Sicilian Defense', 'e2e4 c7c5', 'e4 c5'],
  ['B27', 'Sicilian Defense: Hyperaccelerated Dragon', 'e2e4 c7c5 g1f3 g7g6', 'e4 c5 Nf3 g6'],
  ['B50', 'Sicilian Defense: Modern Variations', 'e2e4 c7c5 g1f3 d7d6', 'e4 c5 Nf3 d6'],
  ['B90', 'Sicilian Defense: Najdorf Variation', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'],
  ['B90', 'Sicilian Defense: Najdorf Variation, English Attack', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5'],
  ['B90', 'Sicilian Defense: Najdorf Variation, English Attack', 'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e6', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e6'],
  ['B21', 'Sicilian Defense: Smith-Morra Gambit', 'e2e4 c7c5 d2d4', 'e4 c5 d4'],
  ['B22', 'Sicilian Defense: Alapin Variation, Barmen Defense', 'e2e4 c7c5 c2c3 d7d5', 'e4 c5 c3 d5'],
  ['A40', "Queen's Pawn Game", 'd2d4', 'd4'],
  ['D02', "Queen's Pawn Game: Zukertort Variation", 'd2d4 d7d5 g1f3', 'd4 d5 Nf3'],
  ['D02', "Queen's Gambit Declined: Baltic Defense, Pseudo-Slav", 'd2d4 d7d5 g1f3 c8f5 c2c4 e7e6 b1c3 c7c6', 'd4 d5 Nf3 Bf5 c4 e6 Nc3 c6'],
  ['D30', "Queen's Gambit Declined", 'd2d4 d7d5 c2c4 e7e6', 'd4 d5 c4 e6'],
  ['D80', 'Grünfeld Defense', 'd2d4 g8f6 c2c4 g7g6 b1c3 d7d5', 'd4 Nf6 c4 g6 Nc3 d5'],
]
export const FILE: LineFile = { source: 'test', license: 'CC0', lines: LINES }
