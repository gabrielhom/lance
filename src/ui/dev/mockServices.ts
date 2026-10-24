/** Dev-only Services. Every screen and state is reachable without an engine.
 *  Fetch usernames that trigger failures: "nada" (not-found), "limite" (rate-limited), "rede" (network), "ruim" (bad-response).
 *  Bridge URLs: containing "nada" probe as unreachable, "recusa" as refused, "falha" makes the review fail. */
import { Chess } from 'chess.js'
import type { Move } from 'chess.js'
import { divide, estimateElo, keyMoments, phaseAt } from '../../analysis'
import { perspective } from '../../domain/identity'
import { loadPlay, savePlay } from '../../play'
import { buildBackup, libraryRecord, planImport } from '../../storage'
import { checkAnswer, nextSchedule, syncItems } from '../../training'
import { accuracyHistory } from '../../review'
import type {
  AccuracyPct,
  AnalysisProfile,
  BridgeEngine,
  BridgeProbeError,
  Classification,
  Color,
  EvalLine,
  Fen,
  FetchFailure,
  Game,
  GameId,
  GameRejection,
  GameResult,
  GameReview,
  GameSource,
  GraphPoint,
  Identity,
  ImportResult,
  LibraryRecord,
  MoveReview,
  NonEmpty,
  Opening,
  PartialSeries,
  Perspective,
  Phase,
  PhaseSummary,
  PlayedMove,
  PlayerSummary,
  PlayablePosition,
  Position,
  PositionKey,
  Result,
  ReviewState,
  San,
  SearchedEval,
  Score,
  Services,
  Settings,
  TrainingItem,
  TrainingItemId,
  Uci,
  WinPct,
} from '../../domain/types'
import { CLASSIFICATIONS, DEFAULT_SETTINGS, MIN_MOVES_OUTSIDE_THEORY, MIN_PHASE_MOVES, movesOutsideTheory } from '../../domain/types'
import operaPgn from '../../../e2e/fixtures/opera.pgn?raw'
import scholarPgn from '../../../e2e/fixtures/scholar.pgn?raw'

const SETTINGS_KEY = 'lance.settings'
const USER = 'gabrielhom'
const PROFILE: AnalysisProfile = { engine: 'sf19/nn-61e7af4bb97d' as AnalysisProfile['engine'], limit: { kind: 'depth', depth: 18 } }
const CLASSIFIER_VERSION = 1

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function rng(seed: number): () => number {
  let s = seed || 1
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    return ((s >>> 0) % 10000) / 10000
  }
}

function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}
let bookPromise: Promise<Record<string, [string, string] | null>> | null = null
function book() {
  bookPromise ??= import('../../openings/openings.json').then((m) => m.default as unknown as Record<string, [string, string] | null>)
  return bookPromise
}

const PIECE_VALUE: Readonly<Record<string, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/** A weak opponent that still finishes games: it mates when it can, grabs the biggest capture, then checks, then moves at random. */
function mockMove(input: { root: string; tail: readonly string[] }): Uci {
  const board = new Chess(input.root)
  for (const u of input.tail) board.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })
  const legal = board.moves({ verbose: true })
  const mate = legal.find((m) => m.san.endsWith('#'))
  const captures = legal.filter((m) => m.captured).sort((a, b) => PIECE_VALUE[b.captured!] - PIECE_VALUE[a.captured!])
  const checks = legal.filter((m) => m.san.endsWith('+'))
  const pool = mate ? [mate] : captures.length ? [captures[0]] : checks.length && Math.random() < 0.5 ? checks : legal
  return pool[Math.floor(Math.random() * pool.length)].lan as Uci
}

