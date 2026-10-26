import type { BackupRejection, BackupReport, Identity, LibraryRecord, LineProgress, PuzzleAttempt, Result, Schedule, Settings, TrainingItem, TrainingItemId } from '../domain/types'
import { parseIdentity, parseLibraryRecord, parseLineProgress, parsePuzzleAttempt, parseTrainingItem } from './parse'

/** Raw rows of each object store that a backup carries. The eval cache stays out: it rebuilds itself.
 *  A new store is one more key here; an app that doesn't know a key ignores it, so adding one is not a format change. */
export type BackupStores = {
  readonly games: readonly unknown[]
  readonly training: readonly unknown[]
  readonly puzzles: readonly unknown[]
  readonly openings: readonly unknown[]
}

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

export type ImportPlan = {
  readonly put: readonly LibraryRecord[]
  readonly training: readonly TrainingItem[]
  /** Items here of a game the file brings a newer review of, that the file doesn't have: the older review made them. */
  readonly drop: readonly TrainingItemId[]
  readonly puzzles: readonly PuzzleAttempt[]
  readonly openings: readonly LineProgress[]
  readonly report: BackupReport
}

/** Decides what an import writes, given the rows already in each store and the accounts already set.
 *  A game already here stays unless the file has a newer review of it. A training item or an opening line stays unless
 *  the file's copy was answered later, since the later answer carries the schedule the player last saw. Of two attempts
 *  at one puzzle the earlier stays, since only the first attempt counts toward the rating. A row this app can't read
 *  stays out of the database, since nothing could show or update it; it is still in the file. Accounts come back only
 *  when none are set. */
export function planImport(text: string, existing: BackupStores, identity: Identity): Result<ImportPlan, BackupRejection> {
  const parsed = parseBackup(text)
  if (!parsed.ok) return parsed
  const { records, training: fileTraining, puzzles: filePuzzles, openings: fileOpenings, ignored, accounts } = parsed.value
  const put = newer(records, existing.games, parseLibraryRecord, (r) => r.reviewedAt)
  const answered = (s: { readonly schedule: Schedule }) => s.schedule.last?.at ?? -Infinity
  const training = newer(fileTraining?.items ?? [], existing.training, parseTrainingItem, answered)
  const puzzles = newer(filePuzzles, existing.puzzles, parsePuzzleAttempt, (a) => -a.at)
  const openings = newer(fileOpenings, existing.openings, parseLineProgress, answered)
  // A file without a training store predates training, so it says nothing about the items here.
  const won = new Set<string>(put.map((r) => r.id))
  const drop = fileTraining
    ? existing.training.flatMap((row) => {
        const i = parseTrainingItem(row)
        return i && won.has(i.gameId) && !fileTraining.ids.has(i.id) ? [i.id] : []
      })
    : []
  const restore = identity.accounts.length === 0 && accounts && accounts.accounts.length > 0 ? accounts : null
  return { ok: true, value: { put, training, drop, puzzles, openings, report: { imported: put.length, alreadyHere: new Set(records.map((r) => r.id)).size - put.length, ignored, identity: restore } } }
}

/** The newest copy of each row in the file, kept only when it is newer than the row here. */
function newer<T extends { readonly id: string }>(file: readonly T[], here: readonly unknown[], parse: (row: unknown) => T | null, at: (row: T) => number): T[] {
  const stamps = new Map<unknown, number | null>()
  for (const row of here) {
    const r = parse(row)
    if (r) stamps.set(r.id, at(r))
    // An unreadable row may come from a newer app, so it wins over anything in the file.
    else if (typeof row === 'object' && row !== null && 'id' in row) stamps.set(row.id, null)
  }
  const newest = new Map<string, T>()
  for (const r of file) {
    const seen = newest.get(r.id)
    if (!seen || at(r) > at(seen)) newest.set(r.id, r)
  }
  return [...newest.values()].filter((r) => {
    const stamp = stamps.get(r.id)
    return stamp === undefined || (stamp !== null && at(r) > stamp)
  })
}

type ParsedBackup = {
  readonly records: readonly LibraryRecord[]
  /** null when the file has no training store. `ids` holds every row's id, unreadable rows included. */
  readonly training: { readonly items: readonly TrainingItem[]; readonly ids: ReadonlySet<string> } | null
  readonly puzzles: readonly PuzzleAttempt[]
  readonly openings: readonly LineProgress[]
  readonly ignored: number
  readonly accounts: Identity | null
}

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
  const rows = file.stores.training ?? null
  const attempts = file.stores.puzzles ?? []
  const lines = file.stores.openings ?? []
  if (!Array.isArray(games) || (rows !== null && !Array.isArray(rows)) || !Array.isArray(attempts) || !Array.isArray(lines)) {
    return { ok: false, error: { kind: 'not-backup' } }
  }
  const records = games.map(parseLibraryRecord).filter((r) => r !== null)
  const training = rows && {
    items: rows.map(parseTrainingItem).filter((i) => i !== null),
    ids: new Set(rows.flatMap((row: unknown) => (isObj(row) && typeof row.id === 'string' ? [row.id] : []))),
  }
  const accounts = isObj(file.settings) ? parseIdentity(file.settings.identity) : null
  const puzzles = attempts.map(parsePuzzleAttempt).filter((a) => a !== null)
  const openings = lines.map(parseLineProgress).filter((p) => p !== null)
  return { ok: true, value: { records, training, puzzles, openings, ignored: games.length - records.length, accounts } }
}

const isInt = (x: unknown): x is number => Number.isInteger(x)
const isObj = (x: unknown): x is Readonly<Record<string, unknown>> => typeof x === 'object' && x !== null && !Array.isArray(x)
