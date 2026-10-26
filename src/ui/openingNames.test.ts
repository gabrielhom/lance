import { describe, expect, it } from 'vitest'
import { loadTree } from '../openings'
import { OPENING_NAMES, openingName } from './openingNames'

describe('OPENING_NAMES', async () => {
  const families = new Set((await loadTree()).families.map((f) => f.name))

  it('names only families the book has, so a rebuilt book that renames one fails here', () => {
    expect(Object.keys(OPENING_NAMES).filter((name) => !families.has(name))).toEqual([])
  })

  it('names the Sicilian in Portuguese and leaves a family it does not know in English', () => {
    expect(openingName('Sicilian Defense')).toBe('Defesa Siciliana')
    expect(openingName('Kangaroo Defense')).toBe('Kangaroo Defense')
  })
})
