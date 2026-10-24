import { describe, expect, it } from 'vitest'
import { phaseStarts, sheetRows } from './sections'

describe('sheetRows', () => {
  it('puts a heading before the first move of each phase, in full moves', () => {
    // Positions 5 and 9 are the first of the middlegame and the endgame: their first moves are indices 4 and 8, both White's.
    expect(sheetRows(10, { middlegame: 5, endgame: 9 })).toEqual([
      { kind: 'heading', phase: 'opening' },
      { kind: 'moves', number: 1, white: 0, black: 1 },
      { kind: 'moves', number: 2, white: 2, black: 3 },
      { kind: 'heading', phase: 'middlegame' },
      { kind: 'moves', number: 3, white: 4, black: 5 },
      { kind: 'moves', number: 4, white: 6, black: 7 },
      { kind: 'heading', phase: 'endgame' },
      { kind: 'moves', number: 5, white: 8, black: 9 },
    ])
  })

  it("splits the row when a phase starts on Black's move", () => {
    // Position 4 is the first of the middlegame, so Black's 2nd move (index 3) is the first of the phase.
    expect(sheetRows(8, { middlegame: 4, endgame: null })).toEqual([
      { kind: 'heading', phase: 'opening' },
      { kind: 'moves', number: 1, white: 0, black: 1 },
      { kind: 'moves', number: 2, white: 2, black: null },
      { kind: 'heading', phase: 'middlegame' },
      { kind: 'moves', number: 2, white: null, black: 3 },
      { kind: 'moves', number: 3, white: 4, black: 5 },
      { kind: 'moves', number: 4, white: 6, black: 7 },
    ])
  })

  it('shows only the phases the game has and leaves an unfinished row open', () => {
    expect(sheetRows(3, { middlegame: null, endgame: null })).toEqual([
      { kind: 'heading', phase: 'opening' },
      { kind: 'moves', number: 1, white: 0, black: 1 },
      { kind: 'moves', number: 2, white: 2, black: null },
    ])
    expect(sheetRows(0, { middlegame: null, endgame: null })).toEqual([])
  })

  it('has no opening heading when the middlegame is already there after the first move', () => {
    expect(phaseStarts(4, { middlegame: 1, endgame: null })).toEqual({ middlegame: 0 })
  })
})
