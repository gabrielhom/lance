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

export interface OpeningBook {
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
