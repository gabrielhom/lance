import { Chess, type Move } from 'chess.js'
import type {
  ByColor,
  EngineInput,
  Fen,
  Game,
  GameId,
  GameRejection,
  GameResult,
  GameSource,
  NonEmpty,
  PlayablePosition,
  PlayedMove,
  PlayerTag,
  Position,
  PositionKey,
  Result,
  San,
  Uci,
} from './types'

const PLAYABLE_VARIANTS = ['standard', 'from position']
const RESULTS: readonly GameResult[] = ['1-0', '0-1', '1/2-1/2', '*']

/** The only Game constructor. Everything that reaches the domain as moves went through here. */
export function gameFromPgn(pgn: string, source: GameSource): Result<Game, GameRejection> {
  // chess.js rejects a Chess960 start before its headers can be read, so the variant tag is checked on the raw text.
  const variant = /^\s*\[Variant\s+"([^"]*)"\s*\]/m.exec(pgn)?.[1]
  if (variant !== undefined && !PLAYABLE_VARIANTS.includes(variant.toLowerCase())) {
    return reject('variant', variant)
  }
  const chess = new Chess()
  try {
    chess.loadPgn(pgn)
  } catch (e) {
    return reject('unparseable', e instanceof Error ? e.message : String(e))
  }
  const history = chess.history({ verbose: true })
  if (history.length === 0) return reject('no-moves', 'the PGN has no moves')

  const headers = chess.getHeaders()
  const start = history[0].before
  const players: ByColor<PlayerTag> = {
    w: { name: headers.White ?? '?', rating: rating(headers.WhiteElo) },
    b: { name: headers.Black ?? '?', rating: rating(headers.BlackElo) },
  }
  const inputs = engineInputs(start, history)
  const board = new Chess()
  // A legal move was played from every position but the last, so only the last can be terminal.
  const before = history.map((m, i) => playable(i, m.before, inputs[i], loaded(board, m.before)))
  const end = history.length
  const last = positionAt(end, history[end - 1].after, inputs[end], loaded(board, history[end - 1].after))
  const positions: NonEmpty<Position> = [before[0], ...before.slice(1), last]
  const moves = history.map((m, i) => playedMove(i, m, before[i], positions[i + 1]))
  return {
    ok: true,
    value: {
      id: gameId(source, history, start, headers),
      source,
      players,
      result: RESULTS.find((r) => r === headers.Result) ?? '*',
      playedAt: playedAt(headers),
      timeControl: headers.TimeControl && headers.TimeControl !== '?' ? headers.TimeControl : null,
      pgn: chess.pgn(),
      positions,
      moves,
    },
  }
}

function positionKey(input: EngineInput): PositionKey {
  return `${input.root}|${input.tail.join(' ')}` as PositionKey
}

/** The move `uci` from `before`, or null when it is illegal there. Lines that branch off a game are built from these. */
export function playMove(before: PlayablePosition, uci: Uci): PlayedMove | null {
  const board = new Chess(before.fen)
  const m = moveUci(board, uci)
  return m && playedMove(before.index, m, before, positionAt(before.index + 1, m.after, nextInput(before.input, m), board))
}

/** The position `input` describes, `index` plies into its game, or null when its moves are illegal or the game is over there.
 *  For what was stored without its game, such as a training item. */
export function playableAt(input: EngineInput, index: number): PlayablePosition | null {
  const board = new Chess(input.root)
  if (!input.tail.every((u) => moveUci(board, u))) return null
  const p = positionAt(index, board.fen(), input, board)
  return p.kind === 'playable' ? p : null
}

function moveUci(board: Chess, uci: Uci): Move | null {
  try {
    return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined })
  } catch {
    return null
  }
}

/** The position after the last pawn move or capture, then every move since. Index 0 is the start. */
function engineInputs(start: string, history: readonly Move[]): EngineInput[] {
  const inputs: EngineInput[] = [{ root: start as Fen, tail: [] }]
  for (const m of history) inputs.push(nextInput(inputs[inputs.length - 1], m))
  return inputs
}

function nextInput(input: EngineInput, m: Move): EngineInput {
  return halfmoveClock(m.after) === 0 ? { root: m.after as Fen, tail: [] } : { root: input.root, tail: [...input.tail, m.lan as Uci] }
}

function positionAt(index: number, fen: string, input: EngineInput, board: Chess): Position {
  if (board.isCheckmate()) return { index, fen: fen as Fen, turn: board.turn(), kind: 'checkmate' }
  if (board.isStalemate()) return { index, fen: fen as Fen, turn: board.turn(), kind: 'stalemate' }
  return playable(index, fen, input, board)
}

function playable(index: number, fen: string, input: EngineInput, board: Chess): PlayablePosition {
  return { index, fen: fen as Fen, turn: board.turn(), kind: 'playable', input, key: positionKey(input), legalMoves: board.moves().length }
}

function playedMove(index: number, m: Move, before: PlayablePosition, after: Position): PlayedMove {
  return {
    index,
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
  }
}

function loaded(board: Chess, fen: string): Chess {
  board.load(fen)
  return board
}

function halfmoveClock(fen: string): number {
  return Number(fen.split(' ')[4])
}

function rating(elo: string | undefined): number | null {
  const n = Number(elo)
  return elo && Number.isInteger(n) && n > 0 ? n : null
}

function playedAt(h: Record<string, string | undefined>): number | null {
  const date = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(h.UTCDate ?? h.Date ?? '')
  if (!date) return null
  const time = /^(\d{2}):(\d{2}):(\d{2})$/.exec(h.UTCTime ?? '') ?? [null, '0', '0', '0']
  return Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), Number(time[1]), Number(time[2]), Number(time[3]))
}

function gameId(source: GameSource, history: readonly Move[], start: string, h: Record<string, string | undefined>): GameId {
  switch (source.kind) {
    case 'lichess':
      return `lichess:${source.id}` as GameId
    case 'chesscom':
      return `chesscom:${source.uuid}` as GameId
    case 'played':
      return `played:${source.id}` as GameId
    case 'pgn': {
      const movetext = history.map((m) => m.san).join(' ')
      return `pgn:${cyrb53([start, movetext, h.White, h.Black, h.Date].join('|'))}` as GameId
    }
  }
}

function reject(kind: GameRejection['kind'], detail: string): Result<never, GameRejection> {
  return { ok: false, error: { kind, detail } }
}

/** cyrb53 by bryc (public domain): a fast 53-bit string hash, plenty for telling pasted games apart. */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
