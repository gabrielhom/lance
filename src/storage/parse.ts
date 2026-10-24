import {
  CLASSIFICATIONS,
  PHASES,
  WASM_FLAVORS,
  type Account,
  type AnalysisProfile,
  type ByColor,
  type Classification,
  type EngineDescriptor,
  type EngineId,
  type EngineInput,
  type EngineTuning,
  type EvalLine,
  type Fen,
  type GameId,
  type GameResult,
  type GameSource,
  type Identity,
  type LibraryRecord,
  type NonEmpty,
  type Opening,
  type Phase,
  type PlayerTag,
  type PuzzleAttempt,
  type PuzzleId,
  type ReviewSummary,
  type San,
  type Schedule,
  type Score,
  type SearchedEval,
  type SearchLimit,
  type TrainingItem,
  type TrainingItemId,
  type Uci,
} from '../domain/types'

/** Persisted shapes are untrusted: an old schema, a manual edit or a bug can leave anything. Every parser returns null
 *  instead of throwing, so a bad row is a miss and a bad setting falls back. */
type Obj = Readonly<Record<string, unknown>>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const isStr = (x: unknown): x is string => typeof x === 'string' && x.length > 0
const isInt = (x: unknown, min: number): x is number => Number.isInteger(x) && (x as number) >= min
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const UCI = /^[a-h][1-8][a-h][1-8][nbrq]?$/
const RESULTS: readonly GameResult[] = ['1-0', '0-1', '1/2-1/2', '*']

export type StoredEval = { readonly v: 1; readonly lines: SearchedEval['lines']; readonly depth: number }

export function evalRow(value: SearchedEval): StoredEval {
  return { v: 1, lines: value.lines, depth: value.depth }
}

export function parseEvalRow(row: unknown): SearchedEval | null {
  if (!isObj(row) || row.v !== 1 || !isInt(row.depth, 1) || !Array.isArray(row.lines)) return null
  const lines = row.lines.map(parseLine)
  const [first, second] = lines
  if (!first || lines.some((l) => l === null)) return null
  if (lines.length === 1) return { depth: row.depth, lines: [first] }
  if (lines.length === 2 && second) return { depth: row.depth, lines: [first, second] }
  return null
}

function parseLine(x: unknown): EvalLine | null {
  if (!isObj(x) || !Array.isArray(x.pv) || !x.pv.every((m) => typeof m === 'string' && UCI.test(m))) return null
  const score = parseScore(x.score)
  const [head, ...rest] = x.pv as Uci[]
  return score && head ? { score, pv: [head, ...rest] as NonEmpty<Uci> } : null
}

function parseScore(x: unknown): Score | null {
  if (!isObj(x)) return null
  if (x.kind === 'cp' && isNum(x.white)) return { kind: 'cp', white: x.white }
  if (x.kind === 'mate' && (x.winner === 'w' || x.winner === 'b') && isInt(x.moves, 1)) return { kind: 'mate', winner: x.winner, moves: x.moves }
  return null
}

export function parseLibraryRecord(row: unknown): LibraryRecord | null {
  if (!isObj(row) || row.v !== 1 || !isStr(row.id) || typeof row.pgn !== 'string') return null
  const source = parseSource(row.source)
  const players = byColor(row.players, parsePlayer)
  const profile = parseProfile(row.profile)
  const summary = parseSummary(row.summary)
  const result = RESULTS.find((r) => r === row.result)
  const playedAt = row.playedAt === null ? null : isNum(row.playedAt) ? row.playedAt : undefined
  if (!source || !players || !profile || !summary || !result || playedAt === undefined || !isNum(row.reviewedAt)) return null
  return { v: 1, id: row.id as GameId, source, players, result, playedAt, reviewedAt: row.reviewedAt, pgn: row.pgn, profile, summary }
}

export type StoredTrainingItem = TrainingItem & { readonly v: 1 }

export function trainingRow(item: TrainingItem): StoredTrainingItem {
  return { v: 1, ...item }
}

export function parseTrainingItem(row: unknown): TrainingItem | null {
  if (!isObj(row) || row.v !== 1 || !isStr(row.id) || !isStr(row.gameId) || !isInt(row.index, 0)) return null
  const input = parseInput(row.input)
  const lastMove = row.lastMove === null ? null : isUci(row.lastMove) ? row.lastMove : undefined
  const played = parsePlayed(row.played)
  const best = parseLine(row.best)
  const alternative = row.alternative === null ? null : (parseLine(row.alternative) ?? undefined)
  const schedule = parseSchedule(row.schedule)
  const sans = Array.isArray(row.bestLineSan) && row.bestLineSan.every(isStr) ? (row.bestLineSan as San[]) : null
  if (!input || lastMove === undefined || !played || !best || alternative === undefined || !schedule || !sans) return null
  return {
    id: row.id as TrainingItemId,
    gameId: row.gameId as GameId,
    index: row.index,
    input,
    lastMove,
    played,
    best,
    bestLineSan: sans,
    alternative,
    schedule,
  }
}

export type StoredPuzzleAttempt = PuzzleAttempt & { readonly v: 1 }

export function puzzleRow(attempt: PuzzleAttempt): StoredPuzzleAttempt {
  return { v: 1, ...attempt }
}

export function parsePuzzleAttempt(row: unknown): PuzzleAttempt | null {
  if (!isObj(row) || row.v !== 1 || !isStr(row.id) || !isNum(row.at) || typeof row.solved !== 'boolean' || !isNum(row.puzzleRating)) return null
  return { id: row.id as PuzzleId, at: row.at, solved: row.solved, puzzleRating: row.puzzleRating }
}

