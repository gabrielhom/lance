import { describe, expect, it } from 'vitest'
import type { Color, LineId, LineProgress, Schedule } from '../domain'
import { buildTree } from './lines'
import { catalog, dueCount, familyStudy, lineKey, nextProgress, OPENINGS, requeueStep, searchCatalog, stepFor, studyQueue, type StudyLine, type StudyStep } from './study'
import { FILE } from './testing'

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime()
const NOW = at(2026, 10, 24, 20)
const tree = buildTree(FILE)
const sicilian = tree.family('Sicilian Defense')!
const row = (color: Color, line: string, schedule: Schedule): LineProgress => ({ id: lineKey(color, line as LineId), color, line: line as LineId, schedule })
const learned = (due: number, box = 1): Schedule => ({ box, due, last: { at: NOW - 1, correct: true } })

describe('nextProgress', () => {
  it('makes a first drill learned: box 0, back tomorrow', () => {
    expect(nextProgress(null, 'learned', NOW)).toEqual({ box: 0, due: at(2026, 10, 25), last: { at: NOW, correct: true } })
  })

  it('moves a clean drill up a box on the due day and a missed one back to box 0', () => {
    const due = learned(at(2026, 10, 24))
    expect(nextProgress(due, 'clean', NOW)).toMatchObject({ box: 2, due: at(2026, 10, 31) })
    expect(nextProgress(due, 'missed', NOW)).toMatchObject({ box: 0, due: at(2026, 10, 25), last: { correct: false } })
  })

  it('returns the schedule itself before the due day, and for a learn pass of a line already learned', () => {
    const waiting = learned(at(2026, 10, 27))
    expect(nextProgress(waiting, 'clean', NOW)).toBe(waiting)
    expect(nextProgress(waiting, 'missed', NOW)).toBe(waiting)
    const due = learned(at(2026, 10, 24))
    expect(nextProgress(due, 'learned', NOW)).toBe(due)
  })
})

describe('familyStudy', () => {
  const progress = [
    row('w', 'e2e4 c7c5 g1f3 g7g6', learned(at(2026, 10, 23))),
    row('w', 'e2e4 c7c5 d2d4', learned(at(2026, 10, 30), 2)),
    row('b', 'e2e4 c7c5 c2c3 d7d5', learned(at(2026, 10, 20))),
  ]
  const study = familyStudy(sicilian, 'w', progress, NOW)

  it('gives each variation its state for that color only, in study order', () => {
    expect(study.lines.map((l) => [l.variation.line.sans.join(' '), l.state])).toEqual([
      ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5', { kind: 'new' }],
      ['e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e6', { kind: 'new' }],
      ['e4 c5 Nf3 g6', { kind: 'due', box: 1, due: at(2026, 10, 23) }],
      ['e4 c5 d4', { kind: 'learned', box: 2, due: at(2026, 10, 30) }],
      ['e4 c5 c3 d5', { kind: 'new' }],
    ])
    expect([study.learned, study.due]).toEqual([2, 1])
  })

  it('groups the variations by the first part of their name, in order of their first line', () => {
    expect(study.groups.map((g) => [g.name, g.lines.length])).toEqual([
      ['Najdorf Variation', 2],
      ['Hyperaccelerated Dragon', 1],
      ['Smith-Morra Gambit', 1],
      ['Alapin Variation', 1],
    ])
    expect(familyStudy(tree.family("King's Pawn Game")!, 'w', [], NOW).groups).toEqual([{ name: null, lines: [{ variation: tree.variation('e2e4' as LineId, 'w'), state: { kind: 'new' } }] }])
  })
})

