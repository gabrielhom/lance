import type { EloEstimate, Phase } from '../domain'
import table from './elo-table.json'

export type EloScope = 'game' | Phase
/** Accuracy, then the 25th, 50th and 75th percentile rating of the players who played that accurately. Sorted by accuracy. */
export type EloPoint = readonly [accuracy: number, low: number, elo: number, high: number]

/** The rating that usually goes with this accuracy, from rated Lichess games (scripts/calibrate-elo.mjs writes the table).
 *  null for a scope where accuracy barely tells ratings apart, so any number would only be the average player. */
export function estimateElo(accuracy: number, scope: EloScope): EloEstimate | null {
  const { informative, points } = table.scopes[scope]
  if (!informative) return null
  const [, low, elo, high] = interpolate(points as unknown as readonly EloPoint[], accuracy)
  return { elo: round10(elo), low: round10(low), high: round10(high) }
}

/** Straight lines between the points, flat past either end: no table point means no data to extrapolate from. */
export function interpolate(points: readonly EloPoint[], accuracy: number): EloPoint {
  const first = points[0]
  const last = points[points.length - 1]
  if (accuracy <= first[0]) return first
  if (accuracy >= last[0]) return last
  const i = points.findIndex((p) => p[0] >= accuracy)
  const a = points[i - 1]
  const b = points[i]
  const t = (accuracy - a[0]) / (b[0] - a[0])
  const at = (k: 1 | 2 | 3) => a[k] + (b[k] - a[k]) * t
  return [accuracy, at(1), at(2), at(3)]
}

/** The share of the calibration players, 0 to 100, who played this accurately or worse in that scope. The table's points
 *  are equal-count bins at their median accuracy, so point i of n sits near the (i + 0.5) / n quantile. Flat past either
 *  end, like `interpolate`. Works for every scope, the endgame too, where accuracy says nothing of rating but still
 *  ranks a game against the others. */
export function accuracyPercentile(accuracy: number, scope: EloScope): number {
  return percentile(table.scopes[scope].points as unknown as readonly EloPoint[], accuracy)
}

export function percentile(points: readonly EloPoint[], accuracy: number): number {
  const at = (i: number) => ((i + 0.5) / points.length) * 100
  if (accuracy <= points[0][0]) return at(0)
  if (accuracy >= points[points.length - 1][0]) return at(points.length - 1)
  const i = points.findIndex((p) => p[0] >= accuracy)
  const t = (accuracy - points[i - 1][0]) / (points[i][0] - points[i - 1][0])
  return at(i - 1) + t * (at(i) - at(i - 1))
}

const round10 = (x: number) => Math.round(x / 10) * 10