/** Positions carry engine input (root + tail since the last irreversible move) so the shape matches the real parser. */
export function gameFromPgn(pgn: string, source: GameSource): Result<Game, GameRejection> {
  const chess = new Chess()
  try {
    chess.loadPgn(pgn)
  } catch (e) {
    return { ok: false, error: { kind: 'unparseable', detail: e instanceof Error ? e.message : String(e) } }
  }
  const headers = chess.getHeaders()
  if (headers.Variant && !/standard|from position/i.test(headers.Variant)) {
    return { ok: false, error: { kind: 'variant', detail: headers.Variant } }
  }
  const verbose: Move[] = chess.history({ verbose: true })
  if (verbose.length === 0) return { ok: false, error: { kind: 'no-moves', detail: '' } }

  const replay = new Chess()
  const startFen = verbose[0].before
  replay.load(startFen)
  let root = startFen as Fen
  let tail: Uci[] = []
  const positions: Position[] = []
  const makePosition = (index: number): Position => {
    const fen = replay.fen() as Fen
    const turn = replay.turn()
    if (replay.isCheckmate()) return { index, fen, turn, kind: 'checkmate' }
    if (replay.isStalemate()) return { index, fen, turn, kind: 'stalemate' }
    const key = `${root}|${tail.join(' ')}` as PositionKey
    return { index, fen, turn, kind: 'playable', input: { root, tail: [...tail] }, key, legalMoves: replay.moves().length }
  }
  positions.push(makePosition(0))
  const moves: PlayedMove[] = []
  verbose.forEach((m, i) => {
    const before = positions[i]
    if (before.kind !== 'playable') return
    replay.move(m.san)
    if (m.captured || m.piece === 'p') {
      root = replay.fen() as Fen
      tail = []
    } else {
      tail = [...tail, m.lan as Uci]
    }
    const after = makePosition(i + 1)
    positions.push(after)
    moves.push({
      index: i,
      mover: m.color,
      san: m.san as San,
      uci: m.lan as Uci,
      from: m.from,
      to: m.to,
      piece: m.piece,
      captured: m.captured ?? null,
      promotion: m.promotion ?? null,
      before,
      after,
    })
  })
  const result = (['1-0', '0-1', '1/2-1/2'].includes(headers.Result) ? headers.Result : '*') as GameResult
  const playedAt = parseDate(headers.UTCDate ?? headers.Date, headers.UTCTime ?? headers.StartTime)
  const id = (source.kind === 'lichess' ? `lichess:${source.id}` : source.kind === 'chesscom' ? `chesscom:${source.uuid}` : source.kind === 'played' ? `played:${source.id}` : `pgn:${hash(moves.map((m) => m.san).join(' ') + headers.White + headers.Black + headers.Date).toString(36)}`) as GameId
  return {
    ok: true,
    value: {
      id,
      source,
      players: {
        w: { name: headers.White || 'Brancas', rating: toRating(headers.WhiteElo) },
        b: { name: headers.Black || 'Pretas', rating: toRating(headers.BlackElo) },
      },
      result,
      playedAt,
      timeControl: headers.TimeControl ?? null,
      pgn: chess.pgn(),
      positions: positions as unknown as NonEmpty<Position>,
      moves,
    },
  }
}

function toRating(s: string | undefined): number | null {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}
function parseDate(date: string | undefined, time: string | undefined): number | null {
  if (!date || date.includes('?')) return null
  const iso = `${date.replace(/\./g, '-')}T${time && !time.includes('?') ? time : '12:00:00'}Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

function splitPgn(text: string): string[] {
  const parts = text.split(/\r?\n(?=\[Event\s)/).map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : [text.trim()].filter(Boolean)
}

function parsePgnText(text: string): ImportResult {
  const games: Game[] = []
  const rejected: { index: number; rejection: GameRejection }[] = []
  splitPgn(text).forEach((pgn, index) => {
    const r = gameFromPgn(pgn, { kind: 'pgn' })
    if (r.ok) games.push(r.value)
    else rejected.push({ index, rejection: r.error })
  })
  return { games, rejected }
}

function winFromCp(cp: number): number {
  const c = Math.max(-1000, Math.min(1000, cp))
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1)
}
function moveAccuracy(before: number, after: number): number {
  if (after >= before) return 100
  return Math.max(0, Math.min(100, 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411 + 1))
}
function scoreLabel(s: Score): string {
  if (s.kind === 'mate') return s.winner === 'w' ? `M${s.moves}` : `-M${s.moves}`
  const p = s.white / 100
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}`
}
function scoreFromCp(cp: number, mateIn: { winner: Color; moves: number } | null): Score {
  return mateIn ? { kind: 'mate', ...mateIn } : { kind: 'cp', white: Math.round(cp) }
}