describe('studyQueue', () => {
  const line = (id: string, state: StudyLine['state']): StudyLine => ({ variation: { line: { id: id as LineId } } as never, state })
  const sans = (steps: readonly StudyStep[]) => steps.map((s) => [s.variation.line.id, s.pass])

  it('reviews the due lines oldest first, then teaches up to five new ones in study order', () => {
    const lines = [
      line('a', { kind: 'new' }),
      line('b', { kind: 'due', box: 1, due: 300 }),
      line('c', { kind: 'learned', box: 2, due: NOW + 1 }),
      line('d', { kind: 'due', box: 0, due: 100 }),
      ...['e', 'f', 'g', 'h', 'i', 'j'].map((id) => line(id, { kind: 'new' })),
    ]
    expect(sans(studyQueue(lines))).toEqual([['d', 'review'], ['b', 'review'], ['a', 'learn'], ['e', 'learn'], ['f', 'learn'], ['g', 'learn'], ['h', 'learn']])
    expect(OPENINGS.newPerSession).toBe(5)
  })

  it('is empty when nothing is due and nothing is new', () => {
    expect(studyQueue([line('c', { kind: 'learned', box: 2, due: NOW + 1 })])).toEqual([])
  })

  it('drills one line as a learn, review or practice pass by its state', () => {
    expect(stepFor(line('a', { kind: 'new' })).pass).toBe('learn')
    expect(stepFor(line('b', { kind: 'due', box: 1, due: 300 })).pass).toBe('review')
    expect(stepFor(line('c', { kind: 'learned', box: 2, due: NOW + 1 })).pass).toBe('practice')
  })
})

describe('requeueStep', () => {
  const [a, b] = sicilian.variations.w
  const steps: StudyStep[] = [{ variation: a, pass: 'learn' }, { variation: b, pass: 'review' }]

  it('brings a learned or missed line back once at the end, and a clean one not at all', () => {
    expect(requeueStep(steps, 0, 'learned')).toEqual([...steps, { variation: a, pass: 'again' }])
    expect(requeueStep(steps, 1, 'missed')).toEqual([...steps, { variation: b, pass: 'again' }])
    expect(requeueStep(steps, 1, 'clean')).toBe(steps)
    const again = requeueStep(steps, 1, 'missed')
    expect(requeueStep(again, 2, 'missed')).toBe(again)
  })
})

describe('catalog', () => {
  const progress = [
    row('b', 'e2e4 c7c5 g1f3 g7g6', learned(at(2026, 10, 23))),
    row('b', 'e2e4 c7c5 d2d4', learned(at(2026, 10, 30))),
    row('w', 'e2e4 c7c5', learned(at(2026, 10, 23))),
    row('w', 'd2d4 d7d5 c2c4 e7e6', learned(at(2026, 10, 30))),
  ]
  // Two report groups of the Queen's Pawn Game, the Veresov and the Stonewall, both studied under it.
  const played = [
    { family: 'French Defense', color: 'b' as const, games: 4 },
    { family: 'Caro-Kann Defense', color: 'b' as const, games: 2 },
    { family: 'Caro-Kann Defense', color: 'w' as const, games: 1 },
    { family: "Queen's Pawn Game", color: 'w' as const, games: 1 },
    { family: "Queen's Pawn Game", color: 'w' as const, games: 1 },
  ]
  const entries = catalog(tree, progress, played, NOW)

  it('puts the families with a line due first, then the ones I play or study by games, then the rest by name', () => {
    expect(entries.map((e) => e.family.name)).toEqual([
      'Sicilian Defense',
      'French Defense',
      'Caro-Kann Defense',
      "Queen's Pawn Game",
      "Queen's Gambit Declined",
      'Grünfeld Defense',
      "King's Pawn Game",
    ])
  })

  it('counts the variations, the ones learned and due per color, and my games across the report groups of a family, ignoring a row whose line is no variation', () => {
    expect(entries[0]).toMatchObject({ colors: { w: { total: 5, learned: 0, due: 0 }, b: { total: 5, learned: 2, due: 1 } }, games: { w: 0, b: 0 } })
    expect(entries[2]).toMatchObject({ colors: { w: { total: 1, learned: 0, due: 0 }, b: { total: 1, learned: 0, due: 0 } }, games: { w: 1, b: 2 } })
    expect(entries[3]).toMatchObject({ colors: { w: { total: 1 }, b: { total: 1 } }, games: { w: 2, b: 0 } })
    expect(entries[6]).toMatchObject({ colors: { w: { total: 1 }, b: { total: 0 } } })
  })

  it('searches by every word, ignoring case and accents', () => {
    expect(searchCatalog(entries, 'grunfeld').map((e) => e.family.name)).toEqual(['Grünfeld Defense'])
    expect(searchCatalog(entries, "pawn QUEEN's").map((e) => e.family.name)).toEqual(["Queen's Pawn Game"])
    expect(searchCatalog(entries, '')).toEqual(entries)
  })

  it('counts the lines due today across families, leaving out a row whose line is no variation', () => {
    expect(dueCount(tree, progress, NOW)).toBe(1)
    expect(dueCount(tree, progress, at(2026, 10, 31))).toBe(3)
  })
})
