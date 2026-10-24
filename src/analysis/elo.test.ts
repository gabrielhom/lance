import { describe, expect, it } from 'vitest'
import { accuracyPercentile, estimateElo, interpolate, percentile, type EloPoint } from './elo'

describe('interpolate', () => {
  const points: readonly EloPoint[] = [
    [60, 900, 1200, 1500],
    [80, 1100, 1500, 1800],
    [90, 1400, 1700, 2100],
  ]

  it('draws a straight line between neighbouring points', () => {
    expect(interpolate(points, 70)).toEqual([70, 1000, 1350, 1650])
    expect(interpolate(points, 87.5)).toEqual([87.5, 1325, 1650, 2025])
  })

  it('returns a point exactly at its accuracy', () => {
    expect(interpolate(points, 80)).toEqual([80, 1100, 1500, 1800])
  })

  it('stays flat past either end of the table', () => {
    expect(interpolate(points, 12)).toEqual([60, 900, 1200, 1500])
    expect(interpolate(points, 100)).toEqual([90, 1400, 1700, 2100])
  })
})

describe('estimateElo', () => {
  it('rounds to tens and never ranks a more accurate game lower', () => {
    const estimates = [40, 60, 70, 80, 90, 97].map((a) => estimateElo(a, 'game')!)
    for (const e of estimates) {
      expect(e.elo % 10).toBe(0)
      expect(e.low).toBeLessThanOrEqual(e.elo)
      expect(e.high).toBeGreaterThanOrEqual(e.elo)
    }
    expect(estimates.map((e) => e.elo)).toEqual([...estimates.map((e) => e.elo)].sort((a, b) => a - b))
  })

  // The review's caption names the endgame; a recalibration that changes this must change the caption too.
  it('estimates the opening and the middlegame but not the endgame, where accuracy barely tracks rating', () => {
    expect([estimateElo(90, 'opening'), estimateElo(90, 'middlegame'), estimateElo(90, 'endgame')].map((e) => e !== null)).toEqual([true, true, false])
  })
})

describe('percentile', () => {
  const points: readonly EloPoint[] = [
    [60, 900, 1200, 1500],
    [80, 1100, 1500, 1800],
    [90, 1400, 1700, 2100],
  ]

  it('places each point at the middle of its bin and draws straight lines between them', () => {
    expect([60, 70, 80, 85, 90].map((a) => Math.round(percentile(points, a) * 10) / 10)).toEqual([16.7, 33.3, 50, 66.7, 83.3])
  })

  it('stays flat past either end of the table', () => {
    expect([12, 100].map((a) => Math.round(percentile(points, a) * 10) / 10)).toEqual([16.7, 83.3])
  })

  it('ranks the same accuracy lower in the opening than in the middlegame, where everyone plays less accurately', () => {
    expect(Math.round(accuracyPercentile(85, 'opening'))).toBe(37)
    expect(Math.round(accuracyPercentile(85, 'middlegame'))).toBe(66)
  })
})
