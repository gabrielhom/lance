import type { Square } from 'chess.js'

declare const tag: unique symbol
export type Brand<T, B extends string> = T & { readonly [tag]: B }
export type NonEmpty<T> = readonly [T, ...T[]]
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export type Color = 'w' | 'b'
export type ByColor<T> = { readonly w: T; readonly b: T }
export type PieceKind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type { Square }
export type Fen = Brand<string, 'Fen'>
export type Uci = Brand<string, 'Uci'>
export type San = Brand<string, 'San'>

/** What the engine is told: the position after the last pawn move or capture, then every move since.
 *  No earlier position can recur, so repetition and the 50-move counter survive. */
export type EngineInput = { readonly root: Fen; readonly tail: readonly Uci[] }
/** `${root}|${tail.join(' ')}`, derived from EngineInput only. */
export type PositionKey = Brand<string, 'PositionKey'>

type PositionBase = { readonly index: number; readonly fen: Fen; readonly turn: Color }
export type PlayablePosition = PositionBase & {
  readonly kind: 'playable'
  readonly input: EngineInput
  readonly key: PositionKey
  readonly legalMoves: number
}
/** Never sent to an engine, so `mate 0` never enters the domain. Draws by rule are still playable positions. */
export type TerminalPosition = PositionBase & { readonly kind: 'checkmate' | 'stalemate' }
export type Position = PlayablePosition | TerminalPosition

export type PlayedMove = {
  readonly index: number
  readonly mover: Color
  readonly san: San
  readonly uci: Uci
  readonly from: Square
  readonly to: Square
  readonly piece: PieceKind
  readonly captured: PieceKind | null
  readonly promotion: PieceKind | null
  readonly before: PlayablePosition
  readonly after: Position
}

export type GameId = Brand<string, 'GameId'>
export type GameSource =
  | { readonly kind: 'lichess'; readonly id: string; readonly url: string }
  | { readonly kind: 'chesscom'; readonly uuid: string; readonly url: string }
  | { readonly kind: 'pgn' }
export type PlayerTag = { readonly name: string; readonly rating: number | null }
export type GameResult = '1-0' | '0-1' | '1/2-1/2' | '*'
export type Game = {
  readonly id: GameId
  readonly source: GameSource
  readonly players: ByColor<PlayerTag>
  readonly result: GameResult
  readonly playedAt: number | null
  readonly timeControl: string | null
  readonly pgn: string
  /** length === moves.length + 1; positions[i] === moves[i].before */
  readonly positions: NonEmpty<Position>
  readonly moves: readonly PlayedMove[]
}
export type GameRejection = { readonly kind: 'unparseable' | 'variant' | 'no-moves'; readonly detail: string }

/** No sign convention to get wrong: cp is from White's side, mate names its winner. moves >= 1. */
export type Score =
  | { readonly kind: 'cp'; readonly white: number }
  | { readonly kind: 'mate'; readonly winner: Color; readonly moves: number }
export type EvalLine = { readonly score: Score; readonly pv: NonEmpty<Uci> }
/** Lines from one completed depth, best first. One line only when the position has one legal move. */
export type SearchedEval = {
  readonly lines: readonly [EvalLine] | readonly [EvalLine, EvalLine]
  readonly depth: number
}
export type PositionEval =
  | ({ readonly kind: 'searched' } & SearchedEval)
  | { readonly kind: 'checkmate'; readonly loser: Color }
  | { readonly kind: 'stalemate' }

/** Identifies the evaluation function, not its speed: 'sf19/nn-61e7af4bb97d' (lite), 'sf19/nn-1a298aa575a0' (full), 'uci/<id name>'. */
export type EngineId = Brand<string, 'EngineId'>
export type SearchLimit =
  | { readonly kind: 'depth'; readonly depth: number }
  | { readonly kind: 'movetime'; readonly ms: number }
/** The cache namespace. MultiPV is fixed at 2. Threads, Hash and pool size are left out. */
export type AnalysisProfile = { readonly engine: EngineId; readonly limit: SearchLimit }

export type Account = { readonly site: 'lichess' | 'chesscom' | 'any'; readonly username: string }
export type Identity = { readonly accounts: readonly Account[] }
export type Perspective = { readonly kind: 'me'; readonly color: Color } | { readonly kind: 'spectator' }

export type WinPct = Brand<number, 'WinPct'>
export type AccuracyPct = Brand<number, 'AccuracyPct'>
export const CLASSIFICATIONS = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder', 'miss',
] as const
export type Classification = (typeof CLASSIFICATIONS)[number]
export type Opening = { readonly eco: string; readonly name: string }