/** A plausible line from a position: the best move is the played one when the move was good, else a different legal move. */
function fabricateLine(fen: string, playedSan: string | null, keepPlayed: boolean, random: () => number, cp: number, mate: { winner: Color; moves: number } | null): { line: EvalLine; san: San[] } {
  const chess = new Chess(fen)
  const legal = chess.moves({ verbose: true })
  let first = legal.find((m) => m.san === playedSan)
  if (!keepPlayed || !first) {
    const others = legal.filter((m) => m.san !== playedSan)
    const captures = others.filter((m) => m.captured)
    const pool = captures.length && random() < 0.5 ? captures : others.length ? others : legal
    first = pool[Math.floor(random() * pool.length)]
  }
  const pv: Uci[] = []
  const san: San[] = []
  let m: Move | undefined = first
  for (let i = 0; m && i < 5; i++) {
    chess.move(m.san)
    pv.push(m.lan as Uci)
    san.push(m.san as San)
    const next = chess.moves({ verbose: true })
    m = next.length ? next[Math.floor(random() * next.length)] : undefined
  }
  return { line: { score: scoreFromCp(cp, mate), pv: pv as unknown as NonEmpty<Uci> }, san }
}

/** Fabricated evals: a seeded walk biased toward the result, with a few sharp swings so every classification shows up. */
function fabricateCps(game: Game): number[] {
  const random = rng(hash(game.id))
  const n = game.moves.length
  const bias = game.result === '1-0' ? 1 : game.result === '0-1' ? -1 : 0
  const cps: number[] = [20]
  let cp = 20
  for (let i = 0; i < n; i++) {
    const mover = game.moves[i].mover
    const r = random()
    let delta = (random() - 0.5) * 30
    if (r < 0.08) delta = (mover === 'w' ? -1 : 1) * (150 + random() * 300)
    else if (r < 0.2) delta = (mover === 'w' ? -1 : 1) * (50 + random() * 60)
    else if (r < 0.3) delta = (mover === 'w' ? 1 : -1) * (40 + random() * 80)
    const pull = bias * (i / n) * 12
    cp = Math.max(-1500, Math.min(1500, cp + delta + pull))
    cps.push(cp)
  }
  return cps
}

