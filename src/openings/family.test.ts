import { describe, expect, it } from 'vitest'
import { family, studyFamily, studyPath, variationPath } from '.'

describe('family', () => {
  it('groups an opening by its name before the variation, whether a colon or a comma starts it', () => {
    expect(
      [
        'Sicilian Defense: Najdorf Variation, English Attack',
        'Sicilian Defense',
        'Caro-Kann Defense: Advance Variation',
        'French Defense, Classical, 4. Bg5',
        'London System, with Bd3',
        "Queen's Pawn, Mengarini Attack",
      ].map(family),
    ).toEqual(['Sicilian Defense', 'Sicilian Defense', 'Caro-Kann Defense', 'French Defense', 'London System', "Queen's Pawn"])
  })

  it('keeps the system in a catch-all family, across its sub-variations', () => {
    expect(
      [
        "Queen's Pawn Game: Symmetrical Variation",
        "Queen's Pawn Game: Symmetrical Variation, Pseudo-Catalan",
        "Queen's Pawn Game",
        'Zukertort Opening: Kingside Fianchetto',
      ].map(family),
    ).toEqual(["Queen's Pawn Game: Symmetrical Variation", "Queen's Pawn Game: Symmetrical Variation", "Queen's Pawn Game", 'Zukertort Opening: Kingside Fianchetto'])
  })

  it('puts a system the book also names on its own in that family, from any catch-all family', () => {
    expect(
      [
        "Queen's Pawn Game: London System",
        "Queen's Pawn Game: London System, Poisoned Pawn Variation",
        'Indian Defense: London System',
        'London System',
        'London System, with Be2',
        "Queen's Pawn Game: Colle System, Anti-Colle",
        "Queen's Pawn Game: Modern Defense",
      ].map(family),
    ).toEqual(['London System', 'London System', 'London System', 'London System', 'London System', 'Colle System', 'Modern Defense'])
  })
})

describe('variationPath', () => {
  it('is the rest of the name after its family, one entry per comma', () => {
    expect(variationPath('Sicilian Defense: Najdorf Variation, English Attack')).toEqual(['Najdorf Variation', 'English Attack'])
    expect(variationPath('Sicilian Defense: Najdorf Variation')).toEqual(['Najdorf Variation'])
    expect(variationPath('French Defense, Classical, 4. Bg5')).toEqual(['Classical', '4. Bg5'])
    expect(variationPath('Sicilian Defense')).toEqual([])
  })

  it('starts after the system of a catch-all family, wherever the system lands', () => {
    expect(variationPath("Queen's Pawn Game: Symmetrical Variation, Pseudo-Catalan")).toEqual(['Pseudo-Catalan'])
    expect(variationPath("Queen's Pawn Game: Symmetrical Variation")).toEqual([])
    expect(variationPath("Queen's Pawn Game: London System, with e6")).toEqual(['with e6'])
    expect(variationPath("Queen's Pawn Game: London System")).toEqual([])
    expect(variationPath('London System, with Bd3')).toEqual(['with Bd3'])
    expect(variationPath("Queen's Pawn Game")).toEqual([])
  })
})

describe('studyFamily and studyPath', () => {
  it('study a system of a catch-all family under the catch-all, the system first in the path', () => {
    expect(studyFamily("King's Pawn Game: Bavarian Gambit")).toBe("King's Pawn Game")
    expect(studyPath("King's Pawn Game: Bavarian Gambit")).toEqual(['Bavarian Gambit'])
    expect(studyPath("Queen's Pawn Game: Symmetrical Variation, Pseudo-Catalan")).toEqual(['Symmetrical Variation', 'Pseudo-Catalan'])
    expect(studyFamily("King's Pawn Game")).toBe("King's Pawn Game")
    expect(studyPath("King's Pawn Game")).toEqual([])
  })

  it('study every other name as the report groups it', () => {
    expect(studyFamily("Queen's Pawn Game: London System, with e6")).toBe('London System')
    expect(studyPath("Queen's Pawn Game: London System, with e6")).toEqual(['with e6'])
    expect(studyFamily('Sicilian Defense: Najdorf Variation')).toBe('Sicilian Defense')
    expect(studyPath('Sicilian Defense: Najdorf Variation')).toEqual(['Najdorf Variation'])
  })

  it("map a report family to the trainer's, with the system as the group to open", () => {
    expect(["Queen's Pawn Game: Veresov Attack", 'London System', 'Sicilian Defense', "King's Pawn Game"].map(studyFamily)).toEqual(["Queen's Pawn Game", 'London System', 'Sicilian Defense', "King's Pawn Game"])
    expect(["Queen's Pawn Game: Veresov Attack", 'London System'].map((f) => studyPath(f)[0])).toEqual(['Veresov Attack', undefined])
  })
})
