import { describe, expect, it } from 'vitest'
import { family, variationPath } from '.'

describe('family', () => {
  it('groups an opening by its name before the variation', () => {
    expect(['Sicilian Defense: Najdorf Variation, English Attack', 'Sicilian Defense', 'Caro-Kann Defense: Advance Variation'].map(family)).toEqual([
      'Sicilian Defense',
      'Sicilian Defense',
      'Caro-Kann Defense',
    ])
  })

  it('keeps the system in a catch-all family, across its sub-variations', () => {
    expect(
      [
        "Queen's Pawn Game: London System",
        "Queen's Pawn Game: London System, Poisoned Pawn Variation",
        "Queen's Pawn Game: Colle System, Anti-Colle",
        "Queen's Pawn Game",
        'Indian Defense: London System',
        'Zukertort Opening: Kingside Fianchetto',
      ].map(family),
    ).toEqual([
      "Queen's Pawn Game: London System",
      "Queen's Pawn Game: London System",
      "Queen's Pawn Game: Colle System",
      "Queen's Pawn Game",
      'Indian Defense: London System',
      'Zukertort Opening: Kingside Fianchetto',
    ])
  })
})

describe('variationPath', () => {
  it('is the rest of the name after its family, one entry per comma', () => {
    expect(variationPath('Sicilian Defense: Najdorf Variation, English Attack')).toEqual(['Najdorf Variation', 'English Attack'])
    expect(variationPath('Sicilian Defense: Najdorf Variation')).toEqual(['Najdorf Variation'])
    expect(variationPath('Sicilian Defense')).toEqual([])
  })

  it('starts after the system of a catch-all family', () => {
    expect(variationPath("Queen's Pawn Game: London System, Poisoned Pawn Variation")).toEqual(['Poisoned Pawn Variation'])
    expect(variationPath("Queen's Pawn Game: London System")).toEqual([])
    expect(variationPath("Queen's Pawn Game")).toEqual([])
  })
})