async function fabricateReview(game: Game, who: Perspective): Promise<GameReview> {
  const openings = await book()
  const random = rng(hash(game.id) ^ 0x9e3779b9)
  const cps = fabricateCps(game)
  const last = game.positions[game.positions.length - 1]
  const mateAt = (idx: number): { winner: Color; moves: number } | null => {
    if (last.kind !== 'checkmate') return null
    const left = game.moves.length - idx
    if (left > 6) return null
    const winner: Color = last.turn === 'w' ? 'b' : 'w'
    return { winner, moves: Math.max(1, Math.ceil(left / 2)) }
  }
  const whiteWinAt = (idx: number): number => {
    const p = game.positions[idx]
    if (p.kind === 'checkmate') return p.turn === 'w' ? 2.5 : 97.5
    if (p.kind === 'stalemate') return 50
    const m = mateAt(idx)
    return m ? (m.winner === 'w' ? 97.5 : 2.5) : winFromCp(cps[idx])
  }

  let inBook = true
  let lastOpening: Opening | null = null
  const reviews: MoveReview[] = []
  for (const move of game.moves) {
    const entry = openings[epd(move.after.fen)]
    inBook = inBook && entry !== undefined
    if (inBook && entry) lastOpening = { eco: entry[0], name: entry[1] }
    const wbWhite = whiteWinAt(move.index)
    const waWhite = whiteWinAt(move.index + 1)
    const wb = move.mover === 'w' ? wbWhite : 100 - wbWhite
    const wa = move.mover === 'w' ? waWhite : 100 - waWhite
    const loss = Math.max(0, wb - wa)
    const mates = move.after.kind === 'checkmate'
    const forced = move.before.legalMoves === 1
    const sacrifice = move.captured === null && move.piece !== 'p' && move.piece !== 'k' && random() < 0.12
    let classification: Classification
    if (inBook) classification = 'book'
    else if (mates || forced) classification = 'best'
    else if (loss === 0 && sacrifice) classification = 'brilliant'
    else if (loss === 0 && wa - wb > 10 && random() < 0.5) classification = 'great'
    else if (loss < 1 && random() < 0.6) classification = 'best'
    else if (loss < 2) classification = 'excellent'
    else if (loss < 5) classification = 'good'
    else if (loss < 10) classification = 'inaccuracy'
    else if (loss < 20) classification = wb >= 60 && random() < 0.4 ? 'miss' : 'mistake'
    else classification = 'blunder'
    const keepPlayed = ['book', 'best', 'brilliant', 'great'].includes(classification)
    const best = fabricateLine(move.before.fen, move.san, keepPlayed, random, cps[move.index + (keepPlayed ? 1 : 0)], mateAt(move.index + 1))
    const alt = move.before.legalMoves > 1 ? fabricateLine(move.before.fen, best.san[0], false, random, cps[move.index] - 40, null).line : null
    reviews.push({
      move,
      classification,
      winBefore: wb as WinPct,
      winAfter: wa as WinPct,
      accuracy: moveAccuracy(wb, wa) as AccuracyPct,
      best: best.line,
      bestLineSan: best.san,
      alternative: alt,
      opening: inBook ? lastOpening : null,
    })
  }

  const graph = game.positions.map((p, i): GraphPoint => {
    const whiteWin = whiteWinAt(i) as WinPct
    const label = p.kind === 'checkmate' ? '#' : p.kind === 'stalemate' ? '½' : scoreLabel(scoreFromCp(cps[i], mateAt(i)))
    return { index: i, whiteWin, label }
  }) as unknown as NonEmpty<GraphPoint>

  const division = divide(game.positions.map((p) => p.fen))
  const mean = (rs: readonly MoveReview[]) => (rs.length ? (rs.reduce((s, r) => s + r.accuracy, 0) / rs.length) as AccuracyPct : null)
  const summary = (c: Color): PlayerSummary => {
    const mine = reviews.filter((r) => r.move.mover === c)
    const counts = Object.fromEntries(CLASSIFICATIONS.map((k) => [k, mine.filter((r) => r.classification === k).length])) as Record<Classification, number>
    const accuracy = mean(mine)
    const phase = (p: Phase): PhaseSummary => {
      const inPhase = mine.filter((r) => phaseAt(division, r.move.index + 1) === p)
      const a = inPhase.length < MIN_PHASE_MOVES ? null : mean(inPhase)
      return { moves: inPhase.length, accuracy: a, elo: a === null ? null : estimateElo(a, p) }
    }
    return {
      player: game.players[c],
      accuracy,
      elo: accuracy === null || movesOutsideTheory(counts) < MIN_MOVES_OUTSIDE_THEORY ? null : estimateElo(accuracy, 'game'),
      counts,
      phases: { opening: phase('opening'), middlegame: phase('middlegame'), endgame: phase('endgame') },
    }
  }

  return {
    game,
    profile: PROFILE,
    perspective: who,
    classifierVersion: CLASSIFIER_VERSION,
    moves: reviews,
    players: { w: summary('w'), b: summary('b') },
    graph,
    keyMoments: keyMoments(reviews),
    opening: lastOpening,
    division,
  }
}

const DAY = 86_400_000
type Seed = { pgn: string; white: string; black: string; result: GameResult; daysAgo: number; tc: string; source: 'lichess' | 'chesscom' | 'pgn' }
const SEEDS: readonly Seed[] = [
  { pgn: operaPgn, white: 'Paul Morphy', black: 'Duke Karl / Count Isouard', result: '1-0', daysAgo: 1, tc: '-', source: 'pgn' },
  { pgn: scholarPgn, white: USER, black: 'Oponente', result: '1-0', daysAgo: 2, tc: '180+2', source: 'pgn' },
  { pgn: operaPgn, white: USER, black: 'xadrezista77', result: '1-0', daysAgo: 4, tc: '600+5', source: 'lichess' },
  { pgn: operaPgn, white: 'MariaTorre', black: USER, result: '1-0', daysAgo: 7, tc: '300+3', source: 'chesscom' },
  { pgn: scholarPgn, white: 'cavalo_negro', black: USER, result: '1-0', daysAgo: 11, tc: '180', source: 'lichess' },
  { pgn: operaPgn, white: USER, black: 'peao_passado', result: '1/2-1/2', daysAgo: 15, tc: '900+10', source: 'lichess' },
  { pgn: operaPgn, white: 'Dama_Branca', black: USER, result: '0-1', daysAgo: 21, tc: '600', source: 'chesscom' },
  { pgn: scholarPgn, white: USER, black: 'rookie_99', result: '1-0', daysAgo: 30, tc: '60+1', source: 'lichess' },
]

