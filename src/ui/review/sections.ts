import { phaseAt } from '../../analysis'
import { PHASES } from '../../domain/types'
import type { Division, Phase } from '../../domain/types'

/** One line of the scoresheet. A move is its index in the game. `white: null` is a row that starts on Black's move (printed "N. …"); `black: null` is a row cut short or not played yet. */
export type SheetRow =
  | { readonly kind: 'heading'; readonly phase: Phase }
  | { readonly kind: 'moves'; readonly number: number; readonly white: number | null; readonly black: number | null }

/** Index of the first move of each phase present. A move belongs to the phase of the position it leads to, as in the graph and the per-phase table. */
export function phaseStarts(count: number, division: Division): Partial<Record<Phase, number>> {
  const starts: Partial<Record<Phase, number>> = {}
  for (let i = 0; i < count; i++) starts[phaseAt(division, i + 1)] ??= i
  return starts
}

/** The scoresheet with a heading before the first move of each phase. A phase that starts on Black's move splits its row, book style. */
export function sheetRows(count: number, division: Division): SheetRow[] {
  const starts = phaseStarts(count, division)
  const startingAt = (i: number) => PHASES.find((p) => starts[p] === i)
  const rows: SheetRow[] = []
  for (let i = 0; i < count; ) {
    const phase = startingAt(i)
    if (phase) rows.push({ kind: 'heading', phase })
    if (i % 2) {
      rows.push({ kind: 'moves', number: (i - 1) / 2 + 1, white: null, black: i })
      i += 1
      continue
    }
    const black = i + 1 < count && startingAt(i + 1) === undefined ? i + 1 : null
    rows.push({ kind: 'moves', number: i / 2 + 1, white: i, black })
    i += black === null ? 1 : 2
  }
  return rows
}
