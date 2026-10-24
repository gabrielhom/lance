import { Chess, type Move } from 'chess.js'
import type {
  ByColor,
  Color,
  EngineInput,
  Fen,
  GameResult,
  PlayEvent,
  PlaySetup,
  PlayState,
  San,
  Square,
  Termination,
  Uci,
} from '../domain/types'

type Playing = Extract<PlayState, { phase: 'playing' }>
type Ending = { readonly result: Exclude<GameResult, '*'>; readonly termination: Termination }

const UCI = /^([a-h][1-8])([a-h][1-8])([nbrq])?$/

export function newPlay(setup: PlaySetup, now: number): PlayState {
  return {
    id: `play:${now.toString(36)}`,
    setup,
    startedAt: now,
    moves: [],
    clocks: setup.time.kind === 'clock' ? { w: setup.time.initialMs, b: setup.time.initialMs } : null,
    phase: 'playing',
    turnStartedAt: now,
  }
}

/** Pure. Any event that does not apply to the state (illegal move, game over, takeback with nothing to take) returns it unchanged. */
export function reducePlay(state: PlayState, event: PlayEvent): PlayState {
  if (state.phase !== 'playing') return state
  switch (event.kind) {
    case 'move':
      return move(state, event.uci, event.at)
    case 'resign':
      return over(state, state.moves, clocksAt(state, event.at), event.at, { result: winFor(other(event.by)), termination: 'resignation' })
    case 'flag':
      return outOfTime(state, event.at) ? timeout(state, replay(state.moves), event.at) : state
    case 'takeback':
      return takeback(state, event.at)
  }
}

export function turnOf(state: Pick<PlayState, 'moves'>): Color {
  return state.moves.length % 2 === 0 ? 'w' : 'b'
}

/** Each side's first move is free, so nobody loses time while the board appears or the engine boots. */
export function clockRunning(state: PlayState): boolean {
  return state.phase === 'playing' && state.clocks !== null && state.moves.length >= 2
}

/** Remaining ms per side at `now`, never below zero. */
export function clocksAt(state: PlayState, now: number): ByColor<number> | null {
  const { clocks } = state
  if (!clocks || !clockRunning(state) || state.phase !== 'playing') return clocks
  const turn = turnOf(state)
  return { ...clocks, [turn]: Math.max(0, clocks[turn] - Math.max(0, now - state.turnStartedAt)) }
}

function outOfTime(state: Playing, at: number): boolean {
  return clockRunning(state) && clocksAt(state, at)![turnOf(state)] <= 0
}

function move(state: Playing, uci: Uci, at: number): PlayState {
  const board = replay(state.moves)
  const mover = board.turn()
  if (outOfTime(state, at)) return timeout(state, board, at)
  if (!tryMove(board, uci)) return state
  const moves = [...state.moves, uci]
  const clocks = clocksAt(state, at)
  const increment = state.setup.time.kind === 'clock' && clockRunning(state) ? state.setup.time.incrementMs : 0
  const next = clocks && { ...clocks, [mover]: clocks[mover] + increment }
  const ending = endingOf(board)
  if (ending) return over(state, moves, next, at, ending)
  return { ...state, moves, clocks: next, turnStartedAt: at }
}

function takeback(state: Playing, at: number): PlayState {
  if (state.setup.opponent.kind !== 'engine') return state
  const mine = state.setup.you === 'w' ? 0 : 1
  let last = state.moves.length - 1
  while (last >= 0 && last % 2 !== mine) last--
  if (last < 0 || outOfTime(state, at)) return state
  return { ...state, moves: state.moves.slice(0, last), clocks: clocksAt(state, at), turnStartedAt: at }
}

/** FIDE 6.9: running out of time only loses if the opponent could still mate. Here that means more than a lone minor piece. */
function timeout(state: Playing, board: Chess, at: number): PlayState {
  const loser = board.turn()
  const winner = other(loser)
  const clocks = clocksAt(state, at)!
  const result = canMate(board, winner) ? winFor(winner) : '1/2-1/2'
  return over(state, state.moves, { ...clocks, [loser]: 0 }, at, { result, termination: 'timeout' })
}

function canMate(board: Chess, color: Color): boolean {
  let minors = 0
  for (const row of board.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== color) continue
      if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') return true
      if (sq.type === 'n' || sq.type === 'b') minors++
    }
  }
  return minors >= 2
}