const isUci = (x: unknown): x is Uci => typeof x === 'string' && UCI.test(x)

function parseInput(x: unknown): EngineInput | null {
  if (!isObj(x) || !isStr(x.root) || !Array.isArray(x.tail) || !x.tail.every(isUci)) return null
  return { root: x.root as Fen, tail: x.tail }
}

function parsePlayed(x: unknown): TrainingItem['played'] | null {
  if (!isObj(x) || !isStr(x.san) || !isUci(x.uci)) return null
  const c = x.classification
  return c === 'mistake' || c === 'blunder' || c === 'miss' ? { san: x.san as San, uci: x.uci, classification: c } : null
}

function parseSchedule(x: unknown): Schedule | null {
  if (!isObj(x) || !isInt(x.box, 0) || !isNum(x.due)) return null
  const l = x.last
  const last = l === null ? null : isObj(l) && isNum(l.at) && typeof l.correct === 'boolean' ? { at: l.at, correct: l.correct } : undefined
  return last === undefined ? null : { box: x.box, due: x.due, last }
}

function parseSource(x: unknown): GameSource | null {
  if (!isObj(x)) return null
  if (x.kind === 'lichess' && isStr(x.id) && isStr(x.url)) return { kind: 'lichess', id: x.id, url: x.url }
  if (x.kind === 'chesscom' && isStr(x.uuid) && isStr(x.url)) return { kind: 'chesscom', uuid: x.uuid, url: x.url }
  if (x.kind === 'played' && isStr(x.id) && (x.you === 'w' || x.you === 'b')) return { kind: 'played', id: x.id, you: x.you }
  return x.kind === 'pgn' ? { kind: 'pgn' } : null
}

function parsePlayer(x: unknown): PlayerTag | null {
  if (!isObj(x) || typeof x.name !== 'string') return null
  if (x.rating !== null && !isNum(x.rating)) return null
  return { name: x.name, rating: x.rating }
}

function parseProfile(x: unknown): AnalysisProfile | null {
  if (!isObj(x) || !isStr(x.engine)) return null
  const limit = parseLimit(x.limit)
  return limit && { engine: x.engine as EngineId, limit }
}

function parseSummary(x: unknown): ReviewSummary | null {
  if (!isObj(x) || !isInt(x.classifierVersion, 0)) return null
  const a = x.accuracy
  const accuracy = isObj(a) && isAccuracy(a.w) && isAccuracy(a.b) ? { w: a.w, b: a.b } : null
  const counts = byColor(x.counts, parseCounts)
  const opening = x.opening === null ? null : parseOpening(x.opening)
  // Rows saved before phases existed have none; a malformed value is still a bad row.
  const phases = x.phases === undefined || x.phases === null ? null : (byColor(x.phases, parsePhases) ?? undefined)
  if (!accuracy || !counts || opening === undefined || phases === undefined) return null
  return { classifierVersion: x.classifierVersion, accuracy, counts, opening, phases }
}

function parsePhases(x: unknown): Readonly<Record<Phase, number | null>> | null {
  if (!isObj(x) || !PHASES.every((p) => isAccuracy(x[p]))) return null
  return Object.fromEntries(PHASES.map((p) => [p, x[p]])) as Record<Phase, number | null>
}

const isAccuracy = (a: unknown): a is number | null => a === null || isNum(a)

function parseCounts(x: unknown): Readonly<Record<Classification, number>> | null {
  if (!isObj(x) || !CLASSIFICATIONS.every((c) => isInt(x[c], 0))) return null
  return Object.fromEntries(CLASSIFICATIONS.map((c) => [c, x[c]])) as Record<Classification, number>
}

function parseOpening(x: unknown): Opening | undefined {
  return isObj(x) && isStr(x.eco) && isStr(x.name) ? { eco: x.eco, name: x.name } : undefined
}

function byColor<T>(x: unknown, parse: (v: unknown) => T | null): ByColor<T> | null {
  if (!isObj(x)) return null
  const w = parse(x.w)
  const b = parse(x.b)
  return w !== null && b !== null ? { w, b } : null
}

export function parseLimit(x: unknown): SearchLimit | null {
  if (!isObj(x)) return null
  if (x.kind === 'depth' && isInt(x.depth, 1)) return { kind: 'depth', depth: x.depth }
  if (x.kind === 'movetime' && isInt(x.ms, 1)) return { kind: 'movetime', ms: x.ms }
  return null
}

export function parseIdentity(x: unknown): Identity | null {
  if (!isObj(x) || !Array.isArray(x.accounts)) return null
  return { accounts: x.accounts.filter(isAccount).map(({ site, username }) => ({ site, username })) }
}

function isAccount(x: unknown): x is Account {
  return isObj(x) && (x.site === 'lichess' || x.site === 'chesscom' || x.site === 'any') && isStr(x.username)
}

export function parseEngine(x: unknown): EngineDescriptor | null {
  if (!isObj(x)) return null
  if (x.kind === 'wasm' && typeof x.flavor === 'string' && Object.hasOwn(WASM_FLAVORS, x.flavor)) {
    return { kind: 'wasm', flavor: x.flavor as keyof typeof WASM_FLAVORS }
  }
  if (x.kind === 'bridge' && isStr(x.url) && isStr(x.name) && isStr(x.idName)) return { kind: 'bridge', url: x.url, name: x.name, idName: x.idName }
  return null
}

export function parseTuning(x: unknown): EngineTuning | null {
  if (!isObj(x) || !isInt(x.engines, 1) || !isInt(x.threadsPerEngine, 1) || !isInt(x.hashMb, 1)) return null
  return { engines: x.engines, threadsPerEngine: x.threadsPerEngine, hashMb: x.hashMb }
}