function gameFromSeed(s: Seed, i: number, now: number): Game {
  const chess = new Chess()
  chess.loadPgn(s.pgn)
  chess.setHeader('White', s.white)
  chess.setHeader('Black', s.black)
  chess.setHeader('Result', s.result)
  chess.setHeader('TimeControl', s.tc)
  chess.setHeader('WhiteElo', String(1400 + ((i * 37) % 300)))
  chess.setHeader('BlackElo', String(1400 + ((i * 53) % 300)))
  const d = new Date(now - s.daysAgo * DAY)
  chess.setHeader('UTCDate', d.toISOString().slice(0, 10).replace(/-/g, '.'))
  chess.setHeader('UTCTime', d.toISOString().slice(11, 19))
  const source: GameSource =
    s.source === 'lichess' ? { kind: 'lichess', id: `mock${i}abcd`, url: `https://lichess.org/mock${i}abcd` }
    : s.source === 'chesscom' ? { kind: 'chesscom', uuid: `mock-${i}-uuid`, url: `https://www.chess.com/game/live/${1000 + i}` }
    : { kind: 'pgn' }
  const r = gameFromPgn(chess.pgn(), source)
  if (!r.ok) throw new Error(`seed ${i}: ${r.error.detail}`)
  return r.value
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Settings) }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_SETTINGS, identity: { accounts: [{ site: 'any', username: USER }] } }
}