const DRAWS: readonly (readonly [Termination, (b: Chess) => boolean])[] = [
  ['stalemate', (b) => b.isStalemate()],
  ['insufficient-material', (b) => b.isInsufficientMaterial()],
  ['repetition', (b) => b.isThreefoldRepetition()],
  ['fifty-move', (b) => b.isDrawByFiftyMoves()],
]

function endingOf(board: Chess): Ending | null {
  if (board.isCheckmate()) return { result: winFor(other(board.turn())), termination: 'checkmate' }
  const draw = DRAWS.find(([, test]) => test(board))
  return draw ? { result: '1/2-1/2', termination: draw[0] } : null
}

function over(state: Playing, moves: readonly Uci[], clocks: ByColor<number> | null, at: number, ending: Ending): PlayState {
  return { id: state.id, setup: state.setup, startedAt: state.startedAt, moves, clocks, phase: 'over', endedAt: at, ...ending }
}

function other(c: Color): Color {
  return c === 'w' ? 'b' : 'w'
}

function winFor(c: Color): '1-0' | '0-1' {
  return c === 'w' ? '1-0' : '0-1'
}

/** Applies `uci` if it is legal and spelled canonically (no promotion letter on a plain move). */
function tryMove(board: Chess, uci: string): Move | null {
  const m = UCI.exec(uci)
  if (!m) return null
  try {
    const played = board.move({ from: m[1], to: m[2], promotion: m[3] })
    if (played.lan === uci) return played
    board.undo()
    return null
  } catch {
    return null
  }
}

/** The board after `moves`, or null if one of them is illegal. */
export function tryReplay(moves: readonly string[]): Chess | null {
  const board = new Chess()
  return moves.every((u) => tryMove(board, u)) ? board : null
}

export function replay(moves: readonly Uci[]): Chess {
  const board = tryReplay(moves)
  if (!board) throw new Error(`illegal move list: ${moves.join(' ')}`)
  return board
}

/** A legal destination. A promotion needs its piece letter appended before it is a move. */
type Target = { readonly to: Square; readonly promotion: boolean }

/** Everything the board and move list read about the current position, derived once per move list. */
export type PlayPosition = {
  readonly fen: Fen
  readonly turn: Color
  readonly check: boolean
  readonly kingSquare: Square
  readonly lastMove: { readonly from: Square; readonly to: Square } | null
  readonly sans: readonly San[]
  readonly targets: ReadonlyMap<Square, readonly Target[]>
  readonly input: EngineInput
  /** Material on the board, pawns 1 to queens 9. */
  readonly material: ByColor<number>
}

const VALUE: Readonly<Record<string, number>> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export function playPosition(moves: readonly Uci[]): PlayPosition {
  const board = replay(moves)
  const history = board.history({ verbose: true })
  const targets = new Map<Square, Target[]>()
  for (const m of board.moves({ verbose: true })) {
    const list = targets.get(m.from) ?? []
    if (!m.promotion || m.promotion === 'q') list.push({ to: m.to, promotion: !!m.promotion })
    targets.set(m.from, list)
  }
  let kingSquare: Square = 'e1'
  const material = { w: 0, b: 0 }
  for (const row of board.board()) {
    for (const sq of row) {
      if (!sq) continue
      material[sq.color] += VALUE[sq.type]
      if (sq.type === 'k' && sq.color === board.turn()) kingSquare = sq.square
    }
  }
  const last = history.at(-1)
  return {
    fen: board.fen() as Fen,
    turn: board.turn(),
    check: board.inCheck(),
    kingSquare,
    lastMove: last ? { from: last.from, to: last.to } : null,
    sans: history.map((m) => m.san as San),
    targets,
    input: engineInput(history),
    material,
  }
}

/** Same rule as gameFromPgn: the root is the position after the last pawn move or capture, the tail is every move since. */
function engineInput(history: readonly Move[]): EngineInput {
  const reset = history.findLastIndex((m) => m.piece === 'p' || !!m.captured)
  const root = reset < 0 ? (history[0]?.before ?? new Chess().fen()) : history[reset].after
  return { root: root as Fen, tail: history.slice(reset + 1).map((m) => m.lan as Uci) }
}
