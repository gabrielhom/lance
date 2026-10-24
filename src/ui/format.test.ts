import { describe, expect, it } from 'vitest'
import { estimateSecondsLeft, formatTimeLeft } from './format'

describe('estimateSecondsLeft', () => {
  it('waits for four finished positions', () => {
    expect(estimateSecondsLeft({ at: 0, done: 2 }, { at: 3000, done: 5 }, 34)).toBeNull()
  })
  it('extrapolates the observed rate', () => {
    expect(estimateSecondsLeft({ at: 0, done: 0 }, { at: 4000, done: 8 }, 34)).toBe(13)
  })
})

describe('formatTimeLeft', () => {
  it('speaks plain Portuguese', () => {
    expect(formatTimeLeft(2)).toBe('quase pronto')
    expect(formatTimeLeft(21)).toBe('cerca de 20 s restantes')
    expect(formatTimeLeft(130)).toBe('cerca de 2 min restantes')
  })
})
