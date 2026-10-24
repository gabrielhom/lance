import { describe, expect, it } from 'vitest'
import { CLASSIFICATIONS, DEFAULT_SETTINGS, type Classification, type Identity, type Settings } from '../domain/types'
import { buildBackup, planImport } from './backup'

const ZERO = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>
const NOBODY: Identity = { accounts: [] }
const GABRIEL: Identity = { accounts: [{ site: 'lichess', username: 'gabrielhom' }] }
const here = (games: unknown[], training: unknown[] = [], puzzles: unknown[] = []) => ({ games, training, puzzles })

function record(id: string, reviewedAt: number) {
  return {
    v: 1,
    id,
    source: { kind: 'pgn' },
    players: { w: { name: 'gabriel', rating: 1712 }, b: { name: 'rival', rating: null } },
    result: '1-0',
    playedAt: null,
    reviewedAt,
    pgn: '1. e4 1-0',
    profile: { engine: 'sf19/nn-61e7af4bb97d', limit: { kind: 'depth', depth: 18 } },
    summary: { classifierVersion: 1, accuracy: { w: 91.5, b: null }, counts: { w: ZERO, b: ZERO }, opening: null, phases: null, division: null, phaseErrors: null, bookExit: null },
  }
}

function item(id: string, answeredAt: number | null) {
  return {
    v: 1,
    id,
    gameId: 'g',
    index: Number(id.slice(2)),
    input: { root: '8/8/8/8/8/8/8/K6k w - - 0 1', tail: [] },
    lastMove: null,
    played: { san: 'Kb1', uci: 'a1b1', classification: 'blunder' },
    best: { score: { kind: 'cp', white: 0 }, pv: ['a1a2'] },
    bestLineSan: ['Ka2'],
    alternative: null,
    schedule: { box: 1, due: 1000, last: answeredAt === null ? null : { at: answeredAt, correct: true } },
  }
}

function attempt(id: string, at: number, solved = true) {
  return { v: 1, id, at, solved, puzzleRating: 1760 }
}

function parsed(id: string, answeredAt: number | null) {
  const { v: _, ...rest } = item(id, answeredAt)
  return rest
}

function file(games: unknown[], settings: unknown = { ...DEFAULT_SETTINGS, identity: GABRIEL }, extra: object = {}) {
  return JSON.stringify({ format: 'lance-backup', v: 1, exportedAt: '2026-10-24T12:00:00.000Z', stores: { games, ...extra }, settings })
}

describe('buildBackup', () => {
  it('carries every row as stored, unreadable ones included, and the settings', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, identity: GABRIEL, tuning: { engines: 4, threadsPerEngine: 1, hashMb: 32 } }
    const rows = [record('pgn:a', 100), { v: 2, id: 'pgn:future' }]
    expect(buildBackup({ games: rows, training: [], puzzles: [attempt('00sHx', 100)] }, settings, Date.UTC(2026, 9, 24, 12))).toEqual({
      format: 'lance-backup',
      v: 1,
      exportedAt: '2026-10-24T12:00:00.000Z',
      stores: { games: [record('pgn:a', 100), { v: 2, id: 'pgn:future' }], training: [], puzzles: [{ v: 1, id: '00sHx', at: 100, solved: true, puzzleRating: 1760 }] },
      settings: {
        v: 1,
        identity: { accounts: [{ site: 'lichess', username: 'gabrielhom' }] },
        engine: { kind: 'wasm', flavor: 'lite' },
        limit: { kind: 'depth', depth: 18 },
        tuning: { engines: 4, threadsPerEngine: 1, hashMb: 32 },
      },
    })
  })
})

