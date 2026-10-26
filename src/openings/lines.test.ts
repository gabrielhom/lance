import { describe, expect, it } from 'vitest'
import type { LineId } from '../domain'
import { buildTree, loadTree, type LineFile, type LineTuple } from './lines'

/** A corner of the book: three e4 families and two d4 ones, in dataset order. */
const LINES: readonly LineTuple[] = [
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
]
const FILE: LineFile = { source: 'test', license: 'CC0', lines: LINES }
const tree = buildTree(FILE)
const sicilian = tree.family('Sicilian Defense')!
const names = (color: 'w' | 'b') => sicilian.variations[color].map((v) => v.line.sans.join(' '))

describe('buildTree', () => {
  it('lists the families by name with the range of their ECO codes', () => {
    expect(tree.families.map((f) => [f.name, f.eco])).toEqual([
      ['Caro-Kann Defense', 'B12'],
      ['French Defense', 'C00'],
      ["King's Pawn Game", 'B00'],
      ["Queen's Gambit Declined", 'D02–D30'],
      ["Queen's Pawn Game", 'A40'],
      ["Queen's Pawn Game: Zukertort Variation", 'D02'],
      ['Sicilian Defense', 'B20–B90'],
    ])
    expect(tree.family('Sicilian')).toBeNull()
  })

  it('makes a variation of each line no other line of its family extends, the branch with more lines first', () => {
    expect(names('w')).toEqual([
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5',
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e6',
      'e4 c5 Nf3 g6',
      'e4 c5 d4',
      'e4 c5 c3 d5',
    ])
  })

  it('keeps a line other families extend as a variation of its own family', () => {
    expect(tree.family("King's Pawn Game")!.variations.w.map((v) => v.line.sans)).toEqual([['e4']])
    expect(tree.family("Queen's Pawn Game: Zukertort Variation")!.variations.w.map((v) => v.line.sans.join(' '))).toEqual(['d4 d5 Nf3'])
  })

  it("leaves a line without a Black move out of Black's list", () => {
    expect(tree.family("King's Pawn Game")!.variations.b).toEqual([])
    expect(names('b')).toEqual(names('w'))
  })

  it('splits the name after the family and marks where same-named variations part ways', () => {
    const [e5, e6, dragon, morra] = sicilian.variations.w
    expect(e5.path).toEqual(['Najdorf Variation', 'English Attack'])
    expect([e5.distinctFrom, e6.distinctFrom]).toEqual([11, 11])
    expect([dragon.path, dragon.distinctFrom]).toEqual([['Hyperaccelerated Dragon'], null])
    expect(morra.path).toEqual(['Smith-Morra Gambit'])
    expect(tree.family("Queen's Pawn Game: Zukertort Variation")!.variations.w[0].path).toEqual([])
  })

  it('finds a variation by line and color, and nothing for a line that is not one', () => {
    expect(tree.variation('e2e4 c7c5 g1f3 g7g6' as LineId, 'b')?.line.name).toBe('Sicilian Defense: Hyperaccelerated Dragon')
    expect(tree.variation('e2e4' as LineId, 'w')?.line.name).toBe("King's Pawn Game")
    expect(tree.variation('e2e4' as LineId, 'b')).toBeNull()
    expect(tree.variation('e2e4 c7c5' as LineId, 'w')).toBeNull()
    expect(tree.variation('e2e4 c7c5 g1f3 g7g6 d2d4' as LineId, 'w')).toBeNull()
  })
})

describe('drill', () => {
  const dragon = tree.variation('e2e4 c7c5 g1f3 g7g6' as LineId, 'b')!

  it('lists the other book moves at my turns only, tells the family apart and names a bare position by the shortest line after it', () => {
    const drill = tree.drill(dragon, 'b', true)
    expect([...drill.book.keys()]).toEqual([1, 3])
    expect([...drill.book.get(1)!]).toEqual([
      ['e7e6', { san: 'e6', opening: { eco: 'C00', name: 'French Defense' }, sameFamily: false }],
      ['c7c6', { san: 'c6', opening: { eco: 'B12', name: 'Caro-Kann Defense: Advance Variation' }, sameFamily: false }],
    ])
    expect([...drill.book.get(3)!]).toEqual([['d7d6', { san: 'd6', opening: { eco: 'B50', name: 'Sicilian Defense: Modern Variations' }, sameFamily: true }]])
    expect(drill).toMatchObject({ variation: dragon, color: 'b', learn: true })
  })

  it('names the positions after each move, from any family, and nothing where the book has no name', () => {
    expect(tree.drill(dragon, 'w', false).names).toEqual([
      { eco: 'B00', name: "King's Pawn Game" },
      { eco: 'B20', name: 'Sicilian Defense' },
      null,
      { eco: 'B27', name: 'Sicilian Defense: Hyperaccelerated Dragon' },
    ])
  })

  it('names a move that stays in the family by its own line even when another family names a shorter position', () => {
    const qgd = tree.variation('d2d4 d7d5 c2c4 e7e6' as LineId, 'w')!
    expect(tree.drill(qgd, 'w', false).book.get(2)!.get('g1f3' as never)).toEqual({
      san: 'Nf3',
      opening: { eco: 'D02', name: "Queen's Gambit Declined: Baltic Defense, Pseudo-Slav" },
      sameFamily: true,
    })
  })
})

describe('the bundled lines', async () => {
  const real = await loadTree()
  const { default: file } = await import('./lines.json')
  const { lines } = file as unknown as LineFile

  it('give 327 families, 259 Sicilian variations for White and a unique id per line', () => {
    expect(real.families).toHaveLength(327)
    expect(real.family('Sicilian Defense')!.variations.w).toHaveLength(259)
    expect(new Set(lines.map((l) => l[2])).size).toBe(lines.length)
  })
})
