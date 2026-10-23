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
  const fens = [start, ...history.map((m) => m.after)]
  const inputs = engineInputs(fens, history)
  const board = new Chess()
  // A legal move was played from every position but the last, so only the last can be terminal.
  const before = history.map((m, i) => playable(i, m.before, inputs[i], loaded(board, m.before)))
  const end = history.length
  const final = loaded(board, fens[end])
  const last: Position = final.isCheckmate()
    ? { index: end, fen: fens[end] as Fen, turn: final.turn(), kind: 'checkmate' }
    : final.isStalemate()
      ? { index: end, fen: fens[end] as Fen, turn: final.turn(), kind: 'stalemate' }
      : playable(end, fens[end], inputs[end], final)
  const positions: NonEmpty<Position> = [before[0], ...before.slice(1), last]
  const moves = history.map((m, i): PlayedMove => ({
    index: i,
    mover: m.color,
    san: m.san as San,
    uci: m.lan as Uci,
    from: m.from,
    to: m.to,
    piece: m.piece,
    captured: m.captured ?? null,
    promotion: m.promotion ?? null,
    before: before[i],
    after: positions[i + 1],
  }))
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

/** The position after the last pawn move or capture, then every move since. Index 0 is the start. */
function engineInputs(fens: readonly string[], history: readonly Move[]): EngineInput[] {
  let root = 0
  return fens.map((fen, i) => {
    if (halfmoveClock(fen) === 0) root = i
    return { root: fens[root] as Fen, tail: history.slice(root, i).map((m) => m.lan as Uci) }
  })
}

function playable(index: number, fen: string, input: EngineInput, board: Chess): PlayablePosition {
  return { index, fen: fen as Fen, turn: board.turn(), kind: 'playable', input, key: positionKey(input), legalMoves: board.moves().length }
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