describe('planImport', () => {
  it.each([
    ['text that is not JSON', 'partidas.pgn', { kind: 'not-backup' }],
    ['another JSON file', '{"name":"lance","version":"0.0.0"}', { kind: 'not-backup' }],
    ['a JSON array', '[]', { kind: 'not-backup' }],
    ['a backup without stores', '{"format":"lance-backup","v":1}', { kind: 'not-backup' }],
    ['games that are not a list', '{"format":"lance-backup","v":1,"stores":{"games":{}}}', { kind: 'not-backup' }],
    ['version zero', '{"format":"lance-backup","v":0,"stores":{"games":[]}}', { kind: 'not-backup' }],
    ['a newer format', '{"format":"lance-backup","v":2,"stores":{"games":[]}}', { kind: 'newer-version' }],
  ])('rejects %s', (_, text, error) => {
    expect(planImport(text, here([]), NOBODY)).toEqual({ ok: false, error })
  })

  it('adds new games, takes a newer review, keeps what is here and counts unreadable rows', () => {
    const text = file([record('pgn:same', 100), record('pgn:newer', 300), record('pgn:new', 50), { v: 2, id: 'pgn:future' }, 'lixo'])
    expect(planImport(text, here([record('pgn:same', 100), record('pgn:newer', 200)]), GABRIEL)).toEqual({
      ok: true,
      value: {
        put: [record('pgn:newer', 300), record('pgn:new', 50)],
        training: [],
        drop: [],
        puzzles: [],
        report: { imported: 2, alreadyHere: 1, ignored: 2, identity: null },
      },
    })
  })

  it('keeps a newer review already here over an older copy in the file', () => {
    expect(planImport(file([record('pgn:a', 100)]), here([record('pgn:a', 500)]), GABRIEL)).toEqual({
      ok: true,
      value: { put: [], training: [], drop: [], puzzles: [], report: { imported: 0, alreadyHere: 1, ignored: 0, identity: null } },
    })
  })

  it('never overwrites a row here that this version cannot read', () => {
    expect(planImport(file([record('pgn:a', 100)]), here([{ v: 2, id: 'pgn:a' }]), GABRIEL)).toEqual({
      ok: true,
      value: { put: [], training: [], drop: [], puzzles: [], report: { imported: 0, alreadyHere: 1, ignored: 0, identity: null } },
    })
  })

  it('takes the newest of two copies of one game in the file', () => {
    expect(planImport(file([record('pgn:a', 100), record('pgn:a', 200)]), here([]), GABRIEL)).toEqual({
      ok: true,
      value: { put: [record('pgn:a', 200)], training: [], drop: [], puzzles: [], report: { imported: 1, alreadyHere: 0, ignored: 0, identity: null } },
    })
  })

  it('ignores a store it does not know, so a newer backup still imports its games', () => {
    const text = file([record('pgn:a', 100)], undefined, { drills: [{ id: 't1', due: 0 }] })
    expect(planImport(text, here([]), GABRIEL)).toMatchObject({ ok: true, value: { report: { imported: 1, alreadyHere: 0, ignored: 0 } } })
  })

  it('reads a backup without games as empty', () => {
    expect(planImport('{"format":"lance-backup","v":1,"stores":{}}', here([]), NOBODY)).toEqual({
      ok: true,
      value: { put: [], training: [], drop: [], puzzles: [], report: { imported: 0, alreadyHere: 0, ignored: 0, identity: null } },
    })
  })

  it('takes a training item answered later in the file, keeps one answered later here and never one it cannot read', () => {
    const text = file([], undefined, { training: [item('g#1', 500), item('g#2', 100), item('g#3', null), item('g#4', 900), { v: 2, id: 'g#5' }] })
    const plan = planImport(text, here([], [item('g#1', 300), item('g#2', 200), { v: 2, id: 'g#4' }]), GABRIEL)
    expect(plan.ok && plan.value.training).toEqual([parsed('g#1', 500), parsed('g#3', null)])
  })

  it('adds puzzle attempts, keeping the earlier of two at one puzzle and never replacing one it cannot read', () => {
    const text = file([], undefined, { puzzles: [attempt('aaaaa', 500), attempt('bbbbb', 100, false), attempt('ccccc', 900), attempt('ddddd', 50), attempt('ddddd', 40), { v: 2, id: 'eeeee' }] })
    const plan = planImport(text, here([], [], [attempt('aaaaa', 300), attempt('bbbbb', 200), { v: 2, id: 'ccccc' }]), GABRIEL)
    expect(plan.ok && plan.value.puzzles).toEqual([
      { id: 'bbbbb', at: 100, solved: false, puzzleRating: 1760 },
      { id: 'ddddd', at: 40, solved: true, puzzleRating: 1760 },
    ])
  })

  describe('the items of a game whose newer review comes in', () => {
    const ofGame = (id: string, answeredAt: number | null, gameId = 'pgn:a') => ({ ...item(id, answeredAt), gameId, index: Number(id.split('#')[1]) })
    const local = here([record('pgn:a', 100), record('pgn:b', 100)], [ofGame('pgn:a#3', 50), ofGame('pgn:a#5', 50), ofGame('pgn:b#7', 50, 'pgn:b'), { v: 2, id: 'pgn:a#9', gameId: 'pgn:a' }])

    it('drops the ones here that the file does not have for that game, when the file has a training store', () => {
      const text = file([record('pgn:a', 200), record('pgn:b', 100)], undefined, { training: [ofGame('pgn:a#3', null), { v: 2, id: 'pgn:a#5' }] })
      const plan = planImport(text, local, GABRIEL)
      expect(plan.ok && { put: plan.value.put.map((r) => r.id), drop: plan.value.drop }).toEqual({ put: ['pgn:a'], drop: [] })
      const without = file([record('pgn:a', 200)], undefined, { training: [ofGame('pgn:a#3', null)] })
      const dropped = planImport(without, local, GABRIEL)
      expect(dropped.ok && dropped.value.drop).toEqual(['pgn:a#5'])
    })

    it('leaves them alone when the file predates training', () => {
      const plan = planImport(file([record('pgn:a', 200)]), local, GABRIEL)
      expect(plan.ok && { put: plan.value.put.map((r) => r.id), training: plan.value.training, drop: plan.value.drop }).toEqual({ put: ['pgn:a'], training: [], drop: [] })
    })
  })

  it.each<[string, Identity, unknown, Identity | null]>([
    ['restores the accounts when none are set', NOBODY, { identity: GABRIEL }, GABRIEL],
    ['keeps the accounts already set', { accounts: [{ site: 'chesscom', username: 'outro' }] }, { identity: GABRIEL }, null],
    ['restores nothing from a file without accounts', NOBODY, { identity: { accounts: [] } }, null],
    ['restores nothing from a file without settings', NOBODY, null, null],
  ])('%s', (_, current, settings, identity) => {
    const plan = planImport(file([], settings), here([]), current)
    expect(plan.ok && plan.value.report.identity).toEqual(identity)
  })
})