export type MoveReview = {
  readonly move: PlayedMove
  readonly classification: Classification
  /** Mover's view. winBefore from the best line at `before`, winAfter from the eval at `after`. */
  readonly winBefore: WinPct
  readonly winAfter: WinPct
  readonly accuracy: AccuracyPct
  readonly best: EvalLine
  /** best.pv in SAN from `move.before`, for display. */
  readonly bestLineSan: readonly San[]
  readonly alternative: EvalLine | null
  readonly opening: Opening | null
}
export type PlayerSummary = {
  readonly player: PlayerTag
  readonly accuracy: AccuracyPct | null
  readonly counts: Readonly<Record<Classification, number>>
}
/** label: '+1.3' | '-0.4' | 'M3' | '-M3' (from White) | '#' | '½' */
export type GraphPoint = { readonly index: number; readonly whiteWin: WinPct; readonly label: string }
export type KeyMoment = { readonly move: MoveReview; readonly swing: number; readonly why: 'turning-point' | Classification }
export type GameReview = {
  readonly game: Game
  readonly profile: AnalysisProfile
  readonly perspective: Perspective
  readonly classifierVersion: number
  readonly moves: readonly MoveReview[]
  readonly players: ByColor<PlayerSummary>
  readonly graph: NonEmpty<GraphPoint>
  readonly keyMoments: readonly KeyMoment[]
  readonly opening: Opening | null
}

/** `lookup` answers only for named positions. `has` also knows the unnamed positions between them. */
export interface OpeningBook {
  has(fen: Fen): boolean
  lookup(fen: Fen): Opening | null
}

export const WASM_FLAVORS = {
  lite: { script: 'stockfish-19-lite-single.js', net: 'nn-61e7af4bb97d', threaded: false, bytes: 1_845_971 },
  full: { script: 'stockfish-19.js', net: 'nn-1a298aa575a0', threaded: true, bytes: 99_076_105 },
} as const
export type WasmFlavor = keyof typeof WASM_FLAVORS
export type EngineDescriptor =
  | { readonly kind: 'wasm'; readonly flavor: WasmFlavor }
  | { readonly kind: 'bridge'; readonly url: string; readonly name: string; readonly idName: string }
export type EngineTuning = { readonly engines: number; readonly threadsPerEngine: number; readonly hashMb: number }
export type RuntimeEnv = { readonly crossOriginIsolated: boolean; readonly cores: number }

export type EvalProgress =
  | { readonly kind: 'engine-loading'; readonly loaded: number; readonly total: number }
  | { readonly kind: 'depth'; readonly depth: number }
export type EngineFailureReason =
  | { readonly kind: 'unavailable'; readonly why: 'needs-cross-origin-isolation' | 'bridge-unreachable' | 'bridge-refused' }
  | { readonly kind: 'mismatch'; readonly expected: string; readonly got: string }
  | { readonly kind: 'crashed'; readonly detail: string }
  | { readonly kind: 'protocol'; readonly detail: string }
  | { readonly kind: 'timeout'; readonly during: 'handshake' | 'search' }

/** An AnalysisProfile made live. Safe to call concurrently; it queues internally and answers cache hits without booting.
 *  Rejects with DOMException('AbortError') or EngineFailure. */
export interface Evaluator {
  readonly profile: AnalysisProfile
  evaluate(p: PlayablePosition, signal: AbortSignal, onProgress?: (e: EvalProgress) => void): Promise<SearchedEval>
  dispose(): void
}
export type EvalKey = Brand<string, 'EvalKey'>
export interface EvalCache {
  get(key: EvalKey): Promise<SearchedEval | null>
  put(key: EvalKey, value: SearchedEval): Promise<void>
}

export type EngineActivity =
  | { readonly kind: 'not-needed' }
  | { readonly kind: 'loading'; readonly loaded: number; readonly total: number }
  | { readonly kind: 'searching' }
/** White win% per position index; null while pending. */
export type PartialSeries = readonly (WinPct | null)[]
export type ReviewState =
  | {
      readonly phase: 'analyzing'
      readonly done: number
      readonly total: number
      readonly progress: number
      readonly engine: EngineActivity
      readonly series: PartialSeries
    }
  | { readonly phase: 'done'; readonly review: GameReview; readonly saved: boolean }
  | { readonly phase: 'failed'; readonly failure: EngineFailureReason; readonly series: PartialSeries }

export type ReviewSummary = {
  readonly classifierVersion: number
  readonly accuracy: ByColor<number | null>
  readonly counts: ByColor<Readonly<Record<Classification, number>>>
  readonly opening: Opening | null
}
export type LibraryRecord = {
  readonly v: 1
  readonly id: GameId
  readonly source: GameSource
  readonly players: ByColor<PlayerTag>
  readonly result: GameResult
  readonly playedAt: number | null
  readonly reviewedAt: number
  readonly pgn: string
  readonly profile: AnalysisProfile
  readonly summary: ReviewSummary
}
export interface Library {
  put(review: GameReview, now: number): Promise<void>
  list(): Promise<readonly LibraryRecord[]>
  get(id: GameId): Promise<LibraryRecord | null>
  remove(id: GameId): Promise<void>
}
export type Store = { readonly evals: EvalCache; readonly library: Library }