export function createMockServices(): Services {
  const now = Date.now()
  const records = new Map<GameId, LibraryRecord>()
  const identity = (): Identity => loadSettings().identity

  const items = new Map<TrainingItemId, TrainingItem>()
  const sync = (review: GameReview, at: number) => {
    const { put, remove } = syncItems([...items.values()].filter((i) => i.gameId === review.game.id), review, at)
    for (const id of remove) items.delete(id)
    for (const i of put) items.set(i.id, i)
  }

  // Older seeds' items were answered before, so some come due today and some later.
  const seeded = Promise.all(
    SEEDS.map(async (s, i) => {
      const game = gameFromSeed(s, i, now)
      const review = await fabricateReview(game, perspective(identity(), game.players, game.source))
      const at = now - s.daysAgo * DAY + 3_600_000
      records.set(game.id, libraryRecord(review, at))
      sync(review, at)
    }),
  ).then(() => {
    let n = 0
    for (const item of items.values()) {
      if (n++ % 3 === 0) items.set(item.id, { ...item, schedule: { box: 2, due: now + (n % 5 + 1) * DAY, last: { at: now - 3 * DAY, correct: true } } })
    }
  })

  const library: Services['library'] = {
    async put(review, at) {
      records.set(review.game.id, libraryRecord(review, at))
      sync(review, at)
    },
    async list() {
      await seeded
      return [...records.values()].sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0))
    },
    async unreadable() {
      return 0
    },
    async get(id) {
      await seeded
      return records.get(id) ?? null
    },
    async remove(id) {
      records.delete(id)
      for (const i of items.values()) if (i.gameId === id) items.delete(i.id)
    },
  }

  const backup: Services['backup'] = {
    async export(settings, at) {
      await seeded
      return JSON.stringify(buildBackup({ games: [...records.values()], training: [...items.values()], puzzles: [] }, settings, at), null, 2)
    },
    async import(text, current) {
      await seeded
      const plan = planImport(text, { games: [...records.values()], training: [...items.values()], puzzles: [] }, current)
      if (!plan.ok) return plan
      for (const r of plan.value.put) records.set(r.id, r)
      for (const i of plan.value.training) items.set(i.id, i)
      for (const id of plan.value.drop) items.delete(id)
      return { ok: true, value: plan.value.report }
    },
  }

  const training: Services['training'] = {
    async list() {
      await seeded
      return [...items.values()]
    },
    async answer(id, correct, at) {
      const item = items.get(id)
      if (item) items.set(id, { ...item, schedule: nextSchedule(item.schedule, correct, at) })
    },
    // Any move the stored lines can't settle comes back as good as the best one.
    check: (item, move, signal) => checkAnswer(item, move, async () => {
      await sleep(600, signal)
      return { depth: 18, lines: [item.best] }
    }),
  }

  return {
    training,
    async engineMove(input, _level, signal) {
      await sleep(250 + Math.random() * 350, signal)
      return mockMove(input)
    },
    loadPlay,
    savePlay,
    loadSettings,
    saveSettings(s) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
    },
    runtimeEnv() {
      return { crossOriginIsolated: globalThis.crossOriginIsolated ?? false, cores: navigator.hardwareConcurrency || 4 }
    },
    library,
    backup,
    parsePgnText,
    async fetchRecentGames(site, username, { max, signal }): Promise<Result<ImportResult, FetchFailure>> {
      await sleep(900, signal)
      const u = username.trim().toLowerCase()
      if (u === 'nada') return { ok: false, error: { kind: 'not-found' } }
      if (u === 'limite') return { ok: false, error: { kind: 'rate-limited', retryAfterS: 60 } }
      if (u === 'rede') return { ok: false, error: { kind: 'network', detail: 'Failed to fetch' } }
      if (u === 'ruim') return { ok: false, error: { kind: 'bad-response', detail: 'HTTP 502 Bad Gateway' } }
      const games = SEEDS.slice(0, max).map((s, i) => {
        const other = s.white === USER ? s.black : s.white
        return gameFromSeed({ ...s, white: i % 2 ? other : username, black: i % 2 ? username : other, source: site }, i + 100, now)
      })
      return { ok: true, value: { games, rejected: [] } }
    },
    gameFromRecord(record) {
      return gameFromPgn(record.pgn, record.source)
    },
    async *reviewGame(game, signal): AsyncIterable<ReviewState> {
      const settings = loadSettings()
      const who = perspective(settings.identity, game.players, game.source)
      const playable = game.positions.filter((p): p is PlayablePosition => p.kind === 'playable')
      const total = playable.length
      const series: (WinPct | null)[] = game.positions.map((p) => (p.kind === 'checkmate' ? ((p.turn === 'w' ? 2.5 : 97.5) as WinPct) : p.kind === 'stalemate' ? (50 as WinPct) : null))
      const cps = fabricateCps(game)
      const fails = settings.engine.kind === 'bridge' && settings.engine.url.includes('falha')
      const loadTotal = settings.engine.kind === 'wasm' && settings.engine.flavor === 'full' ? 99_076_105 : 1_845_971
      const asSeries = (): PartialSeries => [...series]
      try {
        for (let step = 0; step <= 5; step++) {
          yield { phase: 'analyzing', done: 0, total, progress: 0, engine: { kind: 'loading', loaded: Math.round((loadTotal * step) / 5), total: loadTotal }, series: asSeries() }
          await sleep(140, signal)
        }
        for (let i = 0; i < playable.length; i++) {
          const p = playable[i]
          if (fails && i === 3) {
            yield { phase: 'failed', failure: { kind: 'unavailable', why: 'bridge-unreachable' }, series: asSeries() }
            return
          }
          for (let d = 6; d < 18; d += 4) {
            yield { phase: 'analyzing', done: i, total, progress: (i + d / 18) / total, engine: { kind: 'searching' }, series: asSeries() }
            await sleep(25, signal)
          }
          series[p.index] = winFromCp(cps[p.index]) as WinPct
          yield { phase: 'analyzing', done: i + 1, total, progress: (i + 1) / total, engine: { kind: 'searching' }, series: asSeries() }
        }
        const review = await fabricateReview(game, who)
        await library.put(review, Date.now())
        yield { phase: 'done', review, saved: true }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        throw e
      }
    },
    async evaluatePosition(p, signal): Promise<SearchedEval> {
      await sleep(400, signal)
      const random = rng(hash(p.key))
      const cp = Math.round((random() - 0.5) * 300)
      const best = fabricateLine(p.fen, null, false, random, cp, null).line
      if (p.legalMoves < 2) return { lines: [best], depth: 18 }
      return { lines: [best, fabricateLine(p.fen, null, false, random, cp - 40, null).line], depth: 18 }
    },
    accuracyHistory,
    async probeBridge(url, signal): Promise<Result<readonly BridgeEngine[], BridgeProbeError>> {
      await sleep(600, signal)
      if (url.includes('nada')) return { ok: false, error: { kind: 'unreachable' } }
      if (url.includes('recusa')) return { ok: false, error: { kind: 'refused' } }
      return { ok: true, value: [{ name: 'sf19', idName: 'Stockfish 19' }, { name: 'lc0', idName: 'Lc0 v0.31' }] }
    },
  }
}
