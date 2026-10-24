import type { BackupRejection, BackupReport, GameId, Identity, LibraryRecord, Result, Settings } from '../domain/types'
import { parseIdentity, parseLibraryRecord } from './parse'

/** Raw rows of each object store that a backup carries. The eval cache stays out: it rebuilds itself.
 *  A new store is one more key here; an app that doesn't know a key ignores it, so adding one is not a format change. */
export type BackupStores = { readonly games: readonly unknown[] }

export type BackupFile = {
  readonly format: 'lance-backup'
  /** Goes up only when an older app could no longer read the file. */
  readonly v: 1
  readonly exportedAt: string
  readonly stores: BackupStores
  readonly settings: Settings
}

/** Rows go out as stored, unreadable ones too, so a newer app can still recover what this one can't parse. */
export function buildBackup(stores: BackupStores, settings: Settings, now: number): BackupFile {
  return { format: 'lance-backup', v: 1, exportedAt: new Date(now).toISOString(), stores, settings }
}

export type ImportPlan = { readonly put: readonly LibraryRecord[]; readonly report: BackupReport }

/** Decides what an import writes, given the rows already in the games store and the accounts already set.
 *  A game already here stays unless the file has a newer review of it. A row this app can't read stays out of the
 *  database, since nothing could show or update it; it is still in the file. Accounts come back only when none are set. */
export function planImport(text: string, existing: readonly unknown[], identity: Identity): Result<ImportPlan, BackupRejection> {
  const parsed = parseBackup(text)
  if (!parsed.ok) return parsed
  const { records, ignored, accounts } = parsed.value

  const here = new Map<unknown, number | null>()
  for (const row of existing) {
    const r = parseLibraryRecord(row)
    if (r) here.set(r.id, r.reviewedAt)
    // An unreadable row may come from a newer app, so it wins over anything in the file.
    else if (typeof row === 'object' && row !== null && 'id' in row) here.set(row.id, null)
  }
  const newest = new Map<GameId, LibraryRecord>()
  for (const r of records) {
    const seen = newest.get(r.id)
    if (!seen || r.reviewedAt > seen.reviewedAt) newest.set(r.id, r)
  }
  const put = [...newest.values()].filter((r) => {
    const at = here.get(r.id)
    return at === undefined || (at !== null && r.reviewedAt > at)
  })
  const restore = identity.accounts.length === 0 && accounts && accounts.accounts.length > 0 ? accounts : null
  return { ok: true, value: { put, report: { imported: put.length, alreadyHere: newest.size - put.length, ignored, identity: restore } } }
}

type ParsedBackup = { readonly records: readonly LibraryRecord[]; readonly ignored: number; readonly accounts: Identity | null }

function parseBackup(text: string): Result<ParsedBackup, BackupRejection> {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return { ok: false, error: { kind: 'not-backup' } }
  }
  if (!isObj(file) || file.format !== 'lance-backup' || !isInt(file.v) || file.v < 1 || !isObj(file.stores)) {
    return { ok: false, error: { kind: 'not-backup' } }
  }
  if (file.v > 1) return { ok: false, error: { kind: 'newer-version' } }
  const games = file.stores.games ?? []
  if (!Array.isArray(games)) return { ok: false, error: { kind: 'not-backup' } }
  const records = games.map(parseLibraryRecord).filter((r) => r !== null)
  const accounts = isObj(file.settings) ? parseIdentity(file.settings.identity) : null
  return { ok: true, value: { records, ignored: games.length - records.length, accounts } }
}

const isInt = (x: unknown): x is number => Number.isInteger(x)
const isObj = (x: unknown): x is Readonly<Record<string, unknown>> => typeof x === 'object' && x !== null && !Array.isArray(x)