export type Settings = {
  readonly v: 1
  readonly identity: Identity
  readonly engine: EngineDescriptor
  readonly limit: SearchLimit
  readonly tuning: EngineTuning
}
export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  identity: { accounts: [] },
  engine: { kind: 'wasm', flavor: 'lite' },
  limit: { kind: 'depth', depth: 18 },
  tuning: { engines: 4, threadsPerEngine: 1, hashMb: 32 },
}

export type ImportResult = {
  readonly games: readonly Game[]
  readonly rejected: readonly { readonly index: number; readonly rejection: GameRejection }[]
}
export type FetchFailure =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'rate-limited'; readonly retryAfterS: number | null }
  | { readonly kind: 'network'; readonly detail: string }
  | { readonly kind: 'bad-response'; readonly detail: string }
export type AccuracyPoint = {
  readonly gameId: GameId
  readonly playedAt: number
  readonly color: Color
  readonly accuracy: number
  readonly result: GameResult
  readonly opponent: PlayerTag
}
export type BridgeEngine = { readonly name: string; readonly idName: string }
export type BridgeProbeError = { readonly kind: 'unreachable' } | { readonly kind: 'refused' } | { readonly kind: 'not-uci'; readonly detail: string }

/** Everything the UI needs from the rest of the app. src/app/services.ts builds the real one. */
export interface Services {
  loadSettings(): Settings
  saveSettings(s: Settings): void
  runtimeEnv(): RuntimeEnv
  readonly library: Library
  parsePgnText(text: string): ImportResult
  fetchRecentGames(
    site: 'lichess' | 'chesscom',
    username: string,
    opts: { readonly max: number; readonly signal: AbortSignal },
  ): Promise<Result<ImportResult, FetchFailure>>
  gameFromRecord(record: LibraryRecord): Result<Game, GameRejection>
  /** Uses the engine and identity from the current settings, saves to the library when done. Ends silently on abort. */
  reviewGame(game: Game, signal: AbortSignal): AsyncIterable<ReviewState>
  accuracyHistory(records: readonly LibraryRecord[], identity: Identity): readonly AccuracyPoint[]
  probeBridge(url: string, signal: AbortSignal): Promise<Result<readonly BridgeEngine[], BridgeProbeError>>
  /** Uses the engine from the current settings. */
  engineMove(input: EngineInput, level: PlayLevel, signal: AbortSignal): Promise<Uci>
  /** The game in progress survives a reload. null clears it. */
  loadPlay(): PlayState | null
  savePlay(state: PlayState | null): void
}

/** How strong the engine plays. Engines without UCI_Elo fall back to Skill Level, and without both play at full strength. */
export type Strength =
  | { readonly kind: 'skill'; readonly level: number }
  | { readonly kind: 'elo'; readonly elo: number }
  | { readonly kind: 'max' }
export type PlayLevel = {
  readonly id: number
  readonly name: string
  /** Approximate rating shown to the player, e.g. '~1500'. */
  readonly rating: string
  readonly strength: Strength
  readonly movetimeMs: number
}
/** Picks moves for play. Separate workers from the Evaluator, MultiPV 1, never cached. Rejects like Evaluator. */
export interface MovePicker {
  pick(input: EngineInput, level: PlayLevel, signal: AbortSignal): Promise<Uci>
  dispose(): void
}

export type TimeControl =
  | { readonly kind: 'none' }
  | { readonly kind: 'clock'; readonly initialMs: number; readonly incrementMs: number }
export type Opponent = { readonly kind: 'engine'; readonly levelId: number } | { readonly kind: 'local' }
export type PlaySetup = {
  readonly opponent: Opponent
  /** The side at the bottom of the board. Against the engine it is the player's side. */
  readonly you: Color
  readonly time: TimeControl
}
export type Termination =
  | 'checkmate' | 'stalemate' | 'repetition' | 'fifty-move' | 'insufficient-material' | 'resignation' | 'timeout'
/** Clock times are remaining ms when the side to move started thinking; `turnStartedAt` is a Date.now() stamp. */
type PlayBase = {
  readonly id: string
  readonly setup: PlaySetup
  readonly startedAt: number
  readonly moves: readonly Uci[]
  readonly clocks: ByColor<number> | null
}
export type PlayState =
  | (PlayBase & { readonly phase: 'playing'; readonly turnStartedAt: number })
  | (PlayBase & {
      readonly phase: 'over'
      readonly endedAt: number
      readonly result: Exclude<GameResult, '*'>
      readonly termination: Termination
    })
export type PlayEvent =
  | { readonly kind: 'move'; readonly uci: Uci; readonly at: number }
  | { readonly kind: 'resign'; readonly by: Color; readonly at: number }
  /** Sent by the UI timer; the reducer ends the game only if the side to move really ran out. */
  | { readonly kind: 'flag'; readonly at: number }
  /** Undoes the player's last move and the engine's reply. Only while playing and only against the engine. */
  | { readonly kind: 'takeback'; readonly at: number }
