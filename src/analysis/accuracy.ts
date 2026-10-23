import type { AccuracyPct, ByColor, Color, Game, PositionEval, Score, WinPct } from '../domain'
import type { CompleteEvals } from './evals'

// Ported from lila modules/analyse/src/main/AccuracyPercent.scala and scalachess core/src/main/scala/eval.scala.
const CP_CEILING = 1000
const WIN_SLOPE = 0.00368208

/** Lichess win%: a mate counts as the cp ceiling, so +10 and mate in 3 look the same (97.5). */
export function winPct(e: Score | PositionEval, pov: Color): WinPct {
  const white = 50 + 50 * (2 / (1 + Math.exp(-WIN_SLOPE * whiteCp(e))) - 1)
  return (pov === 'w' ? white : 100 - white) as WinPct
}

function whiteCp(e: Score | PositionEval): number {
  switch (e.kind) {
    case 'cp':
      return clamp(e.white, -CP_CEILING, CP_CEILING)
    case 'mate':
      return e.winner === 'w' ? CP_CEILING : -CP_CEILING
    case 'searched':
      return whiteCp(e.lines[0].score)
    case 'checkmate':
      return e.loser === 'w' ? -CP_CEILING : CP_CEILING
    case 'stalemate':
      return 0
  }
}

/** Lichess per-move accuracy, with its +1 bonus for imperfect analysis. */
export function moveAccuracy(before: WinPct, after: WinPct): AccuracyPct {
  if (after >= before) return 100 as AccuracyPct
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411
  return clamp(raw + 1, 0, 100) as AccuracyPct
}

/** Lichess game accuracy: the mean of a volatility-weighted mean and a harmonic mean of move accuracies. */
export function gameAccuracy(game: Game, evals: CompleteEvals): ByColor<AccuracyPct | null> {
  const wins = game.positions.map((p) => winPct(evals.at(p), 'w'))
  const size = clamp(Math.floor((wins.length - 1) / 10), 2, 8)
  const windows = [
    ...Array<number[]>(Math.max(0, Math.min(size, wins.length) - 2)).fill(wins.slice(0, size)),
    ...sliding(wins, size),
  ]
  const scored = game.moves.map((m, i) => {
    const pov = (w: number) => (m.mover === 'w' ? w : 100 - w) as WinPct
    return {
      mover: m.mover,
      accuracy: moveAccuracy(pov(wins[i]), pov(wins[i + 1])),
      weight: clamp(stddev(windows[i]), 0.5, 12),
    }
  })
  const of = (c: Color): AccuracyPct | null => {
    const mine = scored.filter((s) => s.mover === c)
    if (mine.length === 0) return null
    const weighted = mine.reduce((a, s) => a + s.accuracy * s.weight, 0) / mine.reduce((a, s) => a + s.weight, 0)
    const harmonic = mine.length / mine.reduce((a, s) => a + 1 / Math.max(1, s.accuracy), 0)
    return ((weighted + harmonic) / 2) as AccuracyPct
  }
  return { w: of('w'), b: of('b') }
}

/** Scala's `sliding`: a list shorter than the window yields itself as the only window. */
function sliding(xs: readonly number[], size: number): number[][] {
  if (xs.length <= size) return [[...xs]]
  return Array.from({ length: xs.length - size + 1 }, (_, i) => xs.slice(i, i + size))
}

/** Population standard deviation, as scalalib Maths.standardDeviation. */
function stddev(xs: readonly number[]): number {
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length
  return Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length)
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}
