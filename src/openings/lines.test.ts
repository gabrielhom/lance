import { describe, expect, it } from 'vitest'
import type { LineId } from '../domain'
import { GENERIC_FAMILIES, STANDALONE_SYSTEMS } from './family'
import { buildTree, loadTree, type LineFile } from './lines'
import { FILE, POPULARITY } from './testing'

const tree = buildTree(FILE, POPULARITY)
const sicilian = tree.family('Sicilian Defense')!
const names = (color: 'w' | 'b') => sicilian.variations[color].map((v) => v.line.sans.join(' '))

describe('buildTree', () => {
  it('lists the families by name with the range of their ECO codes', () => {
    expect(tree.families.map((f) => [f.name, f.eco])).toEqual([
      ['Caro-Kann Defense', 'B12'],
      ['French Defense', 'C00'],
      ['Grünfeld Defense', 'D80'],
      ["King's Pawn Game", 'B00'],
      ["Queen's Gambit Declined", 'D02–D30'],
      ["Queen's Pawn Game", 'A40–D02'],
      ['Sicilian Defense', 'B20–B90'],
    ])
    expect(tree.family('Sicilian')).toBeNull()
  })

  it('studies the systems of a catch-all family under it, each the first part of its path', () => {
    expect(tree.family("Queen's Pawn Game: Zukertort Variation")).toBeNull()
    expect(tree.family("Queen's Pawn Game")!.variations.w.map((v) => [v.line.name, v.path])).toEqual([["Queen's Pawn Game: Zukertort Variation", ['Zukertort Variation']]])
  })

  it('makes a variation of each line no other line of its family extends, the branch with more games first, ties by its lines', () => {
    expect(names('w')).toEqual([
      'e4 c5 d4',
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5',
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e6',
      'e4 c5 Nf3 g6',
      'e4 c5 c3 d5',
    ])
    expect(tree.families.map((f) => [f.name, f.games])).toEqual([
      ['Caro-Kann Defense', 60],
      ['French Defense', 0],
      ['Grünfeld Defense', 0],
      ["King's Pawn Game", 40],
      ["Queen's Gambit Declined", 25],
      ["Queen's Pawn Game", 0],
      ['Sicilian Defense', 100],
    ])
  })

  it('orders the branches by their lines when no game reached the family', () => {
    expect(buildTree(FILE, {}).family('Sicilian Defense')!.variations.w.map((v) => v.line.sans.join(' '))).toEqual([
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5',
      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e6',
      'e4 c5 Nf3 g6',
      'e4 c5 d4',
      'e4 c5 c3 d5',
    ])
  })

  it("splits a name's games evenly across its rows, so a transposition weighs its branch by half and the family counts each game once", () => {
    const vienna = buildTree(
      {
        ...FILE,
        lines: [
          ['C25', 'Vienna Game', 'e2e4 e7e5 b1c3', 'e4 e5 Nc3'],
          ['C25', 'Vienna Game: Max Lange Defense', 'e2e4 e7e5 b1c3 b8c6', 'e4 e5 Nc3 Nc6'],
          ['C25', 'Vienna Game: Max Lange Defense', 'e2e4 b8c6 b1c3 e7e5', 'e4 Nc6 Nc3 e5'],
          ['C26', 'Vienna Game: Falkbeer Variation', 'e2e4 e7e5 b1c3 g8f6', 'e4 e5 Nc3 Nf6'],
        ],
      },
      { 'Vienna Game: Max Lange Defense': 6, 'Vienna Game: Falkbeer Variation': 4 },
    ).family('Vienna Game')!
    expect(vienna.variations.w.map((v) => v.line.sans.join(' '))).toEqual(['e4 e5 Nc3 Nf6', 'e4 e5 Nc3 Nc6', 'e4 Nc6 Nc3 e5'])
    expect(vienna.games).toBe(10)
  })

  it('keeps a line other families extend as a variation of its own family, unlike one its own systems extend', () => {
    expect(tree.family("King's Pawn Game")!.variations.w.map((v) => v.line.sans)).toEqual([['e4']])
    expect(tree.family("Queen's Pawn Game")!.variations.w.map((v) => v.line.sans.join(' '))).toEqual(['d4 d5 Nf3'])
  })

  it("leaves a line without a Black move out of Black's list", () => {
    expect(tree.family("King's Pawn Game")!.variations.b).toEqual([])
    expect(names('b')).toEqual(names('w'))
  })

  it('splits the name after the family and marks where same-named variations part ways', () => {
    const [morra, e5, e6, dragon] = sicilian.variations.w
    expect(e5.path).toEqual(['Najdorf Variation', 'English Attack'])
    expect([e5.distinctFrom, e6.distinctFrom]).toEqual([11, 11])
    expect([dragon.path, dragon.distinctFrom]).toEqual([['Hyperaccelerated Dragon'], null])
    expect(morra.path).toEqual(['Smith-Morra Gambit'])
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

describe('a system the book names on its own and under catch-all families', () => {
  const london = buildTree({
    ...FILE,
    lines: [
      ['A40', "Queen's Pawn Game", 'd2d4', 'd4'],
      ['D02', "Queen's Pawn Game: London System", 'd2d4 d7d5 g1f3 g8f6 c1f4', 'd4 d5 Nf3 Nf6 Bf4'],
      ['D02', "Queen's Pawn Game: London System, with e6", 'd2d4 d7d5 g1f3 e7e6 c1f4', 'd4 d5 Nf3 e6 Bf4'],
      ['A46', 'Indian Defense: London System', 'd2d4 g8f6 g1f3 e7e6 c1f4', 'd4 Nf6 Nf3 e6 Bf4'],
      ['A48', 'London System', 'd2d4 g8f6 g1f3 g7g6 c1f4', 'd4 Nf6 Nf3 g6 Bf4'],
      ['A48', 'London System, with Bd3', 'd2d4 g8f6 g1f3 g7g6 c1f4 f8g7 e2e3 d7d6 f1d3', 'd4 Nf6 Nf3 g6 Bf4 Bg7 e3 d6 Bd3'],
      ['A48', 'London System, with Be2', 'd2d4 g8f6 g1f3 g7g6 c1f4 f8g7 e2e3 d7d6 f1e2', 'd4 Nf6 Nf3 g6 Bf4 Bg7 e3 d6 Be2'],
    ],
  }, {})

  it('is one family, with the variations of every spelling of its name', () => {
    expect(london.families.map((f) => [f.name, f.eco])).toEqual([
      ['London System', 'A46–D02'],
      ["Queen's Pawn Game", 'A40'],
    ])
    expect(london.family('London System')!.variations.w.map((v) => [v.line.name, v.path])).toEqual([
      ['London System, with Bd3', ['with Bd3']],
      ['London System, with Be2', ['with Be2']],
      ['Indian Defense: London System', []],
      ["Queen's Pawn Game: London System", []],
      ["Queen's Pawn Game: London System, with e6", ['with e6']],
    ])
  })
})

describe('the bundled lines', async () => {
  const real = await loadTree()
  const { default: file } = await import('./lines.json')
  const { lines } = file as unknown as LineFile

  it('give 141 families, 259 Sicilian variations for White and a unique id per line', () => {
    expect(real.families).toHaveLength(141)
    expect(real.family('Sicilian Defense')!.variations.w).toHaveLength(259)
    expect(new Set(lines.map((l) => l[2])).size).toBe(lines.length)
  })

  it('count 11546 broadcast games in the Sicilian and teach Black its Najdorf first', () => {
    const sicilian = real.family('Sicilian Defense')!
    expect(sicilian.games).toBe(11546)
    expect(sicilian.variations.b[0].line.name).toBe('Sicilian Defense: Najdorf Variation, Main Line')
    expect(sicilian.variations.b.slice(0, 5).every((v) => v.path[0] === 'Najdorf Variation')).toBe(true)
  })

  it("gather every King's Pawn Game system in one family, grouped by system, and no family named after a catch-all's system", () => {
    const systems = new Set(real.family("King's Pawn Game")!.variations.w.map((v) => v.path[0]))
    expect(systems.has('Bavarian Gambit')).toBe(true)
    expect(systems.size).toBeGreaterThan(10)
    expect(real.families.filter((f) => [...GENERIC_FAMILIES].some((g) => f.name.startsWith(`${g}:`)))).toEqual([])
  })

  it('name on their own exactly the systems STANDALONE_SYSTEMS lists, so a rebuilt book updates the set', () => {
    const head = (name: string) => name.split(/[:,]/)[0].trim()
    const own = new Set(lines.map(([, name]) => head(name)).filter((h) => !GENERIC_FAMILIES.has(h)))
    const systems = lines
      .map(([, name]) => name)
      .filter((name) => GENERIC_FAMILIES.has(head(name)) && name.includes(':'))
      .map((name) => name.split(':')[1].split(',')[0].trim())
    expect(new Set(systems.filter((s) => own.has(s)))).toEqual(STANDALONE_SYSTEMS)
  })
})
