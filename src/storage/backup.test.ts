import { describe, expect, it } from 'vitest'
import { CLASSIFICATIONS, DEFAULT_SETTINGS, type Classification, type Identity, type Settings } from '../domain/types'
import { buildBackup, planImport } from './backup'

const ZERO = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>
const NOBODY: Identity = { accounts: [] }
const GABRIEL: Identity = { accounts: [{ site: 'lichess', username: 'gabrielhom' }] }

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
    summary: { classifierVersion: 1, accuracy: { w: 91.5, b: null }, counts: { w: ZERO, b: ZERO }, opening: null },
  }
}

function file(games: unknown[], settings: unknown = { ...DEFAULT_SETTINGS, identity: GABRIEL }, extra: object = {}) {
  return JSON.stringify({ format: 'lance-backup', v: 1, exportedAt: '2026-10-24T12:00:00.000Z', stores: { games, ...extra }, settings })
}

describe('buildBackup', () => {
  it('carries every row as stored, unreadable ones included, and the settings', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS, identity: GABRIEL, tuning: { engines: 4, threadsPerEngine: 1, hashMb: 32 } }
    const rows = [record('pgn:a', 100), { v: 2, id: 'pgn:future' }]
    expect(buildBackup({ games: rows }, settings, Date.UTC(2026, 9, 24, 12))).toEqual({
      format: 'lance-backup',
      v: 1,
      exportedAt: '2026-10-24T12:00:00.000Z',
      stores: { games: [record('pgn:a', 100), { v: 2, id: 'pgn:future' }] },
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
    expect(planImport(text, [], NOBODY)).toEqual({ ok: false, error })
  })

  it('adds new games, takes a newer review, keeps what is here and counts unreadable rows', () => {
    const text = file([record('pgn:same', 100), record('pgn:newer', 300), record('pgn:new', 50), { v: 2, id: 'pgn:future' }, 'lixo'])
    expect(planImport(text, [record('pgn:same', 100), record('pgn:newer', 200)], GABRIEL)).toEqual({
      ok: true,
      value: {
        put: [record('pgn:newer', 300), record('pgn:new', 50)],
        report: { imported: 2, alreadyHere: 1, ignored: 2, identity: null },
      },
    })
  })

  it('keeps a newer review already here over an older copy in the file', () => {
    expect(planImport(file([record('pgn:a', 100)]), [record('pgn:a', 500)], GABRIEL)).toEqual({
      ok: true,
      value: { put: [], report: { imported: 0, alreadyHere: 1, ignored: 0, identity: null } },
    })
  })

  it('never overwrites a row here that this version cannot read', () => {
    expect(planImport(file([record('pgn:a', 100)]), [{ v: 2, id: 'pgn:a' }], GABRIEL)).toEqual({
      ok: true,
      value: { put: [], report: { imported: 0, alreadyHere: 1, ignored: 0, identity: null } },
    })
  })

  it('takes the newest of two copies of one game in the file', () => {
    expect(planImport(file([record('pgn:a', 100), record('pgn:a', 200)]), [], GABRIEL)).toEqual({
      ok: true,
      value: { put: [record('pgn:a', 200)], report: { imported: 1, alreadyHere: 0, ignored: 0, identity: null } },
    })
  })

  it('ignores a store it does not know, so a newer backup still imports its games', () => {
    const text = file([record('pgn:a', 100)], undefined, { training: [{ id: 't1', due: 0 }] })
    expect(planImport(text, [], GABRIEL)).toMatchObject({ ok: true, value: { report: { imported: 1, alreadyHere: 0, ignored: 0 } } })
  })

  it('reads a backup without games as empty', () => {
    expect(planImport('{"format":"lance-backup","v":1,"stores":{}}', [], NOBODY)).toEqual({
      ok: true,
      value: { put: [], report: { imported: 0, alreadyHere: 0, ignored: 0, identity: null } },
    })
  })

  it.each<[string, Identity, unknown, Identity | null]>([
    ['restores the accounts when none are set', NOBODY, { identity: GABRIEL }, GABRIEL],
    ['keeps the accounts already set', { accounts: [{ site: 'chesscom', username: 'outro' }] }, { identity: GABRIEL }, null],
    ['restores nothing from a file without accounts', NOBODY, { identity: { accounts: [] } }, null],
    ['restores nothing from a file without settings', NOBODY, null, null],
  ])('%s', (_, current, settings, identity) => {
    const plan = planImport(file([], settings), [], current)
    expect(plan.ok && plan.value.report.identity).toEqual(identity)
  })
})
